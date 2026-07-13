// System 13 — event detection: famine, deforestation, festivals, promotions
// (trait outlier, heir), settlement mood. Events feed the DAG + chronicle.
import { EventType, TICKS_PER_YEAR, Season, Good, BuildingKind } from '../../shared/types';
import { SimState, PawnFlag, effFood } from '../state';
import { emitEvent, yearOf } from '../events/events';
import { promoteNamed, namedCap } from '../namedOps';
import { seasonOf } from './calendarSystem';
import { RACE_TABLE } from '../raceData';

export function eventDetectSystem(s: SimState): void {
  // settlement mood cache + famine detection (staggered)
  if (s.tick % 90 === 33) {
    for (const st of s.settlements) {
      if (st.razed) continue;
      let sum = 0, n = 0;
      for (let i = 0; i < s.pawnCount; i++) {
        if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
        if (s.pawns.settlementId[i] !== st.id) continue;
        sum += s.pawns.mood[i]; n++;
      }
      st.moodAvg = n ? (sum / n) | 0 : 150;

      if (n > 0 && effFood(st) < 3500) {
        const recentFamine = s.events.some(e =>
          e.type === EventType.Famine && e.x === st.x && e.y === st.y &&
          s.tick - e.tick < 5 * TICKS_PER_YEAR);
        if (!recentFamine) {
          const drought = s.events.slice(-60).find(e =>
            e.type === EventType.Drought && s.tick - e.tick < 3 * TICKS_PER_YEAR);
          emitEvent(s, {
            type: EventType.Famine,
            factions: [st.factionId],
            x: st.x, y: st.y,
            causes: drought ? [drought.id] : [],
            severity: 3,
            text: `Y${yearOf(s.tick)}: Hunger stalks ${st.name}. The granaries echo.`,
          });
        }
      }
    }
  }

  // harvest festival (autumn, well-fed settlements) — piety & mood flavor
  if (s.tick % TICKS_PER_YEAR === 250 && seasonOf(s.tick) === Season.Autumn) {
    const rich = s.settlements.find(st => !st.razed && effFood(st) > 24000 && st.popCache > 40);
    if (rich) {
      const f = s.factions[rich.factionId];
      s.festivalUntil = s.tick + 20;
      emitEvent(s, {
        type: EventType.Festival,
        factions: [rich.factionId],
        x: rich.x, y: rich.y, severity: 1,
        text: `Y${yearOf(s.tick)}: ${rich.name} feasts in ${f.god}'s name — the harvest was kind.`,
      });
    }
  }

  // temple completion events + trait-outlier promotion, yearly
  if (s.tick % TICKS_PER_YEAR === 300) {
    for (const st of s.settlements) {
      if (st.razed) continue;
      const temple = st.buildings.find(b => b.kind === BuildingKind.Temple && b.stage === 3 && b.workDone < 100);
      if (temple) {
        temple.workDone = 100;   // mark announced
        emitEvent(s, {
          type: EventType.TempleBuilt, factions: [st.factionId],
          x: temple.x, y: temple.y, severity: 2,
          text: `Y${yearOf(s.tick)}: A temple to ${s.factions[st.factionId].god} rises in ${st.name}.`,
        });
      }
    }
    // trait outlier: the destined commoner (03) — top-percentile young adult
    if (s.namedActive < namedCap(s)) {
      let best = -1, bestVal = 205;   // only genuinely exceptional
      for (let i = 0; i < s.pawnCount; i++) {
        const fl = s.pawns.flags[i];
        if (!(fl & PawnFlag.Alive) || (fl & PawnFlag.Child) || (fl & PawnFlag.Named)) continue;
        const rs = RACE_TABLE[(s.factions[s.pawns.factionId[i]]?.race ?? 0) as 0];
        const years = (s.pawns.age[i] * 4 / TICKS_PER_YEAR) | 0;
        if (years > rs.adultAtYears + 6) continue;         // youth only
        const v = Math.max(s.pawns.charisma[i], s.pawns.strength[i]);
        if (v > bestVal) { bestVal = v; best = i; }
      }
      if (best >= 0) {
        promoteNamed(s, best, 'prodigy',
          s.pawns.charisma[best] >= s.pawns.strength[best]
            ? 'A commoner whose words move crowds.'
            : 'A commoner of legendary strength.');
      }
    }
  }

  // heir promotion: firstborn of a ruling king (03) — cheap scan monthly
  if (s.tick % 30 === 21) {
    for (const f of s.factions) {
      if (f.extinct || f.leaderId < 0) continue;
      const king = s.named[f.leaderId];
      if (!king || king.deathTick >= 0 || king.pawnIdx < 0) continue;
      const hasHeir = s.named.some(n => n.deathTick < 0 && n.role === 'heir' && n.parentNamedId === king.id);
      if (hasHeir) continue;
      for (let i = 0; i < s.pawnCount; i++) {
        if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
        if (s.pawns.namedId[i] >= 0) continue;
        if (s.pawns.motherId[i] !== king.pawnIdx && s.pawns.fatherId[i] !== king.pawnIdx) continue;
        const nc = promoteNamed(s, i, 'heir', `Child of ${king.name}.`);
        if (nc) nc.parentNamedId = king.id;
        break;
      }
    }
  }
}
