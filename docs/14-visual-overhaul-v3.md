# 14 : Visual Overhaul v3 : "The WorldBox Gap"

Full visual/UI refactor plan. Written for an implementer with zero prior context.
Read this document top to bottom before writing any code.

Goal: close the presentation gap between Chronica and polished observer sims
(reference: WorldBox) without touching simulation logic. Chronica is observer
only: the player watches, reads, and scrubs history. Presentation IS the game.
Every task below serves one test: "would a stranger watch this world for ten
minutes and take a screenshot to share?"

---

## 0. Orientation for a zero-context implementer

What this project is: a deterministic fantasy world simulation running in a Web
Worker, rendered on Canvas2D on the main thread, with an LLM-optional king AI
and a self-writing history book. TypeScript strict, Vite, ZERO runtime deps,
no image files: every sprite is procedurally baked into offscreen canvas
atlases at boot from character-grid templates.

Commands:

- `npm install`, then `npm run dev` (Vite, add `--host 0.0.0.0` if remote)
- `npm test` = sim import/determinism lint + full vitest suite. Must stay green.
- `npm run lint:sim` = boundary lint only
- `node scripts/perf.mjs` = sim throughput gate
- Dev pages: `/?dev=sprites` (pawn atlas preview), `/?dev=layers&seed=N`
  (worldgen layers), `/?dev=seeds` (seed browser)

File map (all paths relative to repo root):

| Area | Files |
|---|---|
| Entry / frame loop / ALL DOM panel rendering | `src/main.ts` (2333 lines) |
| Worker: sim loop + snapshot protocol | `src/simWorker.ts` |
| Terrain bake + per-tile color + decoration | `src/render/terrain.ts` |
| Pawn sprite atlas | `src/render/sprites.ts` |
| Settlement/building/monster/glyph atlases | `src/render/mapIcons.ts` |
| Far-zoom map mode (territory, labels, war) | `src/render/mapMode.ts` |
| Event choreography (battles, dragons, ...) | `src/render/spectacle.ts` |
| Smoke/weather/roads/birds | `src/render/ambience.ts` |
| Camera + zoom ladder | `src/render/camera.ts` |
| Palette (single source of truth) | `src/render/palette.ts` |
| Event category/glyph/color/tier table | `src/ui/eventMeta.ts` |
| Beacons/pins/edge arrows | `src/ui/beacons.ts` |
| Stats canvas charts | `src/ui/statsCharts.ts` |
| All CSS (single inline style block) + DOM skeleton | `index.html` |
| Deterministic sim (DO NOT TOUCH) | `src/sim/**` |

Inviolable constraints (from `docs/01-architecture.md`, `docs/13-visual-overhaul.md`,
`CLAUDE.md`):

1. `/src/sim` is deterministic and layer-isolated. `scripts/lint-sim.mjs`
   enforces it. This refactor must not modify any file in `src/sim/` and must
   not change the `WorkerSnapshot` message shape in `src/simWorker.ts` unless a
   task below explicitly says how (only additive, render-only fields, and only
   if unavoidable).
2. All visual effects must be pure functions of (event log, snapshot, rAF
   clock) so time-machine scrubbing replays identically. No `Math.random()` in
   anything that must replay; use `fnv1a(x, y, seed)` hashing (see
   `src/sim/rng/rng.ts`, imported render-side already).
3. Terrain drawing stays bake-time (offscreen chunk canvases). Per-frame work
   is blit only. Rebakes happen at season boundaries (4/year) and zoom changes.
4. Performance gate: 60fps at Region zoom with 2000+ pawns on a mid laptop;
   particle pool stays capped (300).
5. The em-dash character is forbidden in this repo (code, docs, UI strings,
   commits).
6. Anti-scope (`docs/00-vision.md`): no player control of the sim, no new sim
   features. This is presentation only.
7. Keep `npm test` green after every task. New visual behavior needs no unit
   tests, but nothing existing may break.

Verification workflow used throughout: run the app headless with Playwright
(devDependency only; see Phase 0 task) and capture screenshots at fixed seeds,
zooms, and years. Compare before/after. Keep captures out of git except the
final ones that replace `docs/screenshots/`.

---

## 1. Repository assessment (current state)

Rendering is competent engineering with weak art direction. The v2.5 overhaul
(V1-V6, all shipped) built the right machinery: chunked terrain cache with a
bake-time decoration pass, sprite atlases, a far-zoom map mode, an event
spectacle engine, ambience layers, beacons, and a tabbed chronicle rail. The
machinery is not the problem. What the machinery draws is the problem.

Verified by running the app (seed 42 and seed "valemont", years 0-59, all zoom
levels, all tabs, overlays, dev pages):

- Terrain reads as flat noise. At every zoom below 16 px/tile the island is
  large murky fields of olive (Steppe/Grassland) and brown (Hills) with a grey
  blob of Mountain. Shorelines are hard beige bands. Water is a flat blue with
  sparse pixel dots. The V3 decoration pass (tufts, flowers, trees) is nearly
  invisible: single dark pixels on flat green.
- Settlements do not look like places. Buildings are 1-tile 8x8 sprites (tiny
  identical red-roof cottages) scattered on a sparse grid with no roads, no
  center, no wall reading, no growth silhouette. A 400-soul capital at Year 59
  looks like the Year 5 hamlet, only with more confetti. WorldBox villages read
  as villages because houses are multi-tile, connected by paths, and clustered.
- Pawns are near-invisible and lifeless. 1px dots at region zoom, 8x12 static
  sprites up close (`sprites.ts` BODY templates), one shared standing pose for
  every state (walking, farming, fighting, fleeing all look identical except a
  1px bob), job "accessories" are 1-2 pixel overlays nobody can read, the
  child variant is a degraded 70% resample of the adult template, and there is
  no facing, no death visual, no carried goods.
