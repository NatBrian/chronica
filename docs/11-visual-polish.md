# 11 : Visual Polish and UX (design reference for v2)

Status: **DESIGN REFERENCE**, consumed by `docs/12-v2-upgrade.md` (the v2 execution playbook: read it FIRST for build order, ground rules, file map, and exit criteria; it references sections here by letter, e.g. "11 §D"). Sections are designs, not build order: doc 12's milestones decide when each section is built. Sections marked "sim-side" (E1-E4, F, parts of I) change simulation behavior and carry golden-seed re-baseline + soak duties; everything else is render/UI-only and must not alter any world hash.

Implementation surfaces: render code in `/src/render/`, panels/overlays/timeline in `src/main.ts` + `index.html` (vanilla DOM, styles in index.html), UI-visible sim data flows ONLY through `packUiSnapshot` in `src/simWorker.ts` (extend it there), sim changes per the doc-12 ground rules. DB32 palette only (`src/render/palette.ts`). Zero runtime deps: hand-roll charts and effects.

Original feedback that triggered this doc:

> "The world sim is so boring, only like ants moving around without elements to show. War also not clear."

Diagnosis: the sim under the hood is rich (crops grow, wars rout, caravans reroute) but the renderer draws almost none of it. Pawns are 3px squares, buildings are flat colored blocks, battles look identical to farming. The fix is presentation, not simulation.

## Root-cause split (screenshot audit, Y940 Wynost)

Two different problems at two different zoom levels. Confirmed by auditing real screenshots: even the author could not identify a city vs a rock field at default zoom.

1. **Far zoom is a presentation-model problem.** A 512-tile island rendered as raw shrunken pixels can never read. RimWorld dodges this: one ~250-tile settlement, always at readable zoom, no world view at all. Chronica needs world scale, so far zoom must stop drawing pixels and start drawing a *map*: settlement icons + name labels, army banners, faction-tinted territory. Total War campaign map, not ant farm. See section D.
2. **Near zoom is an asset + annotation problem.** At Local zoom you see people and brown rectangles, and must guess the rectangles are houses. Flat single-color grass, no roofs, no roads, no fields, no trees near town, mystery tiles (the keep and granary are unlabeled colored blocks). RimWorld's near-view readability = distinct silhouettes with dark outlines + ground texture variation + labels and bars layered on the world. Sections B and C fix this.
3. **Both zooms lack an overlay language.** RimWorld constantly annotates the world (names, health bars, alerts, zone tints). Chronica renders raw state with near-zero annotation. Section C plus D.

## Ground rules (inviolable)

- Zero changes to `/src/sim`. Everything below reads existing state/events and draws.
- Animation clocks use render frame time (`requestAnimationFrame` delta). That is legal outside `/src/sim`; replays stay bit-identical because visuals never feed back into the sim.
- VFX must be derivable from the event log + current state, so time-machine scrubbing shows the same effects at the same years.
- Budget: keep 60fps at Region zoom with 2000+ pawns. Anything per-pawn-per-frame must be O(visible pawns) with no allocation.
- DB32 palette stays. New sprites are composed pixel art like the existing pawn atlas (see 06).

---

## A. War readability (highest priority)

Problem: a war today = some pawn dots walk somewhere, some dots vanish. Nothing announces "this is a battle".

### A1. Armies as banner units
- Squad renders as one *banner sprite* (faction-colored flag on pole) leading a tight marching formation, not a loose crowd.
- Soldier-count badge under the banner (e.g. "38"), morale shown as flag raggedness or color saturation: full flag = fresh, tattered = near rout.
- Faint dotted trail behind the column showing the path marched this season.

### A2. Battle VFX at the engagement tile
- On battle-start event: clash flash (2-frame white/steel burst), then a persistent dust-cloud sprite while squads are engaged on adjacent tiles.
- Floating pips on casualties: tiny red `×` drifting up, one per N deaths (batched, not per pawn).
- Crossed-swords icon hovers over the tile, visible even at Region zoom, so distant battles are spottable.
- On rout: fleeing squad gets motion streaks + dropped-banner sprite left on the field for a season.

### A3. War status strip (UI)
- While any war is active: slim banner across the top of the canvas. "Millford Kingdom vs Bathakdush Horde · Year 912 · war goal: tribute".
- Live bars per side: army strength (sum of squad members) and morale. Click strip = camera jumps to nearest active battle or marching banner.
- Multiple wars stack as tabs.

