// Pawn sprite system v2 (doc 14 T3.1/D7): 12x16 bodies composed from race
// heads + torsos + leg sets, with tool poses, mirrored facings, and animation
// frames baked into one atlas at boot. Frame picked at draw time from
// fnv1a-free tick parity: pure function of (pawn index, tick), replay-safe.
// Template chars: '.' transparent · '1' faction main · '2' faction dark
// '3' faction light trim · 's/S' skin/shadow · 'h' hair · 'e' eye
// 'k' outline · 'w' tusk/white · 'm' metal · 'b' wood · 'y' gold
import { PAL_RGB, P, PE, FACTION_RAMPS } from './palette';
import { Race } from '../shared/types';

// Skin tones per race: human peach, elf pale, dwarf tan, orc green
const SKIN: Record<Race, [number, number]> = {
  [Race.Human]: [P.peach, P.tan],
  [Race.Elf]: [P.paleBlue, P.silver],
  [Race.Dwarf]: [P.tan, P.rust],
  [Race.Orc]: [P.lime, P.green],
};
const HAIR: Record<Race, number> = {
  [Race.Human]: P.brown, [Race.Elf]: P.yellow, [Race.Dwarf]: P.rust, [Race.Orc]: P.charcoal,
};

// ---- race heads (7 rows x 12) ----
const HEAD: Record<Race, string[]> = {
  [Race.Human]: [
    '....kkkk....',
    '...khhhhk...',
    '..khhhhhhk..',
    '..kssssssk..',
    '..ksessesk..',
    '...kssssk...',
    '....kssk....',
  ],
  [Race.Elf]: [
    '....kkkk....',
    '...khhhhk...',
    '..khhhhhhk..',
    '.skssssssks.',
    '..ksessesk..',
    '...kssssk...',
    '...kh..hk...',
  ],
  [Race.Dwarf]: [
    '............',
    '...kkkkkk...',
    '..khhhhhhk..',
    '..ksessesk..',
    '..khhhhhhk..',
    '.khhhhhhhhk.',
    '..khhhhhhk..',
  ],
  [Race.Orc]: [
    '...kkkkkk...',
    '..khhhhhhk..',
    '.kssssssssk.',
    '.ksessessk..',
    '.kssssssssk.',
    '.kwssssswk..',
    '..kssssssk..',
  ],
};

// ---- race torsos (5 rows x 12) ----
const TORSO: Record<Race, string[]> = {
  [Race.Human]: [
    '...k1111k...',
    '..k111111k..',
    '..k131131k..',
    '..k111111k..',
    '...k1111k...',
  ],
  [Race.Elf]: [
    '...k1111k...',
    '...k1111k...',
    '...k1331k...',
    '...k1111k...',
    '...k1111k...',
  ],
  [Race.Dwarf]: [
    '.k11111111k.',
    '.k11311311k.',
    '.k11111111k.',
    '..k111111k..',
    '...k1111k...',
  ],
  [Race.Orc]: [
    '.k11111111k.',
    '.k11111111k.',
    '.k13111131k.',
    '.k11111111k.',
    '..k111111k..',
  ],
};

// ---- leg sets (4 rows x 12) ----
const LEGS_IDLE = [
  '...k2kk2k...',
  '...k2kk2k...',
  '...kk..kk...',
  '............',
];
const LEGS_WALK = [
  '..k2k..k2k..',
  '.k2k....k2k.',
  '.kk......kk.',
  '............',
];