- Monsters are map icons, not creatures. The dragon template in `mapIcons.ts`
  is 12x6 pixels, the troll 8x6, the wolf 7x4, drawn statically at every zoom.
  A dragon attack (the sim's apex event) reads as a small dark smudge.
- Combat is invisible. Engagements render as a crossed-swords glyph over a
  dust ellipse (`main.ts` squad pass); no individual fighters, no weapon
  swings, no projectiles, no hits, no blood, no corpses, no aftermath on the
  ground. Wars, the main story driver, produce almost no pixels.
- Visual effects are choreographed but under-dressed. `spectacle.ts` has 12
  well-structured scenes (shake, flash, letterbox: good bones), but scene
  actors are the same tiny glyphs, effects are thin vector strokes over murky
  terrain, and outside scenes the world has almost no impact feedback (razing
  smoke and rain/snow exist; fire has no glow, weather has no ground contact,
  nothing leaves marks).
- Far map mode: settlement icons are near-black blobs, territory borders are
  1px faint lines, the map is dominated by the brown interior. It is the most
  watched zoom level and the least attractive.
- UI is a generic dark web app: flat slate panels, system font, blue accents.
  Worse, icon glyphs render as tofu boxes on machines without an emoji font
  (seen in the HUD "kings ruling by instinct" line, overlay bar buttons, world
  records list, minimap buttons). eventMeta.ts still hands emoji to the DOM.
- The timeline is a thin dark strip with 2px colored dots. It encodes eras and
  event clusters but communicates almost nothing visually.
- Landing page is clean but generic; the worldgen preview canvas is the only
  hook, framed like a form control.
- Minor UX rot: the "WHY THIS HAPPENED" panel persists for decades of sim time
  once opened; default camera at Begin History centers on empty steppe rather
  than a settlement; chronicle rail is closed by default so the headline
  feature (the history book) is invisible on first run.

What is genuinely good and must not regress: chronicle prose + typography,
stats charts, event feed information density, the spectacle/beacon system's
event choreography, snapshot/replay integrity, 60fps headroom, mobile safe-area
work, and the fact that everything is procedural (no asset licensing, no
loading).

---

## 2. Visual comparison analysis (Chronica vs WorldBox)

Inspected 12 WorldBox references (Steam press shots, kingdom menu, kingdoms
list) side by side with 17 fresh Chronica captures.

| Dimension | WorldBox | Chronica today | Principle to adopt |
|---|---|---|---|
| Base palette | Saturated, warm. Grass is bright spring green, ocean is two-band blue, sand is cream | Muddy DB32 mids: olive grass, brown hills, grey mountains dominate the island | Terrain base colors carry the mood; decoration is seasoning, not the fix. Re-ramp biome colors first |
| Water | Two blues + shallow shelf, checker dither texture, foam edge, boats leave wakes | Flat single blue, no shelf gradient, no dither, static | Cheap texture (ordered dither + shore foam + animated sparkle rows) makes 40% of the screen alive |
| Terrain texture | Subtle checkerboard/dither everywhere, cloud shadows drift over | Large flat color rectangles with hard quantization edges | Break flatness with 2-3% luminance dither and drifting cloud-shadow layer |
| Buildings | Multi-tile (2x2 to 5x5), strong silhouettes, kingdom-colored roofs, race-specific architecture, chimneys and doors readable | 1-tile cottages, identical, faction color only on a 3px pennant | Buildings are the #1 read of civilization. Multi-tile sprites, roof = faction color, race style sets |
| Settlement layout | Houses cluster around a center, dirt paths connect them, farms are golden crop patches, watchtowers on edges | Sparse grid, no paths, farm rows are 1px lines, no landmark center | Draw path network + plaza + prominent center building; make farms solid readable fields |
| Units | Small but readable: weapon accessories, banners, formation clumps | 1-3px rects or static 8x12 sprite | Bigger sprites at close zoom, animation frames per state, army banner chips at region zoom |
| Monsters | Multi-tile creatures with personality: giant crab spans 6+ tiles, casts a water shadow, snaps; dragons breathe visible fire cones | 12x6 px dragon glyph, static | Monsters are events. Multi-tile animated sprites + ground shadow + signature attack VFX per kind |
| Combat feedback | Units visibly clash: weapon flashes, arrows fly, corpses and blood pixels persist, houses burn with per-stage flames | Crossed-swords icon + dust ellipse | Render the fight: duel pairs, projectile trails, hit sparks, fading corpse/blood decals, burning-building stages |
| Death/aftermath | Razed towns leave rubble + scorch, battlefields stay scarred | Razed flag exists in sim; ground shows nothing | Persistent-but-fading decals keyed to events (replay-safe) |
| Effects | Bright saturated fire/explosions, divine beams, smoke plumes; effects are focal points | Spectacle engine exists and is good, but scenes sit on murky terrain so they do not pop | Keep engine; raise contrast of scene VFX and ground them with scorch/light |
| Far view | Colorful painted-map feel, kingdom banners, capital stars | Brown interior, black blob icons, faint borders | Far map is a poster: brighten biome cartography, sigil-style settlement icons, thick tinted territory fills |
| UI chrome | Diegetic pixel art: stone slab panels, gold/orange numbers, banner sigils per kingdom, portrait frames, chunky icon buttons with tabs | Generic dark web panels, system font, emoji/tofu icons | Restyle DOM chrome as parchment/stone fantasy UI with a drawn icon set; keep DOM tech |
| Identity | Each kingdom has banner color + sigil animal; you recognize it everywhere | Faction color chips only | Banner sigil system reused in HUD, map labels, war strip, chronicle |
| Atmosphere | Vignette, cloud shadows, biome color variety creates memorable geography | Season tint exists; no vignette/clouds; geography reads uniform | Add cheap atmosphere layers; they cost almost nothing and unify the frame |

### 2b. The ants problem (root-cause analysis)

One-line diagnosis of the current experience: watching Chronica feels like
watching ants fight, move, and stack blocks; watching WorldBox feels like
watching a civilization advance toward prosperity and war. Sprite quality is
only a third of that gap. The other two thirds:

1. Uniform scale, no hierarchy. Every object is roughly one tile and every
   pawn is equally prominent, so nothing is a landmark and nothing is an
   extra. Civilizations read through hierarchy: a keep towers over houses,
   a king stands out from farmers, a capital dwarfs a hamlet, roads and
   bridges knit settlements into a network. Chronica renders a flat crowd.
2. Motion is noise, not intent. Hundreds of identical dots drift in random
   directions at all times. In WorldBox most villagers potter locally around
   town while the motion that crosses the map is meaningful (armies, ships,
   migrations), so your eye is pulled to story. In Chronica signal and noise
   are rendered identically.
3. No visible arc of progress. A Chronica capital at Year 150 draws the same
   pixels as its Year 5 founding camp, only denser. Nothing on screen says
   "this people prospered", "this town is dying", "an age has turned". The
   sim computes all of it (population, stockpiles, eras, loyalty, wars); the
   renderer throws that story away.

Phase 3b below exists specifically to fix these three. Additional comparison
rows:

| Dimension | WorldBox | Chronica today | Principle to adopt |
|---|---|---|---|
| Progress arc | Towns visibly age and enrich: bigger houses, walls, statues, harbors accrete | Same building sprites forever; only count grows | Prosperity tiers: architecture upgrades with settlement wealth/era (render-only) |
| Motion legibility | Local potter + meaningful travelers (armies, ships) | Every pawn wanders the map identically | Motion hierarchy: suppress idle noise, stage workers at worksites, let only story actors travel far |
| Network | Roads, bridges, harbors connect towns into one economy | Settlements are islands in empty terrain | Render the existing trade routes as worn roads with caravan wagons and river bridges |
| Protagonists | Kings/heroes visually distinct, tracked by players | namedPos data exists; renders as one more dot | Name banners, cloaks, retinues for named characters |

Why WorldBox looks polished, reduced to five rules:

1. Bright, saturated base colors with tiny-amplitude texture on top.
2. Silhouette first: any object bigger than a tile gets a readable outline.
3. Identity through color + sigil, repeated in world and UI.
4. The UI is part of the world (pixel chrome), not an admin dashboard on top.
5. One or two moving accents in every frame (fire, birds, wakes, clouds).

---

## 3. Identified problems (concrete, ranked)

P0 = kills first impression. P1 = kills retention. P2 = polish.

- P0-1 Murky biome base colors (`terrain.ts` tileColor ramps for Grassland,
  Steppe, Hills, Mountain).
- P0-2 One-tile identical buildings, no roads/plaza/wall silhouette
  (`mapIcons.ts` bakeBuildingAtlas, `main.ts` drawDynamic building pass).
- P0-3 Tofu/emoji glyphs across DOM UI (`eventMeta.ts` glyph strings, HUD,
  overlay bar, records, minimap buttons).
- P0-4 Generic web-app chrome (all styling in `index.html` style block).
- P0-5 Far map: black-blob settlement icons, faint borders, brown cartography
  (`mapMode.ts`, `mapIcons.ts` bakeMapIcons).
- P1-1 Flat water/shoreline (terrain.ts water branch + decorate shore pass).
- P0-6 Entity sprites below the quality bar everywhere: single-pose 8x12
  pawns, unreadable 1px job accessories, resample-degraded children, 12x6 px
  monsters (sprites.ts BODY/ACCESSORY, mapIcons.ts `m:*` templates).
- P1-2 No entity animation or state reading: walking, working, fighting,
  fleeing, dying all render the same pixels (drawDynamic pawn pass; zoom
  ladder in camera.ts: [2,4,16,32] has a hole between 4 and 16 and stops at
  32, so sprite detail never gets room to exist).
- P1-7 Combat/impact feedback invisible: engagements are a glyph + dust, no
  projectiles, no hits, no corpses, no blood, no burning-building stages, no
  battlefield aftermath (main.ts squad pass, spectacle.ts battle/siege/razing
  scenes).
- P0-7 No visible arc of progress: settlements never age, enrich, or decay
  visually; eras change only a toast and a timeline band (see 2b cause 3).
- P0-8 Motion noise: all pawns rendered identically at all zooms, drowning
  armies/heroes/caravans in idle scurry (see 2b cause 2).
- P1-8 No network reading: trade routes and caravans exist in data but the
  land between settlements renders empty, so the world reads as separate
  ant nests rather than one civilization (routes/caravans in snapshot;
  ambience road wear exists but is too faint to register).
- P1-3 Farms/crops unreadable (drawDynamic crop pass draws 1px furrow lines).
- P1-4 Timeline strip communicates nothing (main.ts drawTimeline).
- P1-5 Default camera opens on empty terrain; chronicle rail hidden on first
  run (main.ts boot sequence).
- P1-6 Quantization rectangles: large flat tone patches with hard edges in
  grass (tileColor moisture/fertility banding).
- P2-1 Landing page lacks fantasy identity.
- P2-2 No vignette/cloud shadows; season tint is the only atmosphere.
- P2-3 Inspector/toast/records panels are unstyled cards; WHY panel never
  auto-closes.
- P2-4 Minimap is accurate but dull; bronze frame exists, contents flat.
- P2-5 Spectacle scenes lack ground contact (no scorch decals under battles,
  no light pools under fires).

Architecture problems affecting the above:

- A0 `main.ts` (2333 lines) owns the frame loop, drawDynamic, and 13 DOM
  render functions. Any UI work in place multiplies merge risk. Must be split
  first.
- A1 All CSS inline in `index.html` (300+ lines): no theming layer, custom
  properties exist but are minimal.
- A2 DB32 (32 colors) is too narrow for biome-differentiated ramps; palette.ts
  is correctly the single source of truth, so widening is one file + doc note.
- A3 No repeatable visual QA: screenshots in docs were taken ad hoc. Need a
  scripted Playwright capture harness to compare before/after.

---

## 4. Recommended refactor strategy

Keep: the entire sim, worker protocol, chronicle/brain layers, spectacle and
beacon engines, terrain chunk cache design, procedural-asset approach (no image
files: keeps zero deps, deterministic, license-free), DOM-for-panels approach,
test suite.

Redesign in place (same files, new output): palette ramps, tile colors, water,
building/pawn/monster/icon atlas templates, the dressing of all 12 spectacle
scenes, particle looks, map mode cartography, timeline, CSS theme. One new
render module: `src/render/decals.ts` (event-derived ground marks).

Restructure (mechanical, no behavior change): split main.ts into modules;
extract CSS to `src/ui/theme.css` imported by main.ts (Vite inlines it);
central icon module replacing emoji in DOM.

Explicit non-goals: WebGL migration, image asset pipeline, new sim features,
touching `src/sim/**`, changing SIM_VERSION or save format, React or any
framework, new runtime dependencies.

Design decisions already made (do not relitigate during implementation):

- D1 Palette: extend `palette.ts` from DB32 to "DB32+": keep the 32 originals
  (existing code indexes into them) and append ~24 curated colors forming
  ramps: grass x4, water x3, sand x2, rock x3, snow x2, crop x2, roofs x8
  (faction ramp), wood x2. Update the DB32-only rule in doc 13 by pointing it
  here. All new colors go through palette.ts constants, never inline hex.
- D2 Zoom ladder becomes [2, 4, 8, 16, 32, 48]. 8 fills the jarring 4-to-16
  gap; 48 gives a true close-up where new sprite detail pays off. Terrain
  bakes per zoom level already; cap decorated bakes to levels >= 8 as today.
- D3 Buildings become multi-tile in RENDER ONLY. Sim keeps 1-tile building
  positions; the renderer draws a 2x2-tile (or larger for Temple/Keep) sprite
  anchored at the sim tile, with a deterministic layout jitter from
  fnv1a(settlementId, buildingId). Overlap between neighbors is resolved by
  draw order (y-sort). No sim change.
- D4 Faction identity system: each faction gets (color ramp, sigil glyph,
  banner shape) derived from existing faction hex slots. One new module
  `src/render/heraldry.ts` bakes banner/sigil sprites used by: map labels, HUD
  chips, war strip, army banners, settlement pennants, chronicle headers.
- D5 UI theme: dark parchment-and-bronze fantasy chrome, CSS only (borders,
  gradients, box shadows, image-set patterns via tiny data-URI canvases are
  allowed but keep them subtle). Body text stays a system serif/sans stack for
  readability; display font for titles is a CSS-styled small-caps serif stack
  (no webfont download, zero deps). All icons come from `src/ui/icons.ts`
  (inline SVG strings, single accent-colorable path set, ~30 icons) replacing
  every emoji in DOM. Canvas layers already use DB32 glyph atlases; extend
  those atlases for any canvas icon still missing.
- D6 Verification: Playwright as devDependency with `scripts/visual.mjs`
  capturing a fixed matrix (seed 42; years 5/30/80 via fast-forward; zooms
  4/16/48; rail tabs; territory overlay; landing; plus one active war
  engagement and one monster event, both reachable deterministically by
  seeking to their event ticks from the journal). Screenshots land in
  `docs/screenshots/v3/`. Determinism suite + perf gate run after every phase.
- D7 Animation system: sprite variants in the atlas, frame selected at draw
  time by `fnv1a(entityId, snapshotTick >> 3) & 1` (or modulo frame count).
  Pure function of (id, tick): identical during replay/scrub, zero per-frame
  allocation, no timers. Pawn states map to frame rows: idle, walk (2), work
  (2), fight (2), flee, down. State comes from data already in the snapshot
  (actionId, squad state, hp); if a field is missing, extend the snapshot
  additively with render-only fields (allowed, see constraint 1).
- D8 Impact decal system: one new module `src/render/decals.ts`. A decal
  (scorch, rubble, blood, trample, festival confetti ground) is derived
  purely from the event log: kind, tile, birth tick, ttl. On draw, alpha =
  f(currentTick - birthTick). Because inputs are (events, tick), scrubbing
  the time machine reproduces decals exactly. Decals draw as a small
  per-chunk overlay canvas rebaked lazily when their set changes, never
  per-frame. Cap: 64 live decals, oldest evicted.
- D9 Motion hierarchy (fixes 2b cause 2). Three motion classes decided at
  draw time from snapshot data, no sim change: (a) story actors: squads,
  caravans, monsters, named characters: always drawn, at every zoom, with
  identity (banner/label); (b) staged workers: pawns whose actionId is a
  worksite action (farm, mine, chop, build, fish) draw AT their worksite in
  work pose; (c) ambient walkers: everyone else. At zoom <= 8 class (c) is
  not drawn individually at all: settlements instead get a small activity
  vignette (plaza crowd cluster, field workers) sized by population. At zoom
  16+ class (c) draws normally. Result: far/mid zooms show story, close zoom
  shows life.
- D10 Prosperity tiers (fixes 2b cause 3). Render-only settlement tier from
  data already in the snapshot: tier = f(pop, buildings.length, capital flag)
  banded at hamlet (<40), village (<120), town (<300), city (300+). Era
  styling multiplier from the current era index (chronicle messages already
  deliver it). Tier + era select building template generation in T2.2's
  atlas: higher tiers swap thatch to timber to stone to slate, add stone
  plaza, well to fountain, bunting, statues, market stalls; declining
  settlements (pop falling across snapshots or loyalty low when inspected)
  get weeds, patched roofs, boarded windows; razed hands off to rubble
  decals with multi-year grass regrowth. If a needed signal is not in the
  snapshot (e.g. per-settlement loyalty), extend the snapshot additively
  (render-only field, constraint 1 allows it).

Dependency risks and mitigations:

- R1 Perf regression from bigger sprites and more decoration. Mitigate: keep
  everything atlas-baked, y-sort only visible buildings, measure with the
  in-app FPS counter and scripts/perf.mjs after each phase, budget: no more
  than 1.5x current draw calls at Region zoom.
- R2 Determinism CI breakage by accidental sim import. Mitigate: lint:sim runs
  in npm test; never import from src/sim except types and fnv1a (already the
  pattern).
- R3 Replay divergence from time-based VFX. Mitigate: new VFX follow the
  spectacle pattern (seeded by event id + tick, driven by rAF clock).
- R4 Chunk cache memory with 6 zoom levels. Mitigate: bake terrain at levels
  2/4/8/16/32 and reuse 32 scaled for 48 (sprites draw native at 48; terrain
  upscale from 32 is acceptable since imageSmoothing is off), or lazily bake
  48 only around camera. Decide by measuring; either is fine.
- R5 Mobile layout regressions from CSS extraction. Mitigate: capture mobile
  viewport (390x844) in the visual harness before starting and diff after.
- R6 Emoji removal touching test strings. Doc 13 explicitly allows emoji in
  docs/tests; only DOM-facing strings change. grep scope: src/ui, src/main.ts,
  index.html.

---

## 5. TODO list

Execute phases in order. Within a phase, tasks are ordered by dependency.
After each phase: `npm test`, `node scripts/perf.mjs`, `node scripts/visual.mjs`,
eyeball the diff, commit.

### Phase 0: Assessment and preparation (blocking everything)

- [ ] T0.1 (P0, no risk) Add Playwright devDependency + `scripts/visual.mjs`
      capture harness as specified in D6. Capture the BEFORE baseline into
      `docs/screenshots/v3-before/`.
      Outcome: repeatable screenshot matrix. Deps: none.
- [ ] T0.2 (P0, mechanical) Split `src/main.ts` with zero behavior change:
      move drawDynamic + overlay + minimap + timeline drawing into
      `src/render/dynamic.ts`, `src/render/overlays.ts`,
      `src/render/timeline.ts`, `src/render/minimap.ts`; move DOM panel
      renderers (renderHudChips, renderWarStrip, renderChronicle,
      renderEvents, renderCouncils, renderRecords, renderFeed, renderChain,
      showInspector, renderCharacterSheet, toasts, council panel) into
      `src/ui/panels/*.ts`; main.ts keeps boot, worker wiring, frame loop,
      input. Target: main.ts under 600 lines.
      Outcome: parallel-safe work surface. Risk: subtle closure state; move
      state into small explicit stores per module. Verify with visual harness
      diff (must be pixel-identical) + full test suite.
- [ ] T0.3 (P0, mechanical) Extract the index.html style block to
      `src/ui/theme.css` (Vite import). Define the design-token layer now:
      color tokens (bg, panel, panel-raised, ink, ink-dim, accent-gold,
      accent-blood, parchment, bronze border ramp), spacing, radii, z-index
      scale. No visual change yet.
      Outcome: theming becomes one-file work. Risk: R5 (capture mobile before).
- [ ] T0.4 (P1) Create `src/ui/icons.ts` (inline SVG icon set, D5) and
      `src/render/heraldry.ts` skeleton (D4). Wire nothing yet.
      Outcome: shared identity/icon primitives exist for later phases.

### Phase 1: Terrain, water, palette (biggest visible win)

- [ ] T1.1 (P0) Extend palette.ts per D1 (DB32+ ramps). Update doc 13 note.
      Deps: none. Risk: none if additive.
- [ ] T1.2 (P0) Re-ramp tileColor(): bright grass ramp for Grassland, warm
      gold-green for Steppe, olive-to-moss for Hills with visible relief
      shading, cool grey-blue ridged Mountain with snow caps at elevation,
      cream Beach, two-band Ocean + lighter Shallows band near coast, teal
      Lake, distinct DarkForest floor. Kill P1-6 banding: replace hard
      moisture bands with fnv1a-dithered band edges (2-tile feather).
      Outcome: island reads as lush cartography at every zoom. Deps: T1.1.
      Risk: rebake cost unchanged (same pass); check season boundaries.
- [ ] T1.3 (P1) Water life: ordered-dither texture on Ocean/DeepOcean split,
      animated sparkle + wave dashes (bake 2 water frames per chunk and
      alternate on a slow rAF cadence; determinism-safe since cosmetic and
      derived from tileHash + frame parity), shore foam widened to 2px with
      occasional breaking-wave pixel runs.
      Outcome: 40% of the frame stops being dead. Deps: T1.2. Risk: R1; two
      cached frames per water chunk only, no per-frame tile work.
- [ ] T1.4 (P1) Decoration pass v2 in decorate(): denser grass tufts and
      flower clusters (biome-tinted), tree sprites upgraded from dark balls to
      2-tone canopy + trunk + soft shadow, rock facets with highlight edge,
      reeds on lake shores, fallen-log/mushroom rarities in DarkForest.
      Extend decoration to zoom 8 (currently >= 8 only after ladder change;
      keep bake-time only). Deps: T1.2, D2 ladder (T2.1) can land either side.
- [ ] T1.5 (P2) Atmosphere layer in ambience.ts: drifting cloud shadows
      (2-3 large soft blobs, screen-space, deterministic drift from world seed
      + rAF clock), soft edge vignette on the world canvas (CSS radial
      gradient overlay div, pointer-events none).
      Outcome: unified "alive" frame. Risk: keep clouds under 5% luminance.

### Phase 2: Buildings and settlements (the civilization read)

- [ ] T2.1 (P1) Camera ladder to [2,4,8,16,32,48] per D2 + default camera at
      Begin History centers on the largest settlement (data already in
      snapshot). Fix P1-5 second half: open chronicle rail by default on
      desktop widths on first run.
      Deps: T0.2. Risk: R4 memory; measure and choose bake strategy.
- [ ] T2.2 (P0) bakeBuildingAtlas v2: multi-tile templates per D3. Sets per
      race (human timber/thatch, elf green-canopy curved, dwarf stone-slab,
      orc hide-and-bone) x kinds (House, Granary, Workshop, Temple, Farm hut,
      Wall segment, Keep for capitals) with roof pixels bound to faction ramp,
      2 mirror variants + scaffold stage. House 16x16 px (2x2 tiles at 8px
      base) drawn at zoom-native scale.
      Outcome: settlements become architecture. Deps: T1.1 (ramps), T0.2.
      Risk: R1 (atlas-baked, cheap); silhouette overlap handled by y-sort.
      Note: design templates tier-ready from the start (T3b.1/D10 adds
      hamlet/village/town/city material variants on top of this atlas).
- [ ] T2.3 (P0) Settlement composition in dynamic.ts: y-sorted building draw,
      deterministic intra-settlement dirt paths (bake into terrain chunk on
      settlement growth events: path pixels from each building toward the
      settlement center via existing routes/flowField helpers render-side),
      plaza + well at center, walls drawn as connected ring segments when
      Wall buildings exist, capital keep + banner.
      Outcome: villages look like villages. Deps: T2.2. Risk: path bake must
      key off snapshot settlement data only (replay-safe).
- [ ] T2.4 (P1) Farms: replace 1px furrows with solid crop-field patches
      (tilled soil, sprout, golden ripe, stubble stages from existing crop
      stage data), 2x2 tiles, harvest-time color pop.
      Outcome: seasons and famine become visible. Deps: T2.2.
- [ ] T2.5 (P1) Far map mode v2: replace black-blob settlement icons with
      heraldry sigil-badges (banner shape in faction color, size by popTier,
      capital star), thicken territory fills (8-12% tint) with 2px lightened
      border, brighter far-zoom biome cartography (reuse T1.2 ramps),
      label typography from theme.
      Outcome: the most-watched zoom becomes the poster. Deps: T0.4, T1.2.

### Phase 3: Entities (pawns, armies, monsters, wildlife) and combat feedback

This phase is equal in weight to Phases 1-2. Entities are what the observer
actually watches; today they are the weakest layer in the game. Suggested
implementation order inside this phase: T3.1, T3.5 (decals), T3.2, T3.3,
T3.4, T3.6 (T3.2 and T3.3 consume T3.5).

- [ ] T3.1 (P0) Pawn sprite system v2 in sprites.ts. New base grid 12x16
      (up from 8x12). Per race: distinct silhouette AND head detail (human
      hair shapes, elf ears + long hair, dwarf beard covering chest, orc
      tusks + jaw), 1px dark outline on the full silhouette (reads against
      bright terrain), 2 palette-jitter variants per faction via
      fnv1a(pawnId) so crowds stop looking cloned. Proper child template
      (drawn small, not resampled). Named characters: crown + cloak trim in
      faction ramp. Facing: bake mirrored left/right, pick by movement sign.
      Animation rows per D7: idle, walk x2, work x2, fight x2, flee, down.
      Job overlays redrawn at the new scale as readable tools (scythe, bow,
      pick, axe, sword + shield) plus carried-goods overlay (grain sack, log,
      ore) when hauling.
      Outcome: a villager, a soldier, an elf, and a king are identifiable at
      a glance at zoom 16+; crowds look alive.
      Deps: T2.1 (zoom 48 exists), T1.1 (ramps). Risk: atlas grows to
      4 races x 8 factions x 5 jobs x 9 frames x 2 jitter x 2 facing: still
      a single canvas under 4k px wide; measure bake time (must stay <150ms).
- [ ] T3.2 (P0) Combat rendering in dynamic.ts squad pass. When squads are in
      `fight`/`siege` state: draw individual soldier sprites (fight frames)
      arranged in opposing rows with deterministic per-pawn offsets
      (fnv1a(squadId, i)), weapon-flash pixels on alternating frames, arrow
      trail streaks between ranged attackers and targets (2px white-to-brown
      streak, lifetime from tick parity), occasional hit spark. On casualty
      events: corpse sprite (down frame) persisting ~1 sim-year then fading,
      blood pixel decal via D8. Siege adds ladder/ram silhouette against the
      wall ring from T2.3.
      Outcome: a war produces watchable fighting, not an icon.
      Deps: T3.1, D8 (T3.5), T2.3 for siege walls. Risk: perf at region zoom:
      cap rendered duel pairs per engagement (12) and fall back to the
      banner-chip presentation below zoom 8.
- [ ] T3.3 (P0) Monsters become creatures in mapIcons.ts (or a new
      `src/render/monsters.ts` atlas). Dragon: 3x3-tile body, 2 wing frames,
      neck/tail articulation pixels, ground shadow offset by flight, fire
      breath cone (orange-to-red dither triangle) synced with the existing
      dragon spectacle scene; scorch decals where breath lands (D8). Troll:
      2x2 tiles, club-swing frame, mossy skin ramp. Wolf pack: 1x1 lope
      frames but drawn as a pack cluster with a shared shadow. All monsters
      get: idle/move frames per D7, 1px outline, a subtle radial dread tint
      on nearby ground while active (event-derived, fades on death).
      Outcome: a dragon attack is the screenshot moment it should be.
      Deps: T3.1 style bar, D8. Risk: none material; counts are tiny.
- [ ] T3.4 (P1) Army/squad presentation at strategic zooms: heraldry banner
      chip above squad clusters at zoom <= 16, soldier-count pip bar, morale
      as banner tatter/fullness, march column rendered as offset sprite file
      at zoom >= 8 (not a blob), keep ambience march dust.
      Deps: T0.4 (heraldry), T3.1.
- [ ] T3.5 (P1) Implement `src/render/decals.ts` per D8 (scorch, rubble on
      razed settlements, blood, trampled-field, confetti). Wire: razing,
      battle, dragon, festival, plague (pale lime rings) events.
      Outcome: history leaves marks on the land; scrubbing time replays them.
      Deps: event log access already in main; no sim change. Risk: R3;
      inputs are (events, tick) only.
- [ ] T3.6 (P2) Wildlife and ambient life in ambience.ts: deer/boar dot-
      sprites grazing in forest clearings that scatter when squads pass
      (position/flee purely from fnv1a(tile, tick window): cosmetic, no sim),
      fish jump splashes on lake/coast tiles, butterflies over flower
      decorations in summer, existing birds kept. Each capped and pooled.
      Outcome: the world breathes between story beats.
      Deps: T1.4 (knows where flowers/clearings are). Risk: R1; hard caps
      (16 wildlife sprites on screen).

### Phase 3b: Civilization legibility (the ants-to-civilization phase)

Fixes the three root causes in section 2b. Nothing here touches the sim;
every signal used is already in WorkerSnapshot (settlement pop/stockpile/
buildings/capital, squad states, caravans, namedPos, pawn actionIds) or the
chronicle era messages.

- [ ] T3b.1 (P0) Prosperity tiers per D10. Extend T2.2's building atlas with
      tier variants (hamlet/village/town/city material sets) + tier dressing
      sprites (fountain, statue, market stalls, bunting) + decline dressing
      (weeds, patched roofs, boarded windows). dynamic.ts picks templates by
      settlement tier and era at draw time; tier changes crossfade over ~30
      ticks so growth feels organic, and a tier-up plays a small dust-puff
      "construction" flourish on affected buildings.
      Outcome: a city looks like it took two centuries to build; a dying
      town looks dying. The core "advancing toward prosperity" read.
      Deps: T2.2, D10. Risk: atlas size x4 tiers: still one canvas; bake
      only tiers in use per race (lazy row bake).
- [ ] T3b.2 (P0) Trade network rendering. Draw inter-settlement routes as
      worn dirt roads that darken with cumulative caravan traffic (amplify
      the existing ambience road-wear so it is clearly visible at zoom 4+),
      plank bridges where a route crosses a river tile, and upgraded caravan
      sprites (wagon + pack animal + faction pennant) moving along them.
      Route geometry: derive polylines from observed caravan positions per
      (source, dest) pair, or add an additive render-only `routes` field to
      the snapshot exposing the sim's existing route paths (preferred,
      constraint 1 allows additive fields).
      Outcome: the map reads as one connected economy; peaceful prosperity
      becomes visible traffic. Deps: T1.2 (road pixels on new terrain),
      T0.2. Risk: none material; routes are few (dozens).
