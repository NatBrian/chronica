// Worldgen v1 — seed → heightmap → hydrology → climate → biomes → resources
// → spawn sites → naming → validation (reject-and-reroll). Docs: 02-worldgen.md.
import { Biome, Race, WorldConfig } from '../../shared/types';
import { Rng, fnv1a } from '../rng/rng';
import { Noise2D, ridged } from './noise';
import { WorldMap, allocMap, SEA_LEVEL, MOUNTAIN_LEVEL, TileFlag, isPassable, isLand } from './map';
import { islandName } from './names';

export interface SpawnSite {
  race: Race; x: number; y: number; score: number;
  /** score / best-available-score for this race ×100 — fairness is judged on this */
  relScore: number;
}

/** Seeded ore vein hidden until prospecting effort crosses threshold (02). */
export interface HiddenVein { x: number; y: number; amount: number; effortThreshold: number }

export interface WorldGenResult {
  map: WorldMap;
  spawns: SpawnSite[];
  islandName: string;
  hiddenVeins: HiddenVein[];
  subSeed: number;       // accepted sub-seed (seed + rejections)
  rejections: number;
  rejectionReasons: string[];
}

const WIND_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
];

export function generateWorld(seed: number, config: WorldConfig): WorldGenResult {
  const reasons: string[] = [];
  const MAX_TRIES = 24;
  let best: { r: Omit<WorldGenResult, 'rejections' | 'rejectionReasons'>; badness: number } | null = null;

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const subSeed = (seed + attempt * 0x9e3779b9) >>> 0;
    const r = generateOnce(subSeed, config);
    const problems = validate(r.map, r.spawns, config);
    if (problems.length === 0) {
      return { ...r, subSeed, rejections: attempt, rejectionReasons: reasons };
    }
    reasons.push(`attempt ${attempt}: ${problems.join('; ')}`);
    if (!best || problems.length < best.badness) {
      best = { r: { ...r, subSeed }, badness: problems.length };
    }
  }
  // Bounded retries exhausted → relax: take least-bad candidate (02 §Validation).
  return { ...best!.r, rejections: MAX_TRIES, rejectionReasons: reasons };
}