### A4. Battle pings
- Minimap: pulsing red dot at battle tiles.
- Toast on battle start: "Battle near Bathakdush" (click = jump). Reuse existing toast system.

### A5. Aftermath
- Razed settlement: chimney-smoke replaced by black smoke plumes for ~2 years of sim time, tiles charred (darkened + soot speckle), ruins sprite instead of buildings.
- Battlefield tile keeps a subtle scorched/trampled decal for a season.

Open questions:
- Banner-unit rendering replaces individual soldier dots at which zoom levels? Proposal: Region and World zoom show only the banner unit; Local zoom shows individual soldiers *plus* the banner.
- Does the war strip fight with the chronicle rail for attention? Alternative: put war chips in the event feed row instead.

## B. A world that looks alive

Problem: terrain is static wallpaper, settlements are blocks, work is invisible.

### B1. Real building sprites
- Tiered settlement art: hamlet (3-4 houses) → village (houses + granary) → town (+ walls, keep) driven by existing pop tiers.
- Race-flavored silhouettes: human timber gables, elf curved canopies, dwarf stone slabs into hillside, orc hide tents + totems. One 16×16 sprite per building type per race, composed like the pawn atlas.
- Construction state: when a settlement tier-ups, show scaffold sprite for a few seasons.

### B2. Visible crop cycle
- Farm tiles already track sow/grow/ripe in sim. Render stages: brown furrows → green shoots → gold ripe → stubble after harvest.
- Winter: fields under snow. Immediate payoff: the year visibly *breathes*.

### B3. Pawn work animations
- 2-frame tool anims keyed to current action: hoe swing (farm), axe chop (wood), pick swing (mine), hammer (build), rod cast at shore (fish).
- Haulers carry a visible bundle/sack sprite.
- Cheap: bake anim frames into the existing pawn atlas, pick frame by `(renderTime >> 8) & 1`.

### B4. Ambient motion
- Water: 2-frame shimmer on shore tiles (bake both frames into the terrain chunk cache, alternate at draw).
- Chimney smoke: 1 gentle particle stream per settlement, count scaled to pop.
- Seasonal foliage: existing seasonal tint is subtle; push further (spring blossom speckle, autumn orange, winter snow caps on trees + roofs).
- Weather made visible: rain streak particles, snow flakes, drought = dusty haze tint. The weather system already exists; today it is invisible.
- Wildlife dots: a few deer/birds wandering in forests (render-only, purely cosmetic, seeded from render clock).

### B5. Roads and caravans
- Caravan routes (already cached A* paths) render as worn dirt paths, opacity scaled by usage count.
- Caravan = ox-cart sprite with goods pile, not a lone pawn dot.

Open questions:
- Wildlife dots are render-only fakes (not sim entities). Acceptable, or does fake life violate the "everything is real" ethos of 00-vision? Cheap compromise: only render wolves/dragons that actually exist in sim, skip cosmetic critters.
- Snow cover: full-tile repaint per winter (chunk cache rebake cost) vs overlay pass? Overlay pass likely wins; needs perf check.

## C. Information layer

### C1. Territory always visible
- Subtle faction tint wash (10-15% alpha) + crisp border stroke at World/Region zoom, always on (today: only behind T toggle). Local zoom keeps it off.

### C2. Selection affordances
- Selected pawn: name label + job icon above head, soft ring under feet.
- Selected settlement: name banner + pop count.

### C3. Event feed icons
- Feed rows get category glyphs (⚔ war, 👑 succession, 🌾 famine, 🐉 injector) for scannability.

### C4. Overlay expansion (beyond territory / population / food / war)
Ranked by wow-per-effort. "Free" = data already in state or event log.

**Tier 1: unique to a history sim, build these**
- **Blood map** (free): heatmap of every battle, raid, and razing EVER, from the event log. Centuries of violence stain the map; old border wars glow at the same choke points. No other sim genre can show this; time-machine scrub makes stains appear era by era.
- **Storied places** (free): pin every chronicle-chapter anchor on the map; click pin = open that chapter. The island becomes a browsable book index. Most on-brand overlay possible.
- **Trade network** (free): cached caravan routes drawn as arcs, thickness = usage count, color = routine trade vs grain relief. Shows the invisible economy; relief arcs during famines are a story in themselves.

