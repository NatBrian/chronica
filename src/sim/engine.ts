// Engine — fixed-order tick pipeline, journal application, keyframes, seek.
// World history = f(seed, decision journal). Nothing else. (01 §Determinism)
import {
  Journal, JournalEntry, WorldConfig, defaultConfig, SIM_VERSION, TICKS_PER_YEAR,
  DecisionRequest,
} from '../shared/types';
import { SimState, hashState, snapshot, restore, packSnapshot, unpackSnapshot, Snapshot } from './state';
import { genesis } from './genesis';
import { SYSTEMS, SystemCtx } from './systems';

export interface Keyframe { tick: number; packed: ArrayBuffer }

export class Sim {
  state: SimState;
  journal: Journal;
  keyframes: Keyframe[] = [];
  /** requests drained by the host (brain layer) each tick */
  requestsOut: DecisionRequest[] = [];
  private genesisSnap: Snapshot;

  constructor(journal: Journal) {
    this.journal = journal;
    this.state = genesis(journal.header.seed, journal.header.config);
    this.journal.header.islandName = this.state.islandName;
    this.genesisSnap = snapshot(this.state);
    this.pushKeyframe();
  }

  static fresh(seed: number, config?: Partial<WorldConfig>): Sim {
    const cfg = { ...defaultConfig(), ...config };
    return new Sim({ header: { seed, simVersion: SIM_VERSION, config: cfg }, entries: [] });
  }

  /** One tick — the fixed system order is part of the determinism contract. */
  tick(): void {
    const s = this.state;
    s.tick++;
    const ctx: SystemCtx = { journal: this.journal };
    for (const system of SYSTEMS) system(s, ctx);
    if (s.outbox.length > 0) {
      this.requestsOut.push(...s.outbox);
      s.outbox = [];
    }
    // keyframe every N years
    const kfTicks = s.config.keyframeIntervalYears * TICKS_PER_YEAR;
    if (s.tick % kfTicks === 0) this.pushKeyframe();
  }

  runTicks(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
  }

  runYears(n: number): void {
    this.runTicks(n * TICKS_PER_YEAR);
  }

  hash(): number {
    return hashState(this.state);
  }

  /** Host appends a resolved decision (LLM or fallback). Must be ≥ current tick. */
  submitDecision(entry: JournalEntry): void {
    this.journal.entries.push(entry);
    // keep sorted by applyAtTick then seq — brainInbox scans linearly
    this.journal.entries.sort((a, b) => a.applyAtTick - b.applyAtTick || a.seq - b.seq);
  }

  takeRequests(): DecisionRequest[] {
    const out = this.requestsOut;
    this.requestsOut = [];
    return out;
  }

  private pushKeyframe(): void {
    const packed = packSnapshot(snapshot(this.state));
    this.keyframes = this.keyframes.filter(k => k.tick !== this.state.tick);
    this.keyframes.push({ tick: this.state.tick, packed });
    // F3 quota thinning: beyond 100y ago keep every 50y only
    const cutoff = this.state.tick - 100 * TICKS_PER_YEAR;
    this.keyframes = this.keyframes.filter(k =>
      k.tick >= cutoff || k.tick % (50 * TICKS_PER_YEAR) === 0);
  }

  /** Seek to a year: restore nearest keyframe ≤ target, fast-forward silently. */
  seekToTick(targetTick: number): void {
    if (targetTick > this.state.tick) {
      this.runTicks(targetTick - this.state.tick);
      return;
    }
    let best: Keyframe | null = null;
    for (const k of this.keyframes) {
      if (k.tick <= targetTick && (!best || k.tick > best.tick)) best = k;
    }
    if (best) {
      restore(this.state, unpackSnapshot(best.packed));
    } else {
      restore(this.state, this.genesisSnap);
    }
    this.runTicks(targetTick - this.state.tick);
  }

  seekToYear(year: number): void {
    this.seekToTick(year * TICKS_PER_YEAR);
  }

  /** Replay from scratch: same seed + same journal ⇒ bit-identical (zero LLM calls). */
  static replay(journal: Journal, toTick: number): Sim {
    const sim = new Sim({
      header: journal.header,
      entries: journal.entries.map(e => ({ ...e })),
    });
    sim.runTicks(toTick);
    return sim;
  }
}
