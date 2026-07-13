// Procedural per-culture name generators; phoneme tables (04 §Culture).
import { Race } from '../../shared/types';
import { Rng } from '../rng/rng';

interface PhonemeTable {
  onsets: string[];
  vowels: string[];
  codas: string[];
  syllables: [number, number]; // min, max
  surnameParts?: [string[], string[]];
}

const TABLES: Record<Race, PhonemeTable> = {
  [Race.Human]: {
    onsets: ['b', 'd', 'g', 'h', 'j', 'l', 'm', 'n', 'r', 's', 't', 'w', 'al', 'ed', 'os'],
    vowels: ['a', 'e', 'i', 'o', 'u', 'ei', 'ou'],
    codas: ['n', 'r', 'd', 's', 'th', 'ric', 'mund', 'win', 'bert', ''],
    syllables: [2, 3],
    surnameParts: [
      ['Green', 'Red', 'Ash', 'Oak', 'Mill', 'Bridge', 'Hill', 'Marsh', 'Stone', 'Fair'],
      ['field', 'ford', 'wood', 'brook', 'ton', 'dale', 'worth', 'shore', 'gate', 'well'],
    ],
  },
  [Race.Elf]: {
    onsets: ['ae', 'c', 'el', 'f', 'gal', 'il', 'l', 'm', 'n', 's', 'th', 'v', 'y'],
    vowels: ['a', 'e', 'i', 'ae', 'ia', 'ie', 'y'],
    codas: ['l', 'n', 'r', 's', 'th', 'wyn', 'riel', 'las', 'dir', ''],
    syllables: [2, 3],
    surnameParts: [
      ['Vaer', 'Sil', 'Moon', 'Star', 'Dawn', 'Leaf', 'Mist', 'Wind', 'Song', 'Dew'],
      ['wyn', 'shade', 'whisper', 'glade', 'bloom', 'light', 'weaver', 'brook', 'veil', 'thorn'],
    ],
  },
  [Race.Dwarf]: {
    onsets: ['b', 'd', 'dr', 'g', 'gr', 'k', 'kh', 'th', 'thr', 'br', 'm', 'n'],
    vowels: ['a', 'o', 'u', 'i', 'or', 'ur'],
    codas: ['k', 'm', 'n', 'r', 'd', 'in', 'ar', 'grim', 'din', 'li'],
    syllables: [1, 2],
    surnameParts: [
      ['Iron', 'Stone', 'Deep', 'Gold', 'Copper', 'Granite', 'Forge', 'Anvil', 'Coal', 'Silver'],
      ['beard', 'fist', 'delver', 'hammer', 'axe', 'helm', 'brow', 'foot', 'shield', 'pick'],
    ],
  },
  [Race.Orc]: {
    onsets: ['gr', 'k', 'kr', 'z', 'zg', 'm', 'n', 'r', 'sh', 'th', 'ur', 'b'],
    vowels: ['a', 'o', 'u', 'uk', 'ag', 'og'],
    codas: ['k', 'g', 'z', 'sh', 'rg', 'mak', 'gash', 'thak', ''],
    syllables: [1, 2],
    surnameParts: [
      ['Bone', 'Skull', 'Blood', 'Ash', 'Iron', 'Wolf', 'Rock', 'Storm', 'Fang', 'Grim'],
      ['crusher', 'render', 'howler', 'breaker', 'eater', 'stalker', 'cleaver', 'roarer', 'gnasher', 'smasher'],
    ],
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pawnName(race: Race, rng: Rng): string {
  const t = TABLES[race];
  const syl = rng.range(t.syllables[0], t.syllables[1]);
  let name = '';
  for (let i = 0; i < syl; i++) {
    name += rng.pick(t.onsets) + rng.pick(t.vowels);
  }
  name += rng.pick(t.codas);
  return cap(name);
}

export function fullName(race: Race, rng: Rng): string {
  const t = TABLES[race];
  const first = pawnName(race, rng);
  if (t.surnameParts) {
    return `${first} ${rng.pick(t.surnameParts[0])}${rng.pick(t.surnameParts[1])}`;
  }
  return first;
}

export function settlementName(race: Race, rng: Rng): string {
  const t = TABLES[race];
  if (race === Race.Human) {
    return `${rng.pick(t.surnameParts![0])}${rng.pick(t.surnameParts![1])}`;
  }
  return pawnName(race, rng) + (race === Race.Dwarf ? rng.pick(['hold', 'deep', 'forge', 'gate']) :
    race === Race.Elf ? rng.pick(['dell', 'glade', 'haven', 'reach']) :
    rng.pick(['ka', 'gor', 'mok', 'dush']));
}

export function godName(race: Race, rng: Rng): string {
  return pawnName(race, rng);
}

const ISLAND_A = ['Aer', 'Bel', 'Cal', 'Dor', 'El', 'Fen', 'Gal', 'Hal', 'Ith', 'Kor', 'Lor', 'Mar', 'Nor', 'Or', 'Per', 'Quel', 'Run', 'Sol', 'Tir', 'Umb', 'Val', 'Wyn'];
const ISLAND_B = ['andor', 'avia', 'crest', 'edge', 'gard', 'holm', 'ia', 'inar', 'land', 'mere', 'moor', 'ost', 'reach', 'shard', 'strand', 'vale', 'wick', 'wyn'];

export function islandName(rng: Rng): string {
  return rng.pick(ISLAND_A) + rng.pick(ISLAND_B);
}

const RIVER_SUFFIX = ['run', 'flow', 'water', 'rush', 'wend', 'stream'];
export function riverName(rng: Rng): string {
  return cap(rng.pick(ISLAND_A).toLowerCase() + rng.pick(RIVER_SUFFIX));
}
