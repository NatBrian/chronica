# 05 : LLM Layer: Thinking Kings & the Chronicler

## Principles

1. **LLM is garnish, never load-bearing.** Sim runs full speed with LLM off; every decision point has a rule-based fallback producing the same *shape* of output.
2. **All LLM outputs are journaled** (01 §Determinism). The sim consumes journal entries, never live responses. Replay makes zero LLM calls.
3. **Constrained outputs only.** Kings choose from enumerated actions with structured JSON; free prose is only for reasoning display and chronicle text : places where hallucination can't corrupt sim state.
4. **Budget-bounded.** Calls per game-year capped; queue with priorities; drop to fallback on timeout.

## Backend

- **Primary:** local ollama, `gemma4:12b`, GPU 2 (already provisioned, watchdog-managed).
- **Model floor:** sub-1B models (e.g. qwen3 0.6b) are *mechanically* safe (constrained choices + validators mean no model can corrupt sim state) but strategically worse than RuleBrain and fail the chronicle validator too often : below ~4B, ship LLM-less mode instead. Min spec ~4B, target 8–14B, optional API-quality chronicle pass post-MVP. The eval harness (below) gates any model swap empirically.
- **Access path:** direct browser → `http://localhost:11434`. Localhost is exempt from mixed-content blocking even on a hosted https page; user sets `OLLAMA_ORIGINS` (one-line instruction in UI). Queueing, timeouts, and logging live in the browser-side adapter : **no sidecar process** (a Node proxy remains a documented option if some environment blocks direct access, but is not part of the default architecture).
- **BYO API key adapter:** OpenRouter / Anthropic support CORS browser calls; key stored in localStorage only. Gives GPU-less users smart kings at their own (tiny) cost; we host nothing.
- **Adapter interface** (provider-agnostic, swap-friendly):

```ts
interface Brain {
  decide(req: DecisionRequest): Promise<DecisionResult>   // kings
  narrate(req: ChronicleRequest): Promise<ChronicleText>  // historian
}
// implementations: OllamaBrain, RuleBrain (fallback), later ClaudeBrain for chronicle quality pass
```

## Thinking kings

### When a decision is requested
Trigger events, not polling: succession, war/peace threshold crossings from the rule engine (rule engine computes *options and pressure*, king chooses), tribute demand received, famine crisis, alliance proposal, post-war terms. Plus one annual "council" decision per leader. Expected volume: ~10–20 leader decisions per game-year total across all factions.

### Decision option catalog (the complete LLM surface)
The rule engine offers a *legal, relevant subset* of these per request; the LLM picks exactly one. Rules execute the choice : the LLM never touches sim state directly.

| Group | Options |
|---|---|
| War/peace | `DECLARE_WAR(f)`, `SUE_FOR_PEACE(f)`, `SET_WAR_OBJECTIVE(raid\|conquer\|burn)`, `ACCEPT_TRUCE`, `REJECT_TRUCE` |
| Diplomacy | `DEMAND_TRIBUTE(f)`, `PAY_TRIBUTE`, `REFUSE_TRIBUTE`, `PROPOSE_ALLIANCE(f)`, `ALLY_AGAINST(hegemon)`, `ACCEPT_PROPOSAL`, `REJECT_PROPOSAL`, `PROPOSE_MARRIAGE(char)`, `SEND_GIFT(f)` |
| Economy | `PROPOSE_TRADE(f)`, `EMBARGO(f)`, `RESERVE_STORES` |
| Internal | `CONSCRIPT`, `DISBAND_SOLDIERS`, `ORDER_SETTLEMENT`, `CONSOLIDATE` |
| Post-war terms (victor only) | `TAKE_TRIBUTE`, `SHIFT_BORDER`, `VASSALIZE`, `RAZE` |

Everything else in the world : pawn actions, squads, caravans, monsters, succession, prices, rebellions : is pure rules (03/04).

