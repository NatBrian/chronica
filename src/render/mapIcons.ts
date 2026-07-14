// Map-mode icon atlas (11 §D1): settlement icons by tier × race, battle
// swords. Same template scheme as sprites.ts: chars → DB32 slots, baked once.
// 'r'/'R' race roof light/shadow · 'w'/'W' wall light/shadow · 'd' door
// 'k' outline · 'm' metal · 'b' wood · '.' transparent
import { DB32_RGB, P } from './palette';
import { Race } from '../shared/types';

export const ICON_W = 22;
export const ICON_H = 18;

// Roof colors give each race its silhouette accent (11 §B1 flavor, icon scale)
const ROOF: Record<Race, [number, number]> = {
  [Race.Human]: [P.rust, P.maroon],
  [Race.Elf]: [P.green, P.darkGreen],
  [Race.Dwarf]: [P.gray, P.darkGray],
  [Race.Orc]: [P.ocher, P.olive],
};

// One hut per race: human timber gable, elf curved canopy, dwarf stone slab,
// orc hide tent (11 §B1, reduced to icon scale)
const HUT: Record<Race, string[]> = {
  [Race.Human]: [
    '..rr...',
    '.rrrr..',
    'rrrrrr.',
    'kwwwwk.',
    'kwdwwk.',
    'kkkkkk.',
  ],
  [Race.Elf]: [
    '.rrrr..',
    'rrrrrr.',
    'rRRRRr.',
    '.kwwk..',
    '.kwdk..',
    '.kkkk..',
  ],
  [Race.Dwarf]: [
    '.......',
    'WWWWWW.',
    'WwwwwW.',
    'WwdwwW.',
    'WWWWWW.',
    '.......',
  ],
  [Race.Orc]: [
    '...r...',
    '..rrr..',
    '.rrrrr.',
    '.rRdRr.',
    'rrRdRrr',
    '.......',
  ],
};

const KEEP = [
  '.r..r..r.',
  '.rrrrrrr.',
  '.kwwwwwk.',
  '.kwwdwwk.',
  'kkwwwwwkk',
  'kwwwwwwwk',
  'kwdwwwdwk',
  'kkkkkkkkk',
];

const WALL = [
  'w.w.w.w.w.w.w.w.w.',
  'wwwwwwwwwwwwwwwwww',
];

const SWORDS = [
  'm.......m',
  'km.....mk',
  '.km...mk.',
  '..km.mk..',
  '...kmk...',
  '..km.mk..',
  '.bm...mb.',
  'bb.....bb',
];

function stamp(
  img: ImageData, rows: string[], ox: number, oy: number, race: Race,
): void {
  const [roof, roofShadow] = ROOF[race];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      let slot: number;
      switch (ch) {
        case 'r': slot = roof; break;
        case 'R': slot = roofShadow; break;
        case 'w': slot = P.silver; break;
        case 'W': slot = P.gray; break;
        case 'd': slot = P.charcoal; break;
        case 'k': slot = P.deepPurple; break;
        case 'm': slot = P.paleBlue; break;
        case 'b': slot = P.brown; break;
        default: continue;
      }
      const px = ox + x, py = oy + y;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const o = (py * img.width + px) * 4;
      const rgb = DB32_RGB[slot];
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
}

export interface MapIconAtlas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** `${race}:${tier}` for settlements, plus 'swords' */
  index: Record<string, { x: number; y: number }>;
}

/** Settlement pop → icon tier: hamlet / village / walled town / keep-city. */
export function popTier(pop: number): 0 | 1 | 2 | 3 {
  return pop >= 400 ? 3 : pop >= 220 ? 2 : pop >= 90 ? 1 : 0;
}

// ---- building sprites (M10, 11 §B1): tiered, race-flavored silhouettes ----
// kinds: 0 house, 1 granary, 2 workshop, 3 temple, 5 wall (4 farm = tiles)

