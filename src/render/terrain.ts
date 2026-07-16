// Terrain chunk baking: static terrain rendered once per zoom level into
// offscreen chunk canvases; per frame we only blit visible chunks (06).
import { Biome } from '../shared/types';
import { DB32_RGB, P, PAL_RGB, PE } from './palette';

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

/** Deterministic per-tile hash for dither (render-only; not a sim stream). */
function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Bayer 4x4 ordered dither, centered around 0 (v3: subtle woven texture that
// replaces the old flat-rectangle banding; same trick WorldBox-style maps use).
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];
function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] - 7.5) / 7.5; // -1..1
}

type RGB = readonly [number, number, number];
function lerp3(a: RGB, b: RGB, t: number): [number, number, number] {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const C = (slot: number): RGB => PAL_RGB[slot];

export function tileColor(m: RenderMapData, i: number, x: number, y: number): [number, number, number] {
  const b = m.biome[i];
  const e = m.elevation[i];
  const N = m.size;
  let r: number, g: number, bl: number;

  const water = b === Biome.DeepOcean || b === Biome.Ocean || b === Biome.Lake;
  if (water) {
    // depth ramp: deep -> shallow as elevation rises toward the coast, with a
    // bright shelf right at the land edge and a soft checker weave
    let t = (e - 30) / 90; // ~0 deep, ~1 near sea level
    if (t < 0) t = 0; if (t > 1) t = 1;
    let c: [number, number, number];
    if (b === Biome.DeepOcean) c = lerp3(C(PE.oceanDeep), C(PE.ocean), t);
    else if (b === Biome.Ocean) c = lerp3(C(PE.ocean), C(PE.oceanShallow), t);
    else c = lerp3(C(PE.oceanShallow), C(PE.oceanShelf), t * 0.7); // lake
    // land-adjacent shelf brightening
    const nearLand =
      (x + 1 < N && !isWaterB(m.biome[i + 1])) || (x > 0 && !isWaterB(m.biome[i - 1])) ||
      (y + 1 < N && !isWaterB(m.biome[i + N])) || (y > 0 && !isWaterB(m.biome[i - N]));
    if (nearLand) c = lerp3(c, C(PE.oceanShelf), 0.45);
    const d = bayer(x, y) * 4 + ((tileHash(x, y) & 3) - 1.5);
    r = c[0] + d; g = c[1] + d; bl = c[2] + d * 1.4;
  } else {
    const moist = m.moisture[i] / 255;
    const fert = m.fertility[i] / 255;
    let c: [number, number, number];
    switch (b) {
      case Biome.Grassland:
        // lush where fertile/wet, sun-bright where dry
        c = lerp3(C(PE.grassBright), C(PE.grassDark), moist * 0.75 + fert * 0.25);
        break;
      case Biome.Steppe:
        c = lerp3(C(PE.steppe), C(PE.steppeDark), moist);
        if (fert > 0.55) c = lerp3(c, C(PE.grass), (fert - 0.55) * 1.4);
        break;
      case Biome.Forest:
        c = lerp3(C(PE.grassDeep), C(PE.forestFloor), m.forest[i] / 255);
        break;
      case Biome.DarkForest:
        c = lerp3(C(PE.forestFloor), C(PE.forestFloorDark), 0.4 + m.forest[i] / 512);
        break;
      case Biome.Hills:
        c = lerp3(C(PE.hillMoss), C(PE.hillDark), (e - 130) / 80);
        break;
      case Biome.Mountain: {
        c = lerp3(C(PE.rockDark), C(PE.rock), (e - 150) / 60);
        if (e > 190) c = lerp3(c, C(PE.rockLight), (e - 190) / 40);
        if (e > 215) c = lerp3(c, C(PE.snowShadow), (e - 215) / 30);
        break;
      }
      case Biome.Beach:
        c = lerp3(C(PE.sand), C(PE.sandDark), moist * 0.6);
        break;
      case Biome.Swamp:
        c = lerp3(C(PE.swamp), C(PE.forestFloor), moist * 0.7);
        break;
      case Biome.Snow:
        c = lerp3(C(PE.snow), C(PE.snowShadow), (230 - e) / 120);
        break;
      default:
        c = [PAL_RGB[P.gray][0], PAL_RGB[P.gray][1], PAL_RGB[P.gray][2]];
    }
    [r, g, bl] = c;

    // hillshade: light from the NW; slope vs the up-left neighbor (bake-time cost only)
    if (x > 0 && y > 0) {
      const slope = e - m.elevation[i - N - 1];
      const relief = b === Biome.Mountain || b === Biome.Hills ? 1.6 : b === Biome.Snow ? 1.0 : 0.7;
      const shade = Math.max(-20, Math.min(24, slope * relief));
      r += shade; g += shade; bl += shade * 0.8;
    }
    // ore glints
    if (m.ore[i] > 400) { r += 14; g += 6; bl -= 4; }
    // rivers read as real water, not a tint
    if (m.flags[i] & 1) {
      const w = lerp3([r, g, bl], C(PE.oceanShallow), 0.78);
      r = w[0]; g = w[1]; bl = w[2];
    }
    // woven micro-texture: ordered dither + a whisper of hash noise
    const d = bayer(x, y) * 3.2 + ((tileHash(x, y) & 7) - 3.5) * 0.9;
    r += d; g += d; bl += d;
  }
  return [
    Math.max(0, Math.min(255, r | 0)),
    Math.max(0, Math.min(255, g | 0)),
    Math.max(0, Math.min(255, bl | 0)),
  ];
}

function isWaterB(b: number): boolean {
  return b === Biome.DeepOcean || b === Biome.Ocean || b === Biome.Lake;
}

const hex = (slot: number) => `rgb(${DB32_RGB[slot][0]},${DB32_RGB[slot][1]},${DB32_RGB[slot][2]})`;

const hexE = (slot: number) => `rgb(${PAL_RGB[slot][0]},${PAL_RGB[slot][1]},${PAL_RGB[slot][2]})`;

/** Terrain beauty pass v2 (doc 14 T1.3/T1.4): grass tufts, flower clusters,
 *  two-tone trees, pine stands, ridge shading, crisp snowfields, shore foam,
 *  animated wave rows (frame 0/1), reeds. All seeded by tileHash, all baked
 *  into the chunk: zero runtime cost. */
function decorate(
  ctx: CanvasRenderingContext2D, m: RenderMapData,
  baseX: number, baseY: number, px: number, frame: number,
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
        // animated wave rows: two interleaved phases so frame flips read as
        // gentle swell; brighter + denser on shallow water
        const shallow = b !== Biome.DeepOcean;
        const wavePick = (h >>> 2) & 3;
        if (wavePick === (frame === 0 ? 0 : 2)) {
          ctx.fillStyle = shallow ? 'rgba(203,219,252,0.5)' : 'rgba(203,219,252,0.28)';
          const wl = px * (0.35 + u(1) * 0.3);
          ctx.fillRect(ox + u(2) * (px - wl), oy + u(3) * px, wl, 1);
        }
        // sparkle glints, frame-offset so they twinkle
        if (((h + (frame ? 7 : 0)) % 61) === 5) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillRect(ox + u(4) * px, oy + u(5) * px, 1, 1);
        }
        // shore foam: 2px bright edge + a breaking-wave run on some tiles
        const landRight = wx + 1 < N && !isWater(m.biome[i + 1]);
        const landDown = wy + 1 < N && !isWater(m.biome[i + N]);
        const landLeft = wx > 0 && !isWater(m.biome[i - 1]);
        const landUp = wy > 0 && !isWater(m.biome[i - N]);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        if (landRight) ctx.fillRect(ox + px - 2, oy, 2, px);
        if (landLeft) ctx.fillRect(ox, oy, 2, px);
        if (landDown) ctx.fillRect(ox, oy + px - 2, px, 2);
        if (landUp) ctx.fillRect(ox, oy, px, 2);
        if ((landRight || landLeft || landDown || landUp) && ((h + frame) & 3) === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(ox + u(6) * px * 0.4, oy + u(1) * px * 0.4, px * 0.5, 1);
        }
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
          // grass tufts: light + dark blades
          if ((h & 7) < 4) {
            ctx.fillStyle = b === Biome.Steppe ? hexE(PE.steppeDark) : hexE(PE.grassDeep);
            ctx.fillRect(ox + u(1) * (px - 2), oy + u(2) * (px - 2), 1, 2);
            ctx.fillRect(ox + u(3) * (px - 2), oy + u(4) * (px - 2), 1, 2);
            ctx.fillStyle = b === Biome.Steppe ? hexE(PE.cropGold) : hexE(PE.grassBright);
            ctx.fillRect(ox + u(5) * (px - 2), oy + u(6) * (px - 2), 1, 2);
          }
          // flower clusters (3 dots, mixed colors), meadow feel on lush tiles
          if ((h % 41) === 5 && m.fertility[i] > 70) {
            const fx = ox + u(5) * (px - 3), fy = oy + u(6) * (px - 3);
            const s = Math.max(1, Math.floor(px / 12));
            ctx.fillStyle = (h & 1) ? hex(P.yellow) : hex(P.white);
            ctx.fillRect(fx, fy, s, s);
            ctx.fillStyle = (h & 2) ? hex(P.pink) : hex(P.salmon);
            ctx.fillRect(fx + s + 1, fy + 1, s, s);
            ctx.fillStyle = hex(P.yellow);
            ctx.fillRect(fx + 1, fy + s + 1, s, s);
          }
          // lone trees dot lush grassland
          if (m.forest[i] === 0 && (h % 37) === 7 && m.fertility[i] > 80 && b === Biome.Grassland) {
            tree(ctx, ox + px / 2, oy + px / 2, px * 0.5, hexE(PE.grass), hexE(PE.grassDeep));
          }
          break;
        }
        case Biome.Forest:
        case Biome.DarkForest: {
          const dense = m.forest[i] > 90;
          const canopy = b === Biome.DarkForest ? hexE(PE.forestFloorDark) : hexE(PE.grassDeep);
          const lit = b === Biome.DarkForest ? hexE(PE.forestFloor) : hexE(PE.grass);
          // denser stands so forest reads as forest, canopies overlapping
          if ((h & 3) < (dense ? 3 : 2)) {
            tree(ctx, ox + u(1) * px * 0.6 + px * 0.2, oy + u(2) * px * 0.6 + px * 0.2, px * (0.42 + u(3) * 0.3), lit, canopy);
          }
          if ((h & 7) === 1) {
            tree(ctx, ox + u(4) * px * 0.6 + px * 0.2, oy + u(5) * px * 0.6 + px * 0.2, px * 0.36, lit, canopy);
          }
          if (dense && (h & 7) === 6) {
            tree(ctx, ox + u(6) * px * 0.7, oy + u(2) * px * 0.7, px * 0.3, lit, canopy);
          }
          // rare mushrooms on the dark forest floor
          if (b === Biome.DarkForest && (h % 89) === 3 && px >= 12) {
            ctx.fillStyle = hex(P.red);
            ctx.fillRect(ox + u(3) * px, oy + u(4) * px, 2, 1);
            ctx.fillStyle = hex(P.white);
            ctx.fillRect(ox + u(3) * px, oy + u(4) * px + 1, 1, 1);
          }
          break;
        }
        case Biome.Mountain: {
          const e = m.elevation[i];
          // ridge strokes follow the hillshade: dark crease + lit crest
          if ((h & 3) === 0) {
            ctx.fillStyle = 'rgba(30,34,44,0.30)';
            ctx.fillRect(ox + u(1) * px * 0.4, oy + u(2) * px * 0.6 + px * 0.3, px * 0.55, Math.max(1, px * 0.08));
            ctx.fillStyle = 'rgba(255,255,255,0.20)';
            ctx.fillRect(ox + u(1) * px * 0.4 + 1, oy + u(2) * px * 0.6 + px * 0.3 - Math.max(1, px * 0.08), px * 0.45, Math.max(1, px * 0.08));
          }
          // crisp snowfield patches on the peaks (solid shapes, not dashes)
          if (e > 212) {
            ctx.fillStyle = hexE(PE.snow);
            ctx.beginPath();
            ctx.ellipse(ox + px * (0.3 + u(5) * 0.4), oy + px * (0.3 + u(6) * 0.3), px * 0.34, px * 0.22, 0, 0, 7);
            ctx.fill();
          }
          // scree at the foot
          if (e < 175 && (h % 23) === 2) {
            ctx.fillStyle = hexE(PE.rockDark);
            ctx.fillRect(ox + u(3) * px * 0.7, oy + u(4) * px * 0.7, px * 0.18, px * 0.12);
          }
          // scattered pines on the lower slopes
          if (e < 185 && (h % 31) === 4) {
            pine(ctx, ox + px * 0.5, oy + px * 0.55, px * 0.5, hexE(PE.forestFloor), hexE(PE.forestFloorDark));
          }
          break;
        }
        case Biome.Hills: {
          // contour creases + light crests give rolling relief
          if ((h & 7) < 3) {
            ctx.fillStyle = 'rgba(30,34,20,0.18)';
            ctx.fillRect(ox + u(1) * px * 0.4, oy + u(2) * px * 0.6 + px * 0.25, px * 0.55, 1);
            ctx.fillStyle = 'rgba(255,255,240,0.12)';
            ctx.fillRect(ox + u(1) * px * 0.4, oy + u(2) * px * 0.6 + px * 0.25 - 1, px * 0.45, 1);
          }
          if ((h % 41) === 3) {
            ctx.fillStyle = hexE(PE.rock);
            ctx.fillRect(ox + u(5) * px * 0.7, oy + u(6) * px * 0.7, px * 0.2, px * 0.15);
          }
          // hilltop copses
          if ((h % 29) === 6 && m.forest[i] > 20) {
            tree(ctx, ox + px * 0.5, oy + px * 0.5, px * 0.42, hexE(PE.grass), hexE(PE.grassDeep));
          }
          break;
        }
        case Biome.Swamp: {
          if ((h & 3) === 1) {
            ctx.fillStyle = 'rgba(20,30,40,0.35)';
            ctx.beginPath();
            ctx.ellipse(ox + u(1) * px * 0.6 + px * 0.2, oy + u(2) * px * 0.6 + px * 0.2, px * 0.24, px * 0.14, 0, 0, 7);
            ctx.fill();
          }
          // reeds
          if ((h & 7) < 3) {
            ctx.fillStyle = hexE(PE.grassDeep);
            ctx.fillRect(ox + u(3) * px, oy + u(4) * px * 0.5, 1, px * 0.4);
            ctx.fillRect(ox + u(5) * px, oy + u(6) * px * 0.5, 1, px * 0.3);
          }
          // gnarled swamp trees
          if ((h % 43) === 8) {
            tree(ctx, ox + px * 0.5, oy + px * 0.45, px * 0.38, hexE(PE.swamp), hexE(PE.forestFloorDark));
          }
          break;
        }
        case Biome.Beach: {
          if ((h & 7) === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillRect(ox + u(1) * px, oy + u(2) * px, 1, 1);
            ctx.fillRect(ox + u(3) * px, oy + u(4) * px, 1, 1);
          }
          // driftwood + shells, rare
          if ((h % 79) === 11 && px >= 12) {
            ctx.fillStyle = hexE(PE.wood);
            ctx.fillRect(ox + u(5) * px * 0.6, oy + u(6) * px * 0.6, px * 0.3, Math.max(1, px * 0.07));
          }
          break;
        }
        case Biome.Snow: {
          // sparkle + wind-blown drift lines
          if (((h + frame * 5) % 53) === 9) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(ox + u(1) * px, oy + u(2) * px, 1, 1);
          }
          if ((h & 15) === 4) {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillRect(ox + u(3) * px * 0.5, oy + u(4) * px, px * 0.5, 1);
          }
          // snow pines
          if ((h % 27) === 5) {
            pine(ctx, ox + px * 0.5, oy + px * 0.55, px * 0.55, hexE(PE.snowShadow), hexE(PE.forestFloorDark));
          }
          break;
        }
      }
      // river sparkle, frame-shifted so rivers glitter
      if ((m.flags[i] & 1) && ((h + frame * 3) & 15) === 6) {
        ctx.fillStyle = 'rgba(230,242,255,0.9)';
        ctx.fillRect(ox + u(1) * px, oy + u(2) * px, Math.max(1, px / 8), 1);
      }
    }
  }
}