**Execution notes (every option maps to a rule mechanism):**
- All inter-faction goods movement (`PAY_TRIBUTE`, `SEND_GIFT`, `TAKE_TRIBUTE`, trade) rides **physical caravans** : visible, escortable, raidable. A raided tribute caravan is both an economy event and a casus belli. No teleporting goods.
- `EMBARGO(f)`: blocks caravan spawning between the pair + negative ledger entry; lifts on trade/alliance transition.
- `RESERVE_STORES`: sets the faction's stockpile-release policy flag (settlements hold surplus instead of offering it to trade/caravans); spoilage (04) still applies : hoarding has a cost.
- `ALLY_AGAINST(h)`: composite transition : alliance state with the co-signer + coordinated war entry against the hegemon.
- Proposal-type options (`PROPOSE_*`, `DEMAND_TRIBUTE`) generate a decision request for the *recipient* king : response decisions count within the quota; routine responses fall to RuleBrain when the quota is tight.

### DecisionRequest : the situation digest
Compact structured context (target < 1.5k tokens), built from sim state:

```json
{
  "persona": {"name": "Gruk", "race": "orc", "traits": ["aggressive","cunning"],
               "cultureParams": {...}, "age": 44, "yearsRuled": 12},
  "memories": ["Y31: elves refused grain tribute", "Y29: brother died raiding Elmwood",
               "Y40: dwarves honored trade pact during famine"],
  "grudges": [{"faction": "elves", "weight": 8, "why": "tribute refusals, brother's death"}],
  "situation": {"season": "autumn", "foodStores": "4 months", "armyStrength": "strong",
                "enemyEstimates": {...}, "activeTreaties": [...], "recentEvents": [...]},
  "options": ["DECLARE_WAR(elves)", "DEMAND_TRIBUTE(elves)", "PROPOSE_TRADE(dwarves)",
              "RAID_CARAVANS(humans)", "CONSOLIDATE"],
  "constraints": "pick exactly one option; reason in character, max 80 words"
}
```

### DecisionResult (JSON-schema enforced, retry once on parse fail, then fallback)
```json
{"choice": "DECLARE_WAR(elves)",
 "reasoning": "Elves refused grain twice. Winter comes. The dwarves honor their pact and will not intervene. My brother's blood is still owed. Strike before the snows.",
 "newMemory": "Y43: I chose war with the elves over the grain insults"}
```

- `choice` validated against the offered options : anything else = fallback choice.
- `reasoning` → displayed in the UI (council panel / thought bubble) and stored for the chronicle. **This is shareable-moment #1.**
- `newMemory` appended to the king's memory list (capped ~20) : grudge persistence across decades. **Eviction policy:** `weight = severity × recencyDecay`; **landmark memories are pinned** (war outcomes, betrayals, coronations : never evicted: a king may forget a refused gift, never who burned his capital). Evicted non-landmarks collapse into a one-line era summary ("years of quiet trade with the dwarves") so long reigns don't read amnesiac.
- Result journaled `{applyAtTick, actorId, choice, reasoning, source: "ollama"|"fallback"}`.

### RuleBrain fallback
Weighted scoring over the same options using grudge weights + culture params + situation numbers, seeded stream `rng.kingFallback`. Produces `choice` + templated reasoning ("Gruk's patience with the elves is spent."). Same journal shape : replay can't tell the difference, and a no-GPU demo still works.

### Persona quality guard
12B models drift into genre mush. Mitigations: tight persona block, race-specific system prompts with voice examples, max-80-word reasoning cap, temperature ~0.7 for kings. Eval harness (below) checks in-characterness by spot audit.

### Choice quality with imperfect models
- **Decode-time schema enforcement:** ollama's grammar-constrained generation (`format` w/ JSON schema) makes invalid output *structurally impossible* : the model cannot emit tokens outside the schema. Validation+retry remains as backstop for providers without grammar support.
- **Legality pre-filter = correctness floor:** the rule engine offers only legal options; the LLM chooses among sane moves by construction.
- **No RuleBrain veto (policy):** a veto would reduce the LLM to agreeing with rules : decorative. Legal-but-bold picks are the product ("proud orc king declares a rash war" = chapter, not bug). Instead: divergence-from-RuleBrain logged per model; the eval harness gates which models are trusted at all.
- **Anti-repetition (small-model first-option bias is real):** option order shuffled per request (seeded); the digest includes the king's own recent picks ("you chose CONSOLIDATE at the last 3 councils"); temperature 0.7; decision-entropy per king tracked in eval + soak : flag any model/persona exceeding ~50% one action type.

