// BYO-API-key adapter (05): OpenRouter / Anthropic — CORS-enabled browser
// calls, key in localStorage only. Gives GPU-less users thinking kings.
import { DecisionRequest, DecisionResult } from '../shared/types';
import { Brain, decisionPrompt, validateResult } from './brain';

export interface ByoConfig {
  provider: 'openrouter' | 'anthropic';
  apiKey: string;
  model: string;
}

export function loadByoConfig(): ByoConfig | null {
  try {
    const raw = localStorage.getItem('chronica.byok');
    if (!raw) return null;
    const cfg = JSON.parse(raw) as ByoConfig;
    if (!cfg.apiKey || !cfg.model) return null;
    return cfg;
  } catch {
    return null;
  }
}

export function saveByoConfig(cfg: ByoConfig | null): void {
  if (cfg) localStorage.setItem('chronica.byok', JSON.stringify(cfg));
  else localStorage.removeItem('chronica.byok');
}

export class ByoKeyBrain implements Brain {
  readonly name = 'byok';
  constructor(private cfg: ByoConfig) {}

  async probe(): Promise<number> {
    const t0 = performance.now();
    await this.chat('Say OK', 'Reply with the word OK.', 8);
    return performance.now() - t0;
  }

  async decide(req: DecisionRequest): Promise<DecisionResult> {
    const { system, user } = decisionPrompt(req);
    const text = await this.chat(system, user, 300);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('byok: no JSON in response');
    let parsed: unknown;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { throw new Error('byok: JSON parse failed'); }
    const result = validateResult(req, parsed);
    if (!result) throw new Error('byok: invalid choice');
    return result;
  }

  private async chat(system: string, user: string, maxTokens: number): Promise<string> {
    if (this.cfg.provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.cfg.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const data = await r.json() as { content?: { text?: string }[] };
      return data.content?.[0]?.text ?? '';
    }
    // openrouter (openai-compatible)
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`openrouter ${r.status}`);
    const data = await r.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