- [ ] T3b.3 (P0) Motion hierarchy per D9 in the dynamic.ts pawn pass:
      classify story actors / staged workers / ambient walkers; suppress
      individual ambient walkers below zoom 16 in favor of settlement
      activity vignettes (plaza cluster, field line, construction site
      cluster) sized by pop; staged workers snap to their worksite with work
      frames (farmers in field rows, miners at ore, builders on scaffolds).
      Outcome: the ant-scurry disappears; what moves across the map is
      story. Deps: T3.1 (frames exist). Risk: perceived pop drop at mid
      zoom: tune vignette sizes so towns still look inhabited.
- [ ] T3b.4 (P1) Protagonist presence: named characters (namedPos already in
      snapshot) get cloak + crown from T3.1, a small name banner tag at zoom
      >= 16 (heraldry-styled, fades when many on screen, always on for
      kings), and a 2-guard retinue rendered beside kings when their
      settlement is at peace. Beacon/toast "click to look" keeps working and
      now lands on someone visibly special.
      Outcome: the chronicle's protagonists exist on the map. Deps: T3.1,
      T0.4. Risk: label clutter: reuse V1 label-collision declutter.
- [ ] T3b.5 (P1) War as campaign: marching squads get a faint dashed intent
      trail toward their objective (data: squad state + war objective),
      besieged settlements get an encampment ring (tents + campfires) on the
      besieger's side, territory changing hands plays a 1s color sweep in
      mapMode, and active front lines pulse with the existing war overlay
      chips.
      Outcome: wars read as campaigns with geography, not point events.
      Deps: T2.5, T3.2. Risk: R3: all inputs are snapshot + events.