## The Chronicler

### Pipeline (batch, async, never blocks sim)
```
causality DAG + event log
  → chapter detector (rule code): cluster events into narrative units
     (a war start→end, a famine arc, a succession crisis, a hero's arc)
  → per chapter: build ChronicleRequest = ordered facts + involved personas
     + their recorded reasonings + causality links
  → LLM writes chapter (300–600 words), STRICTLY from provided facts
  → validator (rule code): named entities in output must exist in fact list;
     years mentioned must match; on violation → one retry with error note → else template fallback
  → chapter stored with anchors: [{year, region, eventId}] per paragraph
```

- Anchors make paragraphs clickable → time machine seek (01/07). Anchor mapping comes from the fact list, not parsed from prose : prose never becomes ground truth.
- **Era detection:** every ~50–100 years, a meta-pass names the era from dominant chapter themes ("The Grain Wars", "The Long Peace") and writes a 150-word era summary. Table of contents emerges.
- **Faction bias mode (cheap, high-wow):** re-render any chapter from a faction's perspective : same facts, biased system prompt ("you are the orc chronicler; Gruk is a hero"). Two histories, one truth, near-zero extra engineering.
- **Export:** full book → single markdown/HTML document, "The History of {Island}, Years 1–500".
- **Chapters are content, not view (critical):** generated chapters are stored in the save (save = journal + chronicle cache + config). Replay NEVER regenerates prose : regeneration would produce a different book every reload (LLM nondeterminism) and break the "history book your world wrote" promise. Faction-bias re-renders are additional stored chapters, not replacements.
- **Chapter input chunking:** max ~20 facts per ChronicleRequest; larger arcs split into multi-chapter sequences ("The Grain War, Part I–III"). Prevents prompt bloat → mush prose on long wars.
- **Temperatures pinned:** kings 0.7, chronicler 0.85 (prose deserves warmth; the entity/year validator catches excess).

### Hallucination stance
Chronicle text is presentation-layer only. It can be flowery; it must not be *wrong*: the entity/year validator catches the dangerous class of error (invented actors, wrong years). Stylistic embellishment ("as wars often do, it began with an insult at a wedding") is allowed when the insult-event is in the fact list.

### Tone guard (PG-13 war)
Chronicler and king-persona prompts carry a tone rule: razing, famine, massacre, and refugee suffering are stated plainly; war is poignant; but no gore, no torture detail, no atrocity relish. WorldBox register, not grimdark. Applies to both LLM and template prose.

## Budget & scheduling

| Consumer | Volume | Priority |
|---|---|---|
| King decisions | 8–12 / game-year (LLM reserved for dramatic decisions: war, peace, betrayal, succession, post-war terms; routine decisions delegated permanently to RuleBrain) | High (drama is time-sensitive) |
| Chronicle chapters | 2–5 / game-year | Low (batch during quiet ticks / pause) |
| Era summaries | 1 / 50–100 years | Lowest |

**Throughput math (honest):** ~4 s per decision on a 12B (1.5k prefill + ~200 tok out). 10 decisions/game-year ≈ 40 s GPU. Wall-clock per game-year: ~36 s at 1×, ~9 s at 4×, ~6 s at 16×. **The GPU saturates at any speed above ~1×.** This is a real product tradeoff, surfaced, not hidden:
- Deadline-fallback fires whenever inference misses the apply tick (journaled with `source: "fallback"`); at 16× kings are mostly RuleBrain with LLM cameos on the highest-priority decisions.
- Speed selector states it plainly: 1× "kings think deeply" / 4× "kings think quickly" / 16× "kings rule by instinct".
- Pausing lets the queue drain : pausing to read the chronicle also deepens the kings, a natural rhythm.
- `llmCoverage%` (decisions answered by LLM vs fallback, per speed) is a soak metric : coverage is measured, not assumed.

