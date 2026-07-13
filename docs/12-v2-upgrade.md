# 12 : Chronica v2 Upgrade Plan (WorldBox-informed)

Status: APPROVED DIRECTION, execution-ready. This is the v2 analog of `08-roadmap.md`: the playbook a zero-context builder follows. Companion: `11-visual-polish.md` holds the detailed visual/UX designs that milestones below reference by section letter (11 §D means doc 11, section D).

## How to use this doc (read this first, zero-context builder)

You are upgrading Chronica, a SHIPPED v1.0 observer-only fantasy world sim (browser, TypeScript, Canvas2D, zero runtime deps). v1 works: deterministic sim core, LLM kings via local ollama, self-writing chronicle, time-machine replay. v2 makes it engaging for long sessions. Nothing here replaces v1 architecture; it extends it.

Required reading order before writing any code:
1. `CLAUDE.md` (repo rules)
2. `docs/00-vision.md` §anti-scope (BINDING: no player intervention mid-run, ever)
3. `docs/01-architecture.md` §determinism (INVIOLABLE in `/src/sim`)
4. `docs/11-visual-polish.md` (designs for every visual/UX item referenced below)
5. This doc, then the milestone you are building

Where things live:
- `/src/sim` : deterministic core. Engine `src/sim/engine.ts`, systems pipeline `src/sim/systems/index.ts` (FIXED execution order; append new systems deliberately), state `src/sim/state.ts`, decisions `src/sim/rules/decisions.ts`, RuleBrain fallback `src/sim/rules/ruleBrain.ts`, worldgen `src/sim/world/`.
- `/src/render` : camera, terrain chunk cache, sprite atlas, palette (DB32 only).
- `/src/main.ts` + `index.html` : app shell, panels, overlays, timeline, toasts. UI is vanilla DOM + CSS in index.html.
- `/src/brain` : ollama/BYO-key adapters + BrainQueue. LLM calls MUST pass `think: false` (gemma silently breaks otherwise).
- `/src/chronicle` : detector, validator, templates.
- `/src/simWorker.ts` : worker protocol between sim and UI. New UI data = extend `packUiSnapshot` here.
- `test/` : vitest. `scripts/lint-sim.mjs` bans Math.random/Date/performance.now in `/src/sim`. `scripts/perf.mjs` = true throughput. `scripts/eval-llm.mjs` = LLM eval harness.

Ground rules (violating any of these = do not merge):
- Determinism: world history is a pure function of (seed, decision journal). No wall-clock, no Math.random in `/src/sim`; named PRNG streams via `s.rng.get(name)`. No Math.sin/cos/pow in sim (engine-dependent floats): integer tables only.
- Every sim change: `npm test` green (36+ tests), plus a NEW test for the feature in the doc-10 style.
- Golden seeds: sim-behavior changes shift hashes. Re-baseline `test/golden.test.ts` ONLY as the last step of a milestone, in its own commit, after soaks pass.
- Balance: any change touching food/birth/war/expansion re-runs the 200-year no-extinction soak (`test/balance.test.ts` pattern, seed 42 minimum, all 4 races alive).
- The em-dash character is FORBIDDEN in this repo (code, docs, UI strings, commits). Use `:`, `,`, or `·`.
- Zero runtime dependencies. Hand-roll charts, no libs.
- Anti-scope: no god powers, no mid-run player intervention, no multiplayer. World-law dials (M12) are worldgen-time config ONLY.
- Commit per milestone chunk; message style follows git log (`M8: ...`).

