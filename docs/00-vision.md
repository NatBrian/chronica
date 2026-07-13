# Chronica : Vision

> **One-liner:** A god-sim ant farm where you read the history book your world wrote about itself; and click any paragraph to travel back and watch it happen.

## What it is

An observer-only fantasy world simulation running in the browser. Procedurally generated island, multiple races/factions, thousands of autonomous pawns who farm, hunt, build, procreate, and wage war. No player powers, no direct control. The player watches, reads, and rewinds.

Three headline features, mutually reinforcing (the "wow stack"):

1. **Thinking kings** : named leaders (kings, chiefs, prophets) make strategic decisions via a local LLM. Their reasoning is visible to the player as it happens. Wars have motives you can read, not dice rolls.
2. **Living chronicle** : an LLM historian turns the event stream into a written history book with eras, chapters, and character arcs. Optionally biased per faction (the orc version vs the elf version of the same war).
3. **Time machine** : the simulation is strictly deterministic. Seed + decision journal = the entire history is replayable. A timeline scrubber lets the player jump to any year. Clicking a chronicle paragraph jumps the camera to that year and place.

## Why this wins (July 2026 landscape : full survey in 09)

- **WorldBox / DF / RimWorld** : deep rule-based sims, zero AI reasoning, no narrative memory, no replay. We cannot out-content WorldBox; we out-*story* it.
- **Project Sid / Emergence World / AIvilization** : research demos with LLM-per-agent architectures. Impressive emergence, unwatchable as games, ruinously expensive inference.
- **WarAgent / AI_Diplomacy** : LLMs make real strategic decisions with memory and grudges, but in text/board worlds. Validates thinking-kings; no living world to watch.
- **AEON Living Worlds** : closest convergent project (browser, deterministic core, optional local-LLM narrator, chronicle, replay). Its LLM *narrates but never affects outcomes*; prototype-grade, heavy Python backend, noncommercial license.
- **The gap:** nobody combines *LLM decisions that change history* with *bit-identical replay* (our decision-journal trick), nor links a chronicle to a time machine. That combination is the technical thesis of this project.

Positioning: *99% rules, 1% LLM, 100% story*; and the 1% actually steers history without breaking determinism.

## Design pillars

1. **The world remembers.** Every major event stores its cause. Wars trace back through insults, famines, and grudges. Causality is data, not flavor text.
2. **Emergence must be legible.** Raw emergence is noise. Every system feeds the chronicle and the event feed so the player can follow the story.
3. **Determinism is sacred.** No system may introduce nondeterminism into the sim core. LLM outputs are journaled external inputs, never inline randomness. This rule is enforced from day 1 and never waived.
4. **Watchability over interactivity.** Spectator UX (timeline, follow-cam, event feed, chronicle panel) is first-class feature work, not chrome.
5. **The sim must run LLM-less : no-GPU users are a first-class audience.** Every LLM decision point has a rule-based fallback and the chronicle has a template mode; the full sim, time machine, and causality features work on any laptop in a browser tab with zero local AI. The sim never blocks on inference. LLM enriches; it is never load-bearing for the tick loop.

## Explicit non-goals (anti-scope)

- ❌ Player god powers or pawn control (observer only : locked)
- ❌ LLM brain per pawn (Sid's money pit; local 12B cannot serve 500+ agents)
- ❌ Multiplayer, networking of any kind
- ❌ 3D rendering
- ❌ Continent/planet-scale maps (one island, that's it)
- ❌ Mobile support (desktop browser only)
- ❌ Mod support (maybe post-1.0, not before)

## Target experience

Player opens a browser tab, picks a seed (or randoms one), presses play. Over 20–60 minutes of real time, 500 years of history unfold at adjustable speed. They watch kingdoms rise, read the chronicle as chapters appear, pause when the event feed flags a war, follow a named hero, and afterward export "The History of Island {name}, Years 1–500" as a document : then scrub back to year 213 to watch the betrayal that started it all.

## Success criteria (MVP)

- 500-year run completes without extinction or frozen equilibrium in >80% of seeds
- Same seed + same journal replays to bit-identical world state
- Chronicle output is readable and factually consistent with the event log
- 2,000+ pawns at 60fps render / 10+ ticks-per-second sim on a mid-range machine
- One clip-worthy moment per run (a king's readable reasoning, a traceable war cause)

## Document map

| Doc | Covers |
|-----|--------|
| [01-architecture.md](01-architecture.md) | Engine, ECS, tick loop, determinism, time machine |
| [02-worldgen.md](02-worldgen.md) | Procedural island generation |
| [03-agents.md](03-agents.md) | Pawn needs, utility AI, jobs, lifecycle |
| [04-society.md](04-society.md) | Factions, economy, war, diplomacy, genetics |
| [05-llm.md](05-llm.md) | Thinking kings, chronicler, ollama integration |
| [06-rendering-assets.md](06-rendering-assets.md) | Canvas rendering, procedural pixel art |
| [07-ui-spectator.md](07-ui-spectator.md) | Observer UX, timeline, event feed, chronicle panel |
| [08-roadmap.md](08-roadmap.md) | Build order, milestones, risk register |
| [09-landscape.md](09-landscape.md) | Competitive survey (July 2026), differentiation, threats |
| [10-edge-cases.md](10-edge-cases.md) | Edge-case registry: trigger → handling → owner, all tested |
