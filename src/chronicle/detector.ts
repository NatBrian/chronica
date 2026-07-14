// Chapter detector (05 §Chronicler): pure rule code clustering DAG events
// into narrative units. No LLM here; prose is someone else's job.
import { EventType, WorldEvent, TICKS_PER_YEAR } from '../shared/types';

export interface ChapterDraft {
  id: number;
  kind: 'war' | 'famine' | 'succession' | 'founding' | 'disaster' | 'era-life' | 'ending' | 'crisis';
  titleHint: string;
  factIds: number[];
  yearStart: number;
  yearEnd: number;
  x: number; y: number;
  factionIds: number[];
}

const WAR_TYPES = new Set([
  EventType.WarDeclared, EventType.BattleFought, EventType.SettlementRazed,
  EventType.SettlementTaken, EventType.Truce, EventType.PeaceMade,
  EventType.WarObjectiveSet, EventType.Refugees, EventType.Vassalized,
  EventType.BorderShifted, EventType.CaravanRaided, EventType.Conscription,
]);

const MAX_FACTS = 20;

/**
 * Cluster events beyond `fromEventId` into chapter drafts. Only clusters
 * CLOSED arcs (war ended, succession crowned...); open arcs wait.
 * Returns drafts + the new cursor (last event id consumed by a closed arc
 * or safely skipped).
 */
export function detectChapters(
  events: WorldEvent[], fromEventId: number, currentTick: number, nextChapterId: number,
): { drafts: ChapterDraft[]; cursor: number } {
  const pending = events.filter(e => e.id > fromEventId && e.severity >= 2);
  const drafts: ChapterDraft[] = [];
  const consumed = new Set<number>();
  let chapterId = nextChapterId;

  // ---- war arcs: WarDeclared → ... → PeaceMade/Truce for the same pair ----
  for (const start of pending) {
    if (start.type !== EventType.WarDeclared || consumed.has(start.id)) continue;
    const pair = [...start.factions].sort().join(':');
    const arc: WorldEvent[] = [start];
    let closed = false;
    for (const e of pending) {
      if (e.id <= start.id || consumed.has(e.id)) continue;
      if (!WAR_TYPES.has(e.type)) continue;
      const ePair = [...e.factions].sort().join(':');
      if (ePair !== pair) continue;
      arc.push(e);
      if (e.type === EventType.PeaceMade || e.type === EventType.Truce) { closed = true; break; }
    }
    if (!closed) continue;                       // war still burning; wait
    arc.forEach(e => consumed.add(e.id));
    // split long wars into parts (05 §chunking)
    const parts = chunk(arc, MAX_FACTS);
    parts.forEach((facts, i) => {
      drafts.push(mkDraft(chapterId++, 'war',
        parts.length > 1 ? `war part ${i + 1} of ${parts.length}` : 'war', facts));
    });
  }

  // ---- succession arcs: king death + coronation within ~2y ----
  for (const death of pending) {
    if (consumed.has(death.id)) continue;
    if (death.type !== EventType.CharacterDied || death.severity < 4) continue;
    const crown = pending.find(e =>
      e.type === EventType.Coronation && !consumed.has(e.id) &&
      e.tick >= death.tick && e.tick - death.tick < 2 * TICKS_PER_YEAR &&
      e.factions[0] === death.factions[0]);
    if (!crown) continue;
    const facts = [death, crown];
    const heir = pending.find(e => e.type === EventType.HeirBorn && e.factions[0] === death.factions[0] && e.id < death.id);
    if (heir && !consumed.has(heir.id)) facts.unshift(heir);
    facts.forEach(e => consumed.add(e.id));
    drafts.push(mkDraft(chapterId++, 'succession', 'succession', facts));
  }

  // ---- rebellion / succession-crisis arcs (M9): the realm breaks ----
  for (const split of pending) {
    if (consumed.has(split.id)) continue;
    if (split.type !== EventType.FactionSplit && split.type !== EventType.Rebellion) continue;
    const context = pending.filter(c =>
      !consumed.has(c.id) && c.id < split.id &&
      (c.type === EventType.Succession || c.type === EventType.Coronation ||
       c.type === EventType.CharacterDied) &&
      c.factions.some(f => split.factions.includes(f)) &&
      split.tick - c.tick < 3 * TICKS_PER_YEAR).slice(-4);
    const crown = pending.find(c =>
      !consumed.has(c.id) && c.id > split.id &&
      c.type === EventType.Coronation &&
      c.tick - split.tick < 2 * TICKS_PER_YEAR &&
      c.factions.some(f => split.factions.includes(f)));
    const facts = crown ? [...context, split, crown] : [...context, split];
    facts.forEach(e => consumed.add(e.id));
    drafts.push(mkDraft(chapterId++, 'crisis', 'the realm breaks', facts));
  }

  // ---- famine/disaster arcs: drought+famine cluster per ~5y window ----
  const hardship = pending.filter(e =>
    !consumed.has(e.id) &&
    (e.type === EventType.Drought || e.type === EventType.Famine ||
     e.type === EventType.HarshWinter || e.type === EventType.Plague ||
     e.type === EventType.ForestFire) &&
    currentTick - e.tick > 3 * TICKS_PER_YEAR);   // arc settled
  if (hardship.length >= 4) {
    const facts = hardship.slice(0, MAX_FACTS);
    facts.forEach(e => consumed.add(e.id));
    drafts.push(mkDraft(chapterId++, 'famine', 'hard years', facts));
  }

  // ---- extinction / dissolution: always a chapter ----
  for (const e of pending) {
    if (consumed.has(e.id)) continue;
    if (e.type !== EventType.RaceExtinct && e.type !== EventType.FactionDissolved) continue;
    const context = pending.filter(c =>
      !consumed.has(c.id) && c.id < e.id && c.factions.some(f => e.factions.includes(f))).slice(-6);
    const facts = [...context, e];
    facts.forEach(x => consumed.add(x.id));
    drafts.push(mkDraft(chapterId++, 'ending', 'an ending', facts));
  }

  // ---- era-life chapter: leftover notable events, only when a long span idles ----
  const leftovers = pending.filter(e =>
    !consumed.has(e.id) && e.severity >= 2 &&
    currentTick - e.tick > 8 * TICKS_PER_YEAR);
  if (leftovers.length >= 10) {
    const facts = leftovers.slice(0, MAX_FACTS);
    facts.forEach(e => consumed.add(e.id));
    drafts.push(mkDraft(chapterId++, 'era-life', 'life of the island', facts));
  }

  // cursor: everything at or below the highest consumed id that has no
  // unconsumed OPEN arc before it; conservative: min(open war start)-1
  let cursor = fromEventId;
  const openWarStart = pending.find(e =>
    e.type === EventType.WarDeclared && !consumed.has(e.id));
  const limit = openWarStart ? openWarStart.id - 1 : Infinity;
  for (const e of pending) {
    if (e.id > limit) break;
    if (consumed.has(e.id) || currentTick - e.tick > 12 * TICKS_PER_YEAR || e.severity < 2) {
      cursor = Math.max(cursor, e.id);
    } else if (drafts.length === 0) {
      break;
    }
  }
  return { drafts, cursor };
}

