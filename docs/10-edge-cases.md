# 10 : Edge-Case Registry

Single audit surface for edge cases across all systems. Each entry: trigger → handling → owning doc. Every entry gets a test in the suite (08); "handled" means tested, not written down.

## Fatal class (world breaks if unhandled)

| # | Trigger | Handling | Owner |
|---|---|---|---|
| F1 | Population reaches `MAX_PAWNS` (fixed SoA arrays) | Births defer while full (journal-visible event). Soft caps (crowding → emigration, 03) make approach gradual; the bound is a backstop, never the balancing mechanism | 01/03 |
| F2 | Browser killed mid-autosave → corrupt journal | Rolling 3-slot autosave, atomic IndexedDB transactions, checksum per slot; load falls back one slot on failure | 01 |
| F3 | IndexedDB quota exhausted by keyframes | Thin old keyframes (every 50y beyond 100y ago, every 10y recent). Deep-past seeks get slower; nothing is lost : journal replays everything | 01 |
| F4 | Same save opened in two tabs | Web Locks API: second tab read-only with notice ("world open in another tab") | 01/07 |

## Dead-end class (sim soft-locks or produces nonsense)

| # | Trigger | Handling | Owner |
|---|---|---|---|
| D1 | Leader dies, zero heirs | Succession falls to trait-ranked elder pool; empty pool → faction dissolves via existing split/rebellion mechanic | 04 |
| D2 | Faction loses all settlements, pawns survive | Refugee band: join nearest same-race faction, else wander → `settleNewVillage` = phoenix faction. Both outcomes are chronicle material | 04 |
| D3 | ALL factions extinct | World keeps simulating (nature, monsters); chronicler writes the final chapter, era named (e.g. "The Silence"); end-of-history screen: keep watching / export book / new world. Valid ending, not an error | 04/05/07 |
| D4 | Mutual war declarations in same decision window | Merge into one war event, both flagged aggressor ("a war neither king could later claim to have begun") | 04/05 |
| D5 | Caravan's destination razed mid-route | Reroute to next legal partner or return home; goods persist; event logged | 04 |
| D6 | Obligation fails vs refused (tribute granary raided before caravan spawns) | Partial/failed delivery = automatic ledger event + grudge, *distinct from refusal* in recipient's digest ("could not pay" ≠ "would not pay") | 04/05 |

## LLM-infra class (degradation edges)

| # | Trigger | Handling | Owner |
|---|---|---|---|
| L1 | Two pending decisions for one actor (council + crisis collide) | One pending decision per actor; crisis supersedes council; superseded request voided in journal (replay-safe) | 05 |
| L2 | LLM response arrives after deadline fallback fired | Discarded + logged; journal already holds the fallback decision | 05 |
| L3 | Systemic LLM failure (hung ollama, unloaded model, dead API key) : every call would eat its full timeout | Circuit breaker: 3 consecutive failures → LLM disabled for session, UI badge "kings ruling by instinct," background health probe re-enables automatically | 05 |

## Ambient class (browser reality)

| # | Trigger | Handling | Owner |
|---|---|---|---|
| A1 | Tab backgrounded (rAF throttled, worker keeps running) | Deliberate default: sim continues at 1× (returning to progress is a feature); settings toggle for auto-pause | 01/07 |

## Balance class (discovered facts, calibration baselines)

| # | Trigger | Handling | Owner |
|---|---|---|---|
| B1 | Seed 42: dwarves (Baarforge) are knife-edge in v1: chronic famine from ~Y14 (mountain fertility), alive only via gift/relief caravans; they collapse ~Y155-180 (512 map) or ~Y45-60 (192 map) depending on the rng roll. ANY sim-behavior change (e.g. EXPAND consuming rng/option-shuffle streams) re-rolls their fate; verified by v1-vs-M8 A/B runs 2026-07-14 | Balance gates calibrated to engine sanity, not fairy endings: soak early-extinction floor Y60 -> Y40 (M8); m8-cycle gate >= 3 races at 300y. A race dying of famine IS legitimate history (00 vision); dwarf food resilience is a deferred balance quest | 12 |
| B2 | Auto-garrison re-formed the tick its predecessor died, and stacked while one fought (pre-M8): sieges stalled forever, casualties snowballed | Garrison rally cooldown 90 ticks after a defense squad ends + in-fight garrisons count as present; sieges progress between defender waves (P1.5, test/m8-cycle.test.ts) | 04/12 |
| B3 | Faction ids grew past MAX_FACTIONS when splits outlived extinctions: pairKey indexed out of bounds and crashed the tick (found by M9 sweep) | Rebellion-born factions REUSE an extinct id (claimFactionSlot): pair rows wiped to Neutral, stale vassalOf pointers cleared; ids never exceed 8 (test/m9-politics.test.ts 500y invariant) | 04/12 |
| B4 | A settlement seceding mid-war left its pawns inside the parent's marching squads: mixed-faction armies | splitFaction deserts them home: seceded members leave parent squads (empty squads disband); 500y test asserts squads never carry foreign members | 04/12 |
| B5 | Test-side popCache faking is overwritten by the periodic stats refresh within ~300 ticks | Engineer tests with naturally mature settlements (or move real pawns); never assert on faked popCache | 12 |
| B6 | The v1 war-share gate (<60% of years with any war anywhere) cannot survive M9: faction churn doubles the actor count, so "some war somewhere" rises even at constant per-pair rates | Gate recalibrated (M12): war-share < 80% AND a real peace streak >= 3y must exist in 500y. Per-pair war-rate metric is the better long-term gate if this needs tightening | 12 |

## Registry rules

- New edge case discovered → lands here first, then handling propagates to the owning doc.
- Every entry requires a test (unit or soak scenario) before it counts as handled.
- Handling must obey existing invariants: determinism (all handling journal-visible where it affects state), fail-duller (01 admission rules), diegetic honesty (04 : no silent rubber-bands).
