// Sim Web Worker — hosts the deterministic Sim; render thread gets snapshots
// via transferable buffers (01). This file is NOT /src/sim (it may use timers).
import { Sim } from './sim/engine';
import { WorldConfig, defaultConfig, TICKS_PER_YEAR, JournalEntry, Journal, ACTION_NAMES } from './shared/types';
import { AGE_SCALE, PawnFlag, packSnapshot, snapshot, restore, unpackSnapshot } from './sim/state';
import { scoreOffers } from './sim/systems/utilityAISystem';

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

const SNAPSHOT_HZ = 20;

function post(msg: unknown, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function mapPlanesMsg() {
  const m = sim!.state.map;
  // copies (keep sim's own planes) — cheap at 512²
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
    })),
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
      x: e.x, y: e.y, text: e.text, causes: e.causes,
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
      } else {
        sim = msg.journal
          ? new Sim(msg.journal as Journal)
          : Sim.fresh(msg.seed as number, config);
        replayMode = !!msg.journal && !msg.continueLive;
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
        // first scrub into the past — park the present (one world-line, 07)
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
    case 'exportJournal': {
      post({ t: 'journal', journal: sim?.journal ?? null });
      break;
    }
    case 'inspect': {
      if (!sim) break;
      const s = sim.state;
      const p = s.pawns;
      let best = -1, bestD = 18;
      for (let i = 0; i < s.pawnCount; i++) {
        if (!(p.flags[i] & PawnFlag.Alive)) continue;
        const dx = p.x[i] - msg.x, dy = p.y[i] - msg.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) { post({ t: 'inspection', pawn: null }); break; }
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
          named: named ? { name: named.name, role: named.role, bio: named.bio, memories: named.memories.map(m => m.text) } : null,
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
          id: ev.id, tick: ev.tick, severity: ev.severity, x: ev.x, y: ev.y,
          text: ev.text, hasCauses: ev.causes.length > 0,
        })),
      });
      break;
    }
    case 'hash': {
      post({ t: 'hash', hash: sim?.hash() ?? 0, tick: sim?.state.tick ?? 0 });
      break;
    }
  }
};
