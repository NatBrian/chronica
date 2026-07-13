// System 4 — needs decay, aging, derived mood (03 §Needs model).
// Soft-feedback rule: scarcity ramps gradually; mood dips before deaths.
import { ActionId, Season, TICKS_PER_YEAR } from '../../shared/types';
import { RACE_TABLE } from '../raceData';
import { AGE_SCALE, PawnFlag, SimState } from '../state';
import { seasonOf } from './calendarSystem';

const WORK_ACTIONS = new Set<number>([
  ActionId.Forage, ActionId.Hunt, ActionId.Fish, ActionId.FarmWork, ActionId.ChopWood,
  ActionId.Mine, ActionId.Haul, ActionId.CraftEquipment, ActionId.BuildHouse,
  ActionId.BuildStructure, ActionId.Fight, ActionId.Patrol, ActionId.CaravanDuty,
]);

export function needsSystem(s: SimState): void {
  const p = s.pawns;
  const winter = seasonOf(s.tick) === Season.Winter;
  const winterMult = winter ? (s.weather.winterSeverity > 160 ? 3 : 2) : 1;
  const agePhase = s.tick % AGE_SCALE;

  for (let i = 0; i < s.pawnCount; i++) {
    const flags = p.flags[i];
    if (!(flags & PawnFlag.Alive)) continue;

    // hunger: +3/day base, harsher in winter, +1 when working (integer, bounded)
    const working = WORK_ACTIONS.has(p.action[i]);
    let dh = 3;
    if (winter) dh += winterMult - 1;
    if (working && (s.tick & 1) === 0) dh += 1;
    if (flags & PawnFlag.Child) dh -= 1;
    p.hunger[i] = Math.min(255, p.hunger[i] + dh);

    // energy: work/travel drains, idle recovers slightly (rest recovers a lot in workSystem)
    if (working || p.action[i] === ActionId.Flee) {
      p.energy[i] = Math.max(0, p.energy[i] - 3);
    } else if (p.action[i] === ActionId.Rest || p.action[i] === ActionId.Idle) {
      p.energy[i] = Math.min(255, p.energy[i] + 2);
    } else {
      p.energy[i] = Math.max(0, p.energy[i] - 1);
    }

    // shelter exposure: rises in winter unless in shelter; decays otherwise
    if (winter && !(flags & PawnFlag.InShelter)) {
      p.shelter[i] = Math.min(255, p.shelter[i] + winterMult);
    } else if (p.shelter[i] > 0) {
      p.shelter[i] = Math.max(0, p.shelter[i] - 4);
    }

    // safety fear decays (combat raises it)
    if (p.safety[i] > 0) p.safety[i] -= 1;

    // social: adults without partner accumulate
    if (!(flags & PawnFlag.Child) && p.pairId[i] < 0) {
      if (s.tick % 4 === 0) p.social[i] = Math.min(255, p.social[i] + 1);
    } else if (p.social[i] > 0) {
      p.social[i] -= 1;
    }

    // aging (staggered by AGE_SCALE)
    if (agePhase === (i & (AGE_SCALE - 1))) {
      p.age[i] = Math.min(65535, p.age[i] + 1);
      const rs = RACE_TABLE[s.factions[p.factionId[i]]?.race as 0] ?? RACE_TABLE[0];
      const years = (p.age[i] * AGE_SCALE / TICKS_PER_YEAR) | 0;
      if ((flags & PawnFlag.Child) && years >= rs.adultAtYears) {
        p.flags[i] = (p.flags[i] & ~PawnFlag.Child) | 0;
      }
      if (!(flags & PawnFlag.Elder) && years >= rs.elderAtYears) {
        p.flags[i] |= PawnFlag.Elder;
      }
    }

    // starvation / exposure damage — deaths lag sustained deficit (03 damping)
    if (p.hunger[i] >= 250) {
      p.hp[i] = Math.max(0, p.hp[i] - 2);
    } else if (p.hunger[i] < 180 && p.hp[i] < 100 && (s.tick & 3) === 0) {
      p.hp[i] = Math.min(100, p.hp[i] + 1);
    }
    if (p.shelter[i] >= 240) {
      p.hp[i] = Math.max(0, p.hp[i] - 2);
    }

    // mood: derived, no decay loop of its own (03)
    const hungerPenalty = p.hunger[i] > 120 ? (p.hunger[i] - 120) >> 1 : 0;
    const energyPenalty = p.energy[i] < 80 ? (80 - p.energy[i]) >> 2 : 0;
    const fearPenalty = p.safety[i] >> 1;
    const coldPenalty = p.shelter[i] >> 2;
    let mood = 200 - hungerPenalty - energyPenalty - fearPenalty - coldPenalty;
    if (s.festivalUntil > s.tick) mood += 25;
    p.mood[i] = Math.max(0, Math.min(255, mood));
  }
}
