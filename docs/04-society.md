# 04 : Society: Factions, Economy, War, Culture

## Races (asymmetry = built-in conflict)

Four races, stats tuned so their strengths collide geographically and economically:

| Race | Terrain bond | Strengths | Weaknesses | Conflict hook |
|---|---|---|---|---|
| Humans | Grassland, rivers | Balanced, fast breeding, best farming | No specialty | Expansion pressure : always need more land |
| Elves | Forest | Archery, forest yield, long-lived | Slow breeding, slow anger, slow to forgive | Forests are also everyone's wood supply |
| Dwarves | Hills, mountains | Mining, smithing (equipment tier), defense | Poor farmers : must trade for food | Control ore everyone wants; need grain |
| Orcs | Steppe, badlands | Combat, fast breeding, raid economy | Poor land, poor crafting | Hunger + strength = professional raiders |

Structural drama: dwarves need human/elf grain, orcs need everyone's everything, humans need land, elves need to be left alone. Peace requires trade; trade failure cascades to war. The map (02) places them so these dependencies are unavoidable.

## Asymmetry vs snowball (balance philosophy)

This is not an RTS: the goal is **dramatic longevity**, not competitive fairness. Snowballs are welcome; a rising hegemony is a great chapter; but three failure modes must not happen: (1) the same race dominating across seeds, (2) early total elimination followed by centuries of nothing, (3) a permanent hegemon. Rise AND fall.

**Extinction is real.** A race CAN be permanently wiped out : no hidden refuge, no rubber-band resurrection. Stakes stay honest, and "the last elf" is a legendary chronicle arc. Balance work makes extinction rare and late (brakes below), never impossible.

**World setup is fixed: 4 factions, 1 per race.** One balance target, one testing matrix. Configurable faction mixes are post-MVP, unlocked only once soak data exists for the canonical setup.

Structural brakes (why the asymmetry above resists runaway by construction):
- **Different axes, not different power levels.** War / industry / growth / sustain don't ladder into one dominance stat. A military winner still starves without farms.
- **Terrain bonds tax conquest.** Race bonuses apply on home terrain; conquered foreign land is land the conqueror is bad at using. Expansion dilutes your own bonus.
- **Interdependence.** Destroying your grain supplier hurts you : built-in reason to stop short of extermination.

Active brakes (all diegetic : an observer sim cannot cheat with hidden multipliers; viewers read the numbers, and the chronicle must stay honest):
- **Coalitions (anti-hegemon, EU4-proven):** a faction crossing a dominance threshold (territory/army share) raises *fear* in every rival ledger → rule engine starts offering `ALLY_AGAINST(hegemon)` to their kings. Big = surrounded.
- **Bigness rots:** rebellion risk scales with settlement distance from capital; succession disputes scale with heir count; war exhaustion accumulates faster on multiple fronts.
- **Wealth attracts trouble:** the dragon targets the richest granary; plague rides the busiest trade routes. Tall poppy, fairly cut.
- **Grudge gravity:** every conquest mints grudges in survivors and refugees; hegemons accumulate permanent enemy pressure.

All race/faction parameters live in one data table (weights, curves, thresholds) : tuning is data edits, verified by the 100-seed balance matrix in 08.

**Engine fairness (no favored faction, structurally):**
- *Symmetric-engine rule:* combat/diplomacy/economy code is identical for every faction; race differences exist ONLY in the data table. Accidental hardcoded favoritism becomes impossible.
- *Mirror-match soak:* 100 seeds with 4 identical human factions. Any surviving dominance pattern (e.g. a spawn corner always winning) = map/engine bias, isolated from race design. Race asymmetry tuning starts only after mirror matches come back flat.
- *Spawn fairness band:* the 4 spawn-site scores on any accepted map must fall within a tight band : maps are unfair in texture (who neighbors ore, who neighbors orcs), never in total endowment.

## Factions

