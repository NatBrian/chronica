# 08 : Implementation Roadmap (Execution Playbook)

> **READ THIS FIRST if you are implementing Chronica.** This document assumes ZERO prior context. It tells you what the project is, which design docs govern which code, and exactly what to build in what order. Follow milestones strictly in sequence : later milestones depend on earlier invariants.

## What you are building

**Chronica**: an observer-only fantasy world simulation running in the browser. A procedurally generated island; 4 races (humans, elves, dwarves, orcs) whose pawns farm, hunt, build, breed, and war over 500 simulated years : with three headline features:

1. **Thinking kings** : faction leaders make strategic decisions via a local LLM (ollama), reasoning visible to the player.
2. **Living chronicle** : an LLM historian writes the world's history book as it happens.
3. **Time machine** : the sim is strictly deterministic; seed + decision journal replays all history bit-identically; a timeline scrubber seeks to any year; chronicle paragraphs are click-to-seek anchors.

The product is watching and reading, not playing. No player powers exist.

## Design documents (the specs you implement)

All in `docs/`. Read 00 and 01 fully before writing any code. Read others when their milestone starts.

| Doc | Governs | Read before |
|---|---|---|
| `00-vision.md` | Product pillars, success criteria, anti-scope (what must NOT be built) | M0 |
| `01-architecture.md` | Stack, layout, tick loop, ECS storage, **determinism contract**, journal, time machine, deployment, novel-mechanism admission rules | M0 |
| `02-worldgen.md` | Island generation pipeline, validation, ore depletion | M0 |
| `03-agents.md` | Pawn needs, 3-layer action selection, advertisements, pathfinding, combat, lifecycle, named-character promotion | M1 |
| `04-society.md` | Races, factions, diplomacy states, economy invariants, war layers, causality DAG, balance philosophy, genetics, religion, refugees | M3 |
| `05-llm.md` | King decisions (catalog, digest, journaling), chronicler pipeline, token budgets, latency fairness, choice-quality guards | M4 |
| `06-rendering-assets.md` | Canvas renderer, zoom ladder, sprite templates + composition, DB32 palette, quality gates | M0 (renderer), M1 (sprites) |
| `07-ui-spectator.md` | Every UI component, keyboard map, polish standards, layout minimums | M2 onward |
| `09-landscape.md` | Competitive context (background reading only) | : |
| `10-edge-cases.md` | Edge-case registry : every entry needs a test before its class deadline (below) | M2 |

## Ground rules (violations are bugs, not style issues)

1. **Determinism is absolute in `/src/sim`.** No `Math.random`, no `Date`/`performance.now`, no float-dependent branching, fixed system execution order, seeded named PRNG streams only. Enforce with lint rules from the first commit. The determinism CI test (below) must exist before any sim feature.
2. **`/src/sim` imports nothing from `/src/render`, `/src/ui`, `/src/brain`.** The sim is a pure function of (state, journal). Enforce with lint.
3. **LLM outputs never enter the sim directly.** They are journaled decisions applied by `brainInboxSystem` at scheduled ticks (01 §LLM-as-journaled-input). The sim must run and be fun with the LLM completely absent : rule-based fallbacks are mandatory, not optional.
4. **Every invented (non-genre-proven) mechanism passes the admission rules** in 01 §Novel-mechanism admission rules: bounded, slow, observable, fail-duller, config-gated.
5. **Anti-scope is binding** (00): no player powers, no LLM-per-pawn, no multiplayer, no 3D, no mobile, no naval, no mod support. Do not "improve" the design with any of these.
6. **Zero backend.** Static bundle + client-side LLM adapters. Never add a server. (01 §Deployment)

## Stack (decided : do not re-litigate)

