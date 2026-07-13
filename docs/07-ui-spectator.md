# 07 — Spectator UI/UX

## Stance

Observer-only means the UI *is* the gameplay. The player's verbs: watch, read, follow, rewind, inspect. Every panel serves one of those. UI built with Preact (or vanilla + lit-html) in normal DOM overlaying the canvas — sim rendering stays canvas, text-heavy panels stay DOM (accessibility, selection, scrolling for free).

## Screen layout

```
┌─────────────────────────────────────────────┬──────────────┐
│                                             │  Chronicle    │
│                                             │  panel        │
│              World canvas                   │  (collapsible │
│                                             │   right rail) │
│  [overlay toggles]              [minimap]   │               │
├─────────────────────────────────────────────┴──────────────┤
│  Event feed (ticker)                                        │
├─────────────────────────────────────────────────────────────┤
│  ◀◀ ─────────●───────────────── ▶▶   Year 213   ⏸ 1× 4× 16× │
│  Timeline with event markers                                │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Time controls + timeline (the marquee)
- Pause / 1× / 4× / 16× (space = pause, 1–3 = speeds; hotkeys throughout). Speed labels state LLM depth honestly (05): "kings think deeply / quickly / by instinct".
- **Timeline scrubber:** full history, era-colored bands, event markers sized by severity (war = crossed swords, plague = skull, dragon = 🐉-tier flame icon). Click = seek (keyframe + fast-forward, 01).
- **Hover preview (video-player pattern):** hovering the timeline fades in (delayed ~150 ms — no flicker storm while sweeping) a mini-card: year, era name, top event, and a tiny map thumbnail rendered from the nearest keyframe. Thumbnails pre-render at chapter moments, not fixed intervals — previews land on *meaningful* moments.
- **Two-stage precision (500 years on one strip is unscrubbable):** stage 1 = era band; clicking an era expands it to a decade-resolution strip for fine seeking. Long-timeline precision is a solved video-UX problem; we import the solution.
- **Perceived seek latency is THE scrubbing-quality metric:** on seek, snap the island-level aggregate view to the target year *instantly* (from keyframe), then refine detail as fast-forward completes (<2 s budget). Instant coarse feedback beats a 2-second spinner.
- **Live edge vs past:** scrubbed into the past = "REPLAY" badge; jump-to-present button. Past is immutable (replayed from journal), present continues simulating. One world-line, no branching (branch-from-past = post-MVP maybe, off the table for now).

### 2. Event feed
- Bottom ticker, newest first when paused, streaming when running. Severity-filtered (slider: all / notable / major). Race/faction icons + short text: "⚔ Y213: Orcs declare war on Elves — *grain tribute refused*".
- Click event → camera jumps to location + opens its causality chain. The feed is the hook into everything else.
- Rate-limited display (batch minor events per season) — no scroll-blindness at 16×.

### 3. Chronicle panel (right rail)
- The history book, chapters appearing as written (05). Era-titled table of contents, collapsible.
- **Paragraph anchors:** hover highlights region on map; click = time-machine seek + camera move. This interaction is the product's soul — it must be silky.
- Faction-bias toggle per chapter (orc telling / elf telling) once implemented.
- "Chronicler is N years behind" indicator when the LLM queue lags (05); catch-up happens during pause — pausing to read is natural anyway.
- Export button → standalone HTML/markdown of the full book.

### 4. Council panel (king reasoning — shareable moment #1)
- When a journaled king decision applies: toast notification ("Gruk has made a decision") → click opens council panel: persona portrait (procedural), the situation digest summarized, options considered, **the reasoning verbatim**, choice highlighted.
- Auto-pause option on major decisions (war declarations) — default ON at 1×, OFF at 16×.
- Every past decision browsable from the character sheet and from timeline markers.

### 5. Follow mode & inspector
- Click pawn/character → inspector (03): needs, action scores, family, biography.
- "Follow" pins camera; smart follow keeps followed pawn in center at speed. Following a named character surfaces their event stream and chronicle mentions.
- Character directory: living named characters, sortable (kills, age, title); dynasty tree view per faction (genetics/succession made visible — 04).

### 6. Causality chain view
- From any major event: horizontal chain visualization — war ← insult ← failed marriage ← famine ← drought. Each node clickable (seek). Depth-capped display (5 hops) with "show more".
- Locations of chain nodes pulse on map while open (06 overlay). This is the "world remembers" feature made tangible; must feel effortless.

### 7. Overlays & minimap
- Toggle group (hotkeys T/P/F/W): territory, population heat, food scarcity, war fronts. One active at a time + territory combinable.
- Minimap: whole island, camera rectangle, war markers; click to move camera.

### 8. Camera controls
- Pan: mouse drag (grab cursor), WASD/arrow keys, minimap click. NO edge-pan (fights browser chrome).
- Zoom: **wheel zoom-to-cursor** (the point under the mouse stays put — the single biggest feel detail in map UIs), +/- keys step the 4-level ladder (06), double-click = zoom in one level centered.
- Smooth eased transitions between zoom levels (~200 ms); camera position clamps to island bounds with soft rubber-band.

### 9. Global search (the reader's tool)
- One search box (hotkey `/`): characters, places, events, chapters, eras — fuzzy match over all named entities.
- Results grouped by type; selecting one offers its jump targets: chronicle anchor (open chapter), timeline moment (seek), map location (camera move), character sheet.
- "Gruk" → his biography, his chapters, his decisions, his death. Search is how a 500-year world stays navigable; without it the book is read-once.

### 10. Step controls & notifications
- While paused: `,` / `.` step one season / one year (video-player frame-advance, adapted) — precision watching around battles and betrayals.
- Background chronicle completion raises a subtle toast ("New chapter: *The Grain War*" — click to open). New eras get a slightly grander one.
- Followed character dies → camera releases with an in-world toast ("Gruk is dead. [View his end]" → jumps to the death event), never a silent snap.

### 11. Onboarding & ambient docs
- First-run: 5-step tooltip tour (speed controls → event feed → click an event → chronicle → scrub timeline). No tutorial gates — it's an ant farm, let them poke.
- Empty chronicle at year 0 shows "The historian waits for something worth writing..." — sets expectations while early sim is quiet.

## New-world flow

1. Landing: seed input + "Random", world-size preset (MVP: one size), fixed 4-faction setup (race mix configuration is post-MVP, per 04), LLM status indicator (ollama/API key detected: "Kings will think" / absent: "Kings will rule by instinct", with setup hint).
2. Generate → seed-browser-style preview thumbnail + island name → "Begin History".
3. Autosave journal to IndexedDB every game-decade; resume list on landing page. Journal export/import as file (share your world).

## Polish standards (research-backed)

- **Animation timing:** UI transitions 100–400 ms (NN/g band); panel slides ~200 ms, tooltip fades ~150 ms, map-mode/overlay transitions ~300 ms crossfade (Paradox Victoria 3 lesson: smooth mode switches read as quality). Nothing bounces, nothing loops. Microinteractions are feedback, not decoration — every animation answers "did my input register?"
- **Tooltip policy (anti-Paradox-nested-hell):** max ONE level of tooltip. Anything deeper (price breakdowns, morale math, grudge ledgers) lives in a *pinned inspector panel* the tooltip links to ("click to inspect"). Tooltip hierarchy: the number the player needs first, on top; provenance below.
- **Progressive onboarding (2025 standard — teach in play, not up front):** the 5-step tour is contextual and lazy: each hint fires the first time its feature becomes relevant (first war → "click the event to see why"; first chapter → chronicle hint), dismissible, never blocking, "don't show hints" honored globally. No tutorial wall before the first minute of watching.
- **Layout memory:** panel collapsed/expanded states, overlay choice, speed, and font size persist in localStorage — the app remembers how you like to watch.
- **Perceived responsiveness:** every click acknowledges within 100 ms (highlight, ghost state) even when the real work (seek, chronicle render) takes longer. Progress states only past 400 ms; skeleton shimmer over spinners.
- **Empty/loading states are voiced:** chronicle waiting ("The historian waits..."), LLM queue lag ("The chronicler is 3 years behind"), seek in progress ("Traveling to Year 213..."). The UI speaks in-world, never in tech.

## Keyboard map (unified — conflicts checked here, not discovered later)

| Key | Action |
|---|---|
| Space | pause/resume |
| 1 / 2 / 3 | speed 1× / 4× / 16× |
| , / . | step season / year (paused) |
| WASD / arrows | pan camera |
| + / − | zoom ladder step |
| T / P / F / W | overlays (territory / population / food / war) |
| / | global search |
| C | chronicle panel toggle |
| E | event feed focus |
| Esc | close topmost panel / cancel follow |
| F5-style browser keys | untouched — never trap browser shortcuts |

## Layout minimums

- Min supported: 1280×720 (13" laptop). Below 1440 px width: chronicle rail becomes an overlay drawer; below 900 px height: event feed collapses to one line. Canvas never drops below 60% of viewport area.
- Desktop browsers only (00 anti-scope) — but desktop includes small laptops, and the layout must honor them.

## Accessibility & QoL

- All info conveyed by color also has icon/shape (faction icons, not just colors)
- Font-size setting for chronicle text; panels collapsible to zero-chrome "postcard mode" (06)
- Pause-anytime, everything readable while paused — respect the reader

## Anti-goals

- No notification spam settings maze — one severity slider
- No stats-dashboard-first design: numbers live behind inspector/overlays; *story* lives up front
- No modal dialogs that block the sim view; everything is panel or toast
