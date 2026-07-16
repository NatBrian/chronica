// Map-mode icon atlas (11 §D1): settlement icons by tier × race, battle
// swords. Same template scheme as sprites.ts: chars → DB32 slots, baked once.
// 'r'/'R' race roof light/shadow · 'w'/'W' wall light/shadow · 'd' door
// 'k' outline · 'm' metal · 'b' wood · '.' transparent
import { DB32_RGB, P, PAL_RGB, PE, FACTION_RAMPS } from './palette';
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

// ---- category glyphs + monsters (V5): DB32 replaces every canvas emoji ----
const GLYPHS: Record<string, string[]> = {
  'g:war': [
    '.....s.',
    '....s..',
    '.b.s...',
    '..bs...',
    '...b...',
    '..b.b..',
  ],
  'g:politics': [
    'y.y.y..',
    'yyyyy..',
    'yyyyy..',
  ],
  'g:disaster': [
    '.ppp...',
    'p.p.p..',
    'ppppp..',
    '.p.p...',
  ],
  'g:economy': [
    '.ooo...',
    'oyyyo..',
    'oyyyo..',
    '.ooo...',
  ],
  'g:life': [
    '..g....',
    '.gGg...',
    '..G....',
    '..G....',
  ],
  'g:chapter': [
    'cc.cc..',
    'ccccc..',
    'ccccc..',
    'cc.cc..',
  ],
  'm:dragon': [
    '.x.......x..',
    '.XX......XX.',
    '..XXXXXXXX..',
    '.XXxXXXXxXX.',
    '..XXXXXXXXy.',
    '...XX..XX...',
  ],
  'm:troll': [
    '..GGG...',
    '.GGGGG..',
    '.GyGyG..',
    '.GGGGG..',
    '..G.G...',
    '.GG.GG..',
  ],
  'm:wolf': [
    'k....k.',
    'kkkkkk.',
    '.kkkkkk',
    '.k..k..',
  ],
  'm:castle': [
    's.s.s..',
    'sssss..',
    's...s..',
    's.d.s..',
    'sssss..',
  ],
};

// ---- monsters v2 (doc 14 T3.3): multi-tile creatures with wing/lope frames.
// Drawn at detail zooms via bakeMonsterAtlas; the far map keeps small glyphs.
export const MONSTER_W = 24;
export const MONSTER_H = 18;

const DRAGON_F: string[][] = [
  [ // frame 0: wings spread high
    '..........xx............',
    '.........xXXx...........',
    '....x....xyyx....x......',
    '...xXx..xXXXXx..xXx.....',
    '..xXXXxxXXXXXXxxXXXx....',
    '.xXXXXXXXXXXXXXXXXXXx...',
    '.xXXXXXXXooooXXXXXXXx...',
    '..xxXXXXXooooXXXXXxx....',
    '....xxXXXooooXXXxx......',
    '......xXXooooXXx........',
    '.......xXXXXXXx.........',
    '........xXXXXx..........',
    '.........xXXx...........',
    '..........xXx...........',
    '...........xx...........',
    '........................',
    '........................',
    '........................',
  ],
  [ // frame 1: wings swept down
    '..........xx............',
    '.........xXXx...........',
    '.........xyyx...........',
    '........xXXXXx..........',
    '......xxXXXXXXxx........',
    '....xXXXXXXXXXXXXx......',
    '...xXXXXXooooXXXXXx.....',
    '..xXXxXXXooooXXXxXXx....',
    '..xXx.xXXooooXXx.xXx....',
    '..xx...xXXXXXXx...xx....',
    '........xXXXXx..........',
    '.........xXXx...........',
    '.........xXXx...........',
    '..........xXx...........',
    '...........xx...........',
    '........................',
    '........................',
    '........................',
  ],
];
const TROLL_F: string[][] = [
  [
    '........................',
    '.......GGGG.............',
    '......GGGGGG............',
    '......GyGGyG............',
    '......GGGGGG......b.....',
    '....GGGGGGGGGG....b.....',
    '...GGGGGGGGGGG...bb.....',
    '..GGG.GGGGGG.GGGbb......',
    '..GG..GGGGGG..GGb.......',
    '......GGGGGG............',
    '.....GGG..GGG...........',
    '.....GG....GG...........',
    '....kGG....GGk..........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  [
    '........................',
    '.......GGGG.............',
    '......GGGGGG............',
    '......GyGGyG............',
    '......GGGGGG.bb.........',
    '....GGGGGGGGGb..........',
    '...GGGGGGGGGGb..........',
    '..GGG.GGGGGGbGG.........',
    '..GG..GGGGGG..GG........',
    '......GGGGGG............',
    '.....GGG..GGG...........',
    '....GG......GG..........',
    '...kGG......GGk.........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
];
const WOLF_F: string[][] = [
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..k......k..............',
    '..kk....kk..............',
    '..kkkkkkkkkkkk..........',
    '..kykkkkkkkkkkkk........',
    '..kkkkkkkkkkkk..........',
    '...kk..kk..kk.k.........',
    '...k....k...k.k.........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..k......k..............',
    '..kk....kk..............',
    '..kkkkkkkkkkkk..........',
    '..kykkkkkkkkkkkk........',
    '..kkkkkkkkkkkk..........',
    '..kk..........kk........',
    '.kk............kk.......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
];

export interface MonsterAtlas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** `${kind}:${frame}` */
  index: Record<string, { x: number; y: number }>;
}