**Tier 2: strong, cheap**
- **Danger map** (free): wolf-pack territories, troll bridge, dragon lair + raid radius. Explains "why does nobody settle there".
- **Plague overlay** (free while active): live SIR spread per settlement during outbreaks (infected % as pulsing sickly-green), ghost markers on past outbreak sites.
- **Prosperity/mood** (free): settlement moodAvg + food security as warm/cold tint. The "where is life good" glance.
- **Race diaspora** (free): pawn race distribution heat. After conquests scatter refugees, elf quarters in human towns become visible. Proves the world remembers.

**Tier 3: nice, contextual**
- **Fertility/resources** (free, raw map data): why settlements sit where they sit; pairs with expansion (F) to predict where the next village lands.
- **Live weather** (free): current rain/drought/frost bands as translucent wash. Pairs with B4 particles.
- **Settlement age** (free): founding-era tint per settlement, ancient capitals vs frontier villages (only interesting after F makes founding happen).

**Deferred idea, logged**: "then vs now" diff overlay (territory at year X ghosted under current) : powerful but needs keyframe territory extraction; revisit after D ships.

UI: overlays remain one-active-at-a-time + territory combinable (07). The list grows past hotkey capacity, so the overlay bar becomes a small icon palette with tooltips; hotkeys keep the classic four.

### C5. Overlay UX contract + war overlay fix (confirmed bug-by-design)
Verified live: with 0 active wars and 0 squads, the war overlay (Shift+W) draws nothing at all, so on/off are pixel-identical. Two rules fix this class of problem for every overlay:
- **An active overlay always shows something**: a corner legend chip (overlay name + color key + "nothing active right now" when empty) and a subtle full-map tint so the mode is unmistakably on.
- **Overlays show state, not just live actors.** War overlay v2 layers: (a) at-war faction pairs as pulsing red border segments between their territories + banner-vs-banner chips, (b) battle sites of the current war as fading scorch markers, (c) live squads/battles as icons (current behavior), (d) peacetime = legend chip reads "the island is at peace" over a barely-tinted map, which is itself information. Grudge counts on hover of a border segment (pre-war tension made visible).

## D. Far-zoom map mode (new, from screenshot audit)

Problem: World and Region zoom show shrunken terrain pixels. Settlements are gray smudges, pawns invisible, nothing labeled. This is the first thing a new viewer sees and it reads as noise.

### D1. Iconographic layer replaces raw detail at far zoom
- Settlements: pixel-art icon scaled by tier (hamlet hut / village cluster / walled town / keep-city), race-flavored silhouette, faction-color pennant, **name label always on**, pop badge.
- Armies: banner icon + count, visible at any zoom while marching or fighting.
- Battles: crossed-swords icon, pulsing.
- Caravans: small cart icon on their route line.
- Terrain below simplifies: keep biome colors but flatten noise (average per 4x4 block or light blur) so icons pop. Terrain becomes backdrop, not content.

### D2. Political read
- Faction territory tint + border strokes always on at far zoom (C1 folded in here).
- Capital marked with a crown pip.
- Diplo state glancing cues: war = red pulsing border segment between the two factions' territories.

### D3. Zoom transition contract
- World/Region zoom (2x, 4x) = map mode: icons + labels + territory, simplified terrain, no individual pawns.
- Mid zoom (16x) = hybrid: icons shrink into actual building clusters, pawns appear.
- Local zoom (32x) = full detail: sprites, work anims, no icons except selection.
- Transition should crossfade so the world feels continuous, not two separate screens.

Open question: does map mode replace the existing T/P/F overlays, or absorb them as always-on defaults with toggles for the exotic ones (fertility, weather)?

## E. Worldgen variety (every run should look different)

Problem: worlds are already seed-procedural, but every seed produces the *same kind* of world: one round island (radial falloff), same biome mix, same 4 factions. Seeds change the details, not the character. Ten runs feel like one run.

Unlike A-D this touches `/src/sim/world`, so it is sim-side work: determinism rules apply in full, golden-seed tests get re-baselined, spawn-fairness and gini gates must hold per archetype.

### E1. Map archetypes
Seed picks a macro shape before biome pass:
- **Round isle** (current)
- **Archipelago**: 3-5 islands, straits between; forces naval-less factions apart, caravans hug coastlines, wars funnel at land bridges
- **Twin continents**: two landmasses + narrow strait or isthmus choke point
- **Highland ring**: mountain ring around a fertile central valley (dwarf heaven, everyone fights for the middle)
- **Crescent**: C-shaped land around an inner sea
Each archetype = its own falloff function + connectivity guarantee (all faction spawns must be land-reachable; flow fields and A* routes already handle pathing).

