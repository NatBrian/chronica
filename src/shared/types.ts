// Shared enums & types: imported by sim, render, ui, brain.

export const SIM_VERSION = '1.0.0';

export const TICKS_PER_YEAR = 360;
export const TICKS_PER_SEASON = 90;

export enum Season { Spring = 0, Summer = 1, Autumn = 2, Winter = 3 }

export enum Biome {
  DeepOcean = 0, Ocean = 1, Lake = 2, Beach = 3, Grassland = 4,
  Forest = 5, DarkForest = 6, Hills = 7, Mountain = 8, Steppe = 9,
  Swamp = 10, Snow = 11,
}

export enum Race { Human = 0, Elf = 1, Dwarf = 2, Orc = 3 }
export const RACE_NAMES = ['human', 'elf', 'dwarf', 'orc'] as const;

export enum Good { Grain = 0, Meat = 1, Fish = 2, Wood = 3, Stone = 4, Ore = 5, Tools = 6 }
export const GOOD_NAMES = ['grain', 'meat', 'fish', 'wood', 'stone', 'ore', 'tools'] as const;
export const GOOD_COUNT = 7;

export enum ActionId {
  Idle = 0, EatFromStockpile = 1, Forage = 2, Hunt = 3, Fish = 4,
  FarmWork = 5, ChopWood = 6, Mine = 7, Haul = 8, CraftEquipment = 9,
  BuildHouse = 10, BuildStructure = 11, Rest = 12, SeekShelter = 13,
  Court = 14, TendChild = 15, Flee = 16, Fight = 17, Patrol = 18,
  CaravanDuty = 19, SettleNewVillage = 20,
}
export const ACTION_NAMES = [
  'idle', 'eatFromStockpile', 'forage', 'hunt', 'fish', 'farmWork', 'chopWood',
  'mine', 'haul', 'craftEquipment', 'buildHouse', 'buildStructure', 'rest',
  'seekShelter', 'court', 'tendChild', 'flee', 'fight', 'patrol', 'caravanDuty',
  'settleNewVillage',
] as const;

export enum DiploState { War = 0, Hostile = 1, Neutral = 2, Trade = 3, Alliance = 4, Vassal = 5 }
export const DIPLO_NAMES = ['war', 'hostile', 'neutral', 'trade', 'alliance', 'vassal'] as const;

export enum BuildingKind {
  House = 0, Granary = 1, Workshop = 2, Temple = 3, Farm = 4, Wall = 5,
}

export enum EventType {
  // society / war
  WarDeclared = 0, PeaceMade = 1, BattleFought = 2, SettlementRazed = 3,
  SettlementFounded = 4, SettlementTaken = 5, LeaderDied = 6, Succession = 7,
  Coronation = 8, AllianceFormed = 9, TradeOpened = 10, Embargo = 11,
  TributeDemanded = 12, TributePaid = 13, TributeRefused = 14, TributeFailed = 15,
  MarriageProposed = 16, MarriageHeld = 17, ProposalRefused = 18, GiftSent = 19,
  CaravanRaided = 20, Truce = 21, Vassalized = 22, BorderShifted = 23,
  Rebellion = 24, FactionSplit = 25, FactionDissolved = 26, RaceExtinct = 27,
  // hardship
  Famine = 28, Drought = 29, HarshWinter = 30, Plague = 31, ForestFire = 32,
  // monsters
  WolfAttack = 33, TrollBlockade = 34, DragonRaid = 35, MonsterSlain = 36,
  // characters
  HeroDeed = 37, CharacterPromoted = 38, CharacterDied = 39, HeirBorn = 40,
  Festival = 41, TempleBuilt = 42, Refugees = 43, OreDiscovered = 44,
  OreDepleted = 45, Deforestation = 46, WarObjectiveSet = 47, InsultAtWedding = 48,
  GrudgeFormed = 49, CouncilHeld = 50, Conscription = 51, WorldGenesis = 52,
}