function chunk(arr: WorldEvent[], size: number): WorldEvent[][] {
  const out: WorldEvent[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mkDraft(id: number, kind: ChapterDraft['kind'], titleHint: string, facts: WorldEvent[]): ChapterDraft {
  const years = facts.map(f => Math.floor(f.tick / TICKS_PER_YEAR));
  const withPos = facts.filter(f => f.x || f.y);
  const cx = withPos.length ? Math.round(withPos.reduce((a, f) => a + f.x, 0) / withPos.length) : 0;
  const cy = withPos.length ? Math.round(withPos.reduce((a, f) => a + f.y, 0) / withPos.length) : 0;
  return {
    id, kind, titleHint,
    factIds: facts.map(f => f.id),
    yearStart: Math.min(...years),
    yearEnd: Math.max(...years),
    x: cx, y: cy,
    factionIds: [...new Set(facts.flatMap(f => f.factions))],
  };
}

// ---- Era detection (05): meta-pass naming from dominant chapter themes ----

export interface EraDraft {
  name: string;
  yearStart: number;
  yearEnd: number;
  summary: string;
}

export function detectEra(
  chapters: { kind: string; yearStart: number; yearEnd: number; title: string }[],
  fromYear: number, toYear: number, islandName: string,
): EraDraft {
  const inEra = chapters.filter(c => c.yearStart >= fromYear && c.yearStart < toYear);
  const counts: Record<string, number> = {};
  for (const c of inEra) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  const wars = counts.war ?? 0, famines = counts.famine ?? 0, endings = counts.ending ?? 0;
  let name: string;
  if (endings > 0) name = 'The Fading';
  else if (wars >= 3) name = 'The Burning Years';
  else if (wars >= 1 && famines >= 1) name = 'The Lean and Bloody Age';
  else if (wars >= 1) name = 'The Age of Banners';
  else if (famines >= 2) name = 'The Hungry Years';
  else if (inEra.length <= 1) name = 'The Long Peace';
  else name = 'The Quiet Flourishing';
  const summary = `Years ${fromYear}–${toYear} on ${islandName}: ` +
    (inEra.length === 0
      ? 'seasons turned, harvests came in, and the chroniclers had blessedly little to record.'
      : `${inEra.length} chapters were written: ${Object.entries(counts).map(([k, v]) => `${v} of ${k}`).join(', ')}. ` +
        (wars > famines ? 'It was remembered mostly for its wars.' :
         famines > 0 ? 'It was remembered mostly for its hunger.' :
         'It was remembered, on the whole, kindly.'));
  return { name, yearStart: fromYear, yearEnd: toYear, summary };
}