// ---- job tool overlays (12x16 sparse): pose A carry, pose B act ----
const TOOL_A: Record<string, string[]> = {
  farmer: [
    '..........b.', '..........b.', '.........mb.', '..........b.',
    '..........b.', '..........b.', '..........b.', '..........b.',
    '..........b.', '..........b.', '............', '............',
    '............', '............', '............', '............',
  ],
  hunter: [
    '.b..........', 'b...........', 'b...........', 'b...........',
    'b...........', 'b...........', '.b..........', '............',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  miner: [
    '.........mm.', '..........b.', '..........b.', '..........b.',
    '..........b.', '..........b.', '..........b.', '............',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  soldier: [
    '..........m.', '..........m.', '..........m.', '..........m.',
    '.........km.', '............', '.33.........', '.33.........',
    '.33.........', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  none: [],
};
const TOOL_B: Record<string, string[]> = {
  farmer: [
    '......bm....', '.....b.m....', '....b..m....', '...b........',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  hunter: [
    '.b...m......', 'b...m.......', 'b..m........', 'b...........',
    'b...........', 'b...........', '.b..........', '............',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  miner: [
    '....mmb.....', '.....b......', '....b.......', '............',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  soldier: [
    '.........m..', '........m...', '........m...', '.......km...',
    '............', '............', '.33.........', '.33.........',
    '.33.........', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  none: [],
};

// named characters: crown + cloak
const CROWN = [
  '...y.yy.y...',
  '...yyyyyy...',
];
const CLOAK = [
  '............', '............', '............', '............',
  '............', '............', '............', '..2.......2.',
  '..2.......2.', '..2.......2.', '..2.......2.', '..22.....22.',
  '............', '............', '............', '............',
];

// child: small figure anchored at the feet line
const CHILD = [
  '............', '............', '............', '............',
  '............', '............', '............', '.....kk.....',
  '....khhk....', '....kssk....', '....kesk....', '....k11k....',
  '....k11k....', '....k22k....', '....k.k.....', '............',
];

// down/corpse pose (combat aftermath)
const DOWN = [
  '............', '............', '............', '............',
  '............', '............', '............', '............',
  '............', '............', '............', '............',
  '..kkkkkkkk..', '.khsxs1111k.', '.khsss1111k.', '..kkkkkkkk..',
];

export const SPRITE_W = 12;
export const SPRITE_H = 16;
export const JOBS = ['none', 'farmer', 'hunter', 'miner', 'soldier'] as const;
export type JobSprite = typeof JOBS[number];
/** frames: 0 idle · 1 walk · 2 act (tool swing / weapon thrust) · 3 down */
export const FRAMES = 4;

export interface PawnAtlas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** `${race}:${faction}:${job}:${variant}:${frame}:${facing}`
   *  variant 0 adult, 1 child, 2 named; facing 0 right, 1 left */
  index: Record<string, { x: number; y: number }>;
}

function px(data: ImageData, x: number, y: number, rgb: readonly [number, number, number]): void {
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) return;
  const o = (y * data.width + x) * 4;
  data.data[o] = rgb[0]; data.data[o + 1] = rgb[1]; data.data[o + 2] = rgb[2]; data.data[o + 3] = 255;
}

function stampRows(
  data: ImageData, rows: string[], ox: number, oy: number,
  race: Race, faction: number, mirror: boolean,
): void {
  const ramp = FACTION_RAMPS[faction] ?? FACTION_RAMPS[0];
  const [skin, skinShadow] = SKIN[race];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      let slot: number;
      switch (ch) {
        case '1': slot = ramp[0]; break;
        case '2': slot = ramp[3]; break;
        case '3': slot = ramp[1]; break;
        case 's': slot = skin; break;
        case 'S': slot = skinShadow; break;
        case 'h': slot = HAIR[race]; break;
        case 'e': case 'x': slot = P.deepPurple; break;
        case 'k': slot = P.deepPurple; break;
        case 'w': slot = P.white; break;
        case 'm': slot = P.silver; break;
        case 'b': slot = PE.woodLight; break;
        case 'y': slot = P.yellow; break;
        default: continue;
      }
      const dx = mirror ? (SPRITE_W - 1 - x) : x;
      px(data, ox + dx, oy + y, PAL_RGB[slot]);
    }
  }
}

/** Merge sparse overlay rows onto a base template (non '.' wins). */
function overlay(base: string[], over: string[]): string[] {
  if (!over.length) return base;
  const out: string[] = [];
  for (let y = 0; y < SPRITE_H; y++) {
    const b = base[y] ?? '.'.repeat(SPRITE_W);
    const o = over[y] ?? '.'.repeat(SPRITE_W);
    let row = '';
    for (let x = 0; x < SPRITE_W; x++) row += o[x] !== '.' && o[x] !== undefined ? o[x] : (b[x] ?? '.');
    out.push(row);
  }
  return out;
}

function composeBody(race: Race, frame: number): string[] {
  if (frame === 3) return DOWN;
  const legs = frame === 1 ? LEGS_WALK : LEGS_IDLE;
  return [...HEAD[race], ...TORSO[race], ...legs];
}

/** Bake the full pawn atlas: race x faction x job x variant x frame x facing. */
export function bakePawnAtlas(): PawnAtlas {
  const variants = 3, facings = 2;
  const total = 4 * 8 * JOBS.length * variants * FRAMES * facings;
  const COLS = 64;
  const rowsN = Math.ceil(total / COLS);
  const W = COLS * SPRITE_W, H = rowsN * SPRITE_H;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const index: Record<string, { x: number; y: number }> = {};
  let cell = 0;
  for (let race = 0; race < 4; race++) {
    const r = race as Race;
    for (let faction = 0; faction < 8; faction++) {
      for (const job of JOBS) {
        for (let variant = 0; variant < variants; variant++) {
          for (let frame = 0; frame < FRAMES; frame++) {
            for (let facing = 0; facing < facings; facing++) {
              const ox = (cell % COLS) * SPRITE_W, oy = Math.floor(cell / COLS) * SPRITE_H;
              cell++;
              let rows: string[];
              if (variant === 1) {
                rows = CHILD;
              } else {
                rows = composeBody(r, frame);
                if (frame !== 3) {
                  if (variant === 2) rows = overlay(rows, CLOAK);
                  const tool = frame === 2 ? TOOL_B[job] : TOOL_A[job];
                  if (job !== 'none') rows = overlay(rows, tool);
                  if (variant === 2) rows = overlay(rows, [...CROWN]);
                }
              }
              stampRows(img, rows, ox, oy, r, faction, facing === 1);
              index[`${race}:${faction}:${job}:${variant}:${frame}:${facing}`] = { x: ox, y: oy };
            }
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, index };
}

/** Map a sim action id to a sprite job accessory. */
export function actionToJob(action: number): JobSprite {
  switch (action) {
    case 5: case 2: return 'farmer';       // farmWork, forage
    case 3: case 4: return 'hunter';       // hunt, fish
    case 7: case 6: return 'miner';        // mine, chopWood
    case 17: case 18: return 'soldier';    // fight, patrol
    default: return 'none';
  }
}