function generateOnce(subSeed: number, config: WorldConfig) {
  const N = config.mapSize;
  const map = allocMap(N);
  const rng = new Rng(subSeed);
  const baseNoise = new Noise2D((subSeed ^ fnv1a('height')) >>> 0);
  const ridgeNoise = new Noise2D((subSeed ^ fnv1a('ridge')) >>> 0);
  const warpNoise = new Noise2D((subSeed ^ fnv1a('warp')) >>> 0);
  const moistNoise = new Noise2D((subSeed ^ fnv1a('moist')) >>> 0);

  // --- 1. Heightmap: fBm + domain-warped ridges + radial falloff ---
  const half = N / 2;
  const scale = 4.5 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const nx = x * scale, ny = y * scale;
      const wx = nx + 0.35 * warpNoise.fbm(nx * 2, ny * 2, 2);
      const wy = ny + 0.35 * warpNoise.fbm(nx * 2 + 7.31, ny * 2 + 3.17, 2);
      let e = 0.55 * (baseNoise.fbm(wx, wy, 5) * 0.5 + 0.5);
      e += 0.45 * ridged(ridgeNoise, wx * 1.6, wy * 1.6, 4);
      // radial falloff → guaranteed ocean border
      const dx = (x - half) / half, dy = (y - half) / half;
      const d = Math.sqrt(dx * dx + dy * dy);
      const fall = 1 - d * d * 1.35;
      e = e * (fall < 0 ? 0 : fall);
      map.elevation[i] = Math.min(255, Math.max(0, Math.floor(e * 320)));
    }
  }

  // --- 2. Hydrology: elevation-sorted flux accumulation ---
  const order = new Uint32Array(N * N);
  for (let i = 0; i < order.length; i++) order[i] = i;
  const elev = map.elevation;
  // stable integer sort by elevation desc, index asc (deterministic)
  (order as unknown as number[]).constructor; // noop
  const orderArr = Array.from(order);
  orderArr.sort((a, b) => (elev[b] - elev[a]) || (a - b));
  const flux = map.waterFlux;
  const downhill = new Int32Array(N * N).fill(-1);
  for (const i of orderArr) {
    if (elev[i] <= SEA_LEVEL) continue;
    const x = i % N, y = (i / N) | 0;
    let lowest = -1, lowestE = elev[i];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nxp = x + dx, nyp = y + dy;
        if (nxp < 0 || nyp < 0 || nxp >= N || nyp >= N) continue;
        const j = nyp * N + nxp;
        if (elev[j] < lowestE) { lowestE = elev[j]; lowest = j; }
      }
    }
    downhill[i] = lowest;
  }
  for (const i of orderArr) {
    if (elev[i] <= SEA_LEVEL) continue;
    const rain = 1 + (map.moisture[i] >> 6); // moisture not yet set → 1 uniform
    flux[i] = Math.min(65535, flux[i] + rain);
    const d = downhill[i];
    if (d >= 0) flux[d] = Math.min(65535, flux[d] + flux[i]);
  }

  // --- 3. Climate: latitude + lapse + rain shadow along seeded wind ---
  const wind = WIND_DIRS[rng.int(8)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const lat = y / N;                        // 0 north .. 1 south
      let t = 60 + lat * 150 - (elev[i] > SEA_LEVEL ? (elev[i] - SEA_LEVEL) * 0.55 : 0);
      map.temperature[i] = Math.min(255, Math.max(0, t | 0));
    }
  }
  // march moisture along wind: humidity picked up over water, dropped on slopes
  const [wdx, wdy] = wind;
  const startsX: number[] = [], startsY: number[] = [];
  if (wdx > 0) for (let y = 0; y < N; y++) { startsX.push(0); startsY.push(y); }
  else if (wdx < 0) for (let y = 0; y < N; y++) { startsX.push(N - 1); startsY.push(y); }
  if (wdy > 0) for (let x = 0; x < N; x++) { startsX.push(x); startsY.push(0); }
  else if (wdy < 0) for (let x = 0; x < N; x++) { startsX.push(x); startsY.push(N - 1); }
  for (let s = 0; s < startsX.length; s++) {
    let x = startsX[s], y = startsY[s];
    let humidity = 160;
    let prevE = 0;
    while (x >= 0 && y >= 0 && x < N && y < N) {
      const i = y * N + x;
      const e = elev[i];
      if (e <= SEA_LEVEL) {
        humidity = Math.min(255, humidity + 22);
      } else {
        const rise = e - prevE;
        let drop = 8 + (rise > 0 ? rise : 0);   // windward slopes wring out rain
        if (drop > humidity) drop = humidity;
        map.moisture[i] = Math.max(map.moisture[i], Math.min(255, drop * 3 + humidity >> 1));
        humidity -= drop >> 1;
        if (humidity < 0) humidity = 0;
      }
      prevE = e;
      x += wdx; y += wdy;
    }
  }
  // blend with base moisture noise + river bonus
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const nz = (moistNoise.fbm(x * scale * 2, y * scale * 2, 3) * 0.5 + 0.5) * 110;
      let m = (map.moisture[i] * 0.65 + nz) | 0;
      if (flux[i] > 40) m += 40;
      map.moisture[i] = Math.min(255, m);
    }
  }

  // --- 4. Biomes: Whittaker lookup + overrides ---
  let riverCount = 0;
  for (let i = 0; i < N * N; i++) {
    const e = elev[i], t = map.temperature[i], m = map.moisture[i];
    let b: Biome;
    if (e <= SEA_LEVEL - 40) b = Biome.DeepOcean;
    else if (e <= SEA_LEVEL) b = Biome.Ocean;
    else if (e <= SEA_LEVEL + 6) b = Biome.Beach;
    else if (e >= MOUNTAIN_LEVEL) b = Biome.Mountain;
    else if (e >= MOUNTAIN_LEVEL - 40) b = Biome.Hills;
    else if (t < 55) b = Biome.Snow;
    else if (m < 60) b = Biome.Steppe;
    else if (m > 190 && t > 150 && e < SEA_LEVEL + 25) b = Biome.Swamp;
    else if (m > 150) b = (t > 90 && m > 185) ? Biome.DarkForest : Biome.Forest;
    else b = Biome.Grassland;
    map.biome[i] = b;
    if (b !== Biome.DeepOcean && b !== Biome.Ocean && flux[i] > 120) {
      map.flags[i] |= TileFlag.River;
      riverCount++;
    }
  }
  map.riverCount = riverCount;

  // --- 5. Resources ---
  const hiddenVeins: HiddenVein[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const b = map.biome[i];
      // fertility: moisture + biome + river adjacency
      let f = 0;
      if (b === Biome.Grassland) f = 100 + (map.moisture[i] >> 1);
      else if (b === Biome.Forest) f = 60 + (map.moisture[i] >> 2);
      else if (b === Biome.Steppe) f = 55;
      else if (b === Biome.Beach) f = 25;
      else if (b === Biome.Hills) f = 60;
      else if (b === Biome.Swamp) f = 30;
      else if (b === Biome.Snow) f = 10;
      if (map.flags[i] & TileFlag.River) f += 60;
      map.fertility[i] = Math.min(255, f);
      // forest density
      if (b === Biome.Forest) map.forest[i] = 150 + rng.int(80);
      else if (b === Biome.DarkForest) map.forest[i] = 220;
      else if (b === Biome.Grassland && rng.chance(1, 12)) map.forest[i] = 40 + rng.int(40);
      // fish: coast & river
      if (b === Biome.Beach || (map.flags[i] & TileFlag.River)) map.fish[i] = 120 + rng.int(80);
      // game animals
      if (b === Biome.Forest || b === Biome.DarkForest) map.game[i] = 90 + rng.int(90);
      else if (b === Biome.Grassland || b === Biome.Steppe) map.game[i] = 40 + rng.int(50);
      else if (b === Biome.Hills) map.game[i] = 70 + rng.int(60);      // mountain goats
      else if (b === Biome.Snow) map.game[i] = 20 + rng.int(20);
    }
  }
  // ore veins: seeded blobs in hills/mountains; some visible, some hidden (prospecting)
  const veinTarget = Math.max(8, (N * N) >> 13);
  let placedVisible = 0, guard = 0;
  while (placedVisible < veinTarget && guard++ < 4000) {
    const x = rng.int(N), y = rng.int(N);
    const i = y * N + x;
    const b = map.biome[i];
    if (b !== Biome.Hills && b !== Biome.Mountain) continue;
    const amount = 2200 + rng.int(2600);       // ~100–150y of active mining (02)
    if (rng.chance(2, 5)) {
      hiddenVeins.push({ x, y, amount, effortThreshold: 1400 + rng.int(2200) });
    } else {
      blob(map.ore, N, x, y, 2 + rng.int(2), amount, rng);
      placedVisible++;
    }
  }

  // --- 6. Spawn sites ---
  const raceMix: Race[] = config.mirrorMatch
    ? [Race.Human, Race.Human, Race.Human, Race.Human]
    : [Race.Human, Race.Elf, Race.Dwarf, Race.Orc];
  const spawns = pickSpawns(map, rng, raceMix);

  // --- 7. Naming ---
  const name = islandName(rng);

  return { map, spawns, islandName: name, hiddenVeins };
}