### E2. Landmark features (1-2 per world, seed-rolled)
- Great river crossing the land (fertile banks, natural border, bridge choke points)
- Inland sea or great lake
- Volcano (ash-fertile ring, dragon lair flavor)
- Mountain spine splitting the map
- Ancient forest (dense, elf-favored)
Landmarks get generated names ("the River Ithil") and feed the chronicle + event text so history reads differently per world.

### E3. Climate roll
Seed shifts the whole biome distribution: cold world (taiga heavy, short growing season), hot world (savanna/desert edge), wet world (swamp + forest). Changes both look and survival math. Must respect balance gates; may need per-climate calibration of the fairness thresholds.

### E4. Faction mix
Config already supports mirrorMatch; extend to seed-rolled mixes: 3-6 factions, uneven race combos (2 orc hordes vs 1 human kingdom), occasional same-race rivalries with distinct faction colors. Doc 04 diplomacy already keys on faction, not race, so this is mostly worldgen + spawn work.

### E5. Cheap visual variety (no archetype work needed)
- Coastline noise: break the perfect-circle silhouette with fjords and peninsulas
- Rivers and lakes even on the round isle
- Scattered decorative rock fields, clearings, beaches wider/narrower per seed

Open questions:
- Ship E5 inside phase D (it is mostly worldgen noise + render) and defer E1-E4 to their own milestone? E1-E4 is days of balance re-verification (each archetype needs the 200y no-extinction soak).
- Archetype in the landing UI: random-only, or a picker next to the seed box?

## F. Expansion deadlock fix (sim bug, found during this brainstorm)

Confirmed: zero settlements founded in 940 sim years (seed 42). `considerExpansion` requires `crowding > 100` (pop above 100% of capacity), but birth damping starts at 80% capacity and the granary cap (4000) pins food-per-capita to the damp floor around pop ~650. Equilibrium pop sits at 50-90% capacity forever; the expansion gate is above the ceiling the sim itself enforces. Wars and plagues periodically knock pop down and reset even that. Result: 4 villages at Year 0, 4 villages at Year 940, frozen borders, frozen skylines.

Fix candidates (combine 1+3, probably):
1. **Prosperity-driven expansion**: trigger at `crowdPct >= 60` AND granary near cap AND wood >= 60 AND pop >= 120. Rich, comfortable villages plant daughters; no need to starve first.
2. **Clamp capacity**: `min(fertileLand, 250)` in the capacity formula so villages top out ~300 and real pressure builds. Changes balance a lot; needs full soak re-run.
3. **EXPAND as a council option**: let kings *choose* to charter a new village (cost: grain+wood+14 settlers). LLM kings give it personality ("we push toward the river"); chronicle gets founding chapters; RuleBrain picks it on the prosperity condition. Turns a background mechanic into visible story.
4. Raise `granaryCap` with settlement tier so food ceiling grows with town size (pairs with B1 building tiers).

Whatever combination: sim-side change, golden seeds re-baseline, 200y no-extinction soak re-run, new edge-case test in 10 (settlement count grows on a calm seed; expansion respects maxPawns).

## G. Narrative UX: one home for the story (from user feedback)

Feedback: "narrative, notification, and timeline exist but unclear; bottom ticker truncated and weird; pixel timeline only orange and red, confusing what to use or understand."

Diagnosis: v1.0 has three narrative surfaces with no hierarchy and no memory. Toasts vanish after seconds, the bottom ticker shows two truncated events and discards history, the chronicle covers only major arcs. There is no single place to scroll the story. The timeline shipped as a bare marker strip; the era bands, severity icons, hover preview, and two-stage precision that 07 specified were deferred, so it reads as unexplained orange/red noise.

### G1. History panel: one tabbed home for all narrative
Replace scattered surfaces with one right-rail panel, three tabs:
- **Chronicle** (existing book, unchanged)
- **Events**: full reverse-chronological scrollable log. Never truncated, wrapped text, category glyph + faction color chip per row, year gutter. Filter chips (war / politics / disaster / economy / life) + severity slider from 07. Click row = camera jump + why-chain, as today. Search (`/`) results open here.
- **Councils**: every king decision with verbatim reasoning, newest first, faction-filterable. Today reasoning is visible only in a transient toast/panel; this makes it browsable history (07 §4 wanted this via character sheets; a tab is simpler).
Tab buttons carry unread-count badges. Bottom ticker shrinks to ONE latest-event line that acts as a button opening the Events tab (or dies entirely; A/B on feel).

