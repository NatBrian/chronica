// Brain queue (05 §Budget & scheduling / §Latency fairness):
// single in-flight request, FIFO within priority, per-faction coverage boost,
// adaptive quota from a startup probe, circuit breaker (L3), late-discard (L2).
import { DecisionRequest, DecisionResult, JournalEntry } from '../shared/types';
import { Brain } from './brain';

export interface QueueStatus {
  mode: 'llm' | 'instinct';       // instinct = circuit open / no brain
  brainName: string;
  probeMs: number;
  quotaPerYear: number;
  inFlight: boolean;
  queued: number;
  answered: number;
  fallbacks: number;
  failures: number;
}

interface QueueItem {
  req: DecisionRequest;
  enqueuedAt: number;
}

export class BrainQueue {
  private queue: QueueItem[] = [];
  private inFlight = false;
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private probeMs = 0;
  private quotaPerYear = 12;
  private usedThisYear = 0;
  private curYear = -1;
  private coverage = new Map<number, { num: number; den: number }>();
  answered = 0;
  failures = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private brain: Brain | null,
    /** submit a resolved decision toward the sim (worker guards lateness) */
    private submit: (req: DecisionRequest, result: DecisionResult) => void,
    private onStatus?: (st: QueueStatus) => void,
  ) {}

  /** Startup benchmark probe → adaptive quota (05 §4). */
  async start(): Promise<void> {
    if (!this.brain) { this.circuitOpen = true; this.emitStatus(); return; }
    try {
      this.probeMs = await this.brain.probe();
      // quota: how many decisions fit in a game-year of wall time at 1×
      // (36s per game-year at 1×; keep GPU under ~2/3 duty)
      const perYearBudgetMs = 24_000;
      this.quotaPerYear = Math.max(3, Math.min(20, Math.floor(perYearBudgetMs / Math.max(500, this.probeMs))));
      this.circuitOpen = false;
    } catch {
      this.circuitOpen = true;
      this.scheduleHealthProbe();
    }
    this.emitStatus();
  }

  enqueue(req: DecisionRequest, simYear: number): void {
    if (!this.brain || this.circuitOpen) return;   // sim falls back on its own
    if (simYear !== this.curYear) { this.curYear = simYear; this.usedThisYear = 0; }
    if (this.usedThisYear >= this.quotaPerYear && req.priority < 3) return;
    this.queue.push({ req, enqueuedAt: Date.now() });
    // priority order; FIFO within priority; boost lowest-coverage faction (05 §3)
    this.queue.sort((a, b) => {
      const cov = (fid: number) => {
        const c = this.coverage.get(fid);
        return c && c.den > 0 ? c.num / c.den : 1;
      };
      return (b.req.priority - a.req.priority) ||
        (cov(a.req.factionId) - cov(b.req.factionId)) ||
        (a.enqueuedAt - b.enqueuedAt);
    });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.inFlight || this.circuitOpen || !this.brain) return;
    const item = this.queue.shift();
    if (!item) return;
    this.inFlight = true;
    this.emitStatus();
    const cov = this.coverage.get(item.req.factionId) ?? { num: 0, den: 0 };
    cov.den++;
    this.coverage.set(item.req.factionId, cov);
    try {
      const result = await this.brain.decide(item.req);
      this.consecutiveFailures = 0;
      this.answered++;
      this.usedThisYear++;
      cov.num++;
      this.submit(item.req, result);
    } catch {
      this.failures++;
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        // L3: circuit breaker — kings rule by instinct; probe in background
        this.circuitOpen = true;
        this.queue = [];
        this.scheduleHealthProbe();
      }
    } finally {
      this.inFlight = false;
      this.emitStatus();
      if (this.queue.length > 0) void this.pump();
    }
  }

  private scheduleHealthProbe(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(async () => {
      if (!this.brain) return;
      try {
        await this.brain.probe();
        this.circuitOpen = false;
        this.consecutiveFailures = 0;
        if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
        this.emitStatus();
      } catch { /* stay open */ }
    }, 60_000);
  }

  status(): QueueStatus {
    return {
      mode: this.circuitOpen || !this.brain ? 'instinct' : 'llm',
      brainName: this.brain?.name ?? 'none',
      probeMs: Math.round(this.probeMs),
      quotaPerYear: this.quotaPerYear,
      inFlight: this.inFlight,
      queued: this.queue.length,
      answered: this.answered,
      fallbacks: 0,
      failures: this.failures,
    };
  }

  private emitStatus(): void {
    this.onStatus?.(this.status());
  }
}
