// Identity lite (M10, P2.1/P2.2): cultures and character traits. We copy
// WorldBox's RESULT (factions feel different) at 10% of the cost and let the
// LLM carry the flavor. Everything here is deterministic table data.
import { Race } from '../../shared/types';
import { fnv1a, Rng } from '../rng/rng';

export type WarDoctrine = 'raider' | 'defensive' | 'expansionist';
export type SuccessionRule = 'eldest' | 'renowned' | 'election';

export interface CultureRoll {
  doctrine: WarDoctrine;
  succession: SuccessionRule;
  values: string[];
}

/** value keyword pools per race: 2-3 get rolled into every king prompt */
const VALUE_POOLS: Record<Race, string[]> = {
  [Race.Human]: ['harvests', 'oaths', 'roads', 'coin', 'hearth-right', 'the plough'],
  [Race.Elf]: ['long memory', 'the old groves', 'patience', 'starlight', 'unhurried debts', 'tides'],
  [Race.Dwarf]: ['iron', 'grudges', 'the ledger', 'stonework', 'deep halls', 'honest weight'],
  [Race.Orc]: ['strength', 'the horde', 'blood-debts', 'open sky', 'spoils', 'loud dying'],
};

const DOCTRINES: WarDoctrine[] = ['raider', 'defensive', 'expansionist'];
const SUCCESSIONS: SuccessionRule[] = ['eldest', 'renowned', 'election'];

/** Race-weighted doctrine dice: orcs lean raider, dwarves defensive, etc. */
const DOCTRINE_WEIGHTS: Record<Race, [number, number, number]> = {
  [Race.Human]: [1, 2, 3],
  [Race.Elf]: [1, 3, 2],
  [Race.Dwarf]: [1, 4, 1],
  [Race.Orc]: [4, 1, 1],
};

export function rollCulture(race: Race, rng: Rng): CultureRoll {
  const w = DOCTRINE_WEIGHTS[race];
  const total = w[0] + w[1] + w[2];
  let pick = rng.int(total);
  let d = 0;
  while (pick >= w[d]) { pick -= w[d]; d++; }
  const pool = [...VALUE_POOLS[race]];
  const values: string[] = [];
  for (let k = 0; k < 3 && pool.length > 0; k++) {
    values.push(pool.splice(rng.int(pool.length), 1)[0]);
  }
  return {
    doctrine: DOCTRINES[d],
    succession: SUCCESSIONS[rng.int(3)],
    values,
  };
}

/** Culture drift on rebellion (doc 12 open Q4, resolved: drift is more alive). */
export function driftCulture(parent: CultureRoll, race: Race, rng: Rng): CultureRoll {
  const child: CultureRoll = {
    doctrine: rng.chance(1, 3) ? DOCTRINES[rng.int(3)] : parent.doctrine,
    succession: rng.chance(1, 4) ? SUCCESSIONS[rng.int(3)] : parent.succession,
    values: [...parent.values],
  };
  if (rng.chance(1, 2)) {
    const pool = VALUE_POOLS[race].filter(v => !child.values.includes(v));
    if (pool.length > 0 && child.values.length > 0) {
      child.values[rng.int(child.values.length)] = pool[rng.int(pool.length)];
    }
  }
  return child;
}

// ---- character traits (P2.2): visible, prompt-fed, RuleBrain-biasing ----

export const TRAIT_TABLE = [
  'ambitious', 'craven', 'cruel', 'pious', 'brilliant',
  'stubborn', 'gentle', 'greedy', 'bold', 'cunning',
] as const;

/** Two distinct traits, a pure function of (seed, namedId): old saves and
 *  replays roll identically, and no rng stream is consumed. */
export function rollTraits(worldSeed: number, namedId: number): string[] {
  const h = fnv1a(`traits:${worldSeed}:${namedId}`);
  const a = h % TRAIT_TABLE.length;
  let b = ((h >>> 8) % (TRAIT_TABLE.length - 1));
  if (b >= a) b++;
  return [TRAIT_TABLE[a], TRAIT_TABLE[b]];
}

/** RuleBrain score adjustment from the actor's traits (P2.2b). */
export function traitBias(op: string, traits: string[]): number {
  let d = 0;
  for (const t of traits) {
    switch (t) {
      case 'ambitious': d += op === 'DECLARE_WAR' ? 8 : op === 'EXPAND' ? 8 : op === 'DEMAND_TRIBUTE' ? 4 : 0; break;
      case 'craven': d += op === 'SUE_FOR_PEACE' ? 10 : op === 'ACCEPT_TRUCE' ? 8 : op === 'DECLARE_WAR' ? -12 : 0; break;
      case 'cruel': d += op === 'RAZE' ? 12 : op === 'REJECT_PROPOSAL' ? 4 : op === 'SEND_GIFT' ? -6 : 0; break;
      case 'pious': d += op === 'SEND_GIFT' ? 6 : op === 'RAZE' ? -10 : 0; break;
      case 'brilliant': d += op === 'SET_WAR_OBJECTIVE' ? 6 : op === 'ALLY_AGAINST' ? 6 : 0; break;
      case 'stubborn': d += op === 'REFUSE_TRIBUTE' ? 8 : op === 'REJECT_TRUCE' ? 6 : op === 'SUE_FOR_PEACE' ? -6 : 0; break;
      case 'gentle': d += op === 'RAZE' ? -15 : op === 'SUE_FOR_PEACE' ? 6 : op === 'SEND_GIFT' ? 4 : 0; break;
      case 'greedy': d += op === 'DEMAND_TRIBUTE' ? 8 : op === 'TAKE_TRIBUTE' ? 8 : op === 'PAY_TRIBUTE' ? -6 : 0; break;
      case 'bold': d += op === 'DECLARE_WAR' ? 6 : op === 'REJECT_TRUCE' ? 4 : op === 'CONSOLIDATE' ? -4 : 0; break;
      case 'cunning': d += op === 'EMBARGO' ? 6 : op === 'ALLY_AGAINST' ? 8 : op === 'PROPOSE_TRADE' ? 4 : 0; break;
    }
  }
  return d;
}

/** RuleBrain score adjustment from the faction's war doctrine (P2.1). */
export function doctrineBias(op: string, doctrine: WarDoctrine | undefined, args: string[]): number {
  switch (doctrine) {
    case 'raider':
      if (op === 'DECLARE_WAR') return 10;
      if (op === 'SET_WAR_OBJECTIVE') return args[1] === 'raid' ? 10 : -4;
      if (op === 'EXPAND') return -6;
      return 0;
    case 'defensive':
      if (op === 'DECLARE_WAR') return -14;
      if (op === 'CONSCRIPT') return 8;
      if (op === 'ACCEPT_TRUCE' || op === 'SUE_FOR_PEACE') return 8;
      return 0;
    case 'expansionist':
      if (op === 'EXPAND') return 14;
      if (op === 'PROPOSE_TRADE') return 6;
      if (op === 'SET_WAR_OBJECTIVE') return args[1] === 'conquer' ? 8 : 0;
      return 0;
    default:
      return 0;
  }
}