/** tiny broadleaf tree: shadow, trunk, canopy with a lit crown + top glint */
function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lit: string, dark: string): void {
  ctx.fillStyle = 'rgba(20,20,31,0.3)';
  ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.5, r * 0.7, r * 0.3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = hexE(PE.wood);
  ctx.fillRect(x - 1, y, 2, r * 0.55);
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(x, y - r * 0.35, r * 0.68, 0, 7); ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath(); ctx.arc(x - r * 0.18, y - r * 0.5, r * 0.4, 0, 7); ctx.fill();
  if (r >= 6) {
    ctx.fillStyle = 'rgba(255,255,240,0.35)';
    ctx.fillRect(x - r * 0.35, y - r * 0.75, Math.max(1, r * 0.18), Math.max(1, r * 0.12));
  }
}

/** conifer: shadow, trunk, two stacked triangles with a lit edge */
function pine(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lit: string, dark: string): void {
  ctx.fillStyle = 'rgba(20,20,31,0.3)';
  ctx.beginPath(); ctx.ellipse(x + r * 0.2, y + r * 0.45, r * 0.55, r * 0.22, 0, 0, 7); ctx.fill();
  ctx.fillStyle = hexE(PE.wood);
  ctx.fillRect(x - 1, y + r * 0.1, 2, r * 0.35);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.05); ctx.lineTo(x - r * 0.5, y + r * 0.15); ctx.lineTo(x + r * 0.5, y + r * 0.15);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.05); ctx.lineTo(x - r * 0.32, y - r * 0.25); ctx.lineTo(x, y - r * 0.25);
  ctx.closePath(); ctx.fill();
}

