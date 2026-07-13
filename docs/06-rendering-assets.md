# 06 — Rendering & Assets

## Approach

**Authored pixel templates + procedural composition.** The asset set is finite and small: ~60–80 hand-authored base templates (stored as integer matrices in code, authored during development), multiplied at boot by a composition system (palette-slot recoloring per race/faction, job-accessory overlays, building stages, age/state variants) into ~1,000 baked atlas sprites. Only per-tile terrain dither is generative, and it's seeded — same seed, same look.

Why this over the alternatives (challenged and re-affirmed):
- The composition system is mandatory under ANY asset source — 36 pawn bodies × accessories × 4 faction palettes × states ≈ 3,000 final sprites; nobody hand-draws that. The only real question is where the ~70 base templates come from.
- Code-authored matrices beat PNG files slightly: native palette-slot recolor, reviewable diffs, no binary pipeline.
- Public CC0 packs (Kenney/OpenGameArt) fail on coverage — 4 races × jobs × 4 architecture styles × damage stages doesn't exist in one consistent style, and pack-mixing reads cheap.
- **Fallback path (zero lock-in):** dev tool imports PNG → template matrix. If authored templates disappoint at M1, swap in curated CC0 sprites file-by-file; the system doesn't change.

Look target: WorldBox-adjacent — readable 8×8 / 16×16 pixel sprites, warm palette, chunky and cute enough to make war feel poignant.

## Renderer

- **Canvas2D first.** One fullscreen canvas, camera transform (pan/zoom), `drawImage` from pre-baked atlases, `imageSmoothingEnabled = false`. Camera translation snapped to integer device pixels at draw time (unsnapped smooth panning causes subpixel shimmer on crisp pixels).
- **Zoom ladder — px-per-tile levels with distinct render modes** (plain sprite scaling can't reach island view: 512×16 px = 8,192 px world; fitting a 1080p screen needs ~0.23×, which crisp scaling can't do):
  | Level | px/tile | Renders |
  |---|---|---|
  | Island | 1–2 | Aggregate: tile color + territory tint + settlement dots — a living minimap, no sprites |
  | Region | 4 | Simplified: buildings as blocks, pawns as 2px dots, banners visible |
  | Local | 16 | Full sprites — default watching level |
  | Close | 32 | 16px sprites integer-doubled — inspector zoom |
  Each level is integer-exact in its own terms; terrain chunks are baked per level.
- **Layers (draw order):** terrain → water animation → roads/fields → buildings → pawns → effects (fire, blood pools, weather) → territory overlay → selection/UI markers.
- **Terrain baking:** static terrain rendered once per camera-zoom level into offscreen chunk canvases (32×32-tile chunks). Per frame: blit visible chunks + dynamic entities only. Dirty-chunk invalidation when terrain changes (building placed, forest burned). This is the single biggest Canvas2D perf lever.
- **Pawn rendering:** ≤ ~3,000 visible sprites → batched `drawImage` calls, fine for Canvas2D. Off-screen pawns skipped by spatial index. If profiling says otherwise at scale, escape hatch = WebGL2 instanced quads behind the same renderer interface (interface designed for this swap from day 1, swap itself deferred until proven necessary).
- **Render/sim decoupling:** render thread interpolates pawn positions between the last two sim snapshots — 60 fps smoothness even at 10 ticks/sec.
- **Statistical-LOD regions** (01): rendered from aggregates — settlement icon + population dots, no individual pawns. Visual cue kept subtle so the fidelity boundary doesn't distract.

## Procedural sprite generation

At boot (seeded, deterministic — same seed, same look):

- **Terrain tiles:** per-biome base color + per-tile seeded dither/noise variation + edge-blend transitions between biomes (precomputed mask set). Animated water = 3-frame palette cycle.
- **Pawns:** template-based composition — body silhouette per race (orc bulky, elf slender, dwarf squat, human medium) + palette by faction + job accessory pixels (hoe, bow, hammer, sword) + state variants (carrying, fighting, child = smaller). ~8–16 px tall. Named characters get a subtle crown/glow pixel so they're spottable in crowds.
- **Buildings:** grammar-based: footprint + wall material (race-dependent: wood/stone/hide) + roof style + growth stages (construction scaffold → complete → damaged → burned ruin). Farms show crop-growth stages (tie to cropSystem state — visible seasons).
- **Monsters:** hand-tuned templates (wolf, troll, dragon) — few enough to hard-code as pixel matrices.
- **Effects:** fire (palette-cycled), smoke (fading dots), blood pools, snow overlay, rain streaks — all trivial particle draws, hard-capped particle count.

Technique: sprites defined as small integer matrices (paint-by-number) + palette lookup, composed/recolored at boot into atlases. Author templates via a dev-only sprite-preview page (like the worldgen seed browser — doubles as debug tool).

## Authoring process & quality gates

Format: pixel sprites (16×16 tiles, pawns ~10×14, buildings ≤32×32) as integer matrices. Not SVG — small-size vector reads as clipart, and pixel-art quality is rule-driven craft that can be checklisted; vector quality is taste.

- **Craft checklist (enforced per template):** silhouette-first (race identifiable from solid shape alone); selective 1px dark-warm outline; hue-shifted shading ramps (shadows toward blue/purple, never plain darker); ≤4 ramp colors per sprite; chunky proportions (head ≈ ⅓ body, 2px eyes); no orphan pixels.
- **Closed visual loop:** sprite-preview dev page renders all templates at 1×/2×/4× on real terrain → screenshot → visual review against checklist → iterate. Templates are never authored blind; quality comes from the loop.
- **Acceptance gates (M1 exit):** race silhouette test (blacked-out shapes distinguishable); 1× readability test; faction ramps distinct + colorblind-sim pass; side-by-side comparison vs WorldBox screenshot. A template persistently failing gates triggers the CC0-import fallback for that template.

## Palette

- **DB32 (DawnBringer-32)** — the public-domain 32-color palette designed for harmonious pixel art, proven across thousands of games. Color harmony imported as a solved problem, not invented. Single source of truth; all generation samples from it.
- Faction identity = 4-color ramp per faction assigned from palette slots (used in banners, pawn clothes, territory overlay).
- Seasonal grading: global tint shift per season (winter desaturates + blues, autumn warms). Cheap, big atmosphere.
- Day/night cycle: optional subtle darkening; low priority.

## Overlays (spectator-critical, see 07)

Territory (faction-colored translucent fill + hard borders), population heat, food scarcity heat, war fronts (crossed-swords markers + troop arrows), causality highlight (event-chain locations pulse when a chronicle chain is selected). All rendered as separate low-res canvases scaled up (one cell per tile), toggled in UI.

## Typography & UI skin

- Pixel font for flavor headers (procedurally acceptable: tiny bitmap font baked in code); system font for body text — chronicle chapters are *read*, readability beats theme.
- UI chrome minimal: dark panels, palette-accent borders. The world is the star.

## Performance budgets

| Metric | Budget |
|---|---|
| Frame budget | 16 ms (60 fps), render thread |
| Visible sprites | 3,000 @ 60 fps Canvas2D before WebGL2 escape hatch |
| Atlas memory | < 32 MB total |
| Boot-time generation | < 2 s for all atlases |
| Zoom levels | 4-level px-per-tile ladder (see zoom ladder above; no fractional sprite scaling) |

## Screenshot/clip affordances (marketing built-in)

- One-key screenshot (canvas → PNG download, includes overlay state)
- "Postcard mode": hide UI, show world + one caption (year + era name)
- Later: timelapse GIF export from keyframes (post-MVP)