- Faction = race + territory + settlements + leader + diplomatic stances + culture params.
- Factions can **split** (settlement rebellion when unfed/unprotected/over-taxed) and **merge** (conquest, vassalage). New factions from splits inherit culture with drift.
- Leadership: one named character rules. Succession rules per race (eldest heir / elder council / strongest challenger). Succession moments are high-drama, chronicle-flagged, and a classic war trigger (disputed succession).
- Faction memory: rolling ledger of significant events with other factions (helped during famine +, raided caravan −, burned settlement −−−). This ledger is the input to king decisions and the source of **grudges**.

## Diplomacy

Simple explicit state machine per faction pair: `war / hostile / neutral / trade / alliance / vassal` with transition rules (tribute demands, gifts, marriages between named characters, truces after exhaustion). `vassal` (entered via post-war `VASSALIZE`): tribute flows to overlord, vassal's war/alliance options are locked to the overlord's side; exits via rebellion (mood + overlord weakness) or overlord collapse. Transitions are triggered by rules OR by journaled king decisions (05). Rule engine can always run headless; kings make it *interesting*.

**Marriage stays shallow (scope guard):** `PROPOSE_MARRIAGE` = alliance glue, grudge-on-refusal, dynasty link for the chronicle. Explicitly NO inherited territorial claims : CK-style claim webs are a permanent non-goal.

**Grudge ledger bounds (per 01 admission rules):** ledger entries decay over ~2 generations unless refreshed by new offenses; total grudge weight per faction pair is capped. Ancient hatreds fade unless renewed; which is both a bound and a story ("the old feud was forgotten, until Gruk's raid").

## Economy

No money in MVP : barter ratios. Goods: `grain, meat, fish, wood, stone, ore, tools/weapons (tiered)`.

- **Stockpiles** per settlement; production from pawn work (03); consumption per capita + winter multiplier.
- **Local prices** = scarcity ratios computed per settlement from stockpile vs demand, expressed in a single numeraire (grain-equivalents) : one value axis instead of 21 pairwise barter ratios. Computational currency only; the world displays barter. Purely emergent : no scripted prices.
- **Trade caravans:** when settlement A's surplus × B's scarcity crosses a threshold and diplomacy allows, a caravan entity walks the route (escortable, raidable : traveling loot is an orc magnet and a war spark).
- **Ripple effects:** famine in one valley raises grain scarcity in trading partners → price signals → caravan rerouting → sometimes war. Economics is the war-motive generator; the king LLM reads these numbers when deciding.

### Economy stability invariants

- **No monetary inflation by construction:** no money exists; prices are ratios of real goods. A price rise = real scarcity of a real good : signal, never spiral.
- **Calibration invariant (anti-"always bad"):** median settlement in median weather produces ~+10% surplus. Deficits arise only from shocks (drought, winter, war), never from base arithmetic. Verified by an isolated settlement-economy test before faction logic exists.
- **Sinks (anti-hoarding):** grain spoils (~10%/yr) with capped granary capacity; tools/weapons wear and need maintenance ore/wood. Stockpiles are bounded (01 admission rules), production stays meaningful in year 400, scarcity can always return.
- **Price damping:** per-season clamp on price change rate, on top of rolling-average signals (03) : no single-year glut/crash whiplash.
- **Raid EV law (anti-"always war"):** expected raid loot < expected production, long-run. Raiding is rational only when hungry (survival) or strong-vs-weak (opportunism) : war is a response to conditions, never the standing optimum. War also destroys capital (razed granaries, dead workers), so postwar rebuild forms natural peace phases; war is economically self-limiting.

## War

Three layers:
1. **Cause** : every war stores a casus belli chain (see Causality below). No causeless wars, ever.
2. **Campaign (faction layer):** raise squads (conscription shifts job mix), pick objective (raid stockpile / take settlement / punitive burn), rally, march. Objectives from rule engine or king decision. **Defense is automatic:** mustering, garrisons, and settlement defense are rule-layer responses that fire the tick a threat appears : never gated on a king decision (LLM latency can never kill a kingdom; see 05 §Latency fairness).
3. **Battle (pawn layer, 03):** squads fight with morale. Outcomes emit events: casualties (grudge fuel), heroes (promotion triggers), settlements taken/burned (chronicle chapters).

