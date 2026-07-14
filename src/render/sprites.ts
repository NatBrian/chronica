// Sprite templates + composition (06): ~10×14 pawn bodies per race, job
// accessories, faction palette-slot recolor, baked into an atlas at boot.
// Template chars: '.' transparent · '1'-'4' faction ramp slots · 'k' outline
// 's' skin · 'S' skin shadow · 'h' hair · 'w' white · 'm' metal · 'b' wood
import { DB32_RGB, FACTION_RAMPS, P } from './palette';
import { Race } from '../shared/types';

// Skin tones per race (DB32 slots): human peach, elf pale, dwarf tan, orc green
const SKIN: Record<Race, [number, number]> = {
  [Race.Human]: [P.peach, P.tan],
  [Race.Elf]: [P.paleBlue, P.silver],
  [Race.Dwarf]: [P.tan, P.rust],
  [Race.Orc]: [P.lime, P.green],
};
const HAIR: Record<Race, number> = {
  [Race.Human]: P.brown, [Race.Elf]: P.yellow, [Race.Dwarf]: P.rust, [Race.Orc]: P.charcoal,
};

// Race body silhouettes (06: orc bulky, elf slender, dwarf squat, human medium)
const BODY: Record<Race, string[]> = {
  [Race.Human]: [
    '...hh...',
    '..hssh..',
    '..ssss..',
    '...ss...',
    '..1111..',
    '.111111.',
    '.121121.',
    '.111111.',
    '..1111..',
    '..2..2..',
    '..2..2..',
    '..k..k..',
  ],
  [Race.Elf]: [
    '...hh...',
    '..hssh..',
    '..ssss..',
    '...ss...',
    '...11...',
    '..1111..',
    '..1211..',
    '..1111..',
    '..1111..',
    '...2.2..',
    '...2.2..',
    '...k.k..',
  ],
  [Race.Dwarf]: [
    '........',
    '..hhhh..',
    '..ssss..',
    '..sSSs..',
    '.h1111h.',
    '.111111.',
    '.121121.',
    '.111111.',
    '.111111.',
    '..2..2..',
    '..k..k..',
    '........',
  ],
  [Race.Orc]: [
    '..hhhh..',
    '.ssssss.',
    '.sSssSs.',
    '..ssss..',
    '.111111.',
    '11111111',
    '11211211',
    '.111111.',
    '.111111.',
    '..2..2..',
    '..2..2..',
    '..k..k..',
  ],
};

// Job accessory overlays (same 8×12 grid); drawn after body
const ACCESSORY: Record<string, string[]> = {
  farmer: [
    '......b.',
    '......b.',
    '......b.',
    '......b.',
    '.....mb.',
    '........',
    '........', '........', '........', '........', '........', '........',
  ],
  hunter: [
    '.b......',
    'b.......',
    'b.......',
    'b.......',
    '.b......',
    '........',
    '........', '........', '........', '........', '........', '........',
  ],
  miner: [
    '......m.',
    '.....mb.',
    '......b.',
    '......b.',
    '........',
    '........',
    '........', '........', '........', '........', '........', '........',
  ],
  soldier: [
    '......m.',
    '......m.',
    '......m.',
    '......mm',
    '........',
    '........',
    '........', '........', '........', '........', '........', '........',
  ],
  none: ['........', '........', '........', '........', '........', '........',
    '........', '........', '........', '........', '........', '........'],
};

const CROWN = [
  '.w.ww.w.',
  '.wwwwww.',
];

export const SPRITE_W = 8;
export const SPRITE_H = 12;
export const JOBS = ['none', 'farmer', 'hunter', 'miner', 'soldier'] as const;
export type JobSprite = typeof JOBS[number];

export interface PawnAtlas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** [race][faction][job][variant] → {x,y} in atlas; variant 0 adult, 1 child, 2 named */
  index: Record<string, { x: number; y: number }>;
}

function px(data: ImageData, x: number, y: number, rgb: readonly [number, number, number]): void {
  const o = (y * data.width + x) * 4;
  data.data[o] = rgb[0]; data.data[o + 1] = rgb[1]; data.data[o + 2] = rgb[2]; data.data[o + 3] = 255;
}

function drawTemplate(
  data: ImageData, ox: number, oy: number, rows: string[],
  race: Race, factionId: number, scale: 1 | 0.7,
): void {
  const ramp = FACTION_RAMPS[factionId] ?? FACTION_RAMPS[0];
  const [skin, skinShadow] = SKIN[race];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      let slot: number;
      switch (ch) {
        case '1': slot = ramp[0]; break;
        case '2': slot = ramp[1]; break;
        case '3': slot = ramp[2]; break;
        case '4': slot = ramp[3]; break;
        case 's': slot = skin; break;
        case 'S': slot = skinShadow; break;
        case 'h': slot = HAIR[race]; break;
        case 'k': slot = P.deepPurple; break;
        case 'w': slot = P.yellow; break;
        case 'm': slot = P.silver; break;
        case 'b': slot = P.brown; break;
        default: continue;
      }
      if (scale === 1) {
        px(data, ox + x, oy + y, DB32_RGB[slot]);
      } else {
        // child: 70%; skip every 3rd row/col for a squatter tiny figure
        const cx = Math.floor(x * 0.7), cy = Math.floor(y * 0.7) + 4;
        px(data, ox + cx + 1, oy + cy, DB32_RGB[slot]);
      }
    }
  }
}

/** Bake the full pawn atlas: 4 races × 8 factions × 5 jobs × 3 variants.
 *  Factions 4-7 are rebellion-born (M9); their ramps live in palette.ts. */
export function bakePawnAtlas(): PawnAtlas {
  const cols = 8 * 5 * 3;             // faction × job × variant per row
  const rows = 4;                      // race
  const W = cols * SPRITE_W, H = rows * SPRITE_H;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const index: Record<string, { x: number; y: number }> = {};
  for (let race = 0; race < 4; race++) {
    let col = 0;
    for (let faction = 0; faction < 8; faction++) {
      for (let j = 0; j < JOBS.length; j++) {
        for (let variant = 0; variant < 3; variant++) {
          const ox = col * SPRITE_W, oy = race * SPRITE_H;
          drawTemplate(img, ox, oy, BODY[race as Race], race as Race, faction, variant === 1 ? 0.7 : 1);
          if (variant !== 1 && JOBS[j] !== 'none') {
            drawTemplate(img, ox, oy, ACCESSORY[JOBS[j]], race as Race, faction, 1);
          }
          if (variant === 2) {
            drawTemplate(img, ox, oy, CROWN, race as Race, faction, 1);
          }
          index[`${race}:${faction}:${JOBS[j]}:${variant}`] = { x: ox, y: oy };
          col++;
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
