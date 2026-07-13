// Loyalty (M8, P1.2): per-settlement allegiance with LEGIBLE modifiers, the
// WorldBox signed-list adaptation. Pure function of state: recomputed yearly
// by factionSystem, displayed verbatim in the settlement inspector, and read
// by the rebellion trigger. Replaces the old opaque mood+distance check.
import { TICKS_PER_YEAR } from '../../shared/types';
import { SimState, Settlement, PawnFlag, effFood } from '../state';

export interface LoyaltyModifier { label: string; value: number }

export function loyaltyBreakdown(s: SimState, st: Settlement): LoyaltyModifier[] {
  const mods: LoyaltyModifier[] = [{ label: 'allegiance to the crown', value: 100 }];
  const f = s.factions[st.factionId];
  if (!f || f.extinct || st.razed) return mods;
  const cap = s.settlements[f.capital];

  if (cap && cap.id === st.id) {
    mods.push({ label: 'seat of the crown', value: 12 });
  } else if (cap && !cap.razed) {
    const dx = st.x - cap.x, dy = st.y - cap.y;
    const dist = Math.sqrt(dx * dx + dy * dy) | 0;
    if (dist > 30) {
      mods.push({ label: `far from ${cap.name}`, value: -Math.min(18, ((dist - 30) / 4) | 0) });
    }
  } else {
    mods.push({ label: 'the capital lies in ruins', value: -15 });
  }

  // mixed folk: refugees remember other banners
  let pop = 0, refugees = 0;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
    if (s.pawns.settlementId[i] !== st.id) continue;
    pop++;
    if (s.pawns.flags[i] & PawnFlag.Refugee) refugees++;
  }
  if (pop > 0 && refugees * 5 >= pop) {
    mods.push({ label: 'uprooted folk among us', value: -Math.min(12, (refugees * 30 / pop) | 0) });
  }

  // the ruler: stewardship and legitimacy
  const king = f.leaderId >= 0 ? s.named[f.leaderId] : null;
  if (!king || king.deathTick >= 0) {
    mods.push({ label: 'an empty throne', value: -10 });
  } else {
    if (king.pawnIdx >= 0 && s.pawns.charisma[king.pawnIdx] > 160) {
      mods.push({ label: `${king.name} is beloved`, value: 8 });
    }
    const crowned = king.memories.find(m => m.text.includes('took the crown'));
    if (crowned && s.tick - crowned.tick < 3 * TICKS_PER_YEAR) {
      mods.push({ label: 'an untested new ruler', value: -6 });
    }
  }

  // tax pressure: a vassal's dues flow uphill
  if (f.vassalOf >= 0 && !s.factions[f.vassalOf]?.extinct) {
    mods.push({ label: `tribute owed to ${s.factions[f.vassalOf].name}`, value: -8 });
  }

  // war exhaustion
  for (const w of s.wars) {
    if (w.attacker !== f.id && w.defender !== f.id) continue;
    const ex = w.attacker === f.id ? w.exhaustionA : w.exhaustionB;
    if (ex > 100) mods.push({ label: 'weary of war', value: -Math.min(12, (ex / 40) | 0) });
    break;
  }

  // recent conquest: new subjects do not love their conquerors (fades ~20y)
  if (st.capturedTick >= 0) {
    const age = s.tick - st.capturedTick;
    const span = 20 * TICKS_PER_YEAR;
    if (age < span) {
      mods.push({ label: 'taken by conquest', value: -Math.max(5, 25 - ((age * 25 / span) | 0)) });
    }
  }

  // local conditions: mood and food security
  if (st.moodAvg < 110) mods.push({ label: 'grim spirits', value: -Math.min(10, ((110 - st.moodAvg) / 4) | 0) });
  else if (st.moodAvg > 150) mods.push({ label: 'high spirits', value: 6 });
  if (effFood(st) < 8000) mods.push({ label: 'hungry larders', value: -10 });

  return mods;
}

export function computeLoyalty(s: SimState, st: Settlement): number {
  let sum = 0;
  for (const m of loyaltyBreakdown(s, st)) sum += m.value;
  return Math.max(0, Math.min(150, sum));
}
