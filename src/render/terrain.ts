// Terrain chunk baking — static terrain rendered once per zoom level into
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
    return c;
  }

  /** Evict all chunks not at the given zoom (memory bound when ladder changes). */
  trim(keepPx: number): void {
    for (const key of [...this.chunks.keys()]) {
      if (!key.startsWith(`${keepPx}:`)) this.chunks.delete(key);
    }
  }
}
