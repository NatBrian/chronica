# Chronica

**A god-sim ant farm where you read the history book your world wrote about itself — and click any paragraph to travel back and watch it happen.**

An observer-only fantasy world simulation in the browser. One procedurally generated island; humans, elves, dwarves, and orcs farm, trade, scheme, and war over 500 years — while three headline systems turn the emergence into story:

1. **Thinking kings** — faction leaders make strategic decisions via a local LLM (ollama). Their in-character reasoning is readable in the council panel. No GPU? Kings rule by instinct (a competent rule-based strategist) and the whole sim still works.
2. **The living chronicle** — an LLM historian clusters the causality DAG into chapters and writes the island's history book as it happens. Every fact is validated against the event log; prose that invents names or years is rejected. LLM-less mode gets honest template chapters.
3. **The time machine** — the sim is strictly deterministic: `history = f(seed, decision journal)`. Scrub the timeline to any year, or click a chronicle paragraph to jump the camera to that year and place. Replays are bit-identical and make zero LLM calls.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # determinism suite + golden seeds + edge cases
npm run build      # static bundle in dist/ — deploy anywhere that serves files
node scripts/eval-llm.mjs   # LLM eval harness (needs local ollama)
```

**Thinking kings setup (optional):** install [ollama](https://ollama.com), pull a 4B+ instruction model (`ollama pull gemma4:12b`), and serve with `OLLAMA_ORIGINS="*" ollama serve`. Chronica auto-detects it. Alternatively store an OpenRouter/Anthropic key via the BYO-key flow (localStorage only; we host nothing).

## Controls

Space pause · 1/2/3 speeds · drag/WASD pan · wheel zoom-to-cursor · +/- zoom ladder ·
click pawn = inspector · click event = why-chain · timeline click = time travel ·
C chronicle · / search · T/P/F/Shift+W overlays · H postcard mode · G screenshot ·
,/. step season/year while paused

## Architecture

- `/src/sim` — pure deterministic core. No `Math.random`, no `Date`, no imports from render/ui/brain (lint-enforced). Fixed system order; seeded named PRNG streams; integer-dominant state.
- `/src/brain` — LLM adapters (ollama grammar-constrained JSON, BYO-key) + priority queue with adaptive quota and circuit breaker. LLM outputs become **journal entries** applied at scheduled ticks — never inline calls.
- `/src/chronicle` — chapter detector (rule code), entity/year validator, template fallback.
- `/src/render` — Canvas2D, chunk-baked terrain, 4-level zoom ladder, DB32 palette, composed pixel sprites.
- `/src/ui` — panels; dev tools at `?dev=seeds`, `?dev=layers&seed=N`, `?dev=sprites`.

Design docs in `docs/` — start with `docs/08-roadmap.md`.

## The wow demo

Watch a council toast: an orc king declares war, citing a decade-old grudge. Open the chronicle, read the chapter the historian wrote about the war. Click its first sentence — the time machine rewinds years, the camera lands on the border village where the feud began.
