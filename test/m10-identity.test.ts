// M10 exit criteria: identity. Cultures bias behavior (P2.1), traits are
// deterministic and prompt-visible (P2.2), wars carry diegetic names (P6.2).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { EventType } from '../src/shared/types';
import { rollTraits, TRAIT_TABLE } from '../src/sim/rules/identity';
import { nameWar, buildDigest, declareWar, councilOptions } from '../src/sim/rules/decisions';
import { validateChapter } from '../src/chronicle/validator';

const CFG = { mapSize: 192, mirrorMatch: true, injectors: false };

describe('M10: identity', () => {
  it('war doctrines produce measurably different war rates (mirrorMatch)', () => {
    // same race everywhere; doctrine is the only cultural lever we pull
    const sim = Sim.fresh(11, CFG);
    const s = sim.state;
    s.factions[0].culture.doctrine = 'raider';
    s.factions[1].culture.doctrine = 'raider';
    s.factions[2].culture.doctrine = 'defensive';
    s.factions[3].culture.doctrine = 'defensive';
    sim.runYears(200);
    const wars = s.events.filter(e => e.type === EventType.WarDeclared);
    const byRaiders = wars.filter(e => e.factions[0] === 0 || e.factions[0] === 1).length;
    const byDefensive = wars.filter(e => e.factions[0] === 2 || e.factions[0] === 3).length;
    console.log(`wars declared: raiders ${byRaiders}, defensive ${byDefensive}`);
    expect(byRaiders).toBeGreaterThan(byDefensive);
  }, 600_000);

  it('traits: deterministic, distinct, and verbatim in the king prompt digest', () => {
    const a = rollTraits(42, 7);
    expect(a).toEqual(rollTraits(42, 7));
    expect(a.length).toBe(2);
    expect(a[0]).not.toBe(a[1]);
    for (const t of a) expect(TRAIT_TABLE).toContain(t as any);
    // digest carries the rolled traits (P2.2b: verbatim in LLM prompt)
    const sim = Sim.fresh(3, { mapSize: 192 });
    sim.runYears(2);
    const s = sim.state;
    const f = s.factions[0];
    const digest = buildDigest(s, 0, councilOptions(s, 0));
    const king = s.named[f.leaderId];
    for (const t of king.traits ?? []) expect(digest.persona.traits).toContain(t);
    // and the culture creed rides along (P6.1)
    expect(digest.persona.culture.values?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(digest.persona.culture.doctrine).toBeTruthy();
  });

  it('wars carry diegetic names into events, state, and chapter titles', () => {
    expect(nameWar('tribute refused', 'Elmwood Court')).toBe('the Tribute War');
    expect(nameWar('a quarrel over hunting grounds', 'X Hold')).toBe('the War of the Hunting Grounds');
    expect(nameWar('something odd', 'Elmwood Court')).toBe('the Elmwood War');
    const sim = Sim.fresh(5, { mapSize: 192 });
    sim.runYears(2);
    const s = sim.state;
    declareWar(s, 0, 3, null, 'raid');
    const w = s.wars.find(x => x.attacker === 0 && x.defender === 3)!;
    expect(w.name).toBeTruthy();
    const ev = s.events.find(e => e.type === EventType.WarDeclared && e.factions[0] === 0)!;
    expect(ev.data?.warName).toBe(w.name);
    expect(ev.text).toContain(w.name!);
  });

  it('validator accepts war names as known entities, still rejects inventions', () => {
    const facts = [{
      id: 1, tick: 360, type: EventType.WarDeclared, actors: [], factions: [0, 1],
      x: 0, y: 0, causes: [], severity: 4,
      text: 'Y1: A declares war on B. Men will call it the Tribute War.',
      data: { warName: 'the Tribute War' },
    }];
    const base = {
      facts: facts as any,
      knownNames: ['Millford', 'Bathakdush', 'the Tribute War'],
      yearStart: 1, yearEnd: 2,
    };
    const good = validateChapter({ ...base, prose: 'That season the Tribute War came to Millford.' });
    expect(good.ok).toBe(true);
    const bad = validateChapter({ ...base, prose: 'That season the armies of Zorbulax marched.' });
    expect(bad.ok).toBe(false);
  });
});
