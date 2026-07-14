// M9 exit criteria: politics. Rebellion births real factions (P1.3),
// dynasties + legitimacy (P1.4), faction slots capped and reused.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { EventType, TICKS_PER_YEAR } from '../src/shared/types';
import { pairKey, MAX_FACTIONS, PawnFlag } from '../src/sim/state';

const CFG = { mapSize: 192 };

describe('M9: politics', () => {
  it('natural rebellion births a working faction; replay bit-identical', () => {
    // seed 42 revolts 3 times within 300y on the current world line
    // (rng-ripple sensitive: any sim change re-rolls WHEN, not WHETHER)
    const sim = Sim.fresh(42, CFG);
    sim.runYears(300);
    const s = sim.state;
    const splits = s.events.filter(e => e.type === EventType.FactionSplit);
    expect(splits.length).toBeGreaterThanOrEqual(1);
    // the newborn faction is a full citizen: valid slot, pairs, dynasty
    for (const f of s.factions) {
      expect(f.id).toBeLessThan(MAX_FACTIONS);
      if (f.extinct) continue;
      expect(f.dynasty?.clan.length ?? 0).toBeGreaterThan(1);
      for (const o of s.factions) {
        if (o.id === f.id || o.extinct) continue;
        expect(s.pairs[pairKey(f.id, o.id)]).toBeDefined();
      }
    }
    // the whole political history replays bit-identically from the journal
    const b = Sim.replay(sim.journal, 300 * TICKS_PER_YEAR);
    expect(b.hash()).toBe(sim.hash());
  }, 300_000);

  it('heirless death of a wide realm fractures it (succession crisis)', () => {
    // 150y: daughter villages have matured past the 40-pop province floor
    // (popCache is refreshed from real pawns; faking it gets overwritten)
    const sim = Sim.fresh(7, CFG);
    sim.runYears(150);
    const s = sim.state;
    // widest realm, annexing mature towns until it spans 3 peopled provinces
    const counts = new Map<number, number>();
    for (const st of s.settlements) {
      if (!st.razed && st.popCache > 60) counts.set(st.factionId, (counts.get(st.factionId) ?? 0) + 1);
    }
    const fid = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const f = s.factions[fid];
    for (const st of s.settlements) {
      if (st.razed || st.factionId === fid || st.popCache <= 60) continue;
      if ((counts.get(fid) ?? 0) >= 3) break;
      st.factionId = fid;
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
    expect(counts.get(fid) ?? 0).toBeGreaterThanOrEqual(3);
    // kill the king and every heir: the bloodline ends tonight
    for (const n of s.named) {
      if (n.factionId !== fid || n.deathTick >= 0) continue;
      if (n.role === 'king' || n.role === 'heir') {
        n.deathTick = s.tick;
        if (n.pawnIdx >= 0) {
          s.pawns.flags[n.pawnIdx] &= ~PawnFlag.Alive;
          s.pawns.namedId[n.pawnIdx] = -1;
          n.pawnIdx = -1;
        }
      }
    }
    sim.runYears(2);
    const crisis = s.events.filter(e => e.text.includes('realm trembles'));
    const splits = s.events.filter(e => e.type === EventType.FactionSplit && e.tick >= s.tick - 2 * TICKS_PER_YEAR);
    expect(crisis.length).toBeGreaterThanOrEqual(1);
    expect(splits.length).toBeGreaterThanOrEqual(1);
    // the seceded settlement now flies the rebel banner (net faction count can
    // still dip if an unrelated faction dies in the same window: don't assert it)
    const rebel = s.factions.find(x => !x.extinct && x.name.startsWith('Free '));
    expect(rebel).toBeTruthy();
  }, 240_000);

  it('500y seed 42: faction count varies, dynasties turn, slots stay <= 8', () => {
    const sim = Sim.fresh(42, CFG);
    const counts: number[] = [];
    for (let block = 0; block < 10; block++) {
      sim.runYears(50);
      const s = sim.state;
      counts.push(s.factions.filter(x => !x.extinct).length);
      expect(s.factions.length).toBeLessThanOrEqual(MAX_FACTIONS);
      // squads never carry foreign deserters (war-during-fracture edge)
      for (const sq of s.squads) {
        for (const m of sq.members) {
          if (!(s.pawns.flags[m] & PawnFlag.Alive)) continue;
          expect(s.pawns.factionId[m]).toBe(sq.factionId);
        }
      }
    }
    const s = sim.state;
    console.log(`faction counts per 50y: [${counts}]`);
    // not monotonic to 1, not frozen at 4: the cycle turns
    expect(new Set(counts).size).toBeGreaterThanOrEqual(2);
    expect(Math.max(...counts)).toBeGreaterThan(4 - 1);
    const dyn = s.events.filter(e => e.text.includes('passes from House'));
    expect(dyn.length).toBeGreaterThanOrEqual(2);
    expect(s.alivePawns).toBeGreaterThan(100);
  }, 600_000);
});
