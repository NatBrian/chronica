// Sim Web Worker: hosts the deterministic Sim; render thread gets snapshots
// via transferable buffers (01). This file is NOT /src/sim (it may use timers).
import { Sim } from './sim/engine';
import { WorldConfig, defaultConfig, TICKS_PER_YEAR, JournalEntry, Journal, ACTION_NAMES, ChronicleChapter, EventType } from './shared/types';
import { AGE_SCALE, PawnFlag, packSnapshot, snapshot, restore, unpackSnapshot, pairKey } from './sim/state';
import { scoreOffers } from './sim/systems/utilityAISystem';
import { detectChapters, detectEra, detectHeroArcs, ChapterDraft, EraDraft } from './chronicle/detector';
import { loyaltyBreakdown } from './sim/rules/loyalty';
import { canProsperExpand, crowdPctOf, settlementCapacity } from './sim/settlementOps';
import { templateChapter, draftTitle } from './chronicle/templates';
import { validateChapter, chapterKnownNames } from './chronicle/validator';

let sim: Sim | null = null;
let ticksPerSec = 0;           // 0 = paused
let timer: ReturnType<typeof setInterval> | null = null;
let tickRemainder = 0;
let replayMode = false;
// time machine: when scrubbed into the past, the live "present" is parked here
let presentPack: ArrayBuffer | null = null;
let presentTick = 0;
let lastMajorCount = -1;
let lastAutosaveDecade = 0;
// request digests cached so council panel can show what the king saw (M4)
const digestCache = new Map<number, { digest: unknown; options: string[]; kind: string }>();
let lastJournalScan = 0;

// ---- the Chronicle (M5): stored content, never regenerated (05) ----
interface ChronicleStore {
  chapters: ChronicleChapter[];
  eras: EraDraft[];
  cursorEventId: number;
  nextChapterId: number;
  lastEraYear: number;
  drafts: Record<number, ChapterDraft>;   // awaiting LLM prose (template already placed)
  retried: Record<number, boolean>;
  /** named ids whose life chapter has been written (M11, P3.4) */
  heroDone?: Record<number, boolean>;
}
let chronicle: ChronicleStore = emptyChronicle();
let lastChronicleCheck = 0;

function emptyChronicle(): ChronicleStore {
  return { chapters: [], eras: [], cursorEventId: -1, nextChapterId: 0, lastEraYear: 0, drafts: {}, retried: {} };
}

function currentEraName(): string {
  return chronicle.eras.length > 0 ? chronicle.eras[chronicle.eras.length - 1].name : 'The First Age';
}

function chronicleTick(): void {
  if (!sim || presentPack) return;                     // never chapter a replay view
  const s = sim.state;
  if (s.tick - lastChronicleCheck < 2 * TICKS_PER_YEAR) return;
  lastChronicleCheck = s.tick;

  const { drafts, cursor } = detectChapters(s.events, chronicle.cursorEventId, s.tick, chronicle.nextChapterId);
  chronicle.cursorEventId = Math.max(chronicle.cursorEventId, cursor);
  const factionNames = s.factions.map(f => f.name);
  for (const draft of drafts) {
    chronicle.nextChapterId = Math.max(chronicle.nextChapterId, draft.id + 1);
    const facts = draft.factIds.map(id => s.events.find(e => e.id === id)!).filter(Boolean);
    const title = draftTitle(draft, facts, factionNames);
    // template chapter immediately; the book is never blank; LLM upgrades it
    const chapter = templateChapter(draft, facts, title, currentEraName());
    chronicle.chapters.push(chapter);
    chronicle.drafts[draft.id] = draft;
    post({
      t: 'chronicleDraft',
      draft,
      titleFallback: title,
      era: currentEraName(),
      islandName: s.islandName,
      facts: facts.map(f => f.text),
    });
    post({ t: 'chapterToast', title, chapterId: draft.id });
  }

  // hero arcs (M11, P3.4): a life of renown becomes its own chapter
  chronicle.heroDone ??= {};
  const heroArcs = detectHeroArcs(s.named, s.events, chronicle.heroDone, chronicle.nextChapterId);
  for (const { draft, title } of heroArcs) {
    chronicle.nextChapterId = Math.max(chronicle.nextChapterId, draft.id + 1);
    const facts2 = draft.factIds.map(id => s.events.find(e => e.id === id)!).filter(Boolean);
    chronicle.chapters.push(templateChapter(draft, facts2, title, currentEraName()));
    chronicle.drafts[draft.id] = draft;
    post({
      t: 'chronicleDraft',
      draft, titleFallback: title, era: currentEraName(),
      islandName: s.islandName, facts: facts2.map(f => f.text),
    });
    post({ t: 'chapterToast', title, chapterId: draft.id });
    postChronicle();
  }

  // era detection every ~60 years
  const year = Math.floor(s.tick / TICKS_PER_YEAR);
  if (year - chronicle.lastEraYear >= 60) {
    const era = detectEra(
      chronicle.chapters.map(c => ({ kind: kindOf(c), yearStart: c.yearStart, yearEnd: c.yearEnd, title: c.title })),
      chronicle.lastEraYear, year, s.islandName);
    chronicle.eras.push(era);
    chronicle.lastEraYear = year;
    // back-fill era names onto chapters of that span
    for (const c of chronicle.chapters) {
      if (c.yearStart >= era.yearStart && c.yearStart < era.yearEnd) c.era = era.name;
    }
    post({ t: 'eraToast', name: era.name, summary: era.summary });
  }

  if (drafts.length > 0 || year - chronicle.lastEraYear === 0) {
    postChronicle();
  }
}