### G2. Timeline v2 (implement the deferred 07 spec)
- **Era bands**: background segments colored + named ("The Burning Years" on hover, label inline when wide enough).
- **Category markers with a legend**: war = red swords, succession = gold crown, disaster = purple skull, founding = green dot, chapter = book icon. Legend on hover of a small `?` chip. Markers cluster/stack at low resolution instead of smearing into orange mush.
- **Two-stage precision**: click an era band = expand to decade strip for fine scrubbing (07 §1).
- **Hover preview card**: year, era, top event (07's mini-map thumbnail can wait; text card is 90% of the value at 10% of the cost).
- **Clear live-edge state**: distinct "REPLAY: Year N" badge + jump-to-present button when parked in the past (exists but subtle; make it loud).

### G3. Notification hierarchy
- Toasts only for tier-1 moments: war declared/ended, ruler crowned, settlement founded/razed, new chapter, followed-character death. Everything else lands silently in the Events tab with badge increment.
- Toast click = opens the matching row/chapter, never a dead end.
- **Catch-up digest**: after resume or a fast-forward jump > 5 years, one card: "While you were away: 2 wars, a plague in Baarforge, Rog Bloodeater crowned" with links. A world you mostly watch at 16x needs a "previously on" recap; this is that.

### G4. Reading mode
- Pause + open History panel = widen rail, dim canvas slightly. Signals "reading is a first-class activity", not a popup fighting the map.

Effort: ~1.5 days, pure DOM/UI, zero sim risk. The Events/Councils tabs read existing event log + journal digests; no new state.

## H. Event spotlight: in-world cues for important moments (from user feedback)

Feedback: when an important event happens, the user needs a visual cue showing WHERE it is and WHAT it is. Today an event is a line of text; the world itself never points at anything.

### H1. Event beacons (the core cue)
- Tier-1 event fires → expanding ring pulse at its map location: 2-3 rings over ~1.5s, category color (war red, crown gold, disaster purple, founding green), category icon in the center.
- Screen-space sized: the beacon is the same visible size at every zoom, so a war on the far side of the island still reads at World zoom.
- After the pulse, the beacon decays to a small persistent icon pin that lives for ~1 season of sim time, clickable (= camera jump + why-chain). Recent history stays discoverable on the map itself.

### H2. Edge-of-screen arrows (guidance when off-viewport)
- Event outside the current viewport → arrow chip at the screen edge along the bearing to the event: category icon + color, slides in, lingers ~4s.
- Click arrow = eased camera pan to the event (not a hard teleport; keep spatial continuity).
- Max 3 arrows at once, oldest evicted; more than 3 pending = single "+N" chip that opens the Events tab (G1).

### H3. Minimap + timeline echo
- Same moment, same color, three places: beacon on map, ping ring on minimap, marker dropping onto the timeline (G2). One visual language everywhere; user learns it once.
- Minimap ping generalizes A4's battle pings to all tier-1 events.

### H4. Director mode (optional, default off)
- Toggle: camera auto-follows the story: tier-1 event fires → smooth pan/zoom to it, dwell ~4s, return (or chain to next event). Basically an ambient screensaver / "let the world show me" mode.
- Off by default; manual camera always cancels it instantly. Pairs with postcard mode (H key) for demos.

### Tier map (single source of truth, shared with G3 toasts)
- Tier-1 (beacon + arrow + toast + minimap + timeline): war declared/ended, battle joined, settlement founded/razed, ruler crowned/dead, plague/dragon/major disaster, new chapter's anchor event.
- Tier-2 (minimap ping + Events-tab row only): raids, caravans robbed, alliances, tribute events.
- Tier-3 (Events tab only): everything else.

Determinism note: cues are render-layer reactions to event-log entries; scrubbing to Year 912 replays the same beacons at the same moments. No sim state.

Effort: ~0.5-1 day. Beacon/arrow/ping are one pooled particle system + one bearing calc; tier map is a lookup table.

## I. World statistics: charts, tables, numbers (from user feedback)

Feedback: "User has 0 information what is happening to the world; they only see year and population. Nothing changes for years."

Good news: the data already exists. `YearStats` (state.ts) records per-faction population, food, territory, ore, warTicks, and LLM coverage EVERY YEAR since Year 0, and `deathsByCause` accumulates too. The sim has been keeping the books for centuries; the UI just never opened them. Charts are hand-rolled canvas lines (zero-dep rule holds; a line chart is ~40 lines of code).

### I1. Stats tab (fourth tab in the G1 History panel)
- **Population chart**: per-faction lines in faction colors over all recorded years. War dips, plague cliffs, and golden ages become visible instantly. THE single chart that fixes "nothing changes for years": things change constantly, invisibly.
- **Territory chart**: per-faction area over time (currently flat: F fix makes this chart honest).
- **Food security chart**: per-faction food per capita; famine bands shaded.
- **War intensity strip**: warTicks per year as a heat ribbon under the charts, aligns with pop dips.
- Hover any chart = crosshair with year + values; **click = time-machine seek to that year** (charts become a second timeline; uses existing seek).
- Era bands (G2 colors) as chart background so charts and timeline speak the same language.

### I2. Always-on HUD strip (glanceable numbers)
- Top bar: one chip per faction: color swatch, name, pop with trend arrow (▲▼ vs 10y ago), tiny 50y pop sparkline, ⚔ icon when at war, skull when < 50 souls.
- Click chip = faction sheet (I3). Replaces the lone "925 souls" counter with per-kingdom pulse.

### I3. Faction sheet (click faction chip / territory)
- Header: banner color, name, race, current ruler (portrait + reign length).
- Numbers: population, settlements (list, click = jump), army size, granary total, territory %.
- Diplomacy row: relation chip to each other faction (allied / neutral / trade / war + grudge count).
- Ruler history table: name, reign years, fate (natural / battle / succession crisis), decisions made (links into Councils tab).
- Mini charts: this faction's pop + food, 100y window.

### I4. Diplomacy matrix (world politics at a glance)
- N×N grid, faction colors on both axes, cell = relation state color + years-at-current-state. War cells pulse red. One glance answers "who hates whom", which today requires reading the feed for an hour.

### I5. World records (flavor, cheap, sticky)
- Longest reign, bloodiest war (deaths), oldest living pawn, largest city ever, longest peace, most rulers in a decade. Derived from events + yearStats at panel-open time. Gives the chronicle numbers to brag about.

Data gaps to add sim-side (additive, low risk, golden re-baseline): births/deaths per faction per year (currently only global deathsByCause), battle-deaths counter per war (bloodiest-war record), trade-volume per year (optional, for an economy chart later). Everything else ships with zero sim changes.

Effort: I1+I2 ~1 day; I3-I5 ~1 day; sim counters ~0.25 day.

## Effort and order

| Phase | Contents | Est. |
|-------|----------|------|
| D | far-zoom map mode (D1-D3) | ~1 day |
| A | war readability (A1-A5) | ~1 day |
| B | living world (B1-B5) | ~1.5-2 days |
| C | info layer (C1-C3, minus C1 which moved into D2) | ~0.5 day |
| E5 | coastline noise + rivers (visual variety, low risk) | ~0.5 day |
| E1-E4 | archetypes, landmarks, climate, faction mixes | ~2-3 days + balance soaks |
| F | expansion deadlock fix (sim) | ~0.5 day + soak |
| G | narrative UX: history panel + timeline v2 (G1-G4) | ~1.5 days |
| H | event spotlight: beacons, edge arrows, director mode (H1-H4) | ~0.5-1 day |
| I | statistics: charts, HUD chips, faction sheets, diplo matrix (I1-I5) | ~2 days |

Recommended order: **D + G + H + I1/I2 first** (D = "what am I looking at", G = "what is happening", H = "look HERE", I = "prove the world is alive with numbers"; together they fix comprehension), then A (war clarity, reuses D's banner icons and H's beacons), then F (borders actually move, giving D and the territory chart something to show), then B2+B4 (cheapest wow per hour), then B1+B3+B5, then C, then E5 and I3-I5. E1-E4 is a separate milestone: it is sim-side, every archetype/climate needs its own 200y no-extinction soak, and golden seeds re-baseline. Screenshots that drove this: `docs/screenshots/audit-farzoom.png`, `docs/screenshots/audit-local.png`.

## Explicitly out of scope (unchanged from 00-vision anti-scope)

- WebGL2 rewrite (stays on post-MVP shelf; Canvas2D budgets still hold)
- Player interaction of any kind
- New sim mechanics dressed as visuals (e.g. real wildlife ecology)

## Perf guardrails

- Terrain chunk cache stays; ambient anims must not force per-frame chunk rebakes.
- Particle budget: hard cap ~200 live particles, pooled, zero allocation per frame.
- Banner units *reduce* draw calls at far zoom (one sprite replaces N pawn dots), so A1 likely improves perf.
- Re-run `node scripts/perf.mjs` + a 60fps spot check at Region zoom after each phase.
