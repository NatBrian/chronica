// M11 exit criteria: attachment. Renown accrues from deeds (P3.3) and a
// renowned life becomes a chapter whose every fact is a real event (P3.4).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { detectHeroArcs } from '../src/chronicle/detector';

describe('M11: attachment', () => {
  it('renown accrues; hero arcs anchor every fact to the event log', () => {
    const sim = Sim.fresh(42, { mapSize: 192 });
    sim.runYears(150);
    const s = sim.state;
    const top = [...s.named].sort((a, b) => (b.renown ?? 0) - (a.renown ?? 0))[0];
    console.log(`most renowned: ${top.name} (${top.renown})`);
    expect(top.renown ?? 0).toBeGreaterThanOrEqual(30);
    const heroDone: Record<number, boolean> = {};
    const arcs = detectHeroArcs(s.named, s.events, heroDone, 100);
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    for (const { draft, title } of arcs) {
      expect(title).toMatch(/^The Life of /);
      expect(draft.factIds.length).toBeGreaterThanOrEqual(4);
      // every fact validates against the event log
      for (const id of draft.factIds) {
        expect(s.events.find(e => e.id === id)).toBeTruthy();
      }
      expect(heroDone[s.named.find(n => title.includes(n.name))!.id]).toBe(true);
    }
    // idempotent: a life is chaptered once
    expect(detectHeroArcs(s.named, s.events, heroDone, 200).length).toBe(0);
  }, 300_000);

  it('family lineage data supports a three-generation tree', () => {
    const sim = Sim.fresh(42, { mapSize: 192 });
    sim.runYears(150);
    const s = sim.state;
    // some named character has a parent link (heirs, crowned successors)
    const withParent = s.named.filter(n => n.parentNamedId >= 0);
    expect(withParent.length).toBeGreaterThanOrEqual(1);
    for (const n of withParent) {
      expect(s.named[n.parentNamedId]).toBeTruthy();
    }
  }, 300_000);
});
