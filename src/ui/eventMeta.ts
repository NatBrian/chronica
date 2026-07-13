// Event metadata: category, glyph, color, spotlight tier. Single source of
// truth shared by the Events tab (G1 filters), timeline v2 markers (G2),
// notification hierarchy (G3), and event beacons (H). One visual language:
// the user learns it once.
import { EventType } from '../shared/types';

export type EventCategory = 'war' | 'politics' | 'disaster' | 'economy' | 'life';

/** Tier 1: beacon + arrow + toast + minimap + timeline. Tier 2: minimap +
 *  Events tab. Tier 3: Events tab only. (11 §H tier map) */
export interface EventMeta { cat: EventCategory; glyph: string; color: string; tier: 1 | 2 | 3 }

export const CATEGORY_COLOR: Record<EventCategory, string> = {
  war: '#d95763',
  politics: '#fbf236',
  disaster: '#76428a',
  economy: '#d9a066',
  life: '#6abe30',
};

const T = EventType;
const M: Partial<Record<EventType, [EventCategory, string, 1 | 2 | 3]>> = {
  [T.WarDeclared]: ['war', '⚔', 1],
  [T.PeaceMade]: ['war', '🕊', 1],
  [T.BattleFought]: ['war', '⚔', 1],
  [T.SettlementRazed]: ['war', '🔥', 1],
  [T.SettlementTaken]: ['war', '🏴', 1],
  [T.CaravanRaided]: ['war', '💰', 2],
  [T.WarObjectiveSet]: ['war', '⚔', 2],
  [T.Conscription]: ['war', '⚔', 3],
  [T.MonsterSlain]: ['war', '🗡', 2],

  [T.LeaderDied]: ['politics', '👑', 2],
  [T.Succession]: ['politics', '👑', 2],
  [T.Coronation]: ['politics', '👑', 1],
  [T.AllianceFormed]: ['politics', '🤝', 2],
  [T.Embargo]: ['politics', '🚫', 2],
  [T.TributeDemanded]: ['politics', '💰', 2],
  [T.TributePaid]: ['politics', '💰', 2],
  [T.TributeRefused]: ['politics', '💰', 2],
  [T.TributeFailed]: ['politics', '💰', 3],
  [T.MarriageProposed]: ['politics', '💍', 3],
  [T.MarriageHeld]: ['politics', '💍', 2],
  [T.ProposalRefused]: ['politics', '💍', 2],
  [T.InsultAtWedding]: ['politics', '💢', 2],
  [T.Truce]: ['politics', '🕊', 2],
  [T.Vassalized]: ['politics', '⛓', 1],
  [T.Rebellion]: ['politics', '🔥', 1],
  [T.FactionSplit]: ['politics', '💥', 1],
  [T.FactionDissolved]: ['politics', '💀', 1],
  [T.GrudgeFormed]: ['politics', '💢', 3],
  [T.CouncilHeld]: ['politics', '👑', 3],
  [T.GiftSent]: ['politics', '🎁', 3],

  [T.Famine]: ['disaster', '🌾', 2],
  [T.Drought]: ['disaster', '☀', 2],
  [T.HarshWinter]: ['disaster', '❄', 2],
  [T.Plague]: ['disaster', '☠', 1],
  [T.ForestFire]: ['disaster', '🔥', 2],
  [T.WolfAttack]: ['disaster', '🐺', 2],
  [T.TrollBlockade]: ['disaster', '🧌', 2],
  [T.DragonRaid]: ['disaster', '🐉', 1],
  [T.RaceExtinct]: ['disaster', '💀', 1],

  [T.TradeOpened]: ['economy', '🛒', 2],
  [T.OreDiscovered]: ['economy', '⛏', 2],
  [T.OreDepleted]: ['economy', '⛏', 3],
  [T.Deforestation]: ['economy', '🪓', 3],

  [T.SettlementFounded]: ['life', '🏠', 1],
  [T.HeroDeed]: ['life', '⭐', 2],
  [T.CharacterPromoted]: ['life', '⭐', 3],
  [T.CharacterDied]: ['life', '🪦', 2],
  [T.HeirBorn]: ['life', '👶', 3],
  [T.Festival]: ['life', '🎉', 3],
  [T.TempleBuilt]: ['life', '⛪', 3],
  [T.Refugees]: ['life', '🏠', 2],
  [T.BorderShifted]: ['life', '🗺', 2],
  [T.WorldGenesis]: ['life', '🌍', 1],
};

export function eventMeta(type: EventType): EventMeta {
  const row = M[type];
  if (!row) return { cat: 'life', glyph: '·', color: CATEGORY_COLOR.life, tier: 3 };
  return { cat: row[0], glyph: row[1], color: CATEGORY_COLOR[row[0]], tier: row[2] };
}

export const CATEGORY_LIST: EventCategory[] = ['war', 'politics', 'disaster', 'economy', 'life'];

/** Era band colors (G2): cycled per era index, shared by timeline + charts. */
const ERA_COLORS = ['#3f3f74', '#524b24', '#45283c', '#306082', '#663931', '#76428a'];
export function eraColor(i: number): string {
  return ERA_COLORS[((i % ERA_COLORS.length) + ERA_COLORS.length) % ERA_COLORS.length];
}