function blob(plane: Uint16Array, N: number, cx: number, cy: number, r: number, total: number, rng: Rng): void {
  const tiles: number[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      tiles.push(y * N + x);
    }
  }
  if (tiles.length === 0) return;
  const per = (total / tiles.length) | 0;
  for (const i of tiles) plane[i] = Math.min(65535, plane[i] + per + rng.int(per >> 1 || 1));
}

// Race terrain-preference scoring for spawn sites (02 §6, 04 races).
function siteScore(map: WorldMap, race: Race, cx: number, cy: number): number {
  const N = map.size;
  const R = 10;
  let farm = 0, forest = 0, hills = 0, ore = 0, steppe = 0, river = 0, water = 0, land = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      const b = map.biome[i];
      if (!isLand(map, i)) { water++; continue; }
      land++;
      farm += map.fertility[i];
      if (b === Biome.Forest || b === Biome.DarkForest) forest++;
      if (b === Biome.Hills || b === Biome.Mountain) hills++;
      ore += map.ore[i];
      if (b === Biome.Steppe) steppe++;
      if (map.flags[i] & TileFlag.River) river++;
    }
  }
  if (land < 180) return 0;                    // not enough usable land
  const ci = cy * N + cx;
  if (!isPassable(map, ci)) return 0;
  switch (race) {
    case Race.Human: return (farm >> 4) + river * 6 + (water > 0 ? 20 : 0);
    case Race.Elf: return forest * 4 + (farm >> 6);
    case Race.Dwarf: return hills * 5 + (ore >> 6) + (farm >> 7);
    case Race.Orc: return steppe * 4 + (farm >> 7) + 15;
  }
}

