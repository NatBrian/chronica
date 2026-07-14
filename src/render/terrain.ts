// Terrain chunk baking: static terrain rendered once per zoom level into
// offscreen chunk canvases; per frame we only blit visible chunks (06).
import { Biome } from '../shared/types';
import { DB32_RGB, P } from './palette';

export interface RenderMapData {
  size: number;
  biome: Uint8Array;
  elevation: Uint8Array;
  moisture: Uint8Array;
  fertility: Uint8Array;
  forest: Uint8Array;
  ore: Uint16Array;
  flags: Uint8Array;
  waterFlux: Uint16Array;
  temperature: Uint8Array;
  fish: Uint8Array;
  game: Uint8Array;
}

export const CHUNK_TILES = 32;

const BIOME_BASE: Record<number, number> = {
  [Biome.DeepOcean]: P.navy,
  [Biome.Ocean]: P.seaBlue,
  [Biome.Lake]: P.blue,
  [Biome.Beach]: P.peach,
  [Biome.Grassland]: P.green,
  [Biome.Forest]: P.darkGreen,
  [Biome.DarkForest]: P.darkSlate,
  [Biome.Hills]: P.olive,
  [Biome.Mountain]: P.gray,
  [Biome.Steppe]: P.ocher,
  [Biome.Swamp]: P.mossYellow,
  [Biome.Snow]: P.paleBlue,
};

/** Deterministic per-tile hash for dither (render-only; not a sim stream). */
function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function tileColor(m: RenderMapData, i: number, x: number, y: number): [number, number, number] {
  const b = m.biome[i];
  const base = DB32_RGB[BIOME_BASE[b] ?? P.gray];
  let [r, g, bl] = base;
  // elevation shading: higher = lighter (land only)
  const e = m.elevation[i];
  if (b !== Biome.DeepOcean && b !== Biome.Ocean && b !== Biome.Lake) {
    const shade = (e - 110) * 0.35;
    r += shade; g += shade; bl += shade;
    // moisture darkens grass slightly
    const mo = (m.moisture[i] - 128) * 0.08;
    g += mo;
    // forest density darkens
    if (m.forest[i] > 0) { r -= m.forest[i] * 0.08; g -= m.forest[i] * 0.03; bl -= m.forest[i] * 0.05; }
    // ore glints
    if (m.ore[i] > 400) { r += 14; g += 6; bl -= 4; }
    // river tint
    if (m.flags[i] & 1) { r -= 30; g -= 8; bl += 42; }
    // dither
    const d = (tileHash(x, y) & 15) - 8;
    r += d; g += d; bl += d;
  } else {
    // ocean depth shading
    const d = (tileHash(x, y) & 7) - 4;
    bl += (e - 60) * 0.3 + d;
    g += (e - 60) * 0.2 + d;
  }
  return [
    Math.max(0, Math.min(255, r | 0)),
    Math.max(0, Math.min(255, g | 0)),
    Math.max(0, Math.min(255, bl | 0)),
  ];
}

const hex = (slot: number) => `rgb(${DB32_RGB[slot][0]},${DB32_RGB[slot][1]},${DB32_RGB[slot][2]})`;

/** Terrain beauty pass (doc 13 V3): grass tufts, flowers, trees with shadows,
 *  rocks, shore foam, wave dashes, reeds, snow caps. All seeded by tileHash,
 *  all baked into the chunk: zero runtime cost. */
