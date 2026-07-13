// THE determinism tripwire (08 §Testing contract): first test in the repo.
// (a) same seed twice for 50y → identical hash
// (b) run 50y, seek back to 25y via keyframe, re-run to 50y → identical hash
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { TICKS_PER_YEAR } from '../src/shared/types';

const TEST_CONFIG = { mapSize: 192, startPawnsPerFaction: 40 };
const YEARS = 50;

describe('determinism suite', () => {
  it('same seed run twice → identical state hash', () => {
    const a = Sim.fresh(42, TEST_CONFIG);
    const b = Sim.fresh(42, TEST_CONFIG);
    expect(a.hash()).toBe(b.hash()); // genesis identical
    a.runYears(YEARS);
    b.runYears(YEARS);
    expect(a.hash()).toBe(b.hash());
  });

  it('seek back to mid-run keyframe, re-run → identical hash', () => {
    const a = Sim.fresh(42, TEST_CONFIG);
    a.runYears(YEARS);
    const hEnd = a.hash();
    a.seekToYear(YEARS / 2);
    const hMid = a.hash();
    a.runYears(YEARS / 2);
    expect(a.hash()).toBe(hEnd);
    // and seeking again to the midpoint reproduces the mid hash
    a.seekToYear(YEARS / 2);
    expect(a.hash()).toBe(hMid);
  });

  it('different seeds → different worlds', () => {
    const a = Sim.fresh(1, TEST_CONFIG);
    const b = Sim.fresh(2, TEST_CONFIG);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('journal replay is bit-identical', () => {
    const live = Sim.fresh(7, TEST_CONFIG);
    live.runYears(10);
    const replayed = Sim.replay(live.journal, 10 * TICKS_PER_YEAR);
    expect(replayed.hash()).toBe(live.hash());
  });
});
