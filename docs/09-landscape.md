# 09 — Competitive Landscape (GitHub survey, July 2026)

Survey of open-source world-sim / LLM-agent projects 2024–2026, to position Chronica's wow. See also 00 §Why this wins.

## Category map

### A. LLM-as-strategist (research-flavored, text-first)
| Project | What | Takeaway for us |
|---|---|---|
| [WarAgent](https://github.com/agiresearch/WarAgent) (2023–24) | LLM agents as WWI/WWII countries | Proves LLM strategic decisions work; text-only, no living world, no watchability |
| [AI_Diplomacy](https://github.com/GoodStartLabs/AI_Diplomacy) (2025) | Frontier models play Diplomacy, agents hold state/relationships/negotiations | Closest validation of "kings with memory + grudges"; but board game, not a sim world |
| [CivAgent](https://github.com/fuxiAIlab/CivAgent) (NetEase Fuxi) | LLM digital player inside Unciv | LLM plays an existing game; doesn't own the world or the story |
| [WargamesAI](https://github.com/user1342/WargamesAI), [LLMWargaming](https://github.com/ancorso/LLMWargaming) | Professional wargaming toolkits | Serious-use niche; confirms decision-digest → constrained-choice pattern |

### B. LLM-as-society (many-agent emergence)
| Project | What | Takeaway |
|---|---|---|
| Project Sid / FRL (2024–26) | 1000 agents in Minecraft, religion/tax/constitution | Category king; LLM-per-agent = cost wall we deliberately avoid |
| [SimWorld](https://github.com/SimWorld-AI/SimWorld) (2025–26) | UE-based open-ended sim platform for LLM/VLM agents | Research infra, not a product |
| [Alien Civilizations](https://github.com/MingyuJ666/Simulating-Alien-Civilizations-with-LLM-based-Agents) (2024–25) | LLM civs with different world views | Paper-ware |
| Curated lists: [AI-Synthetic-Society-Experiments](https://github.com/danielrosehill/AI-Synthetic-Society-Experiments), [LLM-Agents-for-Simulation](https://github.com/giammy677dev/LLM-Agents-for-Simulation), [awesome-LLM-game-agent-papers](https://github.com/git-disl/awesome-LLM-game-agent-papers) | — | Field is big and paper-heavy; shipped watchable *products* remain rare |

### C. Classic procedural history sims (no/低 LLM)
| Project | What | Takeaway |
|---|---|---|
| [RyanBabij/WorldSim](https://github.com/RyanBabij/WorldSim) | Tile sandbox, 3 races, dynamic history | Pre-LLM generation of our idea; text-log history, no narrative layer |
| [goblin-sim](https://github.com/leadnaut/goblin-sim), [df-style-worldgen](https://github.com/Dozed12/df-style-worldgen) | Procedural history generators | "History generation" long-standing hobby genre; none make history *readable or replayable* |
| [emergent-fable-generator](https://github.com/mpuchstein/emergent-fable-generator) (2026, Godot) | Utility-AI animals + template chronicle, explicitly no LLM | Chronicle idea validated at toy scale; 8 agents, template prose |

### D. ★ Direct competitor
**[AEON: Living Worlds](https://github.com/Linutesto/aeon-living-worlds)** (2025–26, ~75 stars, prototype, PolyForm noncommercial)
- Browser world sim; deterministic Tier-0 core; **optional local ollama LLM as "world-spirit" narrator**; thousands of citizens w/ memories & beliefs; chronicle of wars/famines/schisms; seed-deterministic; replayable; Python/FastAPI backend + Three.js 3D frontend.
- Convergent evolution: they independently arrived at "deterministic core + optional local LLM + chronicle." Validates our whole architecture thesis.
- **Their LLM never affects outcomes** ("bends presentation rules but never outcomes") — narration only.
- Status: experimental prototype, 8 commits, heavy stack (Python backend + CUDA optional), noncommercial license.

## Chronica differentiation (what nobody in the survey has)

1. **LLM decisions that change history, deterministically.** AEON's LLM narrates; WarAgent's LLM decides but has no world. Chronica's kings *decide* — and the decision-journal trick keeps replay bit-identical. Nobody in the survey combines "LLM affects outcomes" with "perfect replay". This is the technical thesis.
2. **Visible in-character reasoning at decision moments** (council panel). WarAgent/AI_Diplomacy log reasoning for researchers; nobody stages it as a spectator moment.
3. **Chronicle ↔ time machine link.** Several projects have chronicles (AEON, fable-generator); several have replay (AEON). None have *click a history-book paragraph → seek to that year and watch it*. That interaction appears in zero surveyed repos.
4. **Causality DAG as first-class data.** Surveyed chronicles narrate event streams; none store queryable cause-chains (war ← insult ← famine ← drought).
5. **Zero-install, zero-backend.** AEON needs Python+FastAPI(+CUDA); Sid needs Minecraft+infra. Chronica = one browser tab, sidecar optional. Distribution wow matters.
6. **Faction-biased dual histories.** Not found anywhere in the survey.

## Threat assessment

- AEON grows up and adds decision-making LLM: possible, but noncommercial license + heavy stack + narration-only philosophy stated explicitly. Watch it.
- FRL/Sid productizes: their trajectory is agent-company enterprise, not god-sim games.
- Someone clones us post-launch: chronicle-quality + determinism discipline are the moats; both are craft, not secrets.

## Conclusion

Idea is *au courant*, not old: category (deterministic sim + local-LLM story layer) emerged 2025–26 and is still prototype-grade everywhere. Our 3 pillars survive contact with the field intact; pillar-combination (deciding-LLM + replay + clickable chronicle) remains unclaimed. Proceed per 08 roadmap, no design changes required. Re-survey at M4.

---

## Survey update — 2026-07-13 (M4 exit re-check)

- **AEON Living Worlds** (github.com/Linutesto/aeon-living-worlds): evolved since the last survey — now couples a "deterministic Tier-0 sim" with optional local-LLM "world-spirit" tiers that *interpret or nudge* outcomes; thousands of citizens with memories/beliefs; real-time 3D dashboard; targets a single RTX 4090; still an explicit experimental prototype.
- **Differentiation holds:** Chronica's thesis remains unclaimed — (1) LLM decisions that *are* history (journaled inputs, bit-identical replay, zero LLM calls on replay — AEON's LLM nudges, ours RULES and replays); (2) chronicle paragraphs as time-machine anchors (click prose → travel); (3) budget floor: full product on any laptop, LLM-less first-class, 84 KB gzipped static bundle vs 4090-class 3D client.
- No new entrant found combining deciding-LLM + deterministic replay + chronicle-anchored time travel.

Sources: [aeon-living-worlds](https://github.com/Linutesto/aeon-living-worlds), [Paracosm](https://paracosm.agentos.sh/), [SimWorld](https://github.com/SimWorld-AI/SimWorld)
