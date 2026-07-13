// SimState — the entire deterministic world state. Two-tier storage (01):
// hot pawn data in flat typed arrays; story data (named chars, factions,
// settlements) in rich objects serialized as sorted JSON.
import {
  WorldConfig, WorldEvent, Race, DiploState, JournalEntry, DecisionRequest,
} from '../shared/types';
import { stableStringify } from '../shared/stableStringify';
import { RngStreams, fnv1a } from './rng/rng';
import { WorldMap, allocMap } from './world/map';
import { HiddenVein, SpawnSite } from './world/worldgen';

export const PawnFlag = {
  Alive: 1, Female: 2, Pregnant: 4, Fighting: 8, Carrying: 16,
  Child: 32, Elder: 64, Named: 128, InShelter: 256, Refugee: 512,
} as const;

export interface Pawns {
  x: Int16Array; y: Int16Array;
  hp: Uint8Array;
  hunger: Uint8Array;         // 0 full .. 255 starving
  energy: Uint8Array;         // 255 rested .. 0 exhausted
  shelter: Uint8Array;        // exposure accumulator
  safety: Uint8Array;         // fear accumulator
  social: Uint8Array;
  mood: Uint8Array;           // derived
  age: Uint16Array;           // ticks / 4 (so 120y fits) — see AGE_SCALE
  factionId: Uint8Array;      // 255 = none
  settlementId: Uint16Array;  // 65535 = none
  action: Uint8Array;
  actionTarget: Int32Array;   // tile index or entity id (context-dependent)
  actionTicks: Uint16Array;
  pregTicks: Uint16Array;
  pairId: Int32Array;         // partner pawn index, -1 none
  motherId: Int32Array; fatherId: Int32Array;
  strength: Uint8Array; fertility: Uint8Array; temper: Uint8Array;
  longevity: Uint8Array; charisma: Uint8Array;
  squadId: Uint16Array;       // 65535 = none
  namedId: Int16Array;        // -1 = not named
  flags: Uint16Array;
  jobAffinity: Uint8Array;    // last sustained action id (job momentum)
  movePts: Uint8Array;        // movement point accumulator (terrain cost)
}

export const AGE_SCALE = 4;  // age stored in ticks/4; 65535*4 ticks ≈ 728y headroom

export function allocPawns(max: number): Pawns {
  return {
    x: new Int16Array(max), y: new Int16Array(max),
    hp: new Uint8Array(max), hunger: new Uint8Array(max), energy: new Uint8Array(max),
    shelter: new Uint8Array(max), safety: new Uint8Array(max), social: new Uint8Array(max),
    mood: new Uint8Array(max), age: new Uint16Array(max),
    factionId: new Uint8Array(max), settlementId: new Uint16Array(max),
    action: new Uint8Array(max), actionTarget: new Int32Array(max),
    actionTicks: new Uint16Array(max), pregTicks: new Uint16Array(max),
    pairId: new Int32Array(max).fill(-1),
    motherId: new Int32Array(max).fill(-1), fatherId: new Int32Array(max).fill(-1),
    strength: new Uint8Array(max), fertility: new Uint8Array(max),
    temper: new Uint8Array(max), longevity: new Uint8Array(max), charisma: new Uint8Array(max),
    squadId: new Uint16Array(max).fill(65535), namedId: new Int16Array(max).fill(-1),
    flags: new Uint16Array(max), jobAffinity: new Uint8Array(max),
    movePts: new Uint8Array(max),
  };
}

export interface Building {
  kind: number; x: number; y: number; stage: number; // 0..3 construction, 3 = complete
  hp: number; workDone: number;
}

export interface Settlement {
  id: number;
  factionId: number;
  x: number; y: number;
  name: string;
  stockpile: number[];        // Good-indexed
  buildings: Building[];
  farmPlots: number[];        // tile indices
  founded: number;            // tick
  razed: boolean;
  granaryCap: number;
  popCache: number;
  moodAvg: number;
  crowding: number;           // 0..255 soft pressure
  foodPerCapitaAvg: number;   // rolling stock per capita ×1000 (fixed point)
  foodFlowAvg: number;        // rolling net flow per capita per year ×1000 (can be negative)
  lastFoodStock: number;      // previous window's total food (flow measurement)
  lodStatistical: boolean;
  /** cached advertised resource tiles, refreshed periodically (03 smart-world) */
  resourceTiles: { forage: number[]; hunt: number[]; fish: number[]; wood: number[]; mine: number[]; stone: number[] };
  /** farmable tiles (fert ≥ 55) within working radius — carrying-capacity base */
  fertileLand: number;
}

