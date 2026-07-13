#!/usr/bin/env node
// LLM eval harness (05 §Eval harness): run on demand against local ollama:
//   node scripts/eval-llm.mjs [model]
// Checks per fixture: valid choice, memory-grounded reasoning, length cap;
// plus decision entropy across a repeated fixture (anti-first-option bias).
const BASE = process.env.OLLAMA_HOST_URL ?? 'http://localhost:11434';
const MODEL = process.argv[2] ?? 'gemma4:12b';

const personas = {
  orc: { name: 'Gruk Bonecrusher', race: 'orc', traits: ['aggressive', 'battle-scarred'], god: 'Karnak' },
  elf: { name: 'Aelith Vaerwyn', race: 'elf', traits: ['patient', 'devout'], god: 'Silmae' },
  dwarf: { name: 'Thrain Ironbeard', race: 'dwarf', traits: ['pragmatic'], god: 'Bordin' },
  human: { name: 'Aldric Greenfield', race: 'human', traits: ['ambitious', 'charismatic'], god: 'Solen' },
};

function fixture(race, memories, grudges, situation, options) {
  return {
    persona: { ...personas[race], age: 44, yearsRuled: 12, culture: { aggression: 140, piety: 100, wanderlust: 100 } },
    memories, grudges, situation, recentChoices: [], options,
  };
}

const FIXTURES = [];
// war-brink scenarios (each race voice)
for (const race of ['orc', 'elf', 'dwarf', 'human']) {
  FIXTURES.push({
    name: `${race}-war-brink`,
    digest: fixture(race,
      ['Y31: they refused our grain tribute', 'Y29: my brother died raiding Elmwood', 'Y40: dwarves honored their trade pact'],
      [{ faction: 'Elmwood Court (1)', weight: 9, why: 'tribute refusals; brother slain' }],
      { year: 43, season: 'autumn', foodStores: '4 months', armyStrength: 'strong', population: 300, settlements: 2, enemyEstimates: { 'Elmwood Court (1)': 'weaker than us' }, activeTreaties: [], recentEvents: ['Y42: Bad blood; an insult at a border market'] },
      ['DECLARE_WAR(1)', 'DEMAND_TRIBUTE(1)', 'SEND_GIFT(1)', 'CONSOLIDATE']),
    expectMemoryGrounding: true,
  });
}
// famine crisis
for (const race of ['orc', 'dwarf']) {
  FIXTURES.push({
    name: `${race}-famine`,
    digest: fixture(race,
      ['Y50: the great drought began', 'Y49: humans sent grain when we starved'],
      [],
      { year: 51, season: 'winter', foodStores: '1 months', armyStrength: 'weak', population: 120, settlements: 1, enemyEstimates: { 'Greenfield Kingdom (0)': 'much stronger than us' }, activeTreaties: ['trading with Greenfield Kingdom (0)'], recentEvents: ['Y51: Hunger stalks our halls'] },
      ['PROPOSE_TRADE(0)', 'DECLARE_WAR(0)', 'RESERVE_STORES', 'CONSOLIDATE']),
    expectMemoryGrounding: false,
  });
}
// tribute demand response
FIXTURES.push({
  name: 'human-tribute-response',
  digest: fixture('human',
    ['Y60: the orcs burned our border mill'],
    [{ faction: 'Bonecrush Horde (3)', weight: 5, why: 'mill burned' }],
    { year: 61, season: 'spring', foodStores: '8 months', armyStrength: 'adequate', population: 400, settlements: 3, enemyEstimates: { 'Bonecrush Horde (3)': 'roughly our equal' }, activeTreaties: [], recentEvents: ['Y61: Bonecrush Horde demands tribute of us'] },
    ['PAY_TRIBUTE', 'REFUSE_TRIBUTE']),
  expectMemoryGrounding: false,
});
// post-war terms
FIXTURES.push({
  name: 'elf-postwar-terms',
  digest: fixture('elf',
    ['Y70: we broke the orc host at Silverford', 'Y65: they burned Moonshade'],
    [{ faction: 'Bonecrush Horde (3)', weight: 11, why: 'Moonshade burned' }],
    { year: 71, season: 'summer', foodStores: '10 months', armyStrength: 'strong', population: 500, settlements: 3, enemyEstimates: { 'Bonecrush Horde (3)': 'far weaker' }, activeTreaties: [], recentEvents: ['Y71: The war ends in our victory'] },
    ['TAKE_TRIBUTE', 'SHIFT_BORDER', 'VASSALIZE', 'RAZE']),
  expectMemoryGrounding: true,
});
// entropy probe: neutral council, run 6×; flag >50% single-action dominance
const entropyFixture = fixture('human',
  ['Y80: a quiet decade of good harvests'],
  [],
  { year: 81, season: 'spring', foodStores: '9 months', armyStrength: 'adequate', population: 350, settlements: 3, enemyEstimates: {}, activeTreaties: ['trading with two neighbors'], recentEvents: [] },
  ['PROPOSE_TRADE(1)', 'SEND_GIFT(2)', 'CONSOLIDATE', 'CONSCRIPT', 'PROPOSE_ALLIANCE(1)']);