War exhaustion accumulates (casualties, hunger) and pressures truce : wars end, they don't grind forever. Post-war: tribute, border shift, vassalage, or razing. Statistical-LOD battles resolve by attrition math (01) with the same event outputs.

**Refugees (war consequence engine):** survivors of razed/conquered settlements flee to the nearest same-race settlement (reuses `settleNewVillage` movement). Effects: receiving settlement overcrowds (mood drop, emigration pressure), refugees carry grudges (fuel for future revenge chapters), and a sole survivor is a named-character promotion trigger (03). Wars ripple demographically for a generation : razing an enemy village is never free.

**Civil war = faction split (scope guard):** disputed successions resolve through the existing split mechanic : rebel settlements follow the losing heir into a new faction. No separate civil-war system.

## Causality DAG (the "world remembers" spine)

Every significant event is a node: `{id, tick, type, actors, location, causes: [eventIds], severity}`.

- `causes` links are filled by the emitting system: a war-declaration event points at the grudge ledger entries and scarcity crises that triggered it; a famine points at the drought and the deforestation; a hero's vengeance points at the massacre that orphaned them.
- The chronicle (05) walks this DAG to narrate; the UI (07) renders it as a clickable chain: war ← insult at wedding ← failed marriage alliance ← famine ← drought.
- Severity thresholds keep the DAG sparse : hundreds of nodes per century, not millions. Pawn-level noise (individual meals, single deaths of unnamed pawns) never enters the DAG; aggregates do.

This is a data structure, not an LLM feature. It must be complete and correct with the LLM off.

## Genetics & heredity (story fuel, pure math)

- Traits per pawn (byte each): strength, fertility, temper, longevity, charisma. Child = parent average + seeded mutation.
- Isolated populations drift over generations (mountain-valley dwarves measurably tougher by year 200 : detectable, chronicle-worthy).
- Named-character relevance: weak heir → succession crisis; charismatic founder → faction bonus. Royal-line inbreeding penalty included (classic succession-drama generator).
- Deliberately shallow: 5 bytes/pawn, no genome sim. Just enough to make dynasties differ.

## Culture & procedural language

- Per-faction **phoneme tables** generate all names (pawns, places, rivers): orc `Gruk Bonecrusher` vs elf `Aelith Vaerwyn` from the same code, different tables. Zero LLM.
- Name drift: conquest/merges blend phoneme tables over generations : border towns get hybrid names. Cheap, deep-feeling.
- Culture params (aggression, piety, wanderlust : bytes) drift slowly, shift on trauma events (surviving a plague raises piety), and feed utility weights (03) and king-prompt persona (05).
- **Light religion (MVP):** each culture gets a phoneme-generated god name; temples are buildable structures (piety-driven advertisement); piety feeds mood and festival events; kings' personas reference their god ("Karnak wills it"). NO theology sim, no conversion/schism mechanics : religious *flavor* now, myth-drift *depth* post-MVP. The god names and temple records become the substrate myth drift will later mutate.
- **Myth hooks (post-MVP, tier 5):** major events spawn "memory" entries that mutate as they age : the year-12 dragon attack becomes a dragon *god* by year 200. Chronicle can then narrate both the truth (from the DAG) and the legend (from drifted memory). Parked, but the DAG + memory design must not preclude it.

## Monsters & pressure injectors

Boring-equilibrium insurance, all deterministic (seeded schedule + state triggers):

- **Wildlife/monsters:** wolves (livestock/child threat), trolls (bridge/pass blockers), dragon (rare, granary-torching, can force enemies into temporary alliance : chronicle gold).
- **Disasters:** drought years, harsh winters, plague (SIR-lite spread through settlements/caravans : trade routes spread disease, lovely tension), forest fires.
- Injector cadence tuned so no 50-year window is event-free, but clustered catastrophes stay rare.
