// System 1: season/year rollover + yearly stats collection + era turns (M12).
import { TICKS_PER_YEAR, Season, TICKS_PER_SEASON, EventType } from '../../shared/types';
import { SimState, PawnFlag, YearStats } from '../state';
import { eraMods, ERA_SPAN_YEARS } from '../rules/eras';
import { emitEvent } from '../events/events';

export function seasonOf(tick: number): Season {
  return (Math.floor(tick / TICKS_PER_SEASON) % 4) as Season;
}

export function calendarSystem(s: SimState): void {
  if (s.tick % TICKS_PER_YEAR !== 0 || s.tick === 0) return;
  const year = s.tick / TICKS_PER_YEAR;
  // per-faction books grow with faction births (M9): arrays sized to the
  // current roster, never a hardcoded 4
  const nf = s.factions.length;
  const popByFaction = new Array(nf).fill(0);
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
    const f = s.pawns.factionId[i];
    if (f < nf) popByFaction[f]++;
  }
  const foodByFaction = new Array(nf).fill(0);
  for (const st of s.settlements) {
    if (st.razed || st.factionId >= nf) continue;
    foodByFaction[st.factionId] += st.stockpile[0] + st.stockpile[1] + st.stockpile[2];
  }
  const territoryByFaction = new Array(nf).fill(0);
  for (const st of s.settlements) {
    if (!st.razed && st.factionId < nf) territoryByFaction[st.factionId]++;
  }
  const oreByFaction = new Array(nf).fill(0);
  for (const st of s.settlements) {
    if (!st.razed && st.factionId < nf) oreByFaction[st.factionId] += st.stockpile[5];
  }
  const llmCoverage = s.factions.map(f =>
    f.llmCoverageDen > 0 ? Math.round((f.llmCoverageNum * 100) / f.llmCoverageDen) : 100);
  const stats: YearStats = {
    year, popByFaction, foodByFaction, warTicks: s.warTicksThisYear,
    territoryByFaction, oreByFaction, llmCoverage,
  };
  s.yearStats.push(stats);
  s.warTicksThisYear = 0;

  // the age turns (M12, P4.2): the wheel is announced so the chronicle and
  // timeline can narrate the macro rhythm the sim is about to feel
  if ((s.config.eraWheel ?? true) && year % ERA_SPAN_YEARS === 0 && year > 0) {
    const era = eraMods(s.seed, year, true);
    const prev = eraMods(s.seed, year - 1, true);
    if (era.name !== prev.name) {
      emitEvent(s, {
        type: EventType.Festival, factions: [], severity: 3,
        x: s.map.size >> 1, y: s.map.size >> 1,
        text: `Y${year}: The age turns. Elders say ${era.name} are upon the world.`,
      });
    }
  }
}
