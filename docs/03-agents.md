# 03 — Agents (Pawns)

## Philosophy

Pawns are cheap, legible, and numerous. No LLM anywhere in pawn logic. A pawn is a utility-AI creature whose whole life (eat → work → pair → breed → die) exists to generate the raw material of history. Individually simple; drama comes from aggregation and from the named-character layer sitting on top.

## Needs model

Small fixed set of scalar needs, decaying per tick, integer 0–255:

| Need | Decay source | Critical effect |
|---|---|---|
| Hunger | Every tick, faster in winter/when working | Starvation damage → death |
| Energy | Work, travel | Forced rest, work speed penalty |
| Shelter | Nightly exposure without house | Cold damage in winter, morale drain |
| Safety | Proximity to combat/monsters | Flee behavior, refuses outdoor work |
| Social/Mate | Adulthood without partner | Seeks pairing (drives procreation) |

Soft-feedback rule (anti-extinction-spiral): scarcity effects ramp gradually — hungry pawns work slower and breed less *before* anyone starves. Population responds to famine with a birth-rate dip first, deaths second. Tuned so a bad year hurts and a bad decade kills.

**Mood (derived, not a need):** computed per pawn from need satisfaction + recent local events (deaths nearby, war, settlement razed, festival/harvest). No decay loop of its own — nothing new to balance. Feeds: settlement rebellion risk (04), birth rate modifier, work speed modifier; visible in inspector so unhappy villages are readable before they revolt.

## Action selection — three layers (research-backed: Sims advertisement model + IAUS curves + RimWorld priority buckets)

### Layer 1 — Reflexes (hard priority bucket, checked every tick, overrides everything)
`flee (combat/monster in radius), fight (squad engaged), eatEmergency (hunger critical), seekShelterEmergency (freezing)`
Ordered boolean checks, RimWorld-style. An emergency never loses an argmax to a tasty meal. Cheap: bitmask tests.

### Layer 2 — Utility scoring over ADVERTISED offers (staggered: 1/8 of pawns re-decide per tick)
**Smart-world inversion (The Sims):** pawns don't enumerate abstract actions; world objects advertise offers with payoffs. Ripe field advertises `farmWork`; granary-with-stock advertises `eat`; construction site advertises `build`; squad banner advertises `fight/patrol`; forming caravan advertises `caravanDuty`; overcrowded settlement's frontier site advertises `settleNewVillage`; workshop-with-ore advertises `craftEquipment`; shoreline advertises `fish`.

```
score(offer) = curve(needUrgency) × advertisedPayoff × distanceDiscount × jobAffinity × commitmentBonus
pick argmax over offers within radius (spatial index) + faction-priority offers
```

- **Response curves (IAUS), not linear urgency:** hunger curve stays flat until ~60% then spikes steeply — pawns live their lives and drop everything only when it matters. Curves are per-need data tables, tunable without code.
- **Adding an action = adding an advertiser.** Pawn code never changes. This is the complexity-control mechanism: the action catalog can grow without the decision core growing.
- **Perf:** pawn evaluates ~5–15 nearby offers, not every action × every target on the map. Early-outs: any zero factor skips the offer.

### Layer 3 — Idle/ambient
No qualifying offer → wander near home, socialize, rest. Also where `court` and `tendChild` live as low-pressure defaults.

### Anti-dithering (commitment & hysteresis)
- **Commitment:** current action runs to completion unless a Layer-1 reflex fires. No mid-furrow re-decisions.
- **Switch penalty / commitmentBonus:** staying with the current offer type scores ~15% higher than switching — kills A-B-A-B oscillation between two similar offers.
- **Staggered re-decision** (1/8 per tick) doubles as decision damping.

### Anti-oscillation at population scale
Time lags (birth → productive worker ≈ 14 sim-years) make resource-population loops oscillate or spiral (classic system-dynamics result). Damping measures, tuned via golden-seed soak tests:
- Faction-level signals (food-per-capita etc.) are **rolling averages over ~1 season**, never instantaneous values — no reaction to single-tick spikes.
- Birth-rate response to food is a soft curve with a cap (never boom to the ceiling), death response lags further (starvation takes sustained deficit) — births dip *before* deaths spike (00 pillar).
- Settlement soft capacity: crowding gently raises `settleNewVillage` advertisement instead of hard-capping growth.

Actions (MVP set): `eatFromStockpile, forage, hunt, fish, farmWork, chopWood, mine, haul, craftEquipment, buildHouse, buildStructure, rest, seekShelter, court, tendChild, flee, fight, patrol, caravanDuty, settleNewVillage`.

Notes on the less obvious ones:
- `fish` — coastal/river tiles only; the food action that makes shoreline settlements distinct (worldgen fish resource, 02).
- `craftEquipment` — converts ore/wood at a workshop into the settlement's equipment tier (04); the action behind dwarven smithing supremacy.
- `caravanDuty` — pawn joins a spawned caravan entity as porter/escort; caravan speed and survivability depend on who signs up.
- `settleNewVillage` — triggered when a settlement is overcrowded/food-stressed and the faction has an expansion order or free frontier; a founding party walks to a scored site and plants a new settlement (this is also the "founder" promotion trigger, and the growth mechanic that creates new borders → new friction).

