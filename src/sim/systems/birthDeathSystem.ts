// System 10 — procreation, starvation, aging out (03 §Lifecycle).
// Anti-extinction-spiral: birth rate dips before deaths spike (soft feedback).
import { EventType, TICKS_PER_YEAR } from '../../shared/types';
import { RACE_TABLE } from '../raceData';
import { AGE_SCALE, PawnFlag, SimState } from '../state';
import { spawnPawn, killPawn } from '../pawnOps';
import { emitEvent, yearOf } from '../events/events';

const GESTATION_TICKS = 270;

export function birthDeathSystem(s: SimState): void {
  const p = s.pawns;
  const rngBirths = s.rng.get('births');
  const rngDeaths = s.rng.get('deaths');

  for (let i = 0; i < s.pawnCount; i++) {
    if (!(p.flags[i] & PawnFlag.Alive)) continue;

    // ---- death by damage (starvation / cold — cause from dominant need) ----
    if (p.hp[i] === 0) {
      const cause = p.shelter[i] >= 200 ? 'cold' : p.hunger[i] >= 240 ? 'starvation' : 'combat';
      killPawn(s, i, cause);
      continue;
    }

    const rs = RACE_TABLE[(s.factions[p.factionId[i]]?.race ?? 0) as 0];
    const years = (p.age[i] * AGE_SCALE / TICKS_PER_YEAR) | 0;

    // ---- old age (checked monthly, ramps toward race max, longevity trait helps) ----
    if ((s.tick % 30) === (i % 30) && years > rs.elderAtYears) {
      const span = rs.maxAgeYears - rs.elderAtYears;
      const over = years - rs.elderAtYears - ((p.longevity[i] - 128) >> 4);
      if (over > 0) {
        const chance = Math.min(900, (over * over * 900) / (span * span) | 0);
        if (rngDeaths.chance(chance, 12000)) {
          killPawn(s, i, 'oldage');
          continue;
        }
      }
    }

    // ---- gestation & birth ----
    if (p.flags[i] & PawnFlag.Pregnant) {
      p.pregTicks[i]++;
      if (p.pregTicks[i] >= GESTATION_TICKS) {
        p.flags[i] &= ~PawnFlag.Pregnant;
        p.pregTicks[i] = 0;
        const father = p.pairId[i];
        const t = (a: Uint8Array, j: number) => {
          const pa = a[i], pb = father >= 0 ? a[father] : a[i];
          const mut = rngBirths.int(25) - 12;
          return Math.max(20, Math.min(235, ((pa + pb) >> 1) + (s.config.genetics ? mut : 0)));
        };
        const child = spawnPawn(s, {
          x: p.x[i], y: p.y[i],
          factionId: p.factionId[i], settlementId: p.settlementId[i],
          ageYears: 0, female: rngBirths.chance(1, 2),
          motherId: i, fatherId: father,
          traits: {
            strength: t(p.strength, i), fertility: t(p.fertility, i),
            temper: t(p.temper, i), longevity: t(p.longevity, i),
            charisma: t(p.charisma, i),
          },
        }, rngBirths);
        // heir of a leader is chronicle material (03 promotion comes at M3)
        if (child >= 0) {
          const momNamed = p.namedId[i];
          const dadNamed = father >= 0 ? p.namedId[father] : -1;
          const royal = [momNamed, dadNamed].find(n => n >= 0 && s.named[n]?.role === 'king');
          if (royal !== undefined && royal >= 0) {
            emitEvent(s, {
              type: EventType.HeirBorn, actors: [royal], factions: [p.factionId[i]],
              x: p.x[i], y: p.y[i], severity: 2,
              text: `Y${yearOf(s.tick)}: An heir is born to ${s.named[royal].name}.`,
            });
          }
        }
      }
    } else if (
      // ---- conception (checked twice a month, staggered) ----
      (s.tick % 15) === (i % 15) &&
      (p.flags[i] & PawnFlag.Female) &&
      !(p.flags[i] & PawnFlag.Child) &&
      years < rs.elderAtYears &&
      p.pairId[i] >= 0 &&
      (p.flags[p.pairId[i]] & PawnFlag.Alive)
    ) {
      const st = s.settlements[p.settlementId[i]];
      if (st && !st.razed) {
        // food damping: births dip before anyone starves (00 pillar)
        const fpc = st.foodPerCapitaAvg;
        let damp = fpc <= 400 ? 0 : fpc >= 1400 ? 100 : ((fpc - 400) / 10) | 0;
        if (p.mood[i] < 80) damp = (damp * 60 / 100) | 0;
        damp = Math.max(0, damp - (st.crowding >> 2));      // soft capacity (03)
        const num = (rs.breedChanceNum * damp * (64 + (p.fertility[i] >> 1))) / (100 * 128) | 0;
        if (num > 0 && rngBirths.chance(num, 1000)) {
          p.flags[i] |= PawnFlag.Pregnant;
          p.pregTicks[i] = 0;
        }
      }
    }
  }
}
