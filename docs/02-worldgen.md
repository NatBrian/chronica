# 02 : World Generation

## Goal

One 512×512-tile island whose **geography causes history**. Worldgen output is not scenery; every layer feeds a gameplay system. Mountain passes become war chokepoints, river deltas become rich kingdoms, rain shadows become hungry raider country.

Generation is seeded and deterministic (same seed → same island, same starting pawns).

## Pipeline (ordered passes)

```
seed → heightmap → hydrology → climate → biomes → resources → spawn sites → naming
```

### 1. Heightmap
- Layered simplex noise (seeded) + radial falloff mask → island shape, guaranteed ocean border.
- Optional tectonic flavor: 2–4 noise-domain-warped ridges for mountain chains rather than uniform blobby noise. Full plate simulation is over-scope; warped-ridge fakery reads the same on a 512² map.
- Output: `elevation: Uint8Array` (0 = deep ocean, 255 = peak). Sea level constant defines land mask.

### 2. Hydrology
- Rainfall droplets (deterministic, seeded) flow downhill accumulating flux → flux above threshold = **river**; local minima above sea level fill to **lakes**.
- Rivers matter: +fertility along banks, fish resource, natural faction borders, bridge chokepoints.
- Output: `waterFlux: Uint16Array`, river polylines for rendering.

### 3. Climate
- Latitude gradient (north cold, south warm) + elevation lapse (high = cold).
- Prevailing wind (seeded direction) + mountains → **rain shadow**: wet windward side, dry leeward side. This single mechanic creates the classic "rich valley vs hungry steppe" conflict axis.
- Output: `temperature: Uint8Array`, `moisture: Uint8Array`.

### 4. Biomes
Whittaker-style lookup on (temperature, moisture, elevation):

| Biome | Gameplay role |
|---|---|
| Ocean / lake | Fish (coastal), barrier |
| Beach | Neutral, landing sites |
| Grassland | Prime farmland (elf/human favored) |
| Forest | Wood, game animals, elf bonus terrain |
| Dark forest | Danger, monsters, slow travel |
| Hills | Stone, defensible, dwarf favored |
| Mountain | Ore, impassable except passes, dwarf home |
| Steppe/badlands | Poor farming, orc favored, raid pressure source |
| Swamp | Slow, disease risk, hides monsters |
| Snow/tundra | Marginal, harsh winter amplifier |

- Output: `biome: Uint8Array` + derived `fertility`, `passability`, `defensibility` maps.

### 5. Resources
- **Soil fertility** (from moisture + biome + river adjacency) : drives farming yield.
- **Forest density** : wood stock, regrows slowly (deforestation is possible and chronicle-worthy).
- **Ore/stone deposits** : seeded veins in hills/mountains; scarce, uneven on purpose (scarcity = war motive). **Depletion policy:** veins deplete over ~100–150 years of active mining; new veins are discoverable in unexploited hills via prospecting effort thresholds (seeded and deterministic : discovery is earned, not rolled at runtime). The mining map shifts over centuries: old mountain kingdoms decline, fresh ore rushes trigger colonization races : the map itself generates history.
- **Game animals** : herd spawns by biome; huntable, depletable, migrating.
- Deliberate imbalance rule: worldgen validates that resources are *unevenly* distributed (Gini-style check). A fair map is a boring map.

### 6. Spawn sites
- Each starting faction gets a settlement site scored for its race's terrain preference (see 04): dwarves near mountains, elves near forest, orcs on steppe, humans on grassland/river.
- Sites placed with minimum-distance constraint but **shared frontier zones** : contested middle ground is where early friction starts.
- Each faction starts with 30–60 pawns, a stockpile, and a named leader.

### 7. Naming
- Procedural per-culture name generators (phoneme tables : see 04 §Languages): island name, region names, river/mountain names, settlement names, pawn names.
- Every named place is chronicle fuel: "the Battle of Redford" beats "battle at tile 214,180".

## Validation pass (reject-and-reroll)

After generation, assert:
- Land fraction 25–45% of map
- ≥ 2 distinct large landmass regions is NOT required (one island), but ≥ 4 viable spawn sites with score above threshold
- All spawn sites mutually reachable by land path (no faction stranded on a cliff)
- At least one mountain pass / river crossing between each adjacent faction pair (chokepoints must exist)
- Resource Gini within target band (uneven but not starving anyone at spawn)

Fail → increment sub-seed, regenerate (bounded retries, then relax constraints). All deterministic: seed 42 always yields the same accepted island.

**Generator health metric:** the seed browser logs the rejection rate. Rejection >20% means the generator is weak and validation is masking it : fix generation, don't lean on the reroll.

## Data budget

512×512 = 262,144 tiles. ~8 byte-planes (elevation, biome, moisture, temp, fertility, forest, ore, flags) ≈ 2 MB of typed arrays. Trivial for snapshots.

## Debug tooling (build early, thank yourself later)

- Layer viewer: render any raw plane (elevation, moisture, flux...) as heatmap
- Seed browser: gallery of thumbnails for seeds 0–99 to eyeball generator quality
- Both ship as dev-only UI, also double as marketing screenshots