- [ ] T3b.6 (P1) Turning-of-age pageantry: era transitions re-grade the
      world (subtle global palette shift per era already supported by season
      tint machinery), the era title card (exists) gains a full-screen
      parchment flourish, and settlement bunting recolors to era accent for
      a few sim-days.
      Outcome: "an age has turned" is felt on the map, not just toasted.
      Deps: T1.2, T4.2 for card styling (can land before Phase 4 with old
      card). Risk: keep grade subtle (<6% hue) to protect readability.
- [ ] T3b.7 (P2) Genesis cinematic at Begin History: ~8s skippable sequence:
      cloud layer parts (T1.5 clouds), camera pans across the island, brief
      pause on each race's founding site (founding spectacle already fires
      at Y0), settle on the largest settlement at zoom 16 with the chronicle
      rail open.
      Outcome: the first 30 seconds promise a story instead of dropping the
      user on empty steppe. Deps: T1.5, T2.1. Risk: none; pure camera
      choreography, skippable by any input.
- [ ] T3b.8 (P2) Documentary idle drift: when the user has not touched the
      camera for 60s and director mode is off, ease the camera slowly toward
      the current highest-interest point (reuse the director-mode scoring)
      and gently back. Off by default on mobile; any input cancels.
      Outcome: the screen never sits on dead land during long observes.
      Deps: director mode (exists). Risk: motion sickness: cap pan speed,
      make it a settings toggle.

