// Balance stage 2 (04 §Engine fairness): mirror-match soak — 4 identical
// human factions. Surviving dominance pattern = map/engine bias.
// CI runs a reduced matrix; scripts/soak.mjs runs the full 100 seeds.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';

describe('mirror-match soak (reduced CI matrix)', () => {
  it('no spawn slot dominates across seeds', () => {
    const SEEDS = 10;
    const YEARS = 80;
    const winsBySlot = [0, 0, 0, 0];
    const popShareBySlot = [0, 0, 0, 0];
    for (let seed = 100; seed < 100 + SEEDS; seed++) {
      const sim = Sim.fresh(seed, { mapSize: 192, mirrorMatch: true, injectors: false });
      sim.runYears(YEARS);
      const stats = sim.state.yearStats.at(-1)!;
      const total = stats.popByFaction.reduce((a, b) => a + b, 0);
      if (total === 0) continue;
      let winner = 0;
      for (let f = 0; f < 4; f++) {
        popShareBySlot[f] += stats.popByFaction[f] / total;
        if (stats.popByFaction[f] > stats.popByFaction[winner]) winner = f;
      }
      winsBySlot[winner]++;
    }
    const shares = popShareBySlot.map(v => (v / SEEDS * 100).toFixed(1));
    console.log(`avg pop share by spawn slot: [${shares}]%  wins: [${winsBySlot}]`);
    // flat within tolerance: every slot averages 10–40% of world population
    for (let f = 0; f < 4; f++) {
      const share = popShareBySlot[f] / SEEDS;
      expect(share, `slot ${f} share ${share}`).toBeGreaterThan(0.10);
      expect(share, `slot ${f} share ${share}`).toBeLessThan(0.40);
    }
    // no slot wins more than 60% of seeds
    expect(Math.max(...winsBySlot)).toBeLessThanOrEqual(SEEDS * 0.6);
  }, 900_000);
});
