// OllamaBrain — direct browser → localhost:11434 (05 §Backend).
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