- Single queue in the browser adapter, priority-ordered, one in-flight request (12B on one GPU : no parallelism assumptions). Timeout 30 s → fallback.
- Chronicle catches up whenever it can ("chronicler is 3 years behind" indicator, 07); never blocks anything.

## Token budgets & cognitive load

| Call | Input | Output | 3060-class time (12B Q4) |
|---|---|---|---|
| King decision | ~1.5k (persona 300, memories 300, grudges 100, situation 400, options 150, format 250) | ~200 | ~8–9 s |
| Chronicle chapter | ~1.5k (≤20 facts + style) | 450–900 | ~15–30 s |
| Era summary | ~1k | ~250 | ~10 s |

Context never exceeds ~2.5k → KV cache trivial, VRAM = weights only; decode speed is the sole hardware constraint. Cognitive load is deliberately "judgment, not agency": **the rule engine does the perception (digest pre-chews the world into ~15 curated lines); the LLM does only single-shot constrained judgment.** No planning trees, no long-document reading : the task class where 4B is sensible and 12B adds voice, which is why the model floor is 4B. Degradation knobs if a model struggles (each lowers required intelligence AND latency): RuleBrain pre-filters options to top 4, memory cap 20→12, reasoning cap 80→50 words. No knob escalates toward bigger models.

## Latency fairness & budget GPUs

Design assumption: **slow inference is the norm.** Budget hardware reality (12B Q4): RTX 3060 12GB ≈ 25–35 tok/s (~8–10 s/decision), 8GB cards must drop to a 4B (~4–5 s), Apple silicon ~10–15 s, CPU-only → LLM-less mode. The fairness invariants below hold at ANY speed:

1. **Defense is never decision-gated.** Military response to invasion : mustering, garrisons, settlement defense : is automatic rule-layer behavior, firing the tick the threat appears. King decisions are strategic postures (declare, sue, set objectives), never reactions. A kingdom whose king is "still thinking" fights back at full competence. No faction can die of LLM latency.
2. **Uniform decision window.** Every request applies at exactly request-tick + W (same W for every faction, always). At the deadline: LLM answer if arrived, else RuleBrain : journaled either way. Equal thinking time by construction; and the fallback is a competent grudge-weighted strategist, not paralysis.
3. **Fair queue + measured coverage.** FIFO within priority (no faction reordering); per-faction `llmCoverage%` tracked, scheduler boosts the faction with the lowest historical coverage. Cross-faction coverage gap is a soak metric with an allowed band : bias is measured, not assumed away.
4. **Adaptive quota.** The adapter benchmarks the model at startup (one probe call) and sets the LLM decision quota to what the hardware sustains: slow GPU = LLM reserved for the biggest moments (war/peace/succession) at full coverage, everything else permanently RuleBrain. Fewer decisions at high coverage beats many at coin-flip coverage. UI states it: "council depth auto-tuned to your GPU."

## Eval harness (small, early)

Fixture-based: ~20 canned DecisionRequests + 10 ChronicleRequests with expected properties (valid choice; reasoning mentions ≥1 provided memory; chapter passes entity validator). Run against ollama on demand. Catches prompt regressions and model swaps (gemma4:12b → whatever's next) without eyeballing.

## Failure modes & handling

| Failure | Handling |
|---|---|
| ollama down / unreachable | RuleBrain everywhere; UI badge "kings ruling by instinct" |
| Malformed JSON | 1 retry with parse error appended → fallback |
| Invalid choice | fallback choice, keep reasoning discarded |
| Chronicle entity hallucination | 1 retry with violation note → template chapter |
| Queue overflow | drop lowest priority, journal the drop |
| GPU contention (other jobs) | adapter health-checks ollama; degrade gracefully, never queue-bomb |
