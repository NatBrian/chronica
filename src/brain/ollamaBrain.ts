// OllamaBrain: direct browser → localhost:11434 (05 §Backend).
// Grammar-constrained JSON via `format`: invalid output structurally impossible.
import { DecisionRequest, DecisionResult } from '../shared/types';
import { Brain, decisionPrompt, validateResult } from './brain';

const BASE = 'http://localhost:11434';

export class OllamaBrain implements Brain {
  readonly name = 'ollama';
  model: string | null = null;

  async detectModel(): Promise<string | null> {
    try {
      const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const data = await r.json() as { models?: { name: string; size?: number }[] };
      const models = data.models ?? [];
      if (models.length === 0) return null;
      // prefer an instruction-tuned mid-size model; else the largest available
      const preferred = models.find(m => /gemma|qwen|llama|mistral/i.test(m.name) && !/embed/i.test(m.name));
      this.model = (preferred ?? models[0]).name;
      return this.model;
    } catch {
      return null;
    }
  }

  async probe(): Promise<number> {
    if (!this.model && !(await this.detectModel())) throw new Error('ollama unavailable');
    const t0 = performance.now();
    const r = await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: 'Say OK', stream: false, options: { num_predict: 4 } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`ollama probe ${r.status}`);
    await r.json();
    return performance.now() - t0;
  }

  /** Chronicler prose (05): temp 0.85, strictly from provided facts, PG-13. */
  async narrate(req: {
    titleHint: string; era: string; yearStart: number; yearEnd: number;
    facts: string[]; islandName: string; retryNote?: string;
  }): Promise<{ title: string; paragraphs: string[] }> {
    if (!this.model && !(await this.detectModel())) throw new Error('ollama unavailable');
    const system = [
      `You are the court historian of the island of ${req.islandName}, writing its chronicle.`,
      `Write ONLY from the facts given. Never invent names, places, or years not present in the facts.`,
      `Tone: plain, poignant, a touch of dry wit. War and famine stated plainly; no gore, no atrocity detail.`,
      `Style: 2-4 paragraphs, 150-450 words total. Refer to years as "the year N".`,
      req.retryNote ? `PREVIOUS ATTEMPT REJECTED: ${req.retryNote}. Fix this.` : '',
    ].filter(Boolean).join('\n');
    const user = JSON.stringify({
      chapterTheme: req.titleHint,
      years: `${req.yearStart}-${req.yearEnd}`,
      facts: req.facts,
      respond: 'JSON: {"title": "<chapter title, max 8 words>", "paragraphs": ["...", "..."]}',
    });
    const r = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        stream: false,
        format: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            paragraphs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
          },
          required: ['title', 'paragraphs'],
        },
        options: { temperature: 0.85, num_predict: 700 },
        think: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const data = await r.json() as { message?: { content?: string } };
    const parsed = JSON.parse(data.message?.content ?? '') as { title: string; paragraphs: string[] };
    if (!parsed.title || !Array.isArray(parsed.paragraphs) || parsed.paragraphs.length === 0) {
      throw new Error('ollama narrate: bad shape');
    }
    return parsed;
  }

  async decide(req: DecisionRequest): Promise<DecisionResult> {
    if (!this.model && !(await this.detectModel())) throw new Error('ollama unavailable');
    const { system, user } = decisionPrompt(req);
    const schema = {
      type: 'object',
      properties: {
        choice: { type: 'string', enum: req.options },
        reasoning: { type: 'string' },
        newMemory: { type: 'string' },
      },
      required: ['choice', 'reasoning'],
    };
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      format: schema,                       // decode-time schema enforcement
      options: { temperature: 0.7, num_predict: 220 },
      think: false,                         // gemma3/qwen3 thinking wastes budget
    };
    const r = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const data = await r.json() as { message?: { content?: string } };
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.message?.content ?? '');
    } catch {
      throw new Error('ollama JSON parse failed');
    }
    const result = validateResult(req, parsed);
    if (!result) throw new Error('ollama invalid choice');
    return result;
  }
}