### Phase 4: UI redesign (DOM chrome)

- [ ] T4.1 (P0) Kill tofu: replace every emoji glyph in DOM surfaces with
      icons.ts SVGs (eventMeta.ts gains an `icon` field consumed by feed,
      toasts, records, overlay bar, HUD; keep `glyph` for canvas atlases).
      Grep scope per R6.
      Outcome: no missing-glyph boxes anywhere, consistent icon language.
      Deps: T0.4. Risk: low.
- [ ] T4.2 (P0) Apply theme to all panels (theme.css tokens from T0.3):
      parchment-dark panels with bronze 2px borders and corner notches, gold
      numerals for stats, styled scrollbars, HUD faction chips become heraldry
      banner chips with population + trend sparkline, war strip tabs as
      crossed-banner cards, toast redesign (icon + one line + era-colored
      left rule), inspector/council/char-sheet restyle, WHY panel auto-close
      after 20s or on camera move.
      Outcome: chrome matches the fantasy world. Deps: T0.3, T0.4, T4.1.
      Risk: R5 mobile; re-run mobile captures.
- [ ] T4.3 (P1) Timeline v4: taller strip (28px), era bands as labeled
      parchment segments, tier-1 events as icon markers (icons.ts) with
      hover cards, war spans as blood-red underlays, replay cursor as a
      bronze needle. Keep click-to-seek and density clustering.
      Deps: T4.1, T4.2.