function pickSpawns(map: WorldMap, rng: Rng, raceMix: Race[]): SpawnSite[] {
  const N = map.size;
  const step = Math.max(6, N >> 5);
  const candidates: { x: number; y: number; scores: number[] }[] = [];
  for (let y = step; y < N - step; y += step) {
    for (let x = step; x < N - step; x += step) {
      const scores = [Race.Human, Race.Elf, Race.Dwarf, Race.Orc].map(r => siteScore(map, r, x, y));
      if (scores.some(s => s > 0)) candidates.push({ x, y, scores });
    }
  }
  // capped so big maps still have a contested middle (02 §shared frontier)
  const minDist = Math.min(58, N / 4.5);
  const spawns: SpawnSite[] = [];
  // slot order shuffled per world so no slot systematically claims first pick
  const slotOrder = rng.shuffle(raceMix.map((_, i) => i));
  // global best per race (ignoring distance constraints) — the fairness denominator
  const globalBest = [0, 0, 0, 0];
  for (const c of candidates) {
    for (let r = 0; r < 4; r++) if (c.scores[r] > globalBest[r]) globalBest[r] = c.scores[r];
  }
  const bySlot: (SpawnSite | null)[] = raceMix.map(() => null);
  for (const slot of slotOrder) {
    const race = raceMix[slot];
    let bestC: { x: number; y: number; s: number } | null = null;
    for (const c of candidates) {
      const s = c.scores[race];
      if (s <= 0) continue;
      let ok = true;
      for (const sp of spawns) {
        const dx = c.x - sp.x, dy = c.y - sp.y;
        if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
      }
      if (!ok) continue;
      if (!bestC || s > bestC.s) bestC = { x: c.x, y: c.y, s };
    }
    if (bestC) {
      const rel = globalBest[race] > 0 ? Math.round((bestC.s * 100) / globalBest[race]) : 0;
      const site = { race, x: bestC.x, y: bestC.y, score: bestC.s, relScore: rel };
      spawns.push(site);
      bySlot[slot] = site;
    }
  }
  return bySlot.filter((s): s is SpawnSite => s !== null);
}

function validate(map: WorldMap, spawns: SpawnSite[], config: WorldConfig): string[] {
  const problems: string[] = [];
  const N = map.size;
  let land = 0;
  for (let i = 0; i < N * N; i++) if (isLand(map, i)) land++;
  const landFrac = land / (N * N);
  if (landFrac < 0.25 || landFrac > 0.45) problems.push(`land fraction ${landFrac.toFixed(2)} outside [0.25,0.45]`);

  if (spawns.length < 4) problems.push(`only ${spawns.length} viable spawn sites`);

  // spawn fairness band (04 §Engine fairness): every race gets ≥55% of the best
  // site available to ITS race — scale-invariant across race scoring formulas.
  if (spawns.length === 4) {
    for (const sp of spawns) {
      if (sp.score < 25) problems.push(`spawn score ${sp.score} below threshold`);
      if (sp.relScore < 55) problems.push(`spawn fairness band violated (race ${sp.race} at ${sp.relScore}%)`);
    }
    // mutual reachability by land path
    if (!allReachable(map, spawns)) problems.push('spawn sites not mutually reachable');
  }

  // resource Gini: uneven but not degenerate (02 §Deliberate imbalance)
  const gini = resourceGini(map);
  if (gini < 0.18 || gini > 0.95) problems.push(`resource gini ${gini.toFixed(2)} outside [0.18,0.95]`);

  return problems;
}

function allReachable(map: WorldMap, spawns: SpawnSite[]): boolean {
  const N = map.size;
  const start = spawns[0].y * N + spawns[0].x;
  const seen = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  let head = 0, tail = 0;
  queue[tail++] = start; seen[start] = 1;
  while (head < tail) {
    const i = queue[head++];
    const x = i % N, y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (seen[j] || !isPassable(map, j)) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return spawns.every(s => seen[s.y * N + s.x] === 1);
}

function resourceGini(map: WorldMap): number {
  const N = map.size;
  // sample tile "resource value" on land
  const vals: number[] = [];
  const step = Math.max(1, N >> 7);
  for (let y = 0; y < N; y += step) {
    for (let x = 0; x < N; x += step) {
      const i = y * N + x;
      if (!isLand(map, i)) continue;
      vals.push(map.fertility[i] + (map.ore[i] >> 3) + map.forest[i] / 2 + map.fish[i] / 2);
    }
  }
  vals.sort((a, b) => a - b);
  const n = vals.length;
  if (n === 0) return 1;
  let cum = 0, weighted = 0;
  for (let k = 0; k < n; k++) { cum += vals[k]; weighted += vals[k] * (k + 1); }
  if (cum === 0) return 1;
  return (2 * weighted) / (n * cum) - (n + 1) / n;
}
