// Sim Web Worker — hosts the deterministic Sim; render thread gets snapshots
// via transferable buffers (01). This file is NOT /src/sim (it may use timers).
import { Sim } from './sim/engine';
import { WorldConfig, defaultConfig, TICKS_PER_YEAR, JournalEntry, Journal } from './shared/types';
import { PawnFlag } from './sim/state';

let sim: Sim | null = null;
let ticksPerSec = 0;           // 0 = paused
let timer: ReturnType<typeof setInterval> | null = null;
let tickRemainder = 0;
let replayMode = false;

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

function loop(): void {
  if (!sim || ticksPerSec === 0) return;
  const ticksPerFrame = ticksPerSec / SNAPSHOT_HZ + tickRemainder;
  const whole = Math.floor(ticksPerFrame);
  tickRemainder = ticksPerFrame - whole;
  for (let i = 0; i < whole; i++) {
    sim.tick();
  }
  const reqs = sim.takeRequests();
  if (reqs.length > 0 && !replayMode) post({ t: 'requests', requests: reqs });
  sendSnapshot();
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.t) {
    case 'init': {
      const config: WorldConfig = { ...defaultConfig(), ...(msg.config ?? {}) };
      sim = msg.journal
        ? new Sim(msg.journal as Journal)
        : Sim.fresh(msg.seed as number, config);
      replayMode = !!msg.journal && !msg.continueLive;
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
      const target = Math.floor(msg.year * TICKS_PER_YEAR);
      sim.seekToTick(target);
      post({ t: 'seeked', tick: sim.state.tick });
      sendSnapshot();
      break;
    }
    case 'decision': {
      sim?.submitDecision(msg.entry as JournalEntry);
      break;
    }
    case 'exportJournal': {
      post({ t: 'journal', journal: sim?.journal ?? null });
      break;
    }
    case 'hash': {
      post({ t: 'hash', hash: sim?.hash() ?? 0, tick: sim?.state.tick ?? 0 });
      break;
    }
  }
};