- [ ] T4.4 (P1) Landing page v2: full-bleed dark hero with the live worldgen
      preview enlarged (512px, bronze frame), title in display face with the
      existing shimmer, seed row + laws + BYOK restyled as stone cards,
      resume list as save-slot cards with mini map thumbnails (canvas
      thumbnail already derivable from save data).
      Deps: T0.3. Risk: none (page is isolated).
- [ ] T4.5 (P2) Minimap v2: terrain colors from new ramps automatically;
      add faction territory tint + settlement dots; viewport rectangle in
      gold; keep bronze frame.
      Deps: T1.2, T2.5.

### Phase 5: Visual effects overhaul (spectacle, fire, weather, particles)

The spectacle engine's structure (12 scenes, pooled particles, seeded
variation, caps) is kept as-is. This phase re-dresses what it emits and adds
world-level effects outside scenes.

- [ ] T5.1 (P1) Particle emitter upgrade in spectacle.ts/ambience.ts within
      the existing 300-particle shared pool: typed emitters with real pixel
      looks instead of thin strokes: smoke (3-tone grey puffs that grow +
      lighten), ember (orange spark with gravity arc + 1-frame flicker),
      spark (white cross flash), splash (blue-white v), leaf (green flutter,
      forest battles), ash (grey drift under razing). Each particle renders
      as 2-4 px cluster, not 1px.
      Outcome: every effect gains body without new budget. Deps: none inside
      phase. Risk: R1; same pool, same caps.