export interface LedgerEntry { tick: number; delta: number; why: string }

export interface FactionPairState {
  diplo: DiploState;
  grudge: number;             // capped, decays ~2 generations
  ledger: LedgerEntry[];      // rolling, capped
  embargo: boolean;
  truceUntil: number;         // tick
  allianceSince?: number;     // tick the current alliance formed
}

export interface War {
  id: number;
  attacker: number; defender: number;
  objective: 'raid' | 'conquer' | 'burn';
  startTick: number;
  exhaustionA: number; exhaustionB: number;
  causeEventIds: number[];
  targetSettlement: number;
  bothAggressors?: boolean;   // D4 mutual declaration
  musterCooldownUntil?: number; // campaigns pace out — no raid conveyor
}

export interface Faction {
  id: number;
  race: Race;
  name: string;
  god: string;
  leaderId: number;           // named character id, -1 none
  culture: { aggression: number; piety: number; wanderlust: number };
  equipmentTier: number;      // ×1000 fixed point
  extinct: boolean;
  reserveStores: boolean;
  conscriptTarget: number;    // desired soldier count
  foodSignalAvg: number;      // rolling per-capita food ×1000
  capital: number;            // settlement id
  vassalOf: number;           // faction id, -1 none
  prospectEffort: number;
  llmCoverageNum: number; llmCoverageDen: number;
}

export interface Memory { text: string; landmark: boolean; weight: number; tick: number }

export interface NamedCharacter {
  id: number;
  pawnIdx: number;            // -1 once dead
  name: string;
  role: string;               // 'king' | 'heir' | 'hero' | 'founder' | 'survivor' | 'prodigy'
  factionId: number;
  bornTick: number;
  deathTick: number;          // -1 alive
  deathCauseEventId: number;
  bio: string[];
  memories: Memory[];
  recentChoices: string[];
  kills: number;
  parentNamedId: number;
}

export interface Squad {
  id: number;
  factionId: number;
  x: number; y: number;       // banner position
  targetX: number; targetY: number;
  members: number[];          // pawn indices
  morale: number;             // 0..255
  state: 'muster' | 'march' | 'fight' | 'rout' | 'defend' | 'disband';
  warId: number;
  homeSettlement: number;
  pathIdx: number;
}

export interface Caravan {
  id: number;
  from: number; to: number;   // settlement ids
  factionId: number;
  x: number; y: number;
  goods: number[];
  purpose: 'trade' | 'tribute' | 'gift';
  escorts: number[];
  state: 'travel' | 'return' | 'done';
  raided: boolean;
  pathIdx: number;
}

export interface Monster {
  id: number;
  kind: 'wolf' | 'troll' | 'dragon';
  x: number; y: number;
  hp: number;
  targetSettlement: number;
  ticksLeft: number;
}

export interface PendingDecision {
  requestId: number;
  actorId: number;
  factionId: number;
  tick: number;
  applyAtTick: number;
  kind: string;
  priority: number;
  options: string[];
}

export interface YearStats {
  year: number;
  popByFaction: number[];
  foodByFaction: number[];
  warTicks: number;
  territoryByFaction: number[];
  oreByFaction: number[];
  llmCoverage: number[];
}

export interface SimState {
  seed: number;
  config: WorldConfig;
  tick: number;
  islandName: string;
  map: WorldMap;
  hiddenVeins: HiddenVein[];
  spawns: SpawnSite[];
  rng: RngStreams;
  pawns: Pawns;
  pawnCount: number;          // high-water mark for iteration
  alivePawns: number;
  birthsDeferred: number;     // F1 — births deferred while arrays full
  settlements: Settlement[];
  factions: Faction[];
  pairs: FactionPairState[];  // indexed pairKey(a,b)
  named: NamedCharacter[];
  namedActive: number;
  squads: Squad[];
  caravans: Caravan[];
  monsters: Monster[];
  wars: War[];
  events: WorldEvent[];
  nextEventId: number;
  nextEntityId: number;
  weather: { drought: number; winterSeverity: number; plagueActive: boolean };
  plague: { settlementInfections: Record<number, number> };
  pending: PendingDecision[];
  nextRequestId: number;
  outbox: DecisionRequest[];  // requests emitted this tick (drained by engine host)
  journalCursor: number;
  yearStats: YearStats[];
  deathsByCause: Record<string, number>;
  warTicksThisYear: number;
  // fixed-point global modifiers
  festivalUntil: number;
}

