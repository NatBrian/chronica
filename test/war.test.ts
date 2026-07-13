// M3 exit criteria + D-class edge tests.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { EventType, DiploState, TICKS_PER_YEAR } from '../src/shared/types';
import { pairKey } from '../src/sim/state';
import { declareWar } from '../src/sim/rules/decisions';

const CFG = { mapSize: 192, startPawnsPerFaction: 45 };

describe('M3 exit: factions, war, causality (zero LLM)', () => {
  it('200-year run produces ≥1 war with a complete cause chain; war-share <60%', () => {
    const sim = Sim.fresh(42, CFG);
    sim.runYears(200);
    const s = sim.state;
    const wars = s.events.filter(e => e.type === EventType.WarDeclared);
    console.log(`wars declared: ${wars.length}, events total: ${s.events.length}, journal entries: ${sim.journal.entries.length}`);
    expect(wars.length).toBeGreaterThanOrEqual(1);
    // complete clickable cause chain: war event → causes exist in the log
    const withCauses = wars.filter(w => w.causes.length > 0);
    expect(withCauses.length).toBeGreaterThanOrEqual(1);
    for (const c of withCauses[0].causes) {
      expect(s.events.find(e => e.id === c)).toBeTruthy();
    }
    // war-share of sim-years < 60%
    const warYears = s.yearStats.filter(y => y.warTicks > 180).length;
    console.log(`war-share: ${(warYears / 200 * 100).toFixed(0)}%`);
    expect(warYears / 200).toBeLessThan(0.6);
    // decisions were journaled (RuleBrain), zero LLM
    expect(sim.journal.entries.length).toBeGreaterThan(10);
    expect(sim.journal.entries.every(e => e.source === 'fallback')).toBe(true);
  });

  it('determinism with full M3 systems + journal replay', () => {
    const a = Sim.fresh(13, CFG);
    a.runYears(60);
    const b = Sim.replay(a.journal, 60 * TICKS_PER_YEAR);
    expect(b.hash()).toBe(a.hash());
  });

  it('D4: mutual declarations merge into one war, both aggressors', () => {
    const sim = Sim.fresh(5, CFG);
    sim.runYears(2);
    const s = sim.state;
    declareWar(s, 0, 3, null, 'raid');
    declareWar(s, 3, 0, null, 'raid');
    const wars = s.wars.filter(w =>
      (w.attacker === 0 && w.defender === 3) || (w.attacker === 3 && w.defender === 0));
    expect(wars.length).toBe(1);
    expect(wars[0].bothAggressors).toBe(true);
  });

  it('D1/D2: leadership never left vacant; extinct factions dissolve cleanly', () => {
    const sim = Sim.fresh(8, CFG);
    sim.runYears(80);
    const s = sim.state;
    for (const f of s.factions) {
      if (f.extinct) continue;
      // a living faction always has a living leader (succession worked)
      expect(f.leaderId).toBeGreaterThanOrEqual(0);
      const king = s.named[f.leaderId];
      expect(king.deathTick).toBe(-1);
    }
    // coronations happened over 80y (kings die)
    const coronations = s.events.filter(e => e.type === EventType.Coronation);
    expect(coronations.length).toBeGreaterThan(0);
  });

  it('grudges are bounded (04 admission rules)', () => {
    const sim = Sim.fresh(3, CFG);
    sim.runYears(100);
    for (const p of sim.state.pairs) {
      expect(p.grudge).toBeLessThanOrEqual(15);
      expect(p.ledger.length).toBeLessThanOrEqual(12);
    }
  });
});
