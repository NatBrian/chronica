// M5: chapter detector, validator, and the 300-year template book.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { detectChapters, detectEra } from '../src/chronicle/detector';
import { templateChapter, draftTitle } from '../src/chronicle/templates';
import { validateChapter, chapterKnownNames } from '../src/chronicle/validator';
import { EventType } from '../src/shared/types';

describe('M5: the chronicle', () => {
  it('300-year run yields a complete readable template book', () => {
    const sim = Sim.fresh(42, { mapSize: 192 });
    sim.runYears(300);
    const s = sim.state;
    // run the detector the way the worker does, incrementally
    let cursor = -1, nextId = 0;
    const chapters = [];
    for (let upTo = 0; upTo <= s.events.length; upTo += 50) {
      const { drafts, cursor: c } = detectChapters(s.events, cursor, s.tick, nextId);
      cursor = Math.max(cursor, c);
      for (const d of drafts) {
        nextId = Math.max(nextId, d.id + 1);
        const facts = d.factIds.map(id => s.events.find(e => e.id === id)!);
        const title = draftTitle(d, facts, s.factions.map(f => f.name));
        chapters.push(templateChapter(d, facts, title, 'The First Age'));
      }
      if (drafts.length === 0) break;
    }
    console.log(`chapters: ${chapters.length}; titles: ${chapters.slice(0, 6).map(c => c.title).join(' | ')}`);
    expect(chapters.length).toBeGreaterThan(3);
    // every chapter respects the fact cap and has anchored paragraphs
    for (const c of chapters) {
      expect(c.factIds.length).toBeLessThanOrEqual(20);
      expect(c.paragraphs.length).toBeGreaterThan(0);
      for (const p of c.paragraphs) {
        expect(p.anchor.year).toBeGreaterThanOrEqual(0);
        expect(p.anchor.eventId).toBeGreaterThanOrEqual(0);
        // anchors point at real events (click-to-seek integrity)
        expect(s.events.find(e => e.id === p.anchor.eventId)).toBeTruthy();
      }
      expect(c.source).toBe('template');
    }
    // war chapters exist if wars happened
    const wars = s.events.filter(e => e.type === EventType.WarDeclared);
    if (wars.length > 0) {
      expect(chapters.some(c => /war|burning/i.test(c.title))).toBe(true);
    }
    // era naming
    const era = detectEra(
      chapters.map(c => ({ kind: 'war', yearStart: c.yearStart, yearEnd: c.yearEnd, title: c.title })),
      0, 60, s.islandName);
    expect(era.name.length).toBeGreaterThan(3);
    expect(era.summary).toContain(s.islandName);
  });

  it('validator rejects invented entities and wrong years, passes honest prose', () => {
    const facts = [
      { id: 1, tick: 3600, type: 0, actors: [], factions: [0, 1], x: 10, y: 10, causes: [], severity: 4, text: 'Y10: Millford Kingdom declares war on Elmwood Court — grain refused.' },
    ] as any;
    const known = chapterKnownNames(facts, ['Aldric Greenfield'], ['Millford Kingdom', 'Elmwood Court'], ['Millford', 'Elmwood'], ['Solen'], 'Wynost');
    // honest prose
    const good = validateChapter({
      prose: 'In the year 10, Millford declared war upon Elmwood. Aldric Greenfield led the host, praying to Solen.',
      facts, knownNames: known, yearStart: 10, yearEnd: 12,
    });
    expect(good.ok).toBe(true);
    // invented character
    const badEntity = validateChapter({
      prose: 'In the year 10, the hero Zanthar Brightblade slew a dragon at Millford.',
      facts, knownNames: known, yearStart: 10, yearEnd: 12,
    });
    expect(badEntity.ok).toBe(false);
    expect(badEntity.violations.some(v => v.includes('Zanthar') || v.includes('Brightblade'))).toBe(true);
    // wrong year
    const badYear = validateChapter({
      prose: 'In the year 99, Millford declared war on Elmwood.',
      facts, knownNames: known, yearStart: 10, yearEnd: 12,
    });
    expect(badYear.ok).toBe(false);
  });
});