- [ ] T5.2 (P1) Fire done properly (used by razing, dragon breath, siege):
      burning buildings get 3 burn stages (flames on roof edge, engulfed with
      2-frame flame sprites + ember column, charred husk), an additive warm
      glow halo (radial gradient, screen blend, cheap), and smoke plume from
      ambience. Charred husk hands off to the rubble decal (T3.5).
      Outcome: razing a town looks like a catastrophe, not a status change.
      Deps: T2.2 (building sprites), T3.5. Risk: glow overdraw; one gradient
      per burning building, cap 12 concurrent glows.
- [ ] T5.3 (P1) Scene-by-scene dress pass over all 12 spectacle scenes
      against the new art (battle: uses T3.2 fighters instead of glyphs;
      rout: fleeing pawns use flee frames + dropped-item pixels; siege: T3.2
      ladders/ram + wall dust; dragon: T3.3 creature + breath; razing: T5.2
      fire; coronation: gold rays + crowd of cheering pawns (work frames);
      plague: pale ring + rat pixels; rebellion: torch-carrying crowd at
      night-tint; founding: tent-to-house build montage; famine: desaturation
      ring + thin pawns variant tint; festival: confetti + bonfire; memorial:
      kept, already good). Raise flash/beam saturation for the brighter
      terrain and add the 1px outline rule to all scene actors.
      Outcome: tier-1 events are watchable set pieces end to end.
      Deps: T3.1-T3.3, T5.1, T5.2.