Known landmines (cost v1 days; do not rediscover):
- Vitest MUST stay single-thread (`pool: 'threads', singleThread: true` in vite.config.ts): box has pthread limits.
- Background shells reset cwd: always `cd ~/brian/chronica` first. Use `./node_modules/.bin/tsc`, never bare `npx tsc`.
- Playwright fullPage screenshots of large canvases render blank (headless artifact): verify canvases via element screenshots or getImageData pixel sums.
- Ollama runs on GPU 0 (`~/ollama/serve.sh`), model gemma4:12b, needs `OLLAMA_ORIGINS=*`. NEVER touch other GPUs (other users' training jobs).
- The UI snapshot (`packUiSnapshot`) strips fields; if the UI "can't see" sim data, extend the snapshot, do not reach into sim state from UI.
- At 4x/16x speed, the 60-tick decision window closes before the LLM answers: instinct fallback fills in BY DESIGN. Test LLM-visible features at 1x.
- Dev servers likely already running: check `curl localhost:5183` before spawning new ones.

Verification per milestone: `npm test` + `node scripts/lint-sim.mjs` + `node scripts/perf.mjs` (>= 2000 t/s) + Playwright pass over the feature (screenshot evidence) + for sim milestones the soak. Exit criteria listed per milestone in §5.

Research base: four deep-dive reports on WorldBox: God Simulator (Maxim Karpenko, v0.51.4, 96% positive on ~29k Steam reviews, players logging 1,000-13,000 hours). WorldBox is our closest comparable: pixel god-sim ant farm, four classic races, kingdoms, wars, emergent history. Differences: WorldBox is rule-based with god-hand intervention; Chronica is observer-only with LLM kings, an LLM chronicle, and a deterministic time machine. The research answers: what makes their formula work for thousands of hours, where it fails, and what an observer-only LLM sim should copy, adapt, or reject.

## 1. The five lessons

**L1. The empire cycle is the engine.** WorldBox stays watchable because kingdoms rise, over-extend, rebel, collapse, and breakaway kingdoms restart the loop. Every peace decays. Where the cycle stalls (one kingdom blobs the map, homogenization), reviews say "boring": their #1 complaint. Chronica v1 has a HARD version of this disease: settlements never expand (see 11 §F), factions never split into lasting new kingdoms, borders freeze for 900 years.

**L2. Identity depth is the retention ceiling.** WorldBox's most-hyped update ever (0.50, "2+ years in development") added cultures, religions, languages, genes, clans, plots: identity systems, not disasters. Years of top complaints were "races feel identical, wars are samey". Retention correlates with how DIFFERENT the actors feel from each other.

**L3. Attachment converts watching into rooting.** The most-shared WorldBox stories are about individuals: a favorite unit's life, a king's dynasty, a legendary sword with a kill count. The game keeps adding attachment tools (favorites, renown, past-rulers lists, bookmarks, family trees) because they work.

**L4. Pure-observer must replace two god-hand functions.** Players use disasters to un-stick dull periods (drama cadence) and god powers to run experiments (hypothesis testing). WorldBox's own world laws and Age Clock are already a softer "director dial" layer. An observer sim needs: (a) a sim that guarantees drama cadence by itself, (b) worldgen-time levers for experiments.

**L5. One event, five representations.** WorldBox's presentation thesis: every entity exists as map pixels, overlay color, nameplate, inspectable window with graphs, and a history-feed voice: zoom level chooses which dominates. A war is simultaneously clashing sprites, shifting border colors, a notification, and a war window with stats. Doc 11 (D, G, H, I) is our implementation of this lesson; this doc assumes it ships.

**Our high ground, confirmed:** readable post-hoc history is a proven, under-served appetite. WorldBox players beg for chronicles and make timelapse videos as DIY substitutes; the game only has a filterable log. Chronica's LLM chronicle + time machine is the answer to their most-requested unmet need. v2 must protect and extend that lead, not chase feature parity.

## 2. Gap analysis: WorldBox vs Chronica v1

| System | WorldBox | Chronica v1 | Verdict |
|---|---|---|---|
| Empire cycle | rebellions, splits, fractures, breakaways, loyalty math | rebellion/split code exists but rare; expansion dead; 4 factions forever | **fix, P1** |
| Identity | cultures (77 traits), religions, languages, clans, subspecies | 4 races with stat/biome diffs | **adopt lite, P2** |
| Characters | traits, levels, items, favorites, families, renown | named chars + traits array, weakly surfaced | **surface, P3** |
| Drama cadence | god powers + ages + disasters | injectors only | **adopt ages, P4** |
| History | filterable log, past-rulers, war archive, graphs | LLM chronicle + time machine + event log | **we lead; extend** |
| War legibility | bannermen, capture bars, war names, war windows | invisible (11 §A/C5) | doc 11 |
| Info UX | inspectors, graphs, overlays, nameplates | minimal (11 §D-I) | doc 11 |
| God powers | 374 powers | none (anti-scope) | **reject, stay observer** |
| Genes/subspecies | full genome system | fixed races | reject: cost/payoff wrong for us |

## 3. V2 pillars

### P1. Perpetual drama engine (the empire cycle, fixed)

Goal: no century without a border change, a succession crisis, or a faction birth/death. All sim-side; every item needs determinism care + soak re-verification.

- **P1.1 Expansion fix** (11 §F): prosperity-driven settlement founding + EXPAND council option. Borders move again. Foundation for everything below.
- **P1.2 Loyalty system (WorldBox's best mechanic, adapted).** Per-settlement loyalty score with LEGIBLE modifiers: distance from capital, shared race vs mixed (refugees), leader's stewardship, tax pressure, war exhaustion, recent conquest, ruler age/legitimacy. Displayed in the settlement inspector as a signed list (exactly how WorldBox shows it). Loyalty < 0 arms the rebellion plot. Replaces the current opaque rebellion trigger.
- **P1.3 Real faction lifecycle.** Rebellion births a NEW faction (up to MAX_FACTIONS=8) with its own color/banner/name, not just a flipped settlement. Succession failure with no heir = kingdom fracture into independent settlements that re-coalesce. Conquest can absorb factions; extinction frees a faction slot for the next rebellion. The 4-kingdom stasis becomes a churning map of 2-8 kingdoms.
- **P1.4 Dynasties.** Royal bloodline per faction: named clan, family tree, succession rule (per culture, P2), legitimacy. Child kings, disputed successions, dynasty extinction = fracture risk. WorldBox clans prove bloodlines are cheap to track and huge for stories: "House Bloodcleaver ruled Bathakdush for 300 years" writes itself into the chronicle.
- **P1.5 War goals + capture progress.** Wars declare an objective (seize settlement, tribute, humiliation); visible capture-progress bar during sieges (WorldBox's stall-at-5%-until-defenders-die rule is good design: reads as "defenders holding"). Wars end by objective, exhaustion, or white peace. Kills the "war = vague attrition" feel.

### P2. Identity lite (cultures, not genomes)

WorldBox's 0.50 shipped genes, phenotypes, 204 subspecies traits. We copy the RESULT (factions feel different) at 10% of the cost, and let the LLM carry flavor the way their rule tables cannot.

- **P2.1 Cultures.** Each faction rolls a culture at worldgen (or on faction birth): naming style (already have per-race name tables; add per-culture), succession rule (eldest / most-renowned / election), war doctrine (raider / defensive / expansionist: biases RuleBrain weights AND the LLM king prompt), craft affinity, 2-3 value keywords ("honor, iron, grudges"). Culture keywords feed EVERY LLM prompt for that faction's kings and the chronicle's voice when narrating them. Cheap to sim, massive felt difference: this is where LLM beats WorldBox's cosmetic personality labels.
- **P2.2 Character traits that matter.** Named characters get 2-3 traits from a small table (ambitious, craven, cruel, pious, brilliant...) that (a) bias RuleBrain fallback choices, (b) enter the LLM king prompt verbatim, (c) are visible in the character sheet. WorldBox lesson: traits players can SEE on a portrait drive attachment.
- **P2.3 Legendary items (small).** Weapons earn kill counts; a blade that killed two kings gets a generated name and appears in chronicle text. WorldBox proves named items with kill counts are disproportionately shareable. Already on our post-MVP shelf; promote it.
- **NOT adopting:** religions and languages as mechanical systems (v3 candidates at best), genes/subspecies, spell combat, 113 creatures. Anti-scope holds.

### P3. Attachment machinery

- **P3.1 Follow + favorites.** Star any character; camera-follow; starred deaths become tier-1 events (H beacons + toast). WorldBox's single best attachment tool, nearly free for us.
- **P3.2 Character sheets + family trees.** Portrait, traits, kills, offices held, chronicle mentions (links!), genealogy view. Most data exists; UI in 11 §I3 style.
- **P3.3 Renown + records.** Characters and factions accrue renown from deeds; drives 11 §I5 world records and chronicle emphasis (high-renown = more chapter attention). One integer per entity, big narrative payoff.
- **P3.4 Hero arcs in the chronicle** (post-MVP shelf item, promoted): detector v2 clusters a named character's life events into "The Life of X" chapters when renown crosses a threshold. THE feature where LLM + attachment compound.

### P4. Observer drama dials (god powers, replaced honestly)

Determinism contract: dials are set at WORLD CREATION only (they are part of the seed/config, journaled), never mid-run. Mid-run intervention stays anti-scope.

- **P4.1 World laws at worldgen.** Landing screen "world laws" panel: injector toggles (already in config), aggression level, fertility, lifespan, disaster frequency, faction count/mix (11 §E4). This is the hypothesis-testing lever: "what if orcs, double disasters, harsh world?" Each combo is one deterministic, shareable seed+config.
- **P4.2 Ages/eras with teeth.** Chronica detects eras post-hoc for chapter titles; WorldBox's ages CAUSE things (Age of Chaos: loyalty crash; Age of Sun: droughts). Adapt: slow deterministic era wheel (from seed) that modulates pressure: climate swing decades, plague centuries, golden ages (fertility up, grudges decay). Guarantees macro rhythm even if politics stall; the chronicle narrates eras it already titles. Sim-side, config-gated (world law: "turning ages"), soak required.
- **P4.3 Time-lapse export** (shelf item, promoted): one-click video/GIF of N centuries (borders shifting, cities growing, H beacons flashing). WorldBox players hand-make these on YouTube; we can generate them from keyframes. THE shareable artifact for an observer sim.

### P5. Visual/UX overhaul = doc 11

D map mode, G history panel + timeline v2, H event spotlight, I statistics, A war readability, B living world, C4/C5 overlays. Adopt WorldBox specifics: zone-quantized chunky borders (8x8) for the political map look; "world becomes the minimap" at max zoom-out; bannerman-centric army rendering; capture-progress icons; overlay legend chips.

### P6. LLM moat, doubled down

WorldBox kings have cosmetic personality labels; ours REASON. v2 pushes LLM where rules cannot go:
- **P6.1 Culture-voiced kings** (P2.1 keywords in prompts): an "honor, iron, grudges" dwarf king reads differently from a "cunning, tides, profit" elf queen, with zero new sim mechanics.
- **P6.2 Procedural war names, LLM-flavored.** WorldBox: grammar tables ("War of Broken Bones"). Us: chronicler names wars from actual facts ("The Tribute War", "The Burning of Baarforge"), validator-checked, template fallback.
- **P6.3 Faction-biased chronicle** (shelf item #1): same facts, orc telling vs elf telling. No rule-based competitor can do this at all.
- **P6.4 Court intrigue narration.** When P1.2 loyalty plots arm, the LLM voices the rebel leader's grievance in the council panel (journaled like king decisions). Plots become readable drama, not silent state flips.

## 4. What we explicitly do NOT copy

- God powers / mid-run intervention of any kind (observer-only is the product).
- Unit possession, spells-as-combat, genes/subspecies, 100+ creature zoo, meme content (Crabzilla et al.).
- Their update-cadence trap: WorldBox shipped 0.50 after a 2.5-year drought and burned goodwill; we ship v2 in small verified milestones.

## 5. Milestones (strictly sequential; each ends with commit + green suite)

| Milestone | Contents | Est. | Risk |
|---|---|---|---|
| M7 comprehension | 11 §D+G+H+I1/I2 | ~4.5d | low (render/UI only) |
| M8 cycle | P1.1 + P1.2 + P1.5; 11 §A | ~4d | med: balance soaks |
| M9 politics | P1.3 + P1.4 | ~4d | high: faction churn, determinism |
| M10 identity | P2.1 + P2.2 + P6.1/P6.2; 11 §B | ~5d | med |
| M11 attachment | P3.1-P3.4 | ~4d | low-med |
| M12 dials + share | P4.1 + P4.2 + P4.3; 11 §E | ~5d | med: era balance |

### M7 : comprehension (render/UI only, zero sim changes, zero hash changes)
Build: far-zoom map mode (11 §D1-D3), history panel with Chronicle/Events/Councils tabs (11 §G1), timeline v2 with era bands + legend + two-stage strip (11 §G2), notification hierarchy + catch-up digest (11 §G3), event beacons + edge arrows + tier table (11 §H1-H3), stats tab with pop/territory/food charts (11 §I1), per-faction HUD chips (11 §I2), overlay legend chips + war overlay v2 render layers (11 §C5).
Exit criteria:
- Fresh eyes test at World zoom: 4 kingdoms identifiable by name + color within 5 seconds (screenshot proof).
- Every event reachable twice: scrollable Events tab (never truncated) and clickable timeline marker; legend explains every marker color.
- War declared while camera elsewhere produces: beacon, edge arrow, toast, minimap ping, timeline marker (Playwright-verified on a seeded war).
- Population chart shows visible war dip for a known war year; chart click seeks to that year.
- `sim` untouched: `git diff --stat src/sim` empty; all hashes identical to v1.0 baselines.

### M8 : the empire cycle
Build: prosperity expansion + EXPAND council option (11 §F fix candidates 1+3; touch `factionSystem.ts considerExpansion`, `decisions.ts councilOptions/applyDecision`, `ruleBrain.ts`), loyalty system (P1.2: new per-settlement field + legible modifier list in inspector; rebellion trigger reads loyalty), war goals + capture progress (P1.5: `War` gains objective; sieges tick capture bar; surface in war strip 11 §A3), war visuals (11 §A1-A5).
Exit criteria:
- Seed 42, 300y: settlement count grows from 4 to >= 8; at least one faction founds >= 2 settlements; no extinction; test added.
- Settlement inspector lists signed loyalty modifiers summing to the displayed total.
- Every war in a 300y run has a stated objective and ends by objective/exhaustion/peace (no perpetual wars); battles render banner units + clash VFX at 1x.
- Soak green, golden seeds re-baselined in final commit, perf >= 2000 t/s.

### M9 : politics (highest-risk milestone; smallest possible commits)
Build: rebellion births new faction up to MAX_FACTIONS=8 with color/banner/name (P1.3; audit every `factions[...]` loop and pairKey usage for dynamic count), fracture on heirless succession, faction absorption/extinction freeing slots, dynasties (P1.4: clan name, family tree data, succession rules, legitimacy; extend named-character storage).
Exit criteria:
- Engineered test world: rebellion creates faction #5 with working diplo/war/trade against all others; journal replay bit-identical.
- Heirless death fractures a 3+ settlement kingdom; chronicle writes succession-crisis chapter (template ok).
- 500y seed-42 soak: faction count varies over time (not monotonic to 1, not frozen at 4), >= 2 dynasty changes logged, zero race extinctions.
- Edge tests added: rebellion at maxPawns, fracture with 8 live factions, war ongoing during fracture.

### M10 : identity
Build: cultures (P2.1: worldgen-rolled per faction; naming style, succession rule, war doctrine biasing RuleBrain weights AND LLM prompts, value keywords), character traits (P2.2: 2-3 per named char, bias RuleBrain, verbatim in LLM prompts, in character sheet), LLM voicing (P6.1 culture keywords in king prompts, P6.2 chronicler names wars from facts w/ validator + template fallback), living world visuals (11 §B1-B5).
Exit criteria:
- Two same-race factions with different cultures produce measurably different war rates over 200y (test with mirrorMatch).
- King decision reasoning at 1x visibly reflects culture keywords + a personal trait (eval fixture added to `scripts/eval-llm.mjs`).
- War names appear in chronicle and war strip; validator rejects invented entities (test).
- Buildings tiered + race-flavored, crops show stages, work anims at Local zoom (screenshot set).

### M11 : attachment
Build: follow/favorites (P3.1: star characters, camera follow, starred deaths = tier-1), character sheets + family trees (P3.2), renown (P3.3: integer per named char/faction; feeds records I5 + chronicle emphasis), hero-arc chapters (P3.4: detector clusters a high-renown character's life into "The Life of X"; LLM prose w/ validator, template fallback).
Exit criteria:
- Follow a king for 50y at 4x: camera tracks, his death fires beacon + toast + camera release.
- Character sheet shows traits/kills/offices/chronicle mentions with working links; family tree renders 3 generations.
- A character crossing renown threshold gets a life chapter whose every fact validates against the event log (test).

### M12 : dials + shareability
Build: world-laws panel on landing (P4.1: injector toggles, aggression, fertility, lifespan, disaster frequency, faction mix 11 §E4; all journaled into config; hash covers config), era wheel (P4.2: deterministic from seed, config-gated default ON; eras modulate fertility/grudge-decay/disaster rates; chronicle narrates era turns), timelapse export (P4.3: render keyframes to webm/GIF client-side), worldgen variety E5 + optionally E1-E3 if budget allows.
Exit criteria:
- Same seed + same laws = identical hash; any law change = different journal header (test).
- 500y run shows >= 3 era transitions with visible macro effect (pop or war-rate shift in charts) and chronicle mentions.
- Timelapse of 200y exports < 30s, shows border churn (M8/M9 finally visible as spectacle).
- Full regression: all v1 exit criteria still hold (determinism, replay, time machine, LLM-less mode).

Ground rules apply every milestone: determinism suite green, golden re-baseline only at sim-changing milestones (M8-M10, M12) as a final separate commit, 200y soak per balance change, new doc-10 edge tests per feature.

## 6. Open questions for brainstorm

1. M7 first (comprehension, all render-side, 4.5d) vs M8 first (cycle, fixes "boring" at the root)? Recommendation: M7: cannot evaluate M8's drama without the lenses to see it.
2. Faction cap: stay at 8 (pairKey MAX_FACTIONS) or raise? 8 feels right for a 512 island; raising touches war/diplo storage everywhere.
3. Eras (P4.2): fully deterministic wheel from seed, or config-off by default? Purists may want "politics only" worlds.
4. Cultures (P2.1): rolled at worldgen only, or can rebellion-born factions mutate the parent culture (drift)? Drift is more alive; costs a mutation table + naming rules.
5. Scope guard: v2 as specced is ~26 dev-days + soaks. Cut line if needed: M12 > M11 > M10 (comprehension and cycle are non-negotiable).
