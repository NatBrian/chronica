// System 8 — action execution at target: gather, eat, rest, court.
// Yields go straight to the settlement stockpile (hauling abstracted in M1).
import { ActionId, Good } from '../../shared/types';
import { PawnFlag, SimState } from '../state';
import { RACE_TABLE } from '../raceData';

export function workSystem(s: SimState): void {
  const p = s.pawns;
  const N = s.map.size;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(p.flags[i] & PawnFlag.Alive)) continue;
    const action = p.action[i];
    if (action === ActionId.Idle && p.actionTarget[i] < 0) continue;
    const target = p.actionTarget[i];
    if (target < 0) continue;
    const tx = target % N, ty = (target / N) | 0;
    if (p.x[i] !== tx || p.y[i] !== ty) continue;          // still traveling

    // arrived — sheltering actions set the flag immediately
    if (action === ActionId.Rest || action === ActionId.SeekShelter) {
      p.flags[i] |= PawnFlag.InShelter;
    }
    if (p.actionTicks[i] > 0) {
      p.actionTicks[i]--;
      // work-speed penalty when hungry (03 soft feedback): hungry pawns lose ticks
      if (p.hunger[i] > 190 && (s.tick & 1) === 0 && p.actionTicks[i] > 0) {
        // skip progress every other tick
        p.actionTicks[i]++;
      }
      if (p.actionTicks[i] > 0) continue;
    }

    // completion payoff
    const st = s.settlements[p.settlementId[i]];
    const rs = RACE_TABLE[(s.factions[p.factionId[i]]?.race ?? 0) as 0];
    switch (action) {
      case ActionId.EatFromStockpile: {
        if (st && !st.razed) {
          let need = 2;
          for (const g of [Good.Grain, Good.Fish, Good.Meat]) {
            const take = Math.min(need, st.stockpile[g]);
            st.stockpile[g] -= take; need -= take;
            if (need === 0) break;
          }
          if (need < 2) p.hunger[i] = need === 0 ? 15 : 90;
        }
        break;
      }
      case ActionId.Forage: {
        if (st) {
          const gain = (4 + (s.map.fertility[target] >> 5)) * rs.farmSkill / 100 | 0;
          st.stockpile[Good.Grain] = Math.min(st.granaryCap, st.stockpile[Good.Grain] + gain);
        }
        break;
      }
      case ActionId.Hunt: {
        if (st) {
          const gain = 4 + (s.map.game[target] >> 5);
          st.stockpile[Good.Meat] = Math.min(st.granaryCap, st.stockpile[Good.Meat] + gain);
          s.map.game[target] = Math.max(0, s.map.game[target] - 12);
        }
        break;
      }
      case ActionId.Fish: {
        if (st) {
          const gain = 3 + (s.map.fish[target] >> 6) + (rs.forestYield > 120 ? 1 : 0);
          st.stockpile[Good.Fish] = Math.min(st.granaryCap, st.stockpile[Good.Fish] + gain);
          s.map.fish[target] = Math.max(20, s.map.fish[target] - 6);
        }
        break;
      }
      case ActionId.Rest: {
        p.energy[i] = Math.min(255, p.energy[i] + 170);
        break;
      }
      case ActionId.SeekShelter: {
        p.shelter[i] = Math.max(0, p.shelter[i] - 120);
        break;
      }
      case ActionId.Court: {
        if (st) {
          // deterministic pairing: lowest-index eligible candidate in settlement
          const wantFemale = !(p.flags[i] & PawnFlag.Female);
          for (let j = 0; j < s.pawnCount; j++) {
            if (j === i) continue;
            const fl = p.flags[j];
            if (!(fl & PawnFlag.Alive) || (fl & PawnFlag.Child)) continue;
            if (p.settlementId[j] !== p.settlementId[i]) continue;
            if (p.pairId[j] >= 0) continue;
            if (((fl & PawnFlag.Female) !== 0) !== wantFemale) continue;
            p.pairId[i] = j; p.pairId[j] = i;
            p.social[i] = 0; p.social[j] = 0;
            break;
          }
        }
        break;
      }
      default:
        break;
    }
    // action done → free for next decision window
    if (action !== ActionId.Idle) {
      p.jobAffinity[i] = action;
    }
    p.action[i] = ActionId.Idle;
    p.actionTarget[i] = -1;
    p.actionTicks[i] = 0;
  }

  // slow resource regrowth (game herds wander back, fish return, forest regrows)
  if (s.tick % 90 === 7) {
    const m = s.map;
    for (let i = 0; i < m.size * m.size; i++) {
      if (m.game[i] > 0 && m.game[i] < 180) m.game[i] += 2;
      if (m.fish[i] > 0 && m.fish[i] < 200) m.fish[i] += 3;
    }
  }
  if (s.tick % 360 === 11) {
    const m = s.map;
    for (let i = 0; i < m.size * m.size; i++) {
      const f = m.forest[i];
      if (f > 4 && f < 220) m.forest[i] = f + 1;
    }
  }
}
