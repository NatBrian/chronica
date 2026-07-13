# 01 : Architecture & Engine

## Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Browser, single-page app. No framework for the sim; a thin UI layer (Preact or vanilla) for panels.
- **Rendering:** Canvas2D first (WebGL2 escape hatch if profiling demands it : see 06)
- **Build:** Vite. Zero runtime dependencies in the sim core (bitECS or hand-rolled SoA arrays are the only candidates; decide at implementation after a spike).
- **Sim execution:** Web Worker from M0. Sim ticks in a worker; render thread receives snapshots via transferable ArrayBuffers (copy-per-frame is cheap at our state size). `SharedArrayBuffer` is a profiling-driven upgrade only : it demands COOP/COEP headers that complicate static hosting (breaks GitHub Pages) for a win we likely don't need.
- **No backend.** The app is a static bundle; sim, saves (IndexedDB + file export), and LLM adapters all run client-side. See §Deployment.

## Core layout

```
/src
  /sim          # pure deterministic core : NO DOM, NO Date, NO Math.random
    /ecs        # entity storage, component arrays, queries
    /systems    # tick systems in fixed order
    /world      # map data, worldgen output
    /events     # event log, causality DAG
    /rng        # seeded PRNG streams
  /brain        # LLM adapters (ollama / BYO-key / RuleBrain fallback), async, outside tick
  /render       # canvas renderer, camera, sprites
  /ui           # panels: timeline, event feed, chronicle, inspector
  /shared       # types, constants, serialization
```

## Deployment (zero backend)

- **Static bundle** (Vite build) deployable free on Cloudflare Pages / Vercel / Netlify / GitHub Pages. No server compute, no database, no accounts. Bandwidth per visitor ≈ one <5 MB bundle.
- **Saves:** IndexedDB locally + journal export/import as file (sharing a world = sharing a <1 MB file).
- **LLM adapters, all client-side** (detail in 05): none (RuleBrain, default) / visitor's local ollama via direct browser→`localhost:11434` (needs `OLLAMA_ORIGINS` set; one-line instruction shown in UI; localhost is exempt from mixed-content blocking) / BYO API key (OpenRouter/Anthropic CORS-enabled, key in localStorage). We never host inference.
- Avoiding SharedArrayBuffer (above) keeps hosting header-free : deployable anywhere that serves files.

**Import rule (enforced by lint):** `/sim` imports nothing from `/render`, `/ui`, `/brain`. The sim core is a pure function of (state, journal) → state.

## Entity-component storage

Data-oriented, Structure-of-Arrays. Pawns are indices into typed arrays, not objects:

```ts
// conceptual shape : real impl decided at spike
const pawn = {
  x: new Int16Array(MAX_PAWNS),
  y: new Int16Array(MAX_PAWNS),
  hp: new Uint8Array(MAX_PAWNS),
  hunger: new Uint8Array(MAX_PAWNS),
  age: new Uint16Array(MAX_PAWNS),      // in ticks
  factionId: new Uint8Array(MAX_PAWNS),
  jobId: new Uint8Array(MAX_PAWNS),
  flags: new Uint8Array(MAX_PAWNS),     // alive, pregnant, fighting...
}
```

Why: 10k pawns × object-per-pawn = GC pressure and cache misses. Typed arrays give flat memory, trivial snapshotting (copy the buffers), and trivial worker transfer.

Named characters (kings, heroes : tens, not thousands) get an additional rich object store keyed by pawn index: name, memories, grudges, LLM decision history. Two-tier storage: hot data flat, story data on the side.

## Tick loop

- **Fixed timestep.** 1 tick = 1 sim-day. 360 ticks = 1 year. Target 10–60 ticks/sec wall-clock depending on speed setting (pause / 1× / 4× / 16×).
- **Fixed system order.** Systems run in a hard-coded sequence every tick. Order is part of the determinism contract : reordering systems is a save-breaking change.

```
tick(n):
  1. calendarSystem      (season, year rollover)
  2. weatherSystem       (rain, drought, winter severity)
  3. cropSystem          (growth, harvest readiness)
  4. needsSystem         (hunger/energy decay, aging)
  5. brainInboxSystem    (apply journaled LLM decisions scheduled for this tick)
  6. utilityAISystem     (pawns pick actions)
  7. pathMoveSystem      (flow-field movement)
  8. workSystem          (farm, chop, build, haul)
  9. combatSystem        (battles, raids, casualties)
 10. birthDeathSystem    (procreation, starvation, aging out)
 11. factionSystem       (territory, leadership succession, diplomacy state)
 12. economySystem       (stockpiles, prices, trade caravans)
 13. eventDetectSystem   (emit events: war declared, famine, hero deed)
 14. lodSystem           (promote/demote regions between full and statistical sim)
 15. snapshotSystem      (keyframe every N years)
```

## Determinism contract (the time machine's foundation)

This is the most important architectural decision. **World history = f(seed, decision journal).** Nothing else.

Rules:

1. **Seeded PRNG only.** One root seed; each system gets its own named PRNG stream (`rng.combat`, `rng.births`, ...) derived from it. Separate streams so adding a random call in one system doesn't shift every other system's sequence. Implementation: PCG32 or xoshiro128** : fast, seedable, well-understood. `Math.random` is lint-banned in `/sim`.
2. **No wall-clock.** `Date.now()`, `performance.now()` banned in `/sim`. Time is tick count.
3. **Integer-dominant state.** Positions, HP, stockpiles are integers. Where fractions are needed (prices, growth), use fixed-point integers (value × 1000). Float arithmetic is allowed only where results never feed back into branching sim logic (e.g., render interpolation).
4. **Deterministic iteration.** No iteration over `Map`/`Set` insertion-order-sensitive collections in ways that vary; entity processing is always ascending index order.
5. **LLM outputs are journaled inputs.** The sim never calls an LLM inline. See below.

