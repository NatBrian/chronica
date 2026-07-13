// Brain adapter interface (05): all client-side, provider-agnostic.
// LLM output NEVER touches the sim directly: it becomes a journal entry.
import { DecisionRequest, DecisionResult } from '../shared/types';

export interface Brain {
  readonly name: string;
  decide(req: DecisionRequest): Promise<DecisionResult>;
  /** one cheap call to measure latency & availability (adaptive quota) */
  probe(): Promise<number>;   // ms, throws if unavailable
}

export function decisionPrompt(req: DecisionRequest): { system: string; user: string } {
  const d = req.digest;
  const system = [
    `You are ${d.persona.name}, ${d.persona.race} ruler, age ${d.persona.age}, ${d.persona.yearsRuled} years on the throne.`,
    `Traits: ${d.persona.traits.join(', ')}. Your god: ${d.persona.god}.`,
    raceVoice(d.persona.race),
    `Rules: choose EXACTLY ONE option from the list, verbatim. Reason in character, max 80 words.`,
    `War is stated plainly, never relished. No gore.`,
  ].join('\n');
  const user = JSON.stringify({
    memories: d.memories,
    grudges: d.grudges,
    situation: d.situation,
    yourRecentChoices: d.recentChoices,
    options: d.options,
    respond: 'JSON: {"choice": "<one option verbatim>", "reasoning": "<max 80 words, in character>", "newMemory": "<optional one-line memory to keep>"}',
  });
  return { system, user };
}

function raceVoice(race: string): string {
  switch (race) {
    case 'orc': return 'Voice: blunt, hungry, honor-through-strength. Example: "The elves grow fat while my people starve. Strength decides."';
    case 'elf': return 'Voice: patient, long-memoried, quietly cold. Example: "We remember the axes. The forest forgets nothing, and neither do I."';
    case 'dwarf': return 'Voice: dour, practical, ledger-minded. Example: "Grain costs less than graves. For now, we pay."';
    default: return 'Voice: pragmatic, ambitious, plain-spoken. Example: "Land feeds people, and people are strength. We move."';
  }
}

/** Validate an LLM result against the offered options (05: legality floor). */
export function validateResult(req: DecisionRequest, raw: unknown): DecisionResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const choice = typeof r.choice === 'string' ? r.choice.trim() : '';
  if (!req.options.includes(choice)) return null;
  const reasoning = typeof r.reasoning === 'string' ? r.reasoning.slice(0, 600) : '';
  const newMemory = typeof r.newMemory === 'string' && r.newMemory.length > 3
    ? r.newMemory.slice(0, 200) : undefined;
  return { choice, reasoning, newMemory };
}