Full action/decision inventory across all entity types — and the rule-vs-LLM split — is summarized here: pawns and every non-pawn entity (squads, caravans, monsters, herds) are 100% rule-based; the ONLY LLM surface in the whole sim is leader decision selection among rule-enumerated options (05), and chronicler prose (no sim effect).

Why utility scores over behavior trees/GOAP: tunable with data (weight tables per race/job), debuggable (inspector shows every score — "why is this pawn ignoring the field?" is answerable), and cheap. No plan-ahead search; pawns are reactive, planning lives at the faction/king layer.

**Determinism note:** tie-breaking by lowest action id, then pawn index. Never by float equality luck.

## Jobs

Jobs are emergent labels, not assignments. A pawn that keeps scoring highest on farm actions *is* a farmer; `jobAffinity` gives momentum (mild score bonus for the current job) so pawns specialize instead of thrashing. Faction-level need signals (see 04) nudge weights: granary empty → farm actions get a global multiplier for that faction.

Job mix per settlement (farmers/hunters/builders/soldiers ratio) becomes an emergent, observable stat — and a lever kings can shift via journaled decisions ("conscript more soldiers").

## Lifecycle

- **Ages:** child (0–14y) → adult (14–50y) → elder (50y–death). Ticks: 1 year = 360 ticks; ages stored in ticks.
- **Procreation:** paired adults with shelter + food surplus roll (seeded stream `rng.births`) for pregnancy; gestation ~0.75y; child follows a parent, light chores at 8+. Pairing preference: same settlement, compatible traits (see 04 §Genetics).
- **Death:** starvation, cold, combat, monsters, old age (probability ramps past 50y, modified by race + traits), disease (event-driven plagues). Every death emits an event with cause — deaths are chronicle raw material.
- **Inheritance:** traits pass to children with mutation (genetics in 04). Grudges of the *named* dead pass to heirs (society layer).

## Movement & pathfinding

- Grid movement, 8-directional, terrain-cost aware (roads later multiply speed).
- **Flow fields per destination-cluster,** not per-pawn A*: settlements maintain shared fields toward common targets (granary, fields, forest edge, war rally point). A pawn samples the field at its tile — O(1) per pawn per tick. Fields recompute lazily on world change (building placed, bridge destroyed), amortized over ticks.
- Individual A* only for named characters and rare one-off trips, capped per tick.
- Monsters/animals: cheap wander + pursue steering.

## Combat (pawn level)

Kept deliberately simple — strategy drama lives at the society layer:
- Stats: HP, attack, defense derived from race + traits + equipment tier (equipment from faction tech/stockpile, not per-item inventory — no item sim).
- Resolution: adjacent opposed rolls (seeded stream `rng.combat`), morale meter per squad; broken morale → rout (flee events, chase, captures possible later). Morale modifiers (Total War-proven set): casualties, flanked/surrounded, standing alone — and two that make battles dramatic rather than attritional: **rout contagion** (a routing squad inflicts an area morale penalty on nearby friendlies → cascading collapses) and **leader-death shock** (a named character falling hits their whole force's morale — kings dying lose battles, and the chronicle writes itself).
- Squads: soldiers group under a banner entity with a rally target set by faction layer. Pawn-level behavior: stay near banner, engage nearest enemy, flee if morale broken.

## Named-character promotion

The bridge to the LLM layer (05). A plain pawn is **promoted** when it trips a story-worthiness detector:

- Sole survivor of a destroyed settlement
- Kill count above threshold (war hero)
- First child of a leader (heir)
- Founder of a new settlement
- Survivor of a monster attack that killed 5+
- Trait outlier: top-percentile charisma/strength in a generation (the "destined commoner" — genetics made visible as story)

Promotion effects: gets a generated full name, enters the rich-store (biography, memory list, relationship map), becomes chronicle-trackable, becomes eligible for leadership succession, camera-followable. **Dynamic cap:** 30 active named characters at baseline, breathing up to 50 during dramatic eras (active wars/crises raise the ceiling; peace lets it drift back down as elders die unreplaced). Story requires scarcity — a world where everyone is special has no protagonists — but drama deserves a bigger cast than peace.

## Inspector (debug + spectator feature in one)

Click any pawn → panel: needs bars, current action + top-5 scored alternatives with numbers, job history, family tree links, (if named) biography and memories. The same tooling that debugs utility weights doubles as the "zoom into an ant's life" spectator feature.

## Budgets

- Full-sim pawns: 2,000 target / 5,000 stretch (see 01 LOD for the rest)
- Per-pawn per-tick cost target: < 1 µs average (decision ticks staggered, movement O(1))
- Needs/actions kept to byte-sized enums — pawn hot state ≈ 32 bytes