function kindOf(c: ChronicleChapter): string {
  const t = c.title.toLowerCase();
  if (t.includes('war') || t.includes('burning')) return 'war';
  if (t.includes('hungry')) return 'famine';
  if (t.includes('crown')) return 'succession';
  if (t.includes('last days')) return 'ending';
  return 'era-life';
}

function postChronicle(): void {
  if (!sim) return;
  const lastEvent = sim.state.events[sim.state.events.length - 1];
  const lastChaptered = chronicle.chapters.length > 0
    ? Math.max(...chronicle.chapters.map(c => c.yearEnd)) : 0;
  post({
    t: 'chronicle',
    chapters: chronicle.chapters,
    eras: chronicle.eras,
    lagYears: Math.max(0, Math.floor(sim.state.tick / TICKS_PER_YEAR) - lastChaptered),
  });
}

/** LLM prose arrives: validate, retry once, else keep template (05 pipeline). */
function receiveProse(msg: { chapterId: number; title: string; paragraphs: string[] }): void {
  if (!sim) return;
  const s = sim.state;
  const draft = chronicle.drafts[msg.chapterId];
  const chapter = chronicle.chapters.find(c => c.id === msg.chapterId);
  if (!draft || !chapter) return;
  const facts = draft.factIds.map(id => s.events.find(e => e.id === id)!).filter(Boolean);
  const known = chapterKnownNames(
    facts,
    s.named.map(n => n.name),
    s.factions.map(f => f.name),
    s.settlements.map(st => st.name),
    s.factions.map(f => f.god),
    s.islandName,
  );
  // war names are legal entities (M10, P6.2): "the Tribute War" may recur
  for (const f2 of facts) {
    if (typeof f2.data?.warName === 'string') known.push(f2.data.warName);
  }
  const prose = msg.paragraphs.join('\n');
  const check = validateChapter({
    prose, facts, knownNames: known,
    yearStart: chapter.yearStart, yearEnd: chapter.yearEnd,
  });
  if (!check.ok) {
    if (!chronicle.retried[msg.chapterId]) {
      chronicle.retried[msg.chapterId] = true;
      const cached = chronicle.drafts[msg.chapterId];
      post({
        t: 'chronicleDraft',
        draft: cached,
        titleFallback: chapter.title,
        era: chapter.era,
        islandName: s.islandName,
        facts: facts.map(f => f.text),
        retryNote: check.violations.join('; '),
      });
    }
    // template stays; marked, honest (05: else template fallback)
    return;
  }
  // accepted: upgrade the stored chapter (anchors from facts, never prose)
  const anchorsPerPara = Math.max(1, Math.floor(facts.length / msg.paragraphs.length));
  chapter.title = msg.title.slice(0, 80);
  chapter.paragraphs = msg.paragraphs.map((text, i) => {
    const f = facts[Math.min(facts.length - 1, i * anchorsPerPara)];
    return {
      text,
      anchor: { year: Math.floor(f.tick / TICKS_PER_YEAR), x: f.x, y: f.y, eventId: f.id },
    };
  });
  chapter.source = 'llm';
  delete chronicle.drafts[msg.chapterId];
  postChronicle();
  // written prose is content, not view; persist immediately (05: stored, never regenerated)
  forceAutosave();
}

