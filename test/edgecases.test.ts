// D-class edge tests D3, D5, D6 (10-edge-cases.md).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { EventType, Good, GOOD_COUNT } from '../src/shared/types';
import { PawnFlag } from '../src/sim/state';
import { payTribute, razeSettlement } from '../src/sim/rules/decisions';
import { killPawn } from '../src/sim/pawnOps';

const CFG = { mapSize: 192, startPawnsPerFaction: 40 };

describe('D-class edge cases', () => {
  it('D3: all factions extinct → world keeps simulating, no crash', () => {
    const sim = Sim.fresh(4, CFG);
    sim.runYears(3);
    const s = sim.state;
    // exterminate everyone
    for (let i = 0; i < s.pawnCount; i++) {
      if (s.pawns.flags[i] & PawnFlag.Alive) killPawn(s, i, 'plague');
    }
    sim.runYears(5);                        // world of nature and ghosts
    expect(s.alivePawns).toBe(0);
    expect(s.factions.every(f => f.extinct)).toBe(true);
    const extinctionEvents = s.events.filter(e =>
      e.type === EventType.FactionDissolved || e.type === EventType.RaceExtinct);
    expect(extinctionEvents.length).toBeGreaterThanOrEqual(4);
    // world still ticks: weather events continue in the empty world
    const before = s.events.length;
    sim.runYears(4);
    expect(s.tick).toBe(12 * 360);
    expect(s.events.length).toBeGreaterThanOrEqual(before);
  });

  it('D5: caravan destination razed mid-route → reroute or return, goods persist', () => {
    const sim = Sim.fresh(11, CFG);
    sim.runYears(2);
    const s = sim.state;
    // hand-craft a caravan from settlement 0 to settlement 1
    const src = s.settlements[0], dst = s.settlements[1];
    const goods = new Array(GOOD_COUNT).fill(0);
    goods[Good.Grain] = 100;
    s.caravans.push({
      id: 9999, from: src.id, to: dst.id, factionId: src.factionId,
      x: src.x, y: src.y, goods, purpose: 'trade', escorts: [], state: 'travel', raided: false, pathIdx: 0,
    });
    // raze the destination while the caravan travels
    razeSettlement(s, dst.id, 3);
    sim.runYears(2);
    // caravan resolved (rerouted or returned) — goods not vaporized silently:
    const c = s.caravans.find(cv => cv.id === 9999);
    expect(!c || c.state !== 'travel' || !s.settlements[c.to].razed).toBe(true);
  });

  it('D6: tribute that CANNOT be paid emits TributeFailed (≠ refusal)', () => {
    const sim = Sim.fresh(11, CFG);
    sim.runYears(1);
    const s = sim.state;
    // drain payer's granaries so tribute must fail
    for (const st of s.settlements) {
      if (st.factionId === 0) st.stockpile.fill(0);
    }
    payTribute(s, 0, 1, 'tribute');
    const failed = s.events.filter(e => e.type === EventType.TributeFailed);
    expect(failed.length).toBe(1);
    expect(failed[0].text).toContain('could not');
    // and no TributeRefused was emitted for this
    expect(s.events.some(e => e.type === EventType.TributeRefused)).toBe(false);
  });
});
