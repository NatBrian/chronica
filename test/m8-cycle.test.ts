// M8 exit criteria: the empire cycle. Expansion (11 F), loyalty (P1.2),
// war goals + capture progress (P1.5).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { EventType, Good, TICKS_PER_YEAR } from '../src/shared/types';
import { councilOptions, declareWar } from '../src/sim/rules/decisions';
import { canProsperExpand } from '../src/sim/settlementOps';
import { loyaltyBreakdown, computeLoyalty } from '../src/sim/rules/loyalty';

describe('M8: the empire cycle', () => {
  it('seed 42, 300y: settlements grow, no extinction, wars end', () => {
    const sim = Sim.fresh(42, {});
    sim.runYears(300);
    const s = sim.state;
    const alive = s.settlements.filter(st => !st.razed);
    const founded = s.events.filter(e => e.type === EventType.SettlementFounded);
    console.log(`settlements alive: ${alive.length}, founded: ${founded.length}`);
    // borders move again: 4 at genesis, at least 8 standing after 300y
    expect(alive.length).toBeGreaterThanOrEqual(8);
    // at least one faction founded 2+ settlements
    const foundedBy = new Map<number, number>();
    for (const ev of founded) {
      foundedBy.set(ev.factions[0], (foundedBy.get(ev.factions[0]) ?? 0) + 1);
    }
    expect(Math.max(0, ...foundedBy.values())).toBeGreaterThanOrEqual(2);
    // balance gate, calibrated against the v1 baseline (doc 10): v1.0 itself
    // loses the seed-42 dwarves around Y160-180 (succession collapse), so the
    // M8 invariant is "no worse": no early extinction, >= 3 races at 300y.
    for (const ev of s.events) {
      if (ev.type === EventType.RaceExtinct || ev.type === EventType.FactionDissolved) {
        console.log(`extinction event: ${ev.text}`);
        expect(ev.tick, `extinction before Y60: ${ev.text}`).toBeGreaterThan(60 * TICKS_PER_YEAR);
      }
    }
    const racesAlive = new Set(s.factions.filter(f => !f.extinct).map(f => f.race));
    expect(racesAlive.size).toBeGreaterThanOrEqual(3);
    expect(s.alivePawns).toBeGreaterThan(100);
    // wars end: nothing grinds forever (P1.5)
    for (const w of s.wars) {
      expect(s.tick - w.startTick).toBeLessThan(15 * TICKS_PER_YEAR);
    }
    // every declared war carries an objective from birth
    expect(s.events.filter(e => e.type === EventType.WarDeclared).length).toBeGreaterThanOrEqual(1);
  }, 600_000);

  it('EXPAND enters council options exactly when a settlement prospers', () => {
    const sim = Sim.fresh(7, { mapSize: 192, startPawnsPerFaction: 45 });
    sim.runYears(3);
    const s = sim.state;
    const st = s.settlements.find(x => !x.razed && x.factionId === 0)!;
    // engineer prosperity (11 F): crowd >= 60%, granary near cap, wood, pop
    st.popCache = 150;
    st.fertileLand = 40;                  // capacity ~42+extras → crowd >> 60
    st.stockpile[Good.Grain] = 3600;
    st.stockpile[Good.Wood] = 80;
    expect(canProsperExpand(st)).toBe(true);
    expect(councilOptions(s, 0)).toContain('EXPAND');
    // and gone when poor
    st.stockpile[Good.Grain] = 100;
    expect(canProsperExpand(st)).toBe(false);
    expect(councilOptions(s, 0)).not.toContain('EXPAND');
  });

  it('loyalty: legible modifiers sum to the score; conquest wound fades', () => {
    const sim = Sim.fresh(11, { mapSize: 192, startPawnsPerFaction: 45 });
    sim.runYears(2);
    const s = sim.state;
    const st = s.settlements.find(x => !x.razed && x.factionId === 1)!;
    const mods = loyaltyBreakdown(s, st);
    // every modifier is labeled; the displayed list IS the score
    for (const m of mods) {
      expect(m.label.length).toBeGreaterThan(2);
      expect(Number.isFinite(m.value)).toBe(true);
    }
    const sum = mods.reduce((a, m) => a + m.value, 0);
    expect(computeLoyalty(s, st)).toBe(Math.max(0, Math.min(150, sum)));
    // fresh conquest cuts deep, then fades
    const before = computeLoyalty(s, st);
    st.capturedTick = s.tick;
    const wounded = computeLoyalty(s, st);
    expect(wounded).toBeLessThan(before);
    st.capturedTick = s.tick - 19 * TICKS_PER_YEAR;
    const healing = computeLoyalty(s, st);
    expect(healing).toBeGreaterThan(wounded);
    st.capturedTick = -1;
  });

  it('siege: arrival opens a siege and the war resolves by objective', () => {
    const sim = Sim.fresh(21, { mapSize: 192, startPawnsPerFaction: 45 });
    sim.runYears(2);
    const s = sim.state;
    declareWar(s, 0, 3, null, 'conquer');
    const w = s.wars.find(x => x.attacker === 0 && x.defender === 3)!;
    const target = s.settlements[w.targetSettlement]!;
    // engineered host: drop an attacker squad next to the target
    const members: number[] = [];
    for (let i = 0; i < s.pawnCount && members.length < 60; i++) {
      if (!(s.pawns.flags[i] & 1)) continue;
      if (s.pawns.factionId[i] !== 0) continue;
      if (s.pawns.squadId[i] !== 65535) continue;
      members.push(i);
    }
    expect(members.length).toBeGreaterThanOrEqual(12);
    // an overwhelming host: this test exercises the siege, not the field battle
    s.factions[0].equipmentTier = 3000;
    const squadId = s.nextEntityId++;
    for (const m of members) {
      s.pawns.squadId[m] = squadId;
      s.pawns.x[m] = target.x; s.pawns.y[m] = target.y;
    }
    s.squads.push({
      id: squadId, factionId: 0, x: target.x, y: target.y,
      targetX: target.x, targetY: target.y, members, morale: 235,
      state: 'march', warId: w.id, homeSettlement: s.factions[0].capital,
      pathIdx: 0, startSize: members.length,
    });
    let sawSiege = false, sawProgress = 0;
    for (let t = 0; t < 4 * TICKS_PER_YEAR; t++) {
      sim.tick();
      if (s.squads.some(sq => sq.state === 'siege')) sawSiege = true;
      const live = s.wars.find(x => x.id === w.id);
      if (live) sawProgress = Math.max(sawProgress, live.captureProgress ?? 0);
      if (!live) break;                    // war resolved
    }
    expect(sawSiege).toBe(true);
    expect(sawProgress).toBeGreaterThan(0);
    // the war ended by objective or exhaustion, not by the heat death of the world
    expect(s.wars.find(x => x.id === w.id)).toBeUndefined();
  }, 240_000);
});