- [ ] T5.4 (P2) Weather with ground contact in ambience.ts: rain gets splash
      pixels on water/roof tiles and a darkened-ground tint ramp-in, snow
      accumulates as a white tile tint that melts over days (render tint
      derived from weather state in snapshot: no sim change), drought adds
      heat-shimmer bands over sand/steppe, storm adds rare forked lightning
      flash (1 frame) + thunder shake reusing spectacle shake.
      Outcome: weather becomes scenery, not just falling pixels.
      Deps: T1.x. Risk: R3: all state already in snapshot + clock.
- [ ] T5.5 (P2) Event postcard frame: the existing postcard-caption moment
      gets a thin bronze frame + letterbox consistent with theme.
      Deps: T4.2.

### Phase 6: Testing and regression gate (exit criteria)

- [ ] T6.1 `npm test` green (determinism, soak, all milestone suites),
      `npm run lint:sim` clean, `node scripts/perf.mjs` within gate.
- [ ] T6.2 Perf in-browser: 60fps at Region zoom with 2000+ pawns (use the
      FPS badge; test seed 42 at year 200 via fast-forward), no more than
      1.5x baseline frame time at any ladder step.
- [ ] T6.3 Visual harness AFTER matrix captured to `docs/screenshots/v3/`;
      side-by-side page (simple md table in this doc's folder) linking
      before/after; update README screenshots.
- [ ] T6.4 Replay integrity spot-check: run 80 years, seek to year 20, watch
      to year 40, confirm identical event visuals (spectacles, decals,
      beacons) vs the forward run at same years.
- [ ] T6.5 Mobile viewport captures (390x844): all panels reachable, no
      safe-area regressions.
- [ ] T6.6 New edge cases discovered during the work go to
      `docs/10-edge-cases.md` with a test, per repo rule.
- [ ] T6.7 Entity readability review at zooms 16/32/48 (use the visual
      harness war + monster captures): can you tell race, job, and named
      status of a pawn at a glance; does a battle read as a battle with the
      sound off and no UI; does a dragon event pass the "screenshot to share"
      test. Any "no" reopens the relevant Phase 3/5 task.
- [ ] T6.8 `/?dev=sprites` preview page extended to show the full new atlas
      (all races x jobs x frames, monsters, decals) and checked for template
      typos (today the dwarf row renders visibly broken there; must be fixed
      by T3.1 and verified here).
- [ ] T6.9 The century test: capture the same capital at Year 5 and Year
      150+ (visual harness). The two shots must look like different
      centuries (tier architecture, roads, dressing), not the same camp at
      two densities. Fails -> reopen T3b.1/T3b.2.
- [ ] T6.10 The narration test: watch 10 minutes at Region zoom with the
      feed hidden. An observer must be able to say what is happening (who
      prospers, who is at war, where armies are heading, who the king is)
      from pixels alone. Fails -> reopen T3b.3/T3b.4/T3b.5.

Suggested commit granularity: one commit per task ID, message prefixed
`v3(T2.2): ...`, keeping every commit green.

---

## Appendix: reference notes for the art pass

WorldBox color anchors observed (approximate, for direction not copying):
grass #6ab446 to #8fd15f highlights; ocean deep #2e63a8, shallow #4a8bd4,
dither +6 luminance; sand #e8d9a8; house roofs saturate to kingdom hue at
~70% saturation, walls cream #e8e0c8, wood #8a5a33; tree canopy two greens
+1 highlight; fire #ffd23f core / #ff7b26 mid / #d33 edge.

Composition rules that made their shots read well: one focal accent per 300px
of screen (fire, banner, beam); paths and coastlines create diagonal flow
lines; villages hug coasts and rivers so blue/green/roof triads recur; the
camera vignette pulls the eye center-frame.

Chronica equivalents to exploit: era color already exists (eventMeta), season
tints exist, faction ramps exist, spectacle engine can deliver the "focal
accent" rule automatically via its existing scene picker.