function decorate(
  ctx: CanvasRenderingContext2D, m: RenderMapData,
  baseX: number, baseY: number, px: number,
): void {
  const N = m.size;
  const isWater = (b: number) => b === Biome.DeepOcean || b === Biome.Ocean || b === Biome.Lake;
  for (let ty = 0; ty < CHUNK_TILES; ty++) {
    for (let tx = 0; tx < CHUNK_TILES; tx++) {
      const wx = baseX + tx, wy = baseY + ty;
      if (wx >= N || wy >= N) continue;
      const i = wy * N + wx;
      const b = m.biome[i];
      const h = tileHash(wx, wy);
      const ox = tx * px, oy = ty * px;
      const u = (k: number) => ((h >>> (k * 3)) & 7) / 8;   // seeded sub-tile coords

      if (isWater(b)) {
        // wave dashes + shore foam against any land neighbor
        if ((h & 31) === 3) {
          ctx.fillStyle = 'rgba(203,219,252,0.35)';
          ctx.fillRect(ox + u(1) * px * 0.6, oy + u(2) * px, px * 0.4, 1);
        }
        const landRight = wx + 1 < N && !isWater(m.biome[i + 1]);
        const landDown = wy + 1 < N && !isWater(m.biome[i + N]);
        const landLeft = wx > 0 && !isWater(m.biome[i - 1]);
        const landUp = wy > 0 && !isWater(m.biome[i - N]);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        if (landRight) ctx.fillRect(ox + px - 2, oy + u(3) * px * 0.5, 2, px * 0.55);
        if (landLeft) ctx.fillRect(ox, oy + u(4) * px * 0.5, 2, px * 0.55);
        if (landDown) ctx.fillRect(ox + u(5) * px * 0.5, oy + px - 2, px * 0.55, 2);
        if (landUp) ctx.fillRect(ox + u(6) * px * 0.5, oy, px * 0.55, 2);
        continue;
      }

      // biome edge dither: sprinkle a few px of the right/down neighbor color
      const nb = wx + 1 < N ? m.biome[i + 1] : b;
      if (nb !== b && !isWater(nb) && (h & 3) === 0) {
        const [nr, ng, nbl] = tileColor(m, i + 1, wx + 1, wy);
        ctx.fillStyle = `rgb(${nr},${ng},${nbl})`;
        ctx.fillRect(ox + px - 2, oy + u(1) * (px - 2), 2, 2);
        ctx.fillRect(ox + px - 4, oy + u(2) * (px - 2), 2, 2);
      }

      switch (b) {
        case Biome.Grassland:
        case Biome.Steppe: {
          // grass tufts
          if ((h & 7) < 3) {
            ctx.fillStyle = b === Biome.Steppe ? hex(P.olive) : hex(P.darkGreen);
            ctx.fillRect(ox + u(1) * (px - 2), oy + u(2) * (px - 2), 1, 2);
            ctx.fillRect(ox + u(3) * (px - 2), oy + u(4) * (px - 2), 1, 2);
          }
          // flowers, rare
          if ((h % 97) === 5) {
            ctx.fillStyle = (h & 1) ? hex(P.yellow) : hex(P.pink);
            ctx.fillRect(ox + u(5) * (px - 1), oy + u(6) * (px - 1), Math.max(1, px / 12), Math.max(1, px / 12));
          }
          // lone tree on lush grass
          if (m.forest[i] === 0 && (h % 53) === 7 && m.fertility[i] > 90) {
            tree(ctx, ox + px / 2, oy + px / 2, px * 0.5, hex(P.green), hex(P.darkGreen));
          }
          break;
        }
        case Biome.Forest:
        case Biome.DarkForest: {
          const dense = m.forest[i] > 90;
          const canopy = b === Biome.DarkForest ? hex(P.darkSlate) : hex(P.darkGreen);
          const lit = b === Biome.DarkForest ? hex(P.darkGreen) : hex(P.green);
          if ((h & 3) < (dense ? 3 : 2)) {
            tree(ctx, ox + u(1) * px * 0.6 + px * 0.2, oy + u(2) * px * 0.6 + px * 0.2, px * (0.4 + u(3) * 0.3), lit, canopy);
          }
          if (dense && (h & 7) === 1) {
            tree(ctx, ox + u(4) * px * 0.6 + px * 0.2, oy + u(5) * px * 0.6 + px * 0.2, px * 0.35, lit, canopy);
          }
          break;
        }
        case Biome.Mountain: {
          // rock facets: a light + a dark wedge
          if ((h & 3) === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillRect(ox + u(1) * px * 0.5, oy + u(2) * px * 0.5, px * 0.4, px * 0.2);
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.fillRect(ox + u(3) * px * 0.5 + px * 0.2, oy + u(4) * px * 0.5 + px * 0.25, px * 0.4, px * 0.2);
          }
          // snow caps on the high peaks
          if (m.elevation[i] > 210 && (h & 1) === 0) {
            ctx.fillStyle = hex(P.white);
            ctx.fillRect(ox + u(5) * px * 0.5, oy + u(6) * px * 0.4, px * 0.45, Math.max(1, px * 0.15));
          }
          break;
        }
        case Biome.Hills: {
          if ((h & 7) === 2) {
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(ox + u(1) * px * 0.5, oy + u(2) * px * 0.7, px * 0.5, 1);
            ctx.fillRect(ox + u(3) * px * 0.5, oy + u(4) * px * 0.7 + 2, px * 0.35, 1);
          }
          if ((h % 41) === 3) {
            ctx.fillStyle = hex(P.gray);
            ctx.fillRect(ox + u(5) * px * 0.7, oy + u(6) * px * 0.7, px * 0.2, px * 0.15);
          }
          break;
        }
        case Biome.Swamp: {
          if ((h & 3) === 1) {
            ctx.fillStyle = 'rgba(20,20,31,0.25)';
            ctx.fillRect(ox + u(1) * px * 0.7, oy + u(2) * px * 0.7, px * 0.3, px * 0.2);
          }
          if ((h & 7) === 4) {
            ctx.fillStyle = hex(P.darkGreen);
            ctx.fillRect(ox + u(3) * px, oy + u(4) * px * 0.5, 1, px * 0.4);
          }
          break;
        }
        case Biome.Beach: {
          if ((h & 7) === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(ox + u(1) * px, oy + u(2) * px, 1, 1);
            ctx.fillRect(ox + u(3) * px, oy + u(4) * px, 1, 1);
          }
          break;
        }
      }
      // river sparkle
      if ((m.flags[i] & 1) && (h & 15) === 6) {
        ctx.fillStyle = 'rgba(203,219,252,0.8)';
        ctx.fillRect(ox + u(1) * px, oy + u(2) * px, Math.max(1, px / 10), 1);
      }
    }
  }
}

