// M12 exit criteria: world laws are genesis-time config, journaled and
// deterministic; the era wheel turns and announces itself.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { eraMods, ERA_SPAN_YEARS } from '../src/sim/rules/eras';

const CFG = { mapSize: 192 };

describe('M12: dials', () => {
  it('same seed + same laws = identical hash; law change = new header + new world', () => {
    const laws = { ...CFG, aggressionScale: 150, disasterScale: 50 };
    const a = Sim.fresh(9, laws);
    const b = Sim.fresh(9, laws);
    a.runYears(40); b.runYears(40);
    expect(a.hash()).toBe(b.hash());
    const c = Sim.fresh(9, { ...CFG, aggressionScale: 70, disasterScale: 50 });
    c.runYears(40);
    expect(c.journal.header.config.aggressionScale).not.toBe(a.journal.header.config.aggressionScale);
    expect(c.hash()).not.toBe(a.hash());
  }, 300_000);

  it('the era wheel turns deterministically and the world announces it', () => {
    const sim = Sim.fresh(42, { ...CFG, eraWheel: true });
    const YEARS = 400;
    sim.runYears(YEARS);
    // expected turns: boundaries where the wheel's name changes
    let expected = 0;
    for (let y = ERA_SPAN_YEARS; y <= YEARS; y += ERA_SPAN_YEARS) {
      if (eraMods(42, y, true).name !== eraMods(42, y - 1, true).name) expected++;
    }
    const turns = sim.state.events.filter(e => e.text.includes('The age turns'));
    console.log(`era turns announced: ${turns.length} (expected ${expected})`);
    expect(turns.length).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(2);
    // wheel off = no turns, and a different world line
    const flat = Sim.fresh(42, { ...CFG, eraWheel: false });
    flat.runYears(120);
    expect(flat.state.events.some(e => e.text.includes('The age turns'))).toBe(false);
  }, 600_000);
});