const SNAPSHOT_HZ = 20;

function post(msg: unknown, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

/** Settlement inspector payload (M8): the loyalty list is the score. */
function settlementPayload(st: import('./sim/state').Settlement) {
  const s = sim!.state;
  return {
    id: st.id, name: st.name, x: st.x, y: st.y,
    factionId: st.factionId,
    factionName: s.factions[st.factionId]?.name ?? '?',
    pop: st.popCache,
    food: st.stockpile[0] + st.stockpile[1] + st.stockpile[2],
    wood: st.stockpile[3] ?? 0,
    loyalty: st.loyalty,
    loyaltyMods: loyaltyBreakdown(s, st),
    capital: s.factions[st.factionId]?.capital === st.id,
    foundedYear: Math.floor(st.founded / TICKS_PER_YEAR),
  };
}

function mapPlanesMsg() {
  const m = sim!.state.map;
  // copies (keep sim's own planes); cheap at 512²
  const planes = {
    size: m.size,
    biome: m.biome.slice(), elevation: m.elevation.slice(),
    moisture: m.moisture.slice(), fertility: m.fertility.slice(),
    forest: m.forest.slice(), ore: m.ore.slice(), flags: m.flags.slice(),
    waterFlux: m.waterFlux.slice(), temperature: m.temperature.slice(),
    fish: m.fish.slice(), game: m.game.slice(),
  };
  return planes;
}

function snapshotMsg() {
  const s = sim!.state;
  const n = s.pawnCount;
  const px = s.pawns.x.slice(0, n);
  const py = s.pawns.y.slice(0, n);
  const pf = s.pawns.factionId.slice(0, n);
  const pflags = s.pawns.flags.slice(0, n);
  const paction = s.pawns.action.slice(0, n);
  return {
    t: 'snapshot' as const,
    tick: s.tick,
    year: Math.floor(s.tick / TICKS_PER_YEAR),
    inPast: presentPack !== null,
    presentYear: presentPack ? Math.floor(presentTick / TICKS_PER_YEAR) : Math.floor(s.tick / TICKS_PER_YEAR),
    alive: s.alivePawns,
    pawns: { x: px, y: py, factionId: pf, flags: pflags, action: paction, count: n },
    settlements: s.settlements.map(st => ({
      id: st.id, x: st.x, y: st.y, name: st.name, factionId: st.factionId,
      razed: st.razed, pop: st.popCache, stockpile: st.stockpile,
      buildings: st.buildings,
    })),
    factions: s.factions.map(f => ({
      id: f.id, race: f.race, name: f.name, extinct: f.extinct, leaderId: f.leaderId,
      capital: f.capital,
      clan: f.dynasty?.clan, legitimacy: f.legitimacy ?? 80,
    })),
    wars: s.wars.map(w => ({
      id: w.id, attacker: w.attacker, defender: w.defender,
      objective: w.objective, startTick: w.startTick, name: w.name,
      captureProgress: w.captureProgress ?? 0,
      targetSettlement: w.targetSettlement,
    })),
    pairs: (() => {
      const out: { a: number; b: number; diplo: number; grudge: number }[] = [];
      for (let a = 0; a < s.factions.length; a++) {
        for (let b = a + 1; b < s.factions.length; b++) {
          const p = s.pairs[pairKey(a, b)];
          if (p) out.push({ a, b, diplo: p.diplo, grudge: p.grudge });
        }
      }
      return out;
    })(),
    squads: s.squads.map(sq => ({
      x: sq.x, y: sq.y, factionId: sq.factionId, state: sq.state, n: sq.members.length,
      morale: sq.morale, warId: sq.warId,
    })),
    caravans: s.caravans.map(c => ({ x: c.x, y: c.y, factionId: c.factionId, purpose: c.purpose })),
    monsters: s.monsters.map(m => ({ x: m.x, y: m.y, kind: m.kind })),
    // live positions of named characters (M11: follow/favorites camera)
    namedPos: s.named
      .filter(n => n.deathTick < 0 && n.pawnIdx >= 0)
      .map(n => ({ id: n.id, name: n.name, x: s.pawns.x[n.pawnIdx], y: s.pawns.y[n.pawnIdx] })),
    eventsTail: s.events.slice(-40),
    eventCount: s.events.length,
    yearStats: s.yearStats.slice(-1),
    hash: 0,
  };
}

function sendSnapshot(): void {
  if (!sim) return;
  const msg = snapshotMsg();
  post(msg, [
    msg.pawns.x.buffer, msg.pawns.y.buffer, msg.pawns.factionId.buffer,
    msg.pawns.flags.buffer, msg.pawns.action.buffer,
  ]);
}

function maybeAutosave(): void {
  if (!sim || presentPack) return;                 // never autosave a replay view
  const decade = Math.floor(sim.state.tick / (10 * TICKS_PER_YEAR));
  if (decade <= lastAutosaveDecade) return;
  lastAutosaveDecade = decade;
  forceAutosave();
}

function forceAutosave(): void {
  if (!sim || presentPack) return;
  const pack = packSnapshot(snapshot(sim.state));
  post({
    t: 'autosave',
    record: {
      savedAt: Date.now(),
      seed: sim.journal.header.seed,
      islandName: sim.state.islandName,
      tick: sim.state.tick,
      journal: sim.journal,
      snapshot: pack,
      chronicle,
    },
  }, [pack]);
}

function maybeSendMajors(): void {
  if (!sim) return;
  const majors = sim.state.events.filter(e => e.severity >= 3);
  if (majors.length === lastMajorCount) return;
  lastMajorCount = majors.length;
  post({
    t: 'majorEvents',
    events: majors.map(e => ({
      id: e.id, tick: e.tick, type: e.type, severity: e.severity,
      x: e.x, y: e.y, text: e.text, causes: e.causes, actors: e.actors,
    })),
  });
}

function loop(): void {
  if (!sim || ticksPerSec === 0) return;
  const ticksPerFrame = ticksPerSec / SNAPSHOT_HZ + tickRemainder;
  const whole = Math.floor(ticksPerFrame);
  tickRemainder = ticksPerFrame - whole;
  for (let i = 0; i < whole; i++) {
    sim.tick();
    // replaying forward into the parked present → seamless catch-up
    if (presentPack && sim.state.tick >= presentTick) {
      presentPack = null;
      post({ t: 'reachedPresent' });
      break;
    }
  }
  const reqs = sim.takeRequests();
  for (const r of reqs) {
    digestCache.set(r.requestId, { digest: r.digest, options: r.options, kind: r.kind });
    if (digestCache.size > 60) {
      const oldest = digestCache.keys().next().value as number;
      digestCache.delete(oldest);
    }
  }
  if (reqs.length > 0 && !replayMode && !presentPack) post({ t: 'requests', requests: reqs });
  notifyAppliedDecisions();
  chronicleTick();
  maybeAutosave();
  maybeSendMajors();
  sendSnapshot();
}

/** Council panel feed: journal entries newly applied (or voided) this frame. */
function notifyAppliedDecisions(): void {
  if (!sim) return;
  const tick = sim.state.tick;
  for (const e of sim.journal.entries) {
    if (e.applyAtTick <= lastJournalScan || e.applyAtTick > tick) continue;
    if (e.void) continue;
    const cached = digestCache.get(e.requestId);
    post({
      t: 'decisionApplied',
      entry: e,
      digest: cached?.digest ?? null,
      options: cached?.options ?? [],
      kind: cached?.kind ?? '',
      actorName: sim.state.named[e.actorId]?.name ?? '?',
      factionName: sim.state.factions[e.factionId]?.name ?? '?',
    });
  }
  lastJournalScan = tick;
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.t) {
    case 'init': {
      const config: WorldConfig = { ...defaultConfig(), ...(msg.config ?? {}) };
      if (msg.resume) {
        // resume from autosave: reconstruct via journal header, restore snapshot
        sim = new Sim(msg.resume.journal as Journal);
        restore(sim.state, unpackSnapshot(msg.resume.snapshot as ArrayBuffer));
        lastAutosaveDecade = Math.floor(sim.state.tick / (10 * TICKS_PER_YEAR));
        replayMode = false;
        chronicle = (msg.resume.chronicle as ChronicleStore) ?? emptyChronicle();
        lastChronicleCheck = sim.state.tick;
      } else {
        sim = msg.journal
          ? new Sim(msg.journal as Journal)
          : Sim.fresh(msg.seed as number, config);
        replayMode = !!msg.journal && !msg.continueLive;
        chronicle = emptyChronicle();
        lastChronicleCheck = 0;
      }
      presentPack = null;
      lastMajorCount = -1;
      lastJournalScan = sim.state.tick;
      post({
        t: 'ready',
        islandName: sim.state.islandName,
        header: sim.journal.header,
        map: mapPlanesMsg(),
        spawns: sim.state.spawns,
      });
      sendSnapshot();
      if (timer) clearInterval(timer);
      timer = setInterval(loop, 1000 / SNAPSHOT_HZ);
      break;
    }
    case 'speed': {
      ticksPerSec = msg.ticksPerSec;
      break;
    }
    case 'seek': {
      if (!sim) break;
      const target = Math.min(
        presentPack ? presentTick : sim.state.tick + 200 * TICKS_PER_YEAR,
        Math.max(0, Math.floor(msg.year * TICKS_PER_YEAR)),
      );
      if (target < (presentPack ? presentTick : sim.state.tick) && !presentPack) {
        // first scrub into the past; park the present (one world-line, 07)
        presentTick = sim.state.tick;
        presentPack = packSnapshot(snapshot(sim.state));
      }
      sim.seekToTick(target);
      if (presentPack && sim.state.tick >= presentTick) {
        presentPack = null;                        // seeked back to the live edge
      }
      lastMajorCount = -1;
      lastJournalScan = sim.state.tick;
      post({ t: 'seeked', tick: sim.state.tick, inPast: presentPack !== null });
      maybeSendMajors();
      sendSnapshot();
      break;
    }
    case 'jumpPresent': {
      if (!sim || !presentPack) break;
      restore(sim.state, unpackSnapshot(presentPack));
      presentPack = null;
      lastMajorCount = -1;
      lastJournalScan = sim.state.tick;
      post({ t: 'seeked', tick: sim.state.tick, inPast: false });
      maybeSendMajors();
      sendSnapshot();
      break;
    }
    case 'decision': {
      if (!sim) break;
      const e = msg.entry as JournalEntry;
      // L2: late response (deadline fallback already fired) → discard + log
      if (sim.state.tick >= e.applyAtTick ||
          sim.journal.entries.some(j => j.requestId === e.requestId)) {
        post({ t: 'decisionDiscarded', requestId: e.requestId });
        break;
      }
      e.seq = sim.journal.entries.length;
      sim.submitDecision(e);
      break;
    }
    case 'chapterProse': {
      receiveProse(msg as { chapterId: number; title: string; paragraphs: string[] });
      break;
    }
    case 'requestChronicle': {
      postChronicle();
      break;
    }
    case 'searchIndex': {
      if (!sim) break;
      const s2 = sim.state;
      post({
        t: 'searchIndex',
        characters: s2.named.map(n => ({ id: n.id, name: n.name, role: n.role, faction: s2.factions[n.factionId]?.name ?? '', dead: n.deathTick >= 0, x: n.pawnIdx >= 0 ? s2.pawns.x[n.pawnIdx] : -1, y: n.pawnIdx >= 0 ? s2.pawns.y[n.pawnIdx] : -1, deathEventId: n.deathCauseEventId, bio: n.bio.join(' '), kills: n.kills, lineage: n.parentNamedId >= 0 ? s2.named[n.parentNamedId]?.name ?? '' : '' })),
        places: s2.settlements.map(st => ({ id: st.id, name: st.name, x: st.x, y: st.y, razed: st.razed, faction: s2.factions[st.factionId]?.name ?? '' })),
        events: s2.events.filter(e => e.severity >= 3).map(e => ({ id: e.id, text: e.text, tick: e.tick, x: e.x, y: e.y })),
        chapters: chronicle.chapters.map(c => ({ id: c.id, title: c.title, era: c.era, yearStart: c.yearStart })),
      });
      break;
    }
    case 'exportJournal': {
      post({ t: 'journal', journal: sim?.journal ?? null });
      break;
    }
    case 'inspect': {
      if (!sim) break;
      const s = sim.state;
      const p = s.pawns;
      // clicking a town center inspects the settlement (M8 loyalty view);
      // pawns win outside the immediate core
      const core = s.settlements.find(st => {
        if (st.razed) return false;
        const dx = st.x - msg.x, dy = st.y - msg.y;
        return dx * dx + dy * dy <= 2.5 * 2.5;
      });
      if (core) {
        post({ t: 'inspection', pawn: null, settlement: settlementPayload(core) });
        break;
      }
      let best = -1, bestD = 18;
      for (let i = 0; i < s.pawnCount; i++) {
        if (!(p.flags[i] & PawnFlag.Alive)) continue;
        const dx = p.x[i] - msg.x, dy = p.y[i] - msg.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) {
        // no pawn under the cursor: try a settlement (M8 loyalty inspector)
        let stBest = -1, stD = 8 * 8;
        for (const st of s.settlements) {
          if (st.razed) continue;
          const dx = st.x - msg.x, dy = st.y - msg.y;
          const d = dx * dx + dy * dy;
          if (d < stD) { stD = d; stBest = st.id; }
        }
        post({
          t: 'inspection', pawn: null,
          settlement: stBest >= 0 ? settlementPayload(s.settlements[stBest]) : undefined,
        });
        break;
      }
      const i = best;
      const offers = scoreOffers(s, i)
        .sort((a, b) => b.score - a.score).slice(0, 5)
        .map(o => ({ action: ACTION_NAMES[o.action], score: o.score }));
      const named = p.namedId[i] >= 0 ? s.named[p.namedId[i]] : null;
      post({
        t: 'inspection',
        pawn: {
          idx: i,
          x: p.x[i], y: p.y[i],
          faction: s.factions[p.factionId[i]]?.name ?? '?',
          race: s.factions[p.factionId[i]]?.race ?? 0,
          ageYears: (p.age[i] * AGE_SCALE / TICKS_PER_YEAR) | 0,
          female: !!(p.flags[i] & PawnFlag.Female),
          child: !!(p.flags[i] & PawnFlag.Child),
          needs: {
            hunger: p.hunger[i], energy: p.energy[i], shelter: p.shelter[i],
            safety: p.safety[i], social: p.social[i], mood: p.mood[i], hp: p.hp[i],
          },
          action: ACTION_NAMES[p.action[i]],
          offers,
          traits: {
            strength: p.strength[i], fertility: p.fertility[i], temper: p.temper[i],
            longevity: p.longevity[i], charisma: p.charisma[i],
          },
          paired: p.pairId[i] >= 0,
          named: named ? { id: named.id, name: named.name, role: named.role, bio: named.bio, memories: named.memories.map(m => m.text), traits: named.traits ?? [], renown: named.renown ?? 0 } : null,
        },
      });
      break;
    }
    case 'chain': {
      if (!sim) break;
      const byId = new Map(sim.state.events.map(ev => [ev.id, ev]));
      const chain: unknown[] = [];
      let cur = byId.get(msg.eventId as number);
      let depth = 0;
      while (cur && depth < 6) {
        chain.push({
          id: cur.id, tick: cur.tick, type: cur.type, severity: cur.severity,
          x: cur.x, y: cur.y, text: cur.text,
        });
        cur = cur.causes.length > 0 ? byId.get(cur.causes[0]) : undefined;
        depth++;
      }
      post({ t: 'chain', chain });
      break;
    }
    case 'recentFeed': {
      if (!sim) break;
      const minSev = (msg.minSeverity as number) ?? 2;
      const evs = sim.state.events.filter(ev => ev.severity >= minSev).slice(-30);
      post({
        t: 'feed',
        events: evs.map(ev => ({
          id: ev.id, tick: ev.tick, type: ev.type, severity: ev.severity, x: ev.x, y: ev.y,
          text: ev.text, hasCauses: ev.causes.length > 0,
        })),
      });
      break;
    }
    case 'allEvents': {
      // Events tab (11 §G1): the full log, filtered client-side
      if (!sim) break;
      const minSev = (msg.minSeverity as number) ?? 2;
      post({
        t: 'allEvents',
        events: sim.state.events.filter(ev => ev.severity >= minSev).map(ev => ({
          id: ev.id, tick: ev.tick, type: ev.type, severity: ev.severity, x: ev.x, y: ev.y,
          text: ev.text, factions: ev.factions, hasCauses: ev.causes.length > 0,
        })),
      });
      break;
    }
    case 'stats': {
      // Stats tab + HUD chips (11 §I1/I2): the books the sim kept since Year 0
      if (!sim) break;
      const ys = sim.state.yearStats;
      const nf = sim.state.factions.length;
      const series = (pick: (row: typeof ys[number]) => number[]): number[][] => {
        const out: number[][] = Array.from({ length: nf }, () => new Array(ys.length));
        for (let i = 0; i < ys.length; i++) {
          const row = pick(ys[i]);
          for (let f = 0; f < nf; f++) out[f][i] = row?.[f] ?? 0;
        }
        return out;
      };
      post({
        t: 'stats',
        years: ys.map(r => r.year),
        pop: series(r => r.popByFaction),
        food: series(r => r.foodByFaction),
        territory: series(r => r.territoryByFaction),
        warTicks: ys.map(r => r.warTicks),
        deathsByCause: sim.state.deathsByCause,
      });
      break;
    }
    case 'councilLog': {
      // Councils tab (11 §G1): every applied decision, verbatim reasoning
      if (!sim) break;
      post({
        t: 'councilLog',
        entries: sim.journal.entries
          .filter(en => !en.void && en.applyAtTick <= sim!.state.tick)
          .map(en => ({
            seq: en.seq, applyAtTick: en.applyAtTick, factionId: en.factionId,
            choice: en.choice, reasoning: en.reasoning, source: en.source,
            actorName: sim!.state.named[en.actorId]?.name ?? '?',
            factionName: sim!.state.factions[en.factionId]?.name ?? '?',
          })),
      });
      break;
    }
    case 'characterSheet': {
      // M11, P3.2: portrait data, deeds, mentions, three-generation tree
      if (!sim) break;
      const sc = sim.state;
      const n = sc.named[msg.id as number];
      if (!n) { post({ t: 'characterSheet', sheet: null }); break; }
      const kids = sc.named.filter(k => k.parentNamedId === n.id);
      const parent = n.parentNamedId >= 0 ? sc.named[n.parentNamedId] : null;
      const grandparent = parent && parent.parentNamedId >= 0 ? sc.named[parent.parentNamedId] : null;
      const brief = (c: typeof n) => ({
        id: c.id, name: c.name, role: c.role, dead: c.deathTick >= 0,
        bornYear: Math.max(0, Math.floor(c.bornTick / TICKS_PER_YEAR)),
        deathYear: c.deathTick >= 0 ? Math.floor(c.deathTick / TICKS_PER_YEAR) : -1,
      });
      post({
        t: 'characterSheet',
        sheet: {
          ...brief(n),
          factionId: n.factionId,
          factionName: sc.factions[n.factionId]?.name ?? '?',
          traits: n.traits ?? [],
          kills: n.kills,
          renown: n.renown ?? 0,
          bio: n.bio,
          memories: n.memories.map(m => m.text),
          mentions: sc.events
            .filter(e => e.actors?.includes(n.id) && e.severity >= 3)
            .slice(-12)
            .map(e => ({ id: e.id, tick: e.tick, x: e.x, y: e.y, text: e.text })),
          family: {
            grandparent: grandparent ? brief(grandparent) : null,
            parent: parent ? brief(parent) : null,
            children: kids.map(brief),
            grandchildren: kids.flatMap(k => sc.named.filter(g => g.parentNamedId === k.id)).map(brief),
          },
        },
      });
      break;
    }
    case 'records': {
      // M11, I5: world records derived at panel-open time
      if (!sim) break;
      const sr = sim.state;
      const year = Math.floor(sr.tick / TICKS_PER_YEAR);
      // longest reign: successive coronations per faction
      const crowns = sr.events.filter(e => e.type === EventType.Coronation);
      let reignBest = { name: '', years: 0 };
      const lastCrown = new Map<number, { tick: number; text: string }>();
      const consider = (fid: number, endTick: number) => {
        const c = lastCrown.get(fid);
        if (!c) return;
        const yrs = Math.floor((endTick - c.tick) / TICKS_PER_YEAR);
        if (yrs > reignBest.years) {
          reignBest = { name: c.text.replace(/^Y\d+: /, '').replace(/ is crowned.*/, ''), years: yrs };
        }
      };
      for (const e of crowns) { consider(e.factions[0], e.tick); lastCrown.set(e.factions[0], { tick: e.tick, text: e.text }); }
      for (const f of sr.factions) if (!f.extinct) consider(f.id, sr.tick);
      // oldest living pawn
      let oldest = 0;
      for (let i = 0; i < sr.pawnCount; i++) {
        if (sr.pawns.flags[i] & PawnFlag.Alive) oldest = Math.max(oldest, sr.pawns.age[i]);
      }
      // largest city now; longest peace; most crowns in a decade
      const bigCity = [...sr.settlements].filter(st => !st.razed).sort((a, b) => b.popCache - a.popCache)[0];
      let peaceBest = 0, run = 0;
      for (const ysRow of sr.yearStats) { run = ysRow.warTicks === 0 ? run + 1 : 0; peaceBest = Math.max(peaceBest, run); }
      let crownsBest = 0;
      for (let i = 0; i < crowns.length; i++) {
        crownsBest = Math.max(crownsBest, crowns.filter(c =>
          c.tick >= crowns[i].tick && c.tick < crowns[i].tick + 10 * TICKS_PER_YEAR).length);
      }
      const topRenown = [...sr.named].sort((a, b) => (b.renown ?? 0) - (a.renown ?? 0))[0];
      post({
        t: 'records',
        rows: [
          reignBest.years > 0 ? `Longest reign: ${reignBest.name}, ${reignBest.years} years` : '',
          topRenown ? `Most renowned: ${topRenown.name} (${topRenown.renown ?? 0} renown, ${topRenown.kills} kills)` : '',
          `Oldest living soul: ${(oldest * AGE_SCALE / TICKS_PER_YEAR) | 0} years`,
          bigCity ? `Greatest city: ${bigCity.name}, ${bigCity.popCache} souls` : '',
          `Longest peace: ${peaceBest} years`,
          crownsBest > 1 ? `Most crowns in a decade: ${crownsBest}` : '',
          `The chronicle spans ${year} years and ${sr.events.length} recorded events`,
        ].filter(Boolean),
      });
      break;
    }
    case 'farms': {
      // crop stages for the living-world layer (M10, 11 §B2), polled ~0.5Hz
      if (!sim) break;
      const sf = sim.state;
      const N = sf.map.size;
      const out: number[] = [];
      for (const st of sf.settlements) {
        if (st.razed) continue;
        for (const plot of st.farmPlots) {
          out.push(plot % N, (plot / N) | 0, sf.map.crop[plot]);
        }
      }
      post({ t: 'farms', xyStage: out });
      break;
    }
    case 'debugExpansion': {
      // balance probe (M8): why is/isn't EXPAND on the table?
      if (!sim) break;
      const s3 = sim.state;
      post({
        t: 'debugExpansion',
        rows: s3.settlements.filter(st => !st.razed).map(st => ({
          name: st.name, pop: st.popCache,
          crowdPct: crowdPctOf(st),
          capacity: settlementCapacity(st),
          grain: st.stockpile[0], wood: st.stockpile[3],
          granaryCap: st.granaryCap,
          prosper: canProsperExpand(st),
        })),
      });
      break;
    }
    case 'timelapse': {
      // M12, P4.3: replay a span, emitting territory keyframes; the live
      // present is parked exactly like a time-machine scrub and restored after
      if (!sim) break;
      const fromY = Math.max(0, msg.fromYear as number);
      const toY = Math.min(Math.floor((presentPack ? presentTick : sim.state.tick) / TICKS_PER_YEAR), msg.toYear as number);
      const step = Math.max(1, (msg.stepYears as number) ?? 5);
      if (!presentPack) {
        presentTick = sim.state.tick;
        presentPack = packSnapshot(snapshot(sim.state));
      }
      sim.seekToTick(fromY * TICKS_PER_YEAR);
      for (let y = fromY; y <= toY; y += step) {
        if (sim.state.tick < y * TICKS_PER_YEAR) {
          sim.seekToTick(y * TICKS_PER_YEAR);
        }
        post({
          t: 'tlFrame', year: y,
          settlements: sim.state.settlements.map(st => ({
            x: st.x, y: st.y, factionId: st.factionId, razed: st.razed, pop: st.popCache,
          })),
          battles: sim.state.events
            .filter(e => (e.type === EventType.BattleFought || e.type === EventType.SettlementRazed) &&
              Math.abs(e.tick - y * TICKS_PER_YEAR) < step * TICKS_PER_YEAR)
            .slice(-12).map(e => ({ x: e.x, y: e.y })),
        });
      }
      restore(sim.state, unpackSnapshot(presentPack));
      presentPack = null;
      lastMajorCount = -1;
      lastJournalScan = sim.state.tick;
      post({ t: 'tlDone' });
      post({ t: 'seeked', tick: sim.state.tick, inPast: false });
      sendSnapshot();
      break;
    }
    case 'hash': {
      post({ t: 'hash', hash: sim?.hash() ?? 0, tick: sim?.state.tick ?? 0 });
      break;
    }
  }
};