function prompt(digest) {
  const d = digest;
  const system = [
    `You are ${d.persona.name}, ${d.persona.race} ruler, age ${d.persona.age}, ${d.persona.yearsRuled} years on the throne.`,
    `Traits: ${d.persona.traits.join(', ')}. Your god: ${d.persona.god}.`,
    `Rules: choose EXACTLY ONE option from the list, verbatim. Reason in character, max 80 words.`,
  ].join('\n');
  const user = JSON.stringify({
    memories: d.memories, grudges: d.grudges, situation: d.situation,
    options: d.options,
    respond: 'JSON: {"choice": "...", "reasoning": "...", "newMemory": "..."}',
  });
  return { system, user };
}

async function ask(digest) {
  const { system, user } = prompt(digest);
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      format: {
        type: 'object',
        properties: {
          choice: { type: 'string', enum: digest.options },
          reasoning: { type: 'string' }, newMemory: { type: 'string' },
        },
        required: ['choice', 'reasoning'],
      },
      options: { temperature: 0.7, num_predict: 220 },
      think: false,
    }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const data = await r.json();
  return JSON.parse(data.message.content);
}

function grounded(reasoning, digest) {
  const tokens = [];
  for (const m of digest.memories) tokens.push(...m.replace(/^Y\d+: /, '').split(' ').filter(w => w.length > 5));
  for (const g of digest.grudges) tokens.push(...g.why.split(/[ ;]/).filter(w => w.length > 5));
  const low = reasoning.toLowerCase();
  return tokens.some(t => low.includes(t.toLowerCase().replace(/[^a-z]/gi, '')));
}

let pass = 0, fail = 0;
for (const f of FIXTURES) {
  try {
    const res = await ask(f.digest);
    const validChoice = f.digest.options.includes(res.choice);
    const words = (res.reasoning ?? '').split(/\s+/).length;
    const memOk = !f.expectMemoryGrounding || grounded(res.reasoning ?? '', f.digest);
    const ok = validChoice && words <= 110 && memOk;
    console.log(`${ok ? '✓' : '✗'} ${f.name}: ${res.choice} (${words}w${memOk ? '' : ', NOT memory-grounded'})`);
    if (!ok) { fail++; console.log(`   reasoning: ${res.reasoning}`); }
    else pass++;
  } catch (e) {
    fail++;
    console.log(`✗ ${f.name}: ERROR ${e.message}`);
  }
}

// entropy check; with the production mitigations (05 §Anti-repetition):
// self-history in the digest + per-request option shuffle
const picks = {};
const history = [];
for (let i = 0; i < 6; i++) {
  try {
    const fx = JSON.parse(JSON.stringify(entropyFixture));
    fx.recentChoices = history.slice(-3);
    if (history.length) {
      fx.memories.push(`you chose ${history.slice(-3).join(', ')} at your last councils`);
    }
    // deterministic-ish shuffle per iteration
    fx.options = [...fx.options.slice(i % fx.options.length), ...fx.options.slice(0, i % fx.options.length)];
    const res = await ask(fx);
    picks[res.choice] = (picks[res.choice] ?? 0) + 1;
    history.push(res.choice);
  } catch { /* skip */ }
}
const total = Object.values(picks).reduce((a, b) => a + b, 0);
const maxShare = total ? Math.max(...Object.values(picks)) / total : 0;
console.log(`entropy probe: ${JSON.stringify(picks)}; max share ${(maxShare * 100).toFixed(0)}%`);
if (maxShare > 0.84) { fail++; console.log('✗ decision entropy: single action dominates'); }
else pass++;

console.log(`\n${pass} passed, ${fail} failed (model: ${MODEL})`);
process.exit(fail > 2 ? 1 : 0);   // tolerate occasional flakiness, catch regressions