const GRANARY = [
  '..kkkk..',
  '.krrrrk.',
  '.krrrrk.',
  '.kwwwwk.',
  '.kwwwwk.',
  '.kwddwk.',
  '.kwwwwk.',
  '.kkkkkk.',
];
const WORKSHOP = [
  '.....k..',
  '.kkkkk..',
  '.kwwwwk.',
  '.kwbbwk.',
  '.kwwwwk.',
  '.kbbbbk.',
  '.kkkkkk.',
];
const TEMPLE = [
  '..rrrr..',
  '.rrrrrr.',
  '.kwkwkw.',
  '.kwkwkw.',
  '.kwkwkw.',
  '.kkkkkk.',
];
const WALLSEG = [
  'w.w.w.w.',
  'wwwwwwww',
  'wWWWWWWw',
  'wWWWWWWw',
  'wwwwwwww',
];
const SCAFFOLD = [
  'b..b..b.',
  '.b..b..b',
  'b..b..b.',
  '.b..b..b',
  'b..b..b.',
];

export const BUILDING_CELL = 8;

export interface BuildingAtlas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** `${race}:${kind}` plus 'scaffold' */
  index: Record<string, { x: number; y: number }>;
}

export function bakeBuildingAtlas(): BuildingAtlas {
  const KINDS = [0, 1, 2, 3, 5];
  const W = (KINDS.length * 4 + 1) * BUILDING_CELL, H = BUILDING_CELL;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const index: Record<string, { x: number; y: number }> = {};
  let col = 0;
  for (let race = 0; race < 4; race++) {
    const r = race as Race;
    for (const kind of KINDS) {
      const ox = col * BUILDING_CELL;
      const rows = kind === 0 ? HUT[r] : kind === 1 ? GRANARY
        : kind === 2 ? WORKSHOP : kind === 3 ? TEMPLE : WALLSEG;
      stamp(img, rows, ox + (kind === 0 ? 1 : 0), kind === 0 ? 2 : 0, r);
      index[`${race}:${kind}`] = { x: ox, y: 0 };
      col++;
    }
  }
  stamp(img, SCAFFOLD, col * BUILDING_CELL, 1, Race.Human);
  index['scaffold'] = { x: col * BUILDING_CELL, y: 0 };
  ctx.putImageData(img, 0, 0);
  return { canvas, index };
}

export function bakeMapIcons(): MapIconAtlas {
  const cols = 4 * 4 + 1;                     // race × tier + swords
  const W = cols * ICON_W, H = ICON_H;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const index: Record<string, { x: number; y: number }> = {};
  let col = 0;
  for (let race = 0; race < 4; race++) {
    const r = race as Race;
    for (let tier = 0; tier < 4; tier++) {
      const ox = col * ICON_W;
      switch (tier) {
        case 0:
          stamp(img, HUT[r], ox + 7, 10, r);
          break;
        case 1:
          stamp(img, HUT[r], ox + 2, 10, r);
          stamp(img, HUT[r], ox + 12, 10, r);
          break;
        case 2:
          stamp(img, HUT[r], ox + 2, 8, r);
          stamp(img, HUT[r], ox + 13, 8, r);
          stamp(img, HUT[r], ox + 7, 3, r);
          stamp(img, WALL, ox + 2, 15, r);
          break;
        case 3:
          stamp(img, KEEP, ox + 6, 4, r);
          stamp(img, HUT[r], ox + 0, 11, r);
          stamp(img, HUT[r], ox + 15, 11, r);
          stamp(img, WALL, ox + 2, 15, r);
          break;
      }
      index[`${race}:${tier}`] = { x: ox, y: 0 };
      col++;
    }
  }
  stamp(img, SWORDS, col * ICON_W + 6, 5, Race.Human);
  index['swords'] = { x: col * ICON_W, y: 0 };
  ctx.putImageData(img, 0, 0);
  return { canvas, index };
}