TypeScript strict, Vite, no framework in sim core; Preact (or vanilla) for UI panels; Canvas2D renderer; sim in a Web Worker (transferable ArrayBuffers, NOT SharedArrayBuffer); Vitest for tests; deploy = static hosting (Cloudflare Pages / Vercel / Netlify / GitHub Pages all fine). LLM: ollama via direct browser fetch (`localhost:11434`), plus BYO-API-key adapter, plus RuleBrain fallback.

## Testing contract (applies to every milestone)

- **Determinism suite** (exists from M0, runs in CI on every commit): (a) same seed run twice for 50y → identical state hash; (b) run 50y, seek back to 25y via keyframe, re-run to 50y → identical hash.
- **Golden-seed tests**: curated seeds with asserted outcomes, added as systems land.
- **Soak test**: headless 500-year run in CI; assert no NaN, no negative stockpiles, population within bounds.
- **Edge-case registry (10)**: every entry ships a test before its class deadline : F-class by M2 exit, D-class by M3 exit, L-class by M4 exit, A-class by M6 exit.
- A milestone is DONE only when its exit criteria are demonstrably true (run the check, don't assume).

## Milestones

### M0 : Skeleton & determinism rig
**Read first:** 00, 01, 02, 06 (renderer + zoom ladder sections).
**Build:**
- Vite + TS strict project, directory layout per 01 §Core layout, lint rules enforcing ground rules 1–2
- Seeded PRNG (PCG32 or xoshiro128**), named streams; fixed-timestep tick loop in a Web Worker; journal format (header: seed, simVersion, config; entries: decisions) : wired even though empty
- Worldgen v1 per 02: heightmap → hydrology → climate → biomes → resources → spawn sites → validation (reject-and-reroll, log rejection rate)
- Canvas renderer: terrain chunks, camera (pan/zoom-to-cursor, pixel-snapped), 4-level zoom ladder per 06
- Dev tools: worldgen layer viewer + seed browser (thumbnails for seeds 0–99)
- **Determinism CI test : the first test written in this repo**
**Exit criteria:** scrollable deterministic island; seed 42 generates identically twice (hash-verified); rejection rate logged <20%; CI green.

### M1 : Living pawns
**Read first:** 03 (all), 06 (sprite templates + quality gates).
**Build:**
- Pawn SoA storage (typed arrays per 01), needs decay, derived mood
- 3-layer action selection per 03: reflex bucket → utility over advertised offers (response curves, commitment bonus) → idle. Advertisement providers: granary, forage/hunt/fish sources, rest
- Flow-field movement (per-destination-cluster), staggered decisions (1/8 per tick)
- Birth/death minimal (age, starvation), soft-feedback birth-rate damping per 03
- Sprite templates v1 (pawns 4 races, basic terrain) via composition system + DB32 palette; sprite-preview dev page; run the 06 quality gates (silhouette, 1× readability)
- Inspector panel v1 (needs bars, current action + top-scored alternatives)
**Exit criteria:** 500 pawns forage/eat/rest/breed/die over 50y; population curve plausible (no extinction, no unbounded boom) on 10 golden seeds; determinism suite still green; sprites pass quality gates.

### M2 : Civilization + time machine
**Read first:** 03 (jobs, buildings), 07 (timeline, layout), 10 (F-class).
**Build:**
- Farming (seasons, crop stages, granaries), building (houses, construction stages), wood/stone gathering, `craftEquipment`
- Settlements, stockpiles, emergent jobs via faction-need advertisement weighting
- Weather + winter pressure per 02/04
- **Keyframe snapshots (every 10y) + timeline scrub UI v1** per 07 (hover preview, two-stage precision, instant-aggregate-then-refine seek)
- Autosave (rolling 3 slots, IndexedDB, checksums), save/load/export/import of journal
- Settlement-economy calibration test: isolated median village must show ~+10% food surplus (04 §Economy stability)
- **F-class edge tests (10): F1 array overflow, F2 autosave corruption, F3 keyframe quota, F4 multi-tab lock**
**Exit criteria:** a village survives 100y through winters; scrub to any year <2s perceived; exit app, reload, continue AND replay past; calibration invariant holds; F-class tests green.

### M3 : Factions, war, causality
**Read first:** 04 (all), 05 (decision catalog : you implement its RULE-ENGINE side now), 10 (D-class).
**Build:**
- 4 races with data-table stats (one table, no code branches per race : 04 §Engine fairness), spawn placement, territory
- Faction ledger + bounded grudges, diplomacy state machine (war/hostile/neutral/trade/alliance/vassal)
- Rule engine computing legal decision options + **RuleBrain** choosing among them (grudge-weighted scoring) : journaled exactly as LLM decisions will be (this same engine becomes the M4 fallback)
- War: campaign layer (conscription, objectives), squad combat (morale, rout contagion, leader-death shock per 03), automatic defense (never decision-gated, 04), exhaustion → truce, post-war terms
- Economy v1: numeraire prices, spoilage/wear sinks, trade caravans (physical, raidable), raid-EV tuning per 04
- Refugees, settlement razing, `settleNewVillage` expansion, succession + trait-outlier/hero/founder promotions, dynamic named cap
- **Causality DAG + event feed UI + causality chain view** (04/07)
- Light religion (god names, temples, piety→mood)
- Balance stage 1+2: settlement calibration (from M2) then **mirror-match soak** (100 seeds, 4 identical human factions : dominance must be flat before touching race asymmetry)
- **D-class edge tests (10): D1–D6**
**Exit criteria:** 200-year run produces ≥1 war with a complete clickable cause chain, zero LLM involved; mirror-match dominance flat within tolerance; D-class tests green; war-share of sim-years <60% on golden seeds.

### M4 : Thinking kings (LLM wave 1)
**Read first:** 05 (all), 10 (L-class).
**Build:**
- `Brain` adapter interface: OllamaBrain (grammar-constrained JSON via `format`), ByoKeyBrain, RuleBrain (already exists from M3 : same interface)
- Situation digest builder (~1.5k tokens: persona, pinned-landmark memories, grudges, situation, shuffled options, self-history)
- Journal application with uniform decision window, dead-actor voiding, one-pending-per-actor, late-response discard
- Fair queue (FIFO within priority, per-faction coverage boosting), adaptive quota from startup benchmark probe, circuit breaker (3 failures → instinct mode + health probe)
- Council panel UI per 07 (decision toast, reasoning display, auto-pause option)
- Eval harness: ~20 canned DecisionRequests asserting valid choice, memory-grounded reasoning, decision entropy; run against ollama on demand
- **L-class edge tests (10): L1–L3**
**Exit criteria:** king declares war with in-character reasoning citing real grudges; full replay of that run makes ZERO LLM calls and is hash-identical; LLM-off mode plays indistinguishably (RuleBrain); `llmCoverage%` logged per speed; L-class green. Also: re-run the competitive survey (09) : check AEON and new entrants.

### M5 : The Chronicle (LLM wave 2)
**Read first:** 05 (chronicler sections), 07 (chronicle panel, search).
**Build:**
- Chapter detector (rule code clustering DAG events into narrative units, ≤20 facts/chapter, arc splitting)
- Chronicler pipeline: LLM chapter writing (temp 0.85, PG-13 tone guard) → entity/year validator → retry → template fallback; era detection + naming; chapters STORED in save (never regenerated)
- Chronicle panel per 07: TOC, paragraph anchors → time-machine seek + camera move, lag indicator, export to standalone HTML/markdown
- Global search (`/`): characters, places, events, chapters → jump targets
- Chapter-completion toasts; follow-cam death handling
**Exit criteria:** 300-year run yields a readable exported history book; every chapter passes the entity/year validator or is a marked template; click a war paragraph → land at that year/place watching it; book identical after reload (stored, not regenerated).

### M6 : Depth, balance, polish (MVP ship gate)
**Read first:** 04 (injectors), 07 (polish standards, keymap, layout minimums), 00 (success criteria), 10 (A-class).
**Build:**
- Pressure injectors: wolves/troll/dragon (wealth-targeted), drought, plague (caravan-borne SIR-lite), forest fire, harsh winter : seeded schedules, injector cadence per 04
- Genetics visible in dynasties (inheritance, drift, inbreeding penalty)
- Statistical LOD (aggregate off-screen regions, calibration tests vs full sim; sim-side triggers only : camera never affects sim state)
- Performance pass to budgets (01/06): 2k full-sim pawns, 60fps render, ≥2k ticks/s headless
- Full spectator polish per 07: overlays, minimap, onboarding hints, postcard mode, keyboard map, layout minimums, A11y items
- Balance stage 3: 100-seed race soak : per-race dominance within [10%, 40%], no >60% war-share, hegemons rise AND fall, extinction rare/late; tune data tables until green
- **A-class edge test (10): A1 background tab**
**Exit criteria = 00 §Success criteria, verified:** 500y runs complete without extinction/stale equilibrium in >80% of seeds; replay bit-identical; chronicle readable + consistent; 2k pawns at 60fps; demo script below works end to end.

### Ship (after M6)
Deploy static bundle to Cloudflare Pages (or Vercel/Netlify). Verify: cold load <5s, LLM-less mode fully playable, ollama detection + one-line setup hint works, BYO-key flow works, journal export/import round-trips. Tag v1.0.

### Post-MVP shelf (do NOT build before ship)
Faction-biased chronicle rendering → hero-arc detectors v2 → myth drift (builds on stored god names/temple records) → Claude-quality chronicle pass → named legendary weapons → timelapse export → WebGL2 renderer → configurable faction mixes → climate drift injector → branch-from-past worlds → god-mode powers (thin layer over debug injectors).

## Dependency spine (why the order is fixed)

```
M0 determinism ──► M2 time machine ──► M5 chronicle anchors
M3 event DAG   ──► M4 king context ──► M5 chronicle facts
M3 rule engine ──► M4 RuleBrain fallback (same interface, zero throwaway)
M2 economy calibration ──► M3 mirror-match ──► M6 race soak (never tune out of order)
```

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Determinism leak (stray float/iteration-order bug) | Fatal to time machine | CI hash tests from M0; lint bans; fixed system order; bisect harness for divergence hunting |
| Boring equilibrium (nothing happens) | Kills the product | Pressure injectors; asymmetric races; scarcity-by-design maps; drama metrics in soak (wars/century, faction turnover) |
| Extinction spirals | High | Soft feedback (birth-rate dips before deaths); golden-seed tests from M1 |
| 12B model too weak for personas | Medium | Constrained JSON choices; tight personas; eval fixtures; adapter allows model swap; RuleBrain is already decent |
| Chronicle hallucination breaks trust | Medium | Entity/year validator; facts-only prompts; prose is presentation-only, never state |
| Canvas2D perf wall | Medium | Chunk baking + LOD first; renderer interface ready for WebGL2 swap |
| GPU too slow / absent on user machines | Medium | Adaptive quota, fairness invariants (05), LLM-less first-class mode |
| Competitor ships deciding-LLM sim first (see 09) | Low-Med | Speed via strict milestone focus; moats are craft (chronicle quality, determinism discipline, click-to-seek UX); re-survey at M4 |
| Scope creep | Chronic | Post-MVP shelf is a hard wall; anti-scope in 00 is binding |

## Definition of "wow achieved" (final demo script : must work before calling the project done)

Open a world at year 213, paused on a council panel: King Gruk's in-character reasoning for declaring war, citing a 12-year-old grudge → unpause, watch the raid burn Elmwood → open the chronicle, read the chapter the historian wrote about it → click the paragraph's first sentence → the time machine rewinds 12 years → watch the original insult happen at the wedding. If that clip works end to end, everything else is polish.