export interface WorldEvent {
  id: number;
  tick: number;
  type: EventType;
  /** named character ids or faction ids (f prefix in text rendering) */
  actors: number[];
  factions: number[];
  x: number;
  y: number;
  causes: number[];
  severity: number; // 1..5
  text: string;
  data?: Record<string, number | string>;
}

// ---- Journal (the save file) ----

export interface WorldConfig {
  mapSize: number;            // tiles per side
  maxPawns: number;
  factionCount: 4;            // fixed for MVP (04)
  startPawnsPerFaction: number;
  // novel-mechanism config gates (01 §admission rules)
  oreDepletion: boolean;
  grudgeGravity: boolean;
  coalitions: boolean;
  injectors: boolean;
  genetics: boolean;
  decisionWindowTicks: number; // uniform window W (05 §Latency fairness)
  mirrorMatch: boolean;        // 4 identical human factions (04 engine-fairness soak)
  keyframeIntervalYears: number;
  namedCapBase: number;
  namedCapMax: number;
}

export function defaultConfig(): WorldConfig {
  return {
    mapSize: 512,
    maxPawns: 4096,
    factionCount: 4,
    startPawnsPerFaction: 45,
    oreDepletion: true,
    grudgeGravity: true,
    coalitions: true,
    injectors: true,
    genetics: true,
    // W must cover LLM inference at 1× (10 t/s): 60 ticks = 6s wall-clock.
    // At 16× the window is 0.4s; kings rule by instinct (05 speed labels).
    decisionWindowTicks: 60,
    mirrorMatch: false,
    keyframeIntervalYears: 10,
    namedCapBase: 30,
    namedCapMax: 50,
  };
}

export type DecisionSource = 'ollama' | 'byok' | 'fallback';

/** One journaled decision: the ONLY external input to the sim besides the seed. */
export interface JournalEntry {
  seq: number;
  requestId: number;
  requestTick: number;
  applyAtTick: number;
  actorId: number;          // named character id
  factionId: number;
  choice: string;           // e.g. "DECLARE_WAR(2)"
  reasoning: string;
  newMemory?: string;
  source: DecisionSource;
  void?: boolean;           // dead-actor / superseded; stays for bit-identical replay
}

export interface JournalHeader {
  seed: number;
  simVersion: string;
  config: WorldConfig;
  islandName?: string;
  createdAtTick?: number;
}

export interface Journal {
  header: JournalHeader;
  entries: JournalEntry[];
}

/** A decision the sim wants a brain to make. Emitted by rule engine, resolved outside tick. */
export interface DecisionRequest {
  requestId: number;
  tick: number;
  applyAtTick: number;
  actorId: number;
  factionId: number;
  kind: string;             // 'council' | 'crisis' | 'response' ...
  priority: number;         // higher = more important
  options: string[];        // legal options from rule engine
  digest: DecisionDigest;
}

export interface DecisionDigest {
  persona: {
    name: string; race: string; traits: string[]; age: number; yearsRuled: number;
    god: string; culture: { aggression: number; piety: number; wanderlust: number };
  };
  memories: string[];
  grudges: { faction: string; weight: number; why: string }[];
  situation: {
    year: number; season: string; foodStores: string; armyStrength: string;
    population: number; settlements: number;
    enemyEstimates: Record<string, string>;
    activeTreaties: string[];
    recentEvents: string[];
  };
  recentChoices: string[];
  options: string[];
}

export interface DecisionResult {
  choice: string;
  reasoning: string;
  newMemory?: string;
}

// ---- Chronicle (stored content, 05) ----

export interface ChronicleAnchor { year: number; x: number; y: number; eventId: number }

export interface ChronicleChapter {
  id: number;
  title: string;
  era: string;
  yearStart: number;
  yearEnd: number;
  paragraphs: { text: string; anchor: ChronicleAnchor }[];
  factIds: number[];
  source: 'llm' | 'template';
  factionBias?: string;
}

export interface ChronicleEra {
  name: string;
  yearStart: number;
  yearEnd: number;
  summary: string;
}