export class TerrainCache {
  private chunks = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  private dirty = new Set<string>();

  constructor(public map: RenderMapData) {}

  invalidateTile(x: number, y: number): void {
    const cx = Math.floor(x / CHUNK_TILES), cy = Math.floor(y / CHUNK_TILES);
    for (const key of this.chunks.keys()) {
      if (key.endsWith(`:${cx},${cy}`) || key.endsWith(`:${cx},${cy}~1`)) this.dirty.add(key);
    }
  }

  invalidateAll(): void {
    this.chunks.clear();
    this.dirty.clear();
    this.still.clear();
  }

  /** chunks that contain no water bake one frame and alias frame 1 to it */
  private still = new Set<string>();

  /** Get (or bake) the chunk canvas at chunk coords for a px-per-tile level.
   *  frame 0/1 selects the water-animation phase (doc 14 T1.3); land-only
   *  chunks are baked once and shared between frames. */
  chunk(pxPerTile: number, cx: number, cy: number, frame = 0): HTMLCanvasElement | OffscreenCanvas | null {
    if (pxPerTile < 8) frame = 0; // waves only exist in the decorated bakes
    const baseKey = `${pxPerTile}:${cx},${cy}`;
    if (frame === 1 && this.still.has(baseKey)) frame = 0;
    const key = frame === 0 ? baseKey : `${baseKey}~1`;
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
    // frame-dependent decor lives on water, rivers, and snowfields; chunks
    // without any of them bake once and alias both frames to one canvas
    let hasAnim = false;
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const wx = baseX + tx, wy = baseY + ty;
        const o = (ty * CHUNK_TILES + tx) * 4;
        if (wx >= m.size || wy >= m.size) { data[o + 3] = 0; continue; }
        const i = wy * m.size + wx;
        if (!hasAnim && (isWaterB(m.biome[i]) || (m.flags[i] & 1) || m.biome[i] === Biome.Snow)) hasAnim = true;
        const [r, g, b] = tileColor(m, i, wx, wy);
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }
    if (!hasAnim) {
      this.still.add(baseKey);
      if (frame === 1) {
        // first bake happened during the odd phase: keep ONE canvas, filed
        // under the base key, so no duplicate chunk lingers in the cache
        this.chunks.delete(key);
        this.chunks.set(baseKey, c);
      }
    }
    // draw 1px imagedata then scale up crisply via drawImage of a temp canvas
    const tmp = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(CHUNK_TILES, CHUNK_TILES)
      : Object.assign(document.createElement('canvas'), { width: CHUNK_TILES, height: CHUNK_TILES });
    (tmp.getContext('2d') as CanvasRenderingContext2D).putImageData(img, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(tmp as CanvasImageSource, 0, 0, size, size);
    // beauty pass at readable zooms; bake-time, so free per frame
    if (pxPerTile >= 8) decorate(ctx, m, baseX, baseY, pxPerTile, frame);
    return c;
  }

  /** Evict all chunks not at the given zoom (memory bound when ladder changes). */
  trim(keepPx: number): void {
    for (const key of [...this.chunks.keys()]) {
      if (!key.startsWith(`${keepPx}:`)) {
        this.chunks.delete(key);
        this.still.delete(key.replace(/~1$/, ''));
      }
    }
  }
}