/** Effective food security: stock plus weighted trend. A full granary with
 * zero production is NOT wealth — the flow term sees the trajectory. */
export function effFood(st: Settlement): number {
  return Math.max(0, st.foodPerCapitaAvg + 2 * st.foodFlowAvg);
}

export const MAX_FACTIONS = 8;   // 4 at genesis; splits/rebellions may add more

export function pairKey(a: number, b: number): number {
  return a < b ? a * MAX_FACTIONS + b : b * MAX_FACTIONS + a;
}

export function createEmptyState(seed: number, config: WorldConfig): SimState {
  const pairs: FactionPairState[] = [];
  for (let i = 0; i < 64; i++) {
    pairs.push({ diplo: DiploState.Neutral, grudge: 0, ledger: [], embargo: false, truceUntil: 0 });
  }
  return {
    seed, config, tick: 0, islandName: '',
    map: allocMap(config.mapSize),
    hiddenVeins: [], spawns: [],
    rng: new RngStreams(seed),
    pawns: allocPawns(config.maxPawns),
    pawnCount: 0, alivePawns: 0, birthsDeferred: 0,
    settlements: [], factions: [], pairs, named: [], namedActive: 0,
    squads: [], caravans: [], monsters: [], wars: [],
    events: [], nextEventId: 0, nextEntityId: 0,
    weather: { drought: 0, winterSeverity: 100, plagueActive: false },
    plague: { settlementInfections: {} },
    pending: [], nextRequestId: 0, outbox: [],
    journalCursor: 0,
    yearStats: [], deathsByCause: {}, warTicksThisYear: 0,
    festivalUntil: 0,
  };
}

// ---- Snapshot / restore / hash ----

function pawnBuffers(p: Pawns): ArrayBufferView[] {
  return [
    p.x, p.y, p.hp, p.hunger, p.energy, p.shelter, p.safety, p.social, p.mood,
    p.age, p.factionId, p.settlementId, p.action, p.actionTarget, p.actionTicks,
    p.pregTicks, p.pairId, p.motherId, p.fatherId, p.strength, p.fertility,
    p.temper, p.longevity, p.charisma, p.squadId, p.namedId, p.flags, p.jobAffinity,
    p.movePts,
  ];
}

function mapBuffers(m: WorldMap): ArrayBufferView[] {
  return [m.elevation, m.waterFlux, m.temperature, m.moisture, m.biome,
    m.fertility, m.forest, m.ore, m.fish, m.game, m.flags, m.crop];
}

/** JSON-serializable side of state (rich stores + scalars). */
function jsonSide(s: SimState): unknown {
  return {
    seed: s.seed, config: s.config, tick: s.tick, islandName: s.islandName,
    hiddenVeins: s.hiddenVeins, spawns: s.spawns,
    rngStreams: s.rng.save(),
    pawnCount: s.pawnCount, alivePawns: s.alivePawns, birthsDeferred: s.birthsDeferred,
    settlements: s.settlements, factions: s.factions, pairs: s.pairs,
    named: s.named, namedActive: s.namedActive,
    squads: s.squads, caravans: s.caravans, monsters: s.monsters, wars: s.wars,
    nextEventId: s.nextEventId, nextEntityId: s.nextEntityId,
    weather: s.weather, plague: s.plague,
    pending: s.pending, nextRequestId: s.nextRequestId,
    journalCursor: s.journalCursor,
    deathsByCause: s.deathsByCause,
    warTicksThisYear: s.warTicksThisYear, festivalUntil: s.festivalUntil,
    riverCount: s.map.riverCount,
    mapSize: s.map.size,
  };
}

