// System 1: season/year rollover + yearly stats collection.
import { TICKS_PER_YEAR, Season, TICKS_PER_SEASON } from '../../shared/types';
import { SimState, PawnFlag, YearStats } from '../state';

export function seasonOf(tick: number): Season {
  return (Math.floor(tick / TICKS_PER_SEASON) % 4) as Season;
}

export function calendarSystem(s: SimState): void {
  if (s.tick % TICKS_PER_YEAR !== 0 || s.tick === 0) return;
  const year = s.tick / TICKS_PER_YEAR;
  const popByFaction = [0, 0, 0, 0];
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
    const f = s.pawns.factionId[i];
    if (f < 4) popByFaction[f]++;
  }
  const foodByFaction = [0, 0, 0, 0];
  for (const st of s.settlements) {
    if (st.razed || st.factionId > 3) continue;
    foodByFaction[st.factionId] += st.stockpile[0] + st.stockpile[1] + st.stockpile[2];
  }
  const territoryByFaction = [0, 0, 0, 0];
  for (const st of s.settlements) {
    if (!st.razed && st.factionId < 4) territoryByFaction[st.factionId]++;
  }
  const oreByFaction = [0, 0, 0, 0];
  for (const st of s.settlements) {
    if (!st.razed && st.factionId < 4) oreByFaction[st.factionId] += st.stockpile[5];
  }
  const llmCoverage = s.factions.map(f =>
    f.llmCoverageDen > 0 ? Math.round((f.llmCoverageNum * 100) / f.llmCoverageDen) : 100);
  const stats: YearStats = {
    year, popByFaction, foodByFaction, warTicks: s.warTicksThisYear,
    territoryByFaction, oreByFaction, llmCoverage,
  };
  s.yearStats.push(stats);
  s.warTicksThisYear = 0;
}
