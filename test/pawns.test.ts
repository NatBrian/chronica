// M1 exit criteria: 500 pawns forage/eat/rest/breed/die over 50y;
// population plausible (no extinction, no unbounded boom) on 10 golden seeds.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { PawnFlag } from '../src/sim/state';
import { ActionId } from '../src/shared/types';

const CFG = { mapSize: 192, startPawnsPerFaction: 45 };

describe('living pawns (M1)', () => {
  it('pawns act: eat, forage, rest observed within 2 years', () => {
    const sim = Sim.fresh(42, CFG);
    const seen = new Set<number>();
    for (let t = 0; t < 720; t++) {
      sim.tick();
      const p = sim.state.pawns;
      for (let i = 0; i < sim.state.pawnCount; i++) {
        if (p.flags[i] & PawnFlag.Alive) seen.add(p.action[i]);
      }
    }
    expect(seen.has(ActionId.EatFromStockpile)).toBe(true);
    expect(seen.has(ActionId.Rest)).toBe(true);
    const gathers = seen.has(ActionId.Forage) || seen.has(ActionId.Hunt) || seen.has(ActionId.Fish);
    expect(gathers).toBe(true);
  });

  it('population plausible over 50y on 10 golden seeds', () => {
    const results: string[] = [];
    for (let seed = 0; seed < 10; seed++) {
      const sim = Sim.fresh(seed, CFG);
      const start = sim.state.alivePawns;
      sim.runYears(50);
      const end = sim.state.alivePawns;
      results.push(`seed ${seed}: ${start} → ${end}`);
      // no extinction
      expect(end, `seed ${seed} extinct`).toBeGreaterThan(40);
      // no unbounded boom
      expect(end, `seed ${seed} boom`).toBeLessThan(start * 12);
      // births happened (children exist or pop grew)
      expect(sim.state.pawnCount).toBeGreaterThan(start);
    }
    console.log(results.join('\n'));
  });

  it('determinism holds with pawn systems live', () => {
    const a = Sim.fresh(11, CFG);
    const b = Sim.fresh(11, CFG);
    a.runYears(10);
    b.runYears(10);
    expect(a.hash()).toBe(b.hash());
    // seek-back check
    const h = a.hash();
    a.seekToYear(5);
    a.runYears(5);
    expect(a.hash()).toBe(h);
  });
});