export interface Snapshot {
  json: string;               // stableStringify of jsonSide + events + yearStats
  buffers: Uint8Array[];      // raw copies of all typed arrays, fixed order
}

export function snapshot(s: SimState): Snapshot {
  const buffers = [...mapBuffers(s.map), ...pawnBuffers(s.pawns)].map(
    b => new Uint8Array((b.buffer as ArrayBuffer).slice(b.byteOffset, b.byteOffset + b.byteLength)),
  );
  const json = stableStringify({
    core: jsonSide(s),
    events: s.events,
    yearStats: s.yearStats,
  });
  return { json, buffers };
}

export function restore(s: SimState, snap: Snapshot): void {
  const parsed = JSON.parse(snap.json) as { core: any; events: WorldEvent[]; yearStats: YearStats[] };
  const c = parsed.core;
  s.tick = c.tick; s.islandName = c.islandName;
  s.hiddenVeins = c.hiddenVeins; s.spawns = c.spawns;
  s.rng.restore(c.rngStreams);
  s.pawnCount = c.pawnCount; s.alivePawns = c.alivePawns; s.birthsDeferred = c.birthsDeferred;
  s.settlements = c.settlements; s.factions = c.factions; s.pairs = c.pairs;
  s.named = c.named; s.namedActive = c.namedActive;
  s.squads = c.squads; s.caravans = c.caravans; s.monsters = c.monsters; s.wars = c.wars;
  s.nextEventId = c.nextEventId; s.nextEntityId = c.nextEntityId;
  s.weather = c.weather; s.plague = c.plague;
  s.pending = c.pending; s.nextRequestId = c.nextRequestId;
  s.journalCursor = c.journalCursor;
  s.deathsByCause = c.deathsByCause;
  s.warTicksThisYear = c.warTicksThisYear; s.festivalUntil = c.festivalUntil;
  s.map.riverCount = c.riverCount;
  s.events = parsed.events;
  s.yearStats = parsed.yearStats;
  s.outbox = [];
  const targets = [...mapBuffers(s.map), ...pawnBuffers(s.pawns)];
  if (targets.length !== snap.buffers.length) throw new Error('snapshot buffer count mismatch');
  targets.forEach((t, i) => {
    new Uint8Array(t.buffer as ArrayBuffer, t.byteOffset, t.byteLength).set(snap.buffers[i]);
  });
}

/** FNV-1a over all buffers + json — the determinism tripwire. */
export function hashState(s: SimState): number {
  const snap = snapshot(s);
  let h = 0x811c9dc5;
  for (const buf of snap.buffers) {
    for (let i = 0; i < buf.length; i++) {
      h ^= buf[i];
      h = Math.imul(h, 0x01000193);
    }
  }
  h = (h ^ fnv1a(snap.json, h)) >>> 0;
  return h >>> 0;
}

/** Serialize snapshot to a single ArrayBuffer (for keyframes / worker transfer). */
export function packSnapshot(snap: Snapshot): ArrayBuffer {
  const enc = new TextEncoder();
  const jsonBytes = enc.encode(snap.json);
  let total = 8 + jsonBytes.length + 4;
  for (const b of snap.buffers) total += 4 + b.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  let off = 0;
  dv.setUint32(off, jsonBytes.length); off += 4;
  dv.setUint32(off, snap.buffers.length); off += 4;
  u8.set(jsonBytes, off); off += jsonBytes.length;
  for (const b of snap.buffers) {
    dv.setUint32(off, b.length); off += 4;
    u8.set(b, off); off += b.length;
  }
  dv.setUint32(off, 0xC0FFEE ^ jsonBytes.length); // trailing checksum-ish marker
  return out;
}

export function unpackSnapshot(buf: ArrayBuffer): Snapshot {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;
  const jsonLen = dv.getUint32(off); off += 4;
  const bufCount = dv.getUint32(off); off += 4;
  const json = new TextDecoder().decode(u8.subarray(off, off + jsonLen)); off += jsonLen;
  const buffers: Uint8Array[] = [];
  for (let i = 0; i < bufCount; i++) {
    const len = dv.getUint32(off); off += 4;
    buffers.push(u8.slice(off, off + len)); off += len;
  }
  return { json, buffers };
}
