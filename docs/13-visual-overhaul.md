# 13 : Visual Overhaul (v2.5): from readable to spectacular

Status: EXECUTION PLAN. v2 (doc 12) made the sim comprehensible; this doc makes
it worth staring at. Companion audit screenshots: `docs/screenshots/audit2/`.
Ground rules of docs 01/11 hold in full: zero `/src/sim` changes anywhere in
this doc, render clocks from rAF time, all VFX derivable from (event log +
current state) so time-machine scrubs replay identically, DB32 palette only,
zero runtime deps, 60fps at Region zoom with 2000+ pawns.

## The audit (2026-07-14, live worlds Aerreach Y1040 + Wynost Y1630)

What the screenshots actually show:

1. **Events are icons, not moments.** A coalition war, a dragon raid, a
   coronation: each is a 10px glyph plus a toast. The user's words: "viewer
   can see wow they are fighting, not only see there is a fight icon". This
   is the core failure and the core deliverable (V2 below).
2. **UI occlusion crisis.** Three simultaneous wars = three stacked war strips;
   three toasts pile on the right; HUD chips clip off the top edge. At world
   zoom roughly half the map is under chrome (audit-world.png).
3. **Terrain monotony.** Local zoom is a single flat green (audit-local16.png).
   No grass variation, no trees near towns, lakes are flat blobs, no shores.
4. **Building monotony.** One hut sprite stamped in a grid 50 times per town.
5. **Label pileups.** North coast of Aerreach: five settlement labels overlap
   into an unreadable stack.
6. **Emoji vs pixel art.** Monsters, battle markers, feed glyphs, buttons are
   OS emoji floating over DB32 sprites. Reads as a prototype.
7. **Timeline mush returns at 1000+ years.** The cluster pass (M7) saturates
   again on old worlds (audit-close-chronicle.png bottom strip).
8. **Landing page is a bare form** and the `gen-preview` canvas sits unused.

## Phases (strictly ordered; commit + screenshot proof per phase)

### V1. UI decongestion (clean the stage before the show)

- **War strip tabs.** One compact strip, wars as small tabs (A3 spec already
  said tabs); active tab shows detail, others show `⚔ name` chips. Hard cap
  one row of height.