### The LLM nondeterminism problem : solved by journaling

LLM outputs vary run-to-run. If king decisions were inline calls, replay would diverge. Solution: treat LLM decisions exactly like a recorded player-input stream.

```
Live run:
  tick 4820: kingAI wants a decision for King Gruk
    → sim emits DecisionRequest(gruk, situationDigest) and continues with NO decision this tick
    → /brain (async, outside sim) calls ollama, gets decision
    → decision is appended to the journal as {applyAtTick: 4823, actorId, decision}
    → brainInboxSystem applies it at tick 4823

Replay:
  brainInboxSystem reads the SAME journal entry at tick 4823. No LLM call. Bit-identical.
```

The journal (seed + all decision entries + world-config) IS the save file. A 500-year history with ~50 named characters is a few hundred KB of JSON. Sharing a world = sharing a tiny file.

**Latency rule:** decisions apply 1–5 ticks after request. The sim never waits. If the LLM is slow or absent, the rule-based fallback produces the decision instead (and is journaled identically, flagged `source: "fallback"`).

**Dead-actor rule:** if the actor dies (or loses office) between request and apply tick, the journal entry is void : `brainInboxSystem` checks actor validity before applying. Voided entries stay in the journal (marked void) so replay remains bit-identical.

**Journal versioning:** replay = same code + same inputs. Any sim-logic change invalidates old journals. The journal header carries `simVersion`; loading a mismatched journal offers keyframe-resume (continue live from last snapshot, replay-into-past disabled) instead of silent divergence. Policy stated honestly: full time-machine portability is guaranteed within a sim version, not across versions.

## Time machine mechanics

- **Keyframes:** full state snapshot (compressed typed-array copy) every 10 sim-years. ~2–5 MB each raw, less gzipped; ring-buffer or IndexedDB storage.
- **Seek to year Y:** load nearest keyframe ≤ Y, fast-forward ticks silently (no render) to Y. Fast-forward budget: sim-only ticking should exceed 2,000 ticks/sec, so worst-case seek (10 years = 3,600 ticks) < 2 s.
- **Scrub UI:** timeline slider with event markers. Chronicle paragraphs carry `{year, region}` anchors → click = seek + camera move.
- **Replay integrity check (CI test):** run seed X for 50 years twice, hash final state, must match. Run, snapshot at year 25, seek back, re-run to 50, hash must match. These tests are the determinism tripwire and run on every commit.

## LOD simulation (scale strategy)

Two simulation fidelities:

- **Full sim:** regions near camera or containing named characters / active wars. Pawns tick individually.
- **Statistical sim:** everything else. Village-level aggregates (population, food, births/deaths as rates, war resolved by Lanchester-style attrition math).

Promotion/demotion at region granularity with hysteresis (no flip-flopping). Aggregate math must be tuned so a village simulated statistically for 50 years ends up roughly where full sim would put it (calibration tests). Determinism note: LOD state (which regions are full) depends only on sim state + camera... **no.** Camera is nondeterministic input. Fix: LOD promotion by camera affects *render detail only*; simulation fidelity switches are driven purely by sim-side triggers (named characters, wars, chronicle-worthy events), which are deterministic. Camera never influences sim state. This distinction is critical and worth the extra care.

## Performance budgets

| Thing | Budget |
|---|---|
| Pawns (full sim) | 2,000 target, 5,000 stretch |
| Total population incl. statistical | 20,000+ |
| Map | 512×512 tiles (one island) |
| Tick rate (16× speed) | ≥ 60 ticks/sec |
| Sim-only fast-forward | ≥ 2,000 ticks/sec |
| Frame rate | 60 fps render, decoupled from tick rate |
| Save file (journal) | < 1 MB for 500 years |

## Novel-mechanism admission rules

Genre-proven systems (needs, utility AI, trade, war) carry retired risk. Any mechanism WE invent (ore depletion/prospecting, grudge gravity, coalition fear, myth drift...) must satisfy ALL of these before entering the sim:

1. **Bounded.** Every value clamped; growth monotonic or capped. A vein only shrinks; discovery only adds finite seeded veins. No quantity in the mechanism can run away.
2. **Slow.** The mechanism's rate of change is slower than our observation cadence : century-scale loops (depletion ≈ 100–150y) show drift in a 500-year soak long before they cascade. No invented mechanism may operate on a faster clock than the systems it feeds.
3. **Observable.** Ships with a named metric in the soak-test report (e.g. `oreSupplyPerFaction` over time). If we can't chart it, we can't trust it : no metric, no merge.
4. **Fail-duller, not fail-broken.** Designed so misbehavior degrades toward boredom, never explosion: all ore gone → dwarves trade/farm poorly (dull, survivable), not economy NaN. Bounds + fallback paths make the worst case a stale mechanic, not a dead world.
5. **Config-gated at world creation.** Novel mechanisms get an on/off flag in world config (part of the journal header, so determinism holds per-config). A misbehaving mechanism can be disabled for new worlds without code surgery.

Worldgen-time inventions (Gini targets, spawn scoring) are exempt from 2–5: they run once at genesis, their output is static and fully inspectable in the seed browser before any tick executes : worst case is a rejected map, never a runtime surprise.

## Testing strategy

- **Determinism suite** (described above) : the non-negotiable one
- **Golden-seed tests:** curated seeds with asserted outcomes ("seed 42: no extinction by year 100, ≥2 factions survive")
- **System unit tests:** pure functions, easy because sim core has no I/O
- **Calibration tests:** statistical-sim vs full-sim drift bounds
- **Soak test:** 500-year headless run in CI, assert no NaN, no negative stockpiles, population within sane bounds