export function bakeMonsterAtlas(): MonsterAtlas {
  const kinds: [string, string[][]][] = [['dragon', DRAGON_F], ['troll', TROLL_F], ['wolf', WOLF_F]];
  const cols = kinds.length * 2;
  const W = cols * MONSTER_W, H = MONSTER_H;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const index: Record<string, { x: number; y: number }> = {};
  let col = 0;
  for (const [kind, frames] of kinds) {
    for (let f = 0; f < 2; f++) {
      const ox = col * MONSTER_W;
      stamp(img, frames[f], ox, 0, Race.Human);
      index[`${kind}:${f}`] = { x: ox, y: 0 };
      col++;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, index };
}

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
  roofPair?: [number, number],
): void {
  const [roof, roofShadow] = roofPair ?? ROOF[race];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      let slot: number;
      switch (ch) {
        case 'r': slot = roof; break;
        case 'R': slot = roofShadow; break;
        case 'w': slot = P.paleBlue; break;
        case 'W': slot = P.silver; break;
        case 'd': slot = P.charcoal; break;
        case 'k': slot = P.deepPurple; break;
        case 'm': slot = P.paleBlue; break;
        case 'b': slot = P.brown; break;
        case 'y': slot = P.yellow; break;
        case 'g': slot = P.green; break;
        case 'G': slot = P.darkGreen; break;
        case 'x': slot = P.red; break;
        case 'X': slot = P.maroon; break;
        case 'c': slot = P.skyBlue; break;
        case 'p': slot = P.purple; break;
        case 'o': slot = P.orange; break;
        case 's': slot = P.silver; break;
        default: continue;
      }
      const px = ox + x, py = oy + y;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      if (slot < 0) continue;
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

// ---- building sprites v2 (doc 14 T2.2/D3/D10) ----
// Multi-tile 16x16 templates per race, stamped with parametric materials:
// roof chars bind to the settlement's FACTION ramp (kingdom identity), wall
// chars bind to timber (low prosperity) or stone (high prosperity).
// kinds: 0 house, 1 granary, 2 workshop, 3 temple, 5 wall, 6 keep
// plus shared dressing sprites: well, fountain, statue, stall, scaffold.
// Template chars: r/R/q roof shadowless/shadow/highlight (faction ramp),
// w/W wall light/shadow (material), b/B beam, d door, g lit window,
// k outline, s/S stone trim, c chimney, y gold, u water, '.' transparent.

const HOUSE2: Record<Race, string[]> = {
  [Race.Human]: [
    '.......cc.......',
    '......kcck......',
    '.....kqrrrk.....',
    '....kqrrrrrk....',
    '...kqrrrrrrrk...',
    '..kqrrrrrrrrRk..',
    '.kqrrrrrrrrrRRk.',
    'kqrrrrrrrrrrrRRk',
    'kRRRRRRRRRRRRRRk',
    '.kwwwwwwwwwwwwk.',
    '.kwBwgwwwwgwBwk.',
    '.kwBwgwwwwgwBwk.',
    '.kwwwwwddwwwwwk.',
    '.kwBBwwddwwBBwk.',
    '.kwwwwwddwwwwwk.',
    '.kkkkkkkkkkkkkk.',
  ],
  [Race.Elf]: [
    '......kkkk......',
    '....kkqrrrkk....',
    '...kqqrrrrrrk...',
    '..kqrrrrrrrrrk..',
    '..krrrrrrrrRrk..',
    '.kqrrrrrrrrRRrk.',
    '.krrrrrrrrrrRrk.',
    '.kRrrrrrrrrRRk..',
    '..kRRrrrrrRRk...',
    '...kkRRRRRkk....',
    '....kwwwwwk.....',
    '....kwgwgwk.....',
    '....kwwwwwk.....',
    '....kwwddwk.....',
    '....kwwddwk.....',
    '.....kkkkk......',
  ],
  [Race.Dwarf]: [
    '................',
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '.kqqqqqqqqqqqqk.',
    '.krrrrrrrrrrrrk.',
    '.kRRRRRRRRRRRRk.',
    '.kkkkkkkkkkkkkk.',
    '.kWwwWWwwWWwwWk.',
    '.kWssWWggWWssWk.',
    '.kWwwWWwwWWwwWk.',
    '.kWssWWddWWssWk.',
    '.kWwwWWddWWwwWk.',
    '.kWWWWWddWWWWWk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  [Race.Orc]: [
    '.......kk.......',
    '......kqrk......',
    '.....kqrrrk.....',
    '....kqrrRrrk....',
    '...kqrrrRrrrk...',
    '..kqrrrrRrrrrk..',
    '.kqrrrrrRRrrrrk.',
    'kqrrrrrrRRrrrrrk',
    'krrrrrrrRRrrrrrk',
    'kRrrrrrrddrrrrRk',
    '.kRRrrrrddrrRRk.',
    '..kkRRRRddRRkk..',
    '...b.kkkkkk.b...',
    '...B........B...',
    '...b........b...',
    '................',
  ],
};

const GRANARY2 = [
  '................',
  '......kkkk......',
  '....kkqrrrkk....',
  '...kqrrrrrrrk...',
  '..kqrrrrrrrrrk..',
  '.kqrrrrrrrrrrRk.',
  '.kRRRRRRRRRRRRk.',
  '..kwwwwwwwwwwk..',
  '..kwwbwwwwbwwk..',
  '..kwwbwwwwbwwk..',
  '..kwwwwddwwwwk..',
  '..kwbwwddwwbwk..',
  '..kwwwwddwwwwk..',
  '..kkkkkkkkkkkk..',
  '................',
  '................',
];
const WORKSHOP2 = [
  '................',
  '..c.............',
  '.kck.kkkkkkkk...',
  '.kqkkqrrrrrrrk..',
  '.kqrrrrrrrrrrRk.',
  'kqrrrrrrrrrrrRRk',
  'kRRRRRRRRRRRRRRk',
  '.kwwwwwww.wwwk..',
  '.kwBwwgww.wwwk..',
  '.kwBwwgww.SSwk..',
  '.kwwwwwww.SSwk..',
  '.kwBBwddw.bbwk..',
  '.kwwwwddw.wwwk..',
  '.kkkkkkkkkkkkk..',
  '................',
  '................',
];
const TEMPLE2 = [
  '.......yy.......',
  '......kyyk......',
  '.....kqrrrk.....',
  '....kqrrrrrk....',
  '...kqrrrrrrrk...',
  '..kqrrrrrrrrrk..',
  '.kqrrrrrrrrrrrk.',
  'kRRRRRRRRRRRRRRk',
  'kssssssssssssssk',
  '.kW.WW.WW.WW.Wk.',
  '.kW.WW.WW.WW.Wk.',
  '.kW.WW.WW.WW.Wk.',
  '.kW.WWWddWWW.Wk.',
  '.kW.WWWddWWW.Wk.',
  'kssssssssssssssk',
  'kkkkkkkkkkkkkkkk',
];
const WALLSEG2 = [
  '................',
  '................',
  '................',
  '................',
  '................',
  'ss.ss.ss.ss.ss.s',
  'ssssssssssssssss',
  'sWWsWWsWWsWWsWWs',
  'sWWsWWsWWsWWsWWs',
  'ssssssssssssssss',
  'sWWWsWWWsWWWsWWs',
  'sWWWsWWWsWWWsWWs',
  'ssssssssssssssss',
  '................',
  '................',
  '................',
];
const KEEP2 = [
  '....y...........',
  '....yy..........',
  '....k...........',
  '..kr.rk.kr.rk...',
  '..krrrkkkrrrk...',
  '..kRRRRRRRRRk...',
  '..ksssssssssk...',
  '..kWWgWWWgWWk...',
  '..kWWWWWWWWWk...',
  '.kssssssssssssk.',
  '.kWWWgWWWgWWWWk.',
  '.kWWWWWWWWWWWWk.',
  '.kWWWWWddWWWWWk.',
  '.kWWWWWddWWWWWk.',
  '.kssssssssssssk.',
  '.kkkkkkkkkkkkkk.',
];
const WELL2 = [
  '................',
  '................',
  '................',
  '................',
  '.....kbbbk......',
  '.....b...b......',
  '.....b...b......',
  '....ksssssk.....',
  '....ksuuusk.....',
  '....ksuuusk.....',
  '....ksssssk.....',
  '.....kkkkk......',
  '................',
  '................',
  '................',
  '................',
];
const FOUNTAIN2 = [
  '................',
  '................',
  '................',
  '.......u........',
  '......uuu.......',
  '.......u........',
  '....kssssssk....',
  '...ksuuuuuusk...',
  '..ksuuuuuuusk...',
  '..ksuuuuuuusk...',
  '..ksssssssssk...',
  '...kkkkkkkkk....',
  '................',
  '................',
  '................',
  '................',
];
const STATUE2 = [
  '................',
  '................',
  '......yy........',
  '.....kyyk.......',
  '......ss........',
  '.....ssss.......',
  '......ss........',
  '......ss........',
  '.....kssk.......',
  '....kssssk......',
  '...kssssssk.....',
  '...kkkkkkkk.....',
  '................',
  '................',
  '................',
  '................',
];
const STALL2 = [
  '................',
  '................',
  '................',
  '................',
  '...kqrqrqrqk....',
  '..kqrqrqrqrqk...',
  '..kbkkkkkkkbk...',
  '..kb.y.o.g.bk...',
  '..kbbbbbbbbbk...',
  '..kb.......bk...',
  '..kkk.....kkk...',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const SCAFFOLD2 = [
  'b...b...b...b...',
  '.b...b...b...b..',
  'bbbbbbbbbbbbbbbb',
  '..b...b...b...b.',
  'b...b...b...b...',
  'bbbbbbbbbbbbbbbb',
  '.b...b...b...b..',
  'b...b...b...b...',
];

export const BUILDING_CELL = 16;

export interface BuildingAtlas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** `${race}:${faction}:${kind}:${mat}` (mat 0 timber, 1 stone) plus
   *  'well' | 'fountain' | 'statue' | 'stall:F' | 'scaffold' */
  index: Record<string, { x: number; y: number }>;
}

/** Stamp a v2 building template with parametric materials. */
function stamp2(
  img: ImageData, rows: string[], ox: number, oy: number,
  faction: number, mat: 0 | 1,
): void {
  const ramp = FACTION_RAMPS[faction] ?? FACTION_RAMPS[0];
  // timber walls: warm plaster; stone walls: cool masonry
  const wallLight = mat === 0 ? P.peach : PE.rockLight;
  const wallDark = mat === 0 ? P.tan : PE.rock;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      let slot: number;
      switch (ch) {
        case 'r': slot = ramp[0]; break;
        case 'R': slot = ramp[3]; break;
        case 'q': slot = ramp[1]; break;
        case 'w': slot = wallLight; break;
        case 'W': slot = wallDark; break;
        case 'b': slot = PE.woodLight; break;
        case 'B': slot = PE.wood; break;
        case 'd': slot = P.brown; break;
        case 'g': slot = P.yellow; break;
        case 'k': slot = P.deepPurple; break;
        case 's': slot = PE.rockLight; break;
        case 'S': slot = PE.rockDark; break;
        case 'c': slot = PE.rockDark; break;
        case 'y': slot = P.yellow; break;
        case 'o': slot = P.orange; break;
        case 'u': slot = PE.oceanShallow; break;
        default: continue;
      }
      const px = ox + x, py = oy + y;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const o = (py * img.width + px) * 4;
      const rgb = PAL_RGB[slot];
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
}

export function bakeBuildingAtlas(): BuildingAtlas {
  const KINDS = [0, 1, 2, 3, 5, 6];
  const cells = 4 * 8 * KINDS.length * 2 + 8 + 4; // race x faction x kind x mat + stalls + dressing
  const COLS = 48;
  const rowsN = Math.ceil(cells / COLS);
  const W = COLS * BUILDING_CELL, H = rowsN * BUILDING_CELL;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const index: Record<string, { x: number; y: number }> = {};
  let cell = 0;
  const at = () => {
    const ox = (cell % COLS) * BUILDING_CELL, oy = Math.floor(cell / COLS) * BUILDING_CELL;
    cell++;
    return { x: ox, y: oy };
  };
  for (let race = 0; race < 4; race++) {
    const r = race as Race;
    for (let faction = 0; faction < 8; faction++) {
      for (const kind of KINDS) {
        for (let mat = 0; mat < 2; mat++) {
          const pos = at();
          const rows = kind === 0 ? HOUSE2[r] : kind === 1 ? GRANARY2
            : kind === 2 ? WORKSHOP2 : kind === 3 ? TEMPLE2
            : kind === 5 ? WALLSEG2 : KEEP2;
          stamp2(img, rows, pos.x, pos.y, faction, mat as 0 | 1);
          index[`${race}:${faction}:${kind}:${mat}`] = pos;
        }
      }
    }
  }
  for (let faction = 0; faction < 8; faction++) {
    const pos = at();
    stamp2(img, STALL2, pos.x, pos.y, faction, 0);
    index[`stall:${faction}`] = pos;
  }
  const dressings: [string, string[]][] = [
    ['well', WELL2], ['fountain', FOUNTAIN2], ['statue', STATUE2], ['scaffold', SCAFFOLD2],
  ];
  for (const [key, rows] of dressings) {
    const pos = at();
    stamp2(img, rows, pos.x, pos.y + (key === 'scaffold' ? 4 : 0), 0, 1);
    index[key] = pos;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, index };
}

export function bakeMapIcons(): MapIconAtlas {
  // v3: settlement icons are baked per faction so the far map reads kingdom
  // identity from roofs (doc 14 T2.5); glyphs/swords keep one shared row.
  const cells = 4 * 4 * 8 + 1 + Object.keys(GLYPHS).length;
  const COLS = 24;
  const rowsN = Math.ceil(cells / COLS);
  const W = COLS * ICON_W, H = rowsN * ICON_H;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const index: Record<string, { x: number; y: number }> = {};
  let cell = 0;
  const at = () => {
    const pos = { x: (cell % COLS) * ICON_W, y: Math.floor(cell / COLS) * ICON_H };
    cell++;
    return pos;
  };
  for (let race = 0; race < 4; race++) {
    const r = race as Race;
    for (let faction = 0; faction < 8; faction++) {
      const ramp = FACTION_RAMPS[faction] ?? FACTION_RAMPS[0];
      const roofPair: [number, number] = [ramp[0], ramp[3]];
      for (let tier = 0; tier < 4; tier++) {
        const { x: ox, y: oy } = at();
        switch (tier) {
          case 0:
            stamp(img, HUT[r], ox + 7, oy + 10, r, roofPair);
            break;
          case 1:
            stamp(img, HUT[r], ox + 2, oy + 10, r, roofPair);
            stamp(img, HUT[r], ox + 12, oy + 10, r, roofPair);
            break;
          case 2:
            stamp(img, HUT[r], ox + 2, oy + 8, r, roofPair);
            stamp(img, HUT[r], ox + 13, oy + 8, r, roofPair);
            stamp(img, HUT[r], ox + 7, oy + 3, r, roofPair);
            stamp(img, WALL, ox + 2, oy + 15, r, roofPair);
            break;
          case 3:
            stamp(img, KEEP, ox + 6, oy + 4, r, roofPair);
            stamp(img, HUT[r], ox + 0, oy + 11, r, roofPair);
            stamp(img, HUT[r], ox + 15, oy + 11, r, roofPair);
            stamp(img, WALL, ox + 2, oy + 15, r, roofPair);
            break;
        }
        index[`${race}:${tier}:${faction}`] = { x: ox, y: oy };
        if (faction === race) index[`${race}:${tier}`] = { x: ox, y: oy };
      }
    }
  }
  {
    const pos = at();
    stamp(img, SWORDS, pos.x + 6, pos.y + 5, Race.Human);
    index['swords'] = pos;
  }
  for (const [key, rows] of Object.entries(GLYPHS)) {
    const pos = at();
    stamp(img, rows, pos.x + 5, pos.y + 5, Race.Human);
    index[key] = pos;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, index };
}