- **Toast coalescing.** Same-category toasts within 5s merge ("3 kings hold
  council"); max 3 visible, overflow increments the Events badge. Decision
  toasts for the same war merge into its war tab flash.
- **Label decluttering.** Priority ladder at far zoom: capitals + towns >=200
  pop always; villages when < 12 labels on screen; hamlets on hover only.
  Collision pass nudges labels vertically; pop badge folds into the label chip.
- **HUD chip bar.** Single top-center flex bar, never clipped, extinct
  factions drop out, > 5 factions collapses to swatch + pop only.
- **Timeline density v3.** Bucket width scales with world age (6px per century
  over 600y), two marker rows max, cluster count rendered as marker size only.

Exit: audit-world scene reshot with 3 wars + 3 toasts active shows >= 80% of
map pixels unobstructed; zero overlapping labels at world zoom on Aerreach.

### V2. Event Spectacle Engine (THE deliverable)

One system: `src/render/spectacle.ts`. A scene director that consumes tier-1
events and plays a scripted, multi-second, in-world choreography at the event
location. Scenes are keyframe scripts over pooled sprites/particles/overlays;
scene state derives from (event, sim snapshot, rAF clock) only, so scrubbing
to Year 912 replays the same show. Screen feedback allowed: <= 3px camera
shake, brief white/red flash vignette, letterbox title cards. Budget: <= 300
pooled particles, zero allocation per frame, scenes hard-capped at 8s.

The scene table (every unique moment gets its show, not just combat):

| Event | The show |
|---|---|
| Battle joined | Two soldier lines CHARGE across the gap; weapon-spark flashes at the contact line; arrow arcs; red x pips float per casualty batch; dueling morale bars hover over the field; dust wake grows |
| Rout | Loser's banner topples and falls into the mud; fleeing pawns get motion streaks; victor line surges 2 tiles; crows settle after |
| Siege | Capture bar becomes a physical event: wall-crack overlay widens with progress, fire arrows at 75%, gate-breach flash + smoke burst at 100%, then the banner-swap animation on the keep |
| Dragon raid | FORESHADOW: circling shadow sweeps the map ~4s before arrival; dive with wind streaks; fire cone ignites tiles (burning overlay + ember particles); granary detonates in a grain-puff; dragon silhouette departs with the shadow |
| Wolf / troll | Pack silhouettes lope in from map edge leaving track marks; troll thumps down with a dust ring and squats: road visibly detours |
| Plague | Sickly green ring creeps outward from the hub settlement; infected houses hoist small black flags; pawns tint pale; recovery dissolves the ring in sparkles |
| Razing | Fire spreads building to building (staggered ignition), smoke column tall enough to see from world zoom, refugees stream out as a walking line with bundles, charred ruins remain |
| Coronation | Golden rays burst from the keep; a pixel crown descends onto it; nearby pawns walk in and form a cheering ring; faction banner does a wave ripple |
| Settlement founded | Covered-wagon column walks in from the mother town; tents pop up one by one; first chimney smoke; the name label types itself letter by letter |
| Rebellion / secession | Territory blocks flip color in a ripple wave outward from the town; the old banner burns on the keep; an angry crowd ring gathers; new banner rises |
| Succession crisis | The keep dims; black mourning banners; lightning-crack vignette on the fracture moment |
| Famine | Slow desaturation aura over the settlement; circling crow dots; gaunt slow pawn shuffle (walk speed visual only) |
| Alliance / wedding / festival | Bonfire + firework pixel bursts + a dancing ring of pawns; linked banner ribbons for alliances |
| Era turn | 3s letterbox title card: "THE AGE TURNS: years of plenty" over a slow full-map color-grade shift that then persists subtly for the era |
| Starred character death | Slow vignette, a light beam at the spot, the world dims 1s; memorial pin lingers |

Interaction: clicking any running scene opens its why-chain; hovering shows a
caption ("The host of X storms the gates of Y"). Director mode (H4) chains the
camera between scenes automatically: the ambient screensaver.

Wiring: Beacons already classifies tier-1 events; SpectacleDirector subscribes
to the same stream, plays the scene when the event is within the viewport (or
when director mode drags the camera there). Beacon pins remain for off-screen
events. Two waves: core five first (battle, rout, siege, dragon, razing +
coronation), second wave the rest.

Exit: at 1x, a battle reads as a BATTLE from charge to rout with zero UI text;
a dragon raid is a 15s sequence a viewer would screen-record; scrubbing back
replays the identical show; perf still 60fps at Region zoom.

### V3. Terrain beauty pass (bake-time, zero runtime cost)

All inside the chunk-cache bake: grass micro-variation (3 DB32 tones scattered
by tile hash), dithered 2px biome transitions, tree clumps with 1px shadows,
shore foam line + wet-sand ring, lake/sea depth gradient, river glint pixels,
rock + flower + bush decals seeded per tile, farm plots get fence pixels and
soil tone distinct from grass.

Exit: audit-local16 reshot: no two adjacent screen tiles identical; water has
a readable shoreline; a forest looks like a forest, not green static.

### V4. Living ambience (render loop, budgeted)

Chimney smoke per settlement scaled to pop; water shimmer (2-frame shore
alternation baked as chunk variants); weather made visible: rain streaks,
snowflakes, drought heat-haze bands (weather state already in snapshot);
seasonal strong pass (spring blossom speckle, autumn oranges, winter snow
cover + roof caps); caravan routes drawn as worn dirt paths (opacity = usage)
with ox-cart sprites; birds circling towers (render-only, from render clock).

Exit: a 30s idle watch at Local zoom shows >= 4 kinds of autonomous motion
beyond pawns walking.

### V5. Asset unification + variety

- **Kill the emoji.** DB32 pixel sprites for: dragon/troll/wolf, crossed
  swords, all event-category glyphs (beacons, feed, timeline legend, buttons
  keep text). One visual language everywhere.
- **Building variety.** 3 hut variants per race + horizontal flip scatter
  (hash by tile), visible tier upgrades (village adds fences + well, town
  adds walls + keep banner, city adds towers), granary/workshop/temple
  distinct silhouettes at a glance.
- **Pawn variety.** 2 extra tunic tones + hair variation from existing pawn
  hash bits; kings get a visible crown pixel + cape at Local zoom.

Exit: a town screenshot contains >= 6 visually distinct structures; zero emoji
in any canvas layer.

### V6. Chrome + landing

Landing: render the typed seed's map into the unused `gen-preview` canvas live
(debounced worldgen preview in a throwaway worker), animated title shimmer,
laws panel styled as a stone tablet card. In-game: panel theme pass (chronicle
rail = warm parchment-on-dark, data panels = slate), bitmap pixel header font
embedded as data URI (zero-dep), unified button/tab hover states, minimap gets
a bronze frame + glass sheen.

Exit: landing screenshot looks like a game, not a form.

## Order and budget

V1 declutter (~1d) -> V2 wave 1 core scenes (~2d) -> V3 terrain (~1d) -> V4
ambience (~1d) -> V2 wave 2 scenes (~1.5d) -> V5 assets (~1d) -> V6 chrome
(~0.5d). Every phase: tsc + lint-sim + perf >= 2000 t/s + full vitest suite +
element screenshots into `docs/screenshots/v25/` + commit `V<n>: ...`.

## Perf guardrails (inviolable)

- Particle pool cap 300, shared across beacons + spectacle + ambience.
- No per-frame allocation in any scene tick; scenes precompute keyframes on
  event arrival.
- Terrain work bake-time only; ambience may not force chunk rebakes except at
  season boundaries (4/year).
- Spot-check 60fps at Region zoom with an active battle scene + rain.

## Landmines (inherited + new)

- Vitest single-thread, one run at a time; suite ~35min; run in background.
- Playwright: element screenshots only; browser_evaluate promises must resolve
  < 30s; HMR reload kills pending evaluates.
- Emoji in EXISTING baked docs/tests strings stay (only canvas layers change).
- Scenes must handle the event being razed/gone by the time the camera looks
  (settlement razed mid-scene: fall back to location-only effects).
- 16x speed: scenes compress to their first 2s or drop to beacon-only; never
  queue unbounded scene backlogs (cap 3 concurrent, severity-priority).