/** tiny tree: shadow, trunk, canopy with a lit crown */
function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lit: string, dark: string): void {
  ctx.fillStyle = 'rgba(20,20,31,0.3)';
  ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.5, r * 0.7, r * 0.3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#663931';
  ctx.fillRect(x - 1, y, 2, r * 0.5);
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(x, y - r * 0.35, r * 0.65, 0, 7); ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.5, r * 0.38, 0, 7); ctx.fill();
}

export class TerrainCache {
  private chunks = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  private dirty = new Set<string>();

  constructor(public map: RenderMapData) {}

  invalidateTile(x: number, y: number): void {
    const cx = Math.floor(x / CHUNK_TILES), cy = Math.floor(y / CHUNK_TILES);
    for (const key of this.chunks.keys()) {
      if (key.endsWith(`:${cx},${cy}`)) this.dirty.add(key);
    }
  }

  invalidateAll(): void {
    this.chunks.clear();
    this.dirty.clear();
  }

  /** Get (or bake) the chunk canvas at chunk coords for a px-per-tile level. */
  chunk(pxPerTile: number, cx: number, cy: number): HTMLCanvasElement | OffscreenCanvas | null {
    const key = `${pxPerTile}:${cx},${cy}`;
    let c = this.chunks.get(key);
    if (c && !this.dirty.has(key)) return c;
    this.dirty.delete(key);
    const m = this.map;
    const size = CHUNK_TILES * pxPerTile;
    if (!c) {
      c = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement('canvas'), { width: size, height: size });
      this.chunks.set(key, c);
    }
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(CHUNK_TILES, CHUNK_TILES);
    const data = img.data;
    const baseX = cx * CHUNK_TILES, baseY = cy * CHUNK_TILES;
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const wx = baseX + tx, wy = baseY + ty;
        const o = (ty * CHUNK_TILES + tx) * 4;
        if (wx >= m.size || wy >= m.size) { data[o + 3] = 0; continue; }
        const i = wy * m.size + wx;
        const [r, g, b] = tileColor(m, i, wx, wy);
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }
    // draw 1px imagedata then scale up crisply via drawImage of a temp canvas
    const tmp = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(CHUNK_TILES, CHUNK_TILES)
      : Object.assign(document.createElement('canvas'), { width: CHUNK_TILES, height: CHUNK_TILES });
    (tmp.getContext('2d') as CanvasRenderingContext2D).putImageData(img, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(tmp as CanvasImageSource, 0, 0, size, size);
    // V3 (doc 13): per-tile decals at readable zooms; bake-time, so free per frame
    if (pxPerTile >= 8) decorate(ctx, m, baseX, baseY, pxPerTile);
    return c;
  }

  /** Evict all chunks not at the given zoom (memory bound when ladder changes). */
  trim(keepPx: number): void {
    for (const key of [...this.chunks.keys()]) {
      if (!key.startsWith(`${keepPx}:`)) this.chunks.delete(key);
    }
  }
}
