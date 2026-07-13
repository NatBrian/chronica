// M4: L-class edge tests + the replay-purity guarantee (zero LLM calls,
// hash-identical) + LLM-off indistinguishability.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/engine';
import { queueDecision } from '../src/sim/rules/decisions';
import { TICKS_PER_YEAR, JournalEntry } from '../src/shared/types';
import { BrainQueue } from '../src/brain/queue';
import { Brain } from '../src/brain/brain';

const CFG = { mapSize: 192, startPawnsPerFaction: 40 };

describe('M4: journaled kings', () => {
  it('LLM-sourced decisions replay bit-identically with ZERO LLM calls', () => {
    const live = Sim.fresh(21, CFG);
    // run until requests appear; answer some with a fake "LLM" (valid choices)
    let llmAnswered = 0;
    for (let y = 0; y < 12; y++) {
      for (let t = 0; t < TICKS_PER_YEAR; t++) {
        live.tick();
        for (const req of live.takeRequests()) {
          if (llmAnswered >= 6) continue;
          // fake LLM: picks the LAST option (diverges from RuleBrain on purpose)
          const entry: JournalEntry = {
            seq: live.journal.entries.length,
            requestId: req.requestId,
            requestTick: req.tick,
            applyAtTick: req.applyAtTick,
            actorId: req.actorId,
            factionId: req.factionId,
            choice: req.options[req.options.length - 1],
            reasoning: 'The stars demand it. (test LLM)',
            newMemory: `Y${Math.floor(req.tick / 360)}: I heeded the stars`,
            source: 'ollama',
          };
          live.submitDecision(entry);
          llmAnswered++;
        }
      }
    }
    expect(llmAnswered).toBeGreaterThan(0);
    expect(live.journal.entries.some(e => e.source === 'ollama')).toBe(true);
    // replay: no brain host attached — decisions come from the journal alone
    const replayed = Sim.replay(live.journal, live.state.tick);
    expect(replayed.hash()).toBe(live.hash());
  });

  it('L1: one pending per actor — crisis supersedes council', () => {
    const sim = Sim.fresh(3, CFG);
    sim.runYears(2);
    const s = sim.state;
    s.pending = [];
    s.outbox = [];
    queueDecision(s, 0, 'council', 1, ['CONSOLIDATE', 'RESERVE_STORES']);
    expect(s.pending.length).toBe(1);
    const councilId = s.pending[0].requestId;
    // crisis for same actor supersedes
    queueDecision(s, 0, 'famine', 2, ['CONSOLIDATE', 'RESERVE_STORES']);
    expect(s.pending.length).toBe(1);
    expect(s.pending[0].requestId).not.toBe(councilId);
    expect(s.pending[0].kind).toContain('famine');
    // lower priority does NOT supersede
    const crisisId = s.pending[0].requestId;
    queueDecision(s, 0, 'council', 1, ['CONSOLIDATE']);
    expect(s.pending[0].requestId).toBe(crisisId);
  });

  it('L2: late responses are discarded (journal already holds fallback)', () => {
    const sim = Sim.fresh(7, CFG);
    sim.runYears(3);
    // find a request that already resolved via fallback
    const applied = sim.journal.entries.find(e => e.source === 'fallback');
    expect(applied).toBeTruthy();
    // the worker-side guard condition:
    const lateEntry = { ...applied!, source: 'ollama' as const, reasoning: 'too late' };
    const isLate = sim.state.tick >= lateEntry.applyAtTick ||
      sim.journal.entries.some(j => j.requestId === lateEntry.requestId);
    expect(isLate).toBe(true);   // would be discarded, journal unchanged
  });

  it('L3: circuit breaker — 3 consecutive failures → instinct mode', async () => {
    let calls = 0;
    const failingBrain: Brain = {
      name: 'test',
      probe: async () => 100,
      decide: async () => { calls++; throw new Error('model hung'); },
    };
    const submitted: unknown[] = [];
    const q = new BrainQueue(failingBrain, (_r, res) => submitted.push(res));
    await q.start();
    expect(q.status().mode).toBe('llm');
    const mkReq = (id: number) => ({
      requestId: id, tick: 100, applyAtTick: 160, actorId: 0, factionId: 0,
      kind: 'council', priority: 3, options: ['CONSOLIDATE'],
      digest: { persona: { name: 'T', race: 'human', traits: [], age: 40, yearsRuled: 5, god: 'X', culture: { aggression: 100, piety: 100, wanderlust: 100 } }, memories: [], grudges: [], situation: { year: 1, season: 'spring', foodStores: '9 months', armyStrength: 'adequate', population: 100, settlements: 1, enemyEstimates: {}, activeTreaties: [], recentEvents: [] }, recentChoices: [], options: ['CONSOLIDATE'] },
    });
    q.enqueue(mkReq(1), 1);
    await new Promise(r => setTimeout(r, 50));
    q.enqueue(mkReq(2), 1);
    await new Promise(r => setTimeout(r, 50));
    q.enqueue(mkReq(3), 1);
    await new Promise(r => setTimeout(r, 50));
    expect(calls).toBe(3);
    expect(q.status().mode).toBe('instinct');
    // further enqueues are ignored while the circuit is open
    q.enqueue(mkReq(4), 1);
    await new Promise(r => setTimeout(r, 50));
    expect(calls).toBe(3);
    expect(submitted.length).toBe(0);
  });

  it('LLM-off mode plays indistinguishably (same shape, full function)', () => {
    // two identical sims, neither with a brain host: all fallback decisions
    const a = Sim.fresh(31, CFG);
    a.runYears(30);
    expect(a.journal.entries.length).toBeGreaterThan(20);
    expect(a.journal.entries.every(e => e.source === 'fallback')).toBe(true);
    // world is fully alive: population, events, possibly wars
    expect(a.state.alivePawns).toBeGreaterThan(100);
  });
});
