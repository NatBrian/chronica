// System 6 — 3-layer action selection (03): reflexes → utility over advertised
// offers (IAUS curves, commitment, staggered 1/8) → idle.
import { ActionId, BuildingKind, EventType, Good, Season } from '../../shared/types';
import { PawnFlag, SimState, Settlement, effFood } from '../state';
import { TileFlag } from '../world/map';
import { planSettlement } from '../settlementOps';
import { getField, fieldDist } from '../world/flowField';
import { emitEvent, yearOf } from '../events/events';
import { seasonOf } from './calendarSystem';

// ---- Response curves (integer data tables, 03) ----
export function hungerCurve(h: number): number {
  if (h < 100) return 0;
  if (h < 150) return (h - 100) * 2;
  if (h < 200) return 100 + (h - 150) * 4;
  return 300 + (h - 200) * 8;
}

export function energyCurve(e: number): number {
  if (e > 120) return 0;
  if (e > 60) return 120 - e;
  return 60 + (60 - e) * 4;
}

function socialCurve(v: number): number {
  return v < 120 ? 0 : (v - 120);
}

/** Refresh a settlement's advertised resource tiles (radius scan, cached). */
export function refreshResourceTiles(s: SimState, st: Settlement): void {
  const N = s.map.size;
  const R = 15;
  const field = getField(s, st);
  const found: Record<'forage' | 'hunt' | 'fish' | 'wood' | 'mine' | 'stone', [number, number][]> =
    { forage: [], hunt: [], fish: [], wood: [], mine: [], stone: [] };
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = st.x + dx, y = st.y + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (fieldDist(field, x, y) === 65535) continue;   // unreachable — never advertise
      const i = y * N + x;
      const fert = s.map.fertility[i];
      if (fert > 75 && !(s.map.flags[i] & TileFlag.Farm)) found.forage.push([fert, i]);
      if (s.map.game[i] > 50) found.hunt.push([s.map.game[i], i]);
      if (s.map.fish[i] > 70) found.fish.push([s.map.fish[i], i]);
      if (s.map.forest[i] > 90) found.wood.push([s.map.forest[i], i]);
      if (s.map.ore[i] > 0) found.mine.push([s.map.ore[i], i]);
      else {
        const b = s.map.biome[i];
        if (b === 7 /* Hills */) found.stone.push([s.map.elevation[i], i]);
      }
    }
  }
  const top = (arr: [number, number][]) =>
    arr.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 6).map(v => v[1]);
  // carrying-capacity base: how much farmable land does this site command?
  let fertile = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = st.x + dx, y = st.y + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (s.map.fertility[y * N + x] >= 55 && fieldDist(field, x, y) !== 65535) fertile++;
    }
  }
  st.fertileLand = fertile;
  const hadOre = st.resourceTiles.mine.length > 0;
  st.resourceTiles = {
    forage: top(found.forage), hunt: top(found.hunt), fish: top(found.fish),
    wood: top(found.wood), mine: top(found.mine), stone: top(found.stone),
  };
  if (hadOre && st.resourceTiles.mine.length === 0 && s.config.oreDepletion) {
    emitEvent(s, {
      type: EventType.OreDepleted, factions: [st.factionId],
      x: st.x, y: st.y, severity: 3,
      text: `Y${yearOf(s.tick)}: The mines of ${st.name} run dry. The old veins are spent.`,
    });
  }
}

export interface ScoredOffer { action: ActionId; target: number; score: number; work: number }

// ---- per-settlement shared offer cache (perf: one build per settlement per
// tick instead of per pawn; flat arrays, no closures — 68% of tick cost fixed)
interface SharedOffers {
  tick: number;
  actions: number[];
  targets: number[];
  bases: number[];
  works: number[];
}
const sharedOfferCache = new WeakMap<object, Map<number, SharedOffers>>();

function getSharedOffers(s: SimState, st: Settlement): SharedOffers {
  let m = sharedOfferCache.get(s.pawns as object);
  if (!m) { m = new Map(); sharedOfferCache.set(s.pawns as object, m); }
  let so = m.get(st.id);
  if (so && so.tick === s.tick) return so;
  so = { tick: s.tick, actions: [], targets: [], bases: [], works: [] };
  m.set(st.id, so);
  const push = (a: number, t: number, b: number, w: number) => {
    if (b > 0) { so!.actions.push(a); so!.targets.push(t); so!.bases.push(b); so!.works.push(w); }
  };
  const N = s.map.size;
  const scarcity = Math.max(30, Math.min(260, 300 - ((effFood(st) / 100) | 0)));
  for (const t of st.resourceTiles.forage) push(ActionId.Forage, t, scarcity + (s.map.fertility[t] >> 2), 4);
  for (const t of st.resourceTiles.hunt) push(ActionId.Hunt, t, scarcity + (s.map.game[t] >> 2), 6);
  for (const t of st.resourceTiles.fish) push(ActionId.Fish, t, scarcity + (s.map.fish[t] >> 2), 4);
  const season = seasonOf(s.tick);
  let sowShown = 0, harvestShown = 0;
  const canSow = season === Season.Spring || (season === Season.Summer && s.tick % 90 < 45);
  for (let k = 0; k < st.farmPlots.length; k++) {
    const plot = st.farmPlots[k];
    const c = s.map.crop[plot];
    if (c >= 200 && harvestShown < 24) {
      push(ActionId.FarmWork, plot, 250 + (scarcity >> 1), 3);
      harvestShown++;
    } else if (c === 0 && canSow && sowShown < 24) {
      push(ActionId.FarmWork, plot, 130 + (scarcity >> 1), 3);
      sowShown++;
    }
  }
  const industry = Math.max(25, Math.min(100, (effFood(st) / 250) | 0));
  const wood = st.stockpile[Good.Wood];
  if (wood < 150) {
    for (const t of st.resourceTiles.wood) push(ActionId.ChopWood, t, ((60 + (150 - wood)) * industry / 100) | 0, 4);
  }
  const stone = st.stockpile[Good.Stone];
  if (stone < 120) {
    for (const t of st.resourceTiles.stone) push(ActionId.Mine, t, ((40 + ((120 - stone) >> 1)) * industry / 100) | 0, 5);
  }
  let hasWorkshop = false;
  for (const b of st.buildings) {
    if (b.kind === BuildingKind.Workshop && b.stage === 3) { hasWorkshop = true; break; }
  }
  for (const t of st.resourceTiles.mine) {
    push(ActionId.Mine, t, ((hasWorkshop ? 130 : 80) * industry / 100) | 0, 5);
  }
  for (const b of st.buildings) {
    if (b.stage >= 3) continue;
    push(b.kind === BuildingKind.House ? ActionId.BuildHouse : ActionId.BuildStructure,
      b.y * N + b.x, ((140 + (st.crowding >> 1)) * industry / 100) | 0, 3);
  }
  if (hasWorkshop && st.stockpile[Good.Ore] >= 2 && wood >= 1) {
    for (const b of st.buildings) {
      if (b.kind === BuildingKind.Workshop && b.stage === 3) {
        push(ActionId.CraftEquipment, b.y * N + b.x,
          (Math.max(20, 120 - st.stockpile[Good.Tools] * 2) * industry / 100) | 0, 4);
        break;
      }
    }
  }
  return so;
}

/** Allocation-free argmax over shared + personal offers for pawn i. */
function pickBest(s: SimState, i: number, st: Settlement): { action: number; target: number; work: number; score: number } | null {
  const p = s.pawns;
  const N = s.map.size;
  const px = p.x[i], py = p.y[i];
  const centerTile = st.y * N + st.x;
  const isChild = (p.flags[i] & PawnFlag.Child) !== 0;
  const aff = p.jobAffinity[i], cur = p.action[i];
  let bestScore = 0, bestAction = -1, bestTarget = -1, bestWork = 0;

  const consider = (action: number, target: number, base: number, work: number) => {
    if (base <= 0) return;
    const tx = target % N, ty = (target / N) | 0;
    const ddx = tx - px, ddy = ty - py;
    const d = (ddx > 0 ? ddx : -ddx) > (ddy > 0 ? ddy : -ddy) ? (ddx > 0 ? ddx : -ddx) : (ddy > 0 ? ddy : -ddy);
    let disc = 100 - d * 2;
    if (disc < 40) disc = 40;
    let score = (base * disc / 100) | 0;
    if (aff === action) score = (score * 115 / 100) | 0;
    if (cur === action) score = (score * 115 / 100) | 0;
    if (score > bestScore ||
        (score === bestScore && (action < bestAction || (action === bestAction && target < bestTarget)))) {
      bestScore = score; bestAction = action; bestTarget = target; bestWork = work;
    }
  };

  const totalFood = st.stockpile[Good.Grain] + st.stockpile[Good.Meat] + st.stockpile[Good.Fish];
  if (totalFood > 0) consider(ActionId.EatFromStockpile, centerTile, hungerCurve(p.hunger[i]) * 3, 1);
  consider(ActionId.Rest, centerTile, energyCurve(p.energy[i]) * 2, 3);
  if (!isChild) {
    const so = getSharedOffers(s, st);
    for (let k = 0; k < so.actions.length; k++) {
      consider(so.actions[k], so.targets[k], so.bases[k], so.works[k]);
    }
    if (p.pairId[i] < 0 && !(p.flags[i] & PawnFlag.Elder)) {
      consider(ActionId.Court, centerTile, socialCurve(p.social[i]), 2);
    }
  }
  if (bestAction < 0 || bestScore < 20) return null;
  return { action: bestAction, target: bestTarget, work: bestWork, score: bestScore };
}

/** All offers visible to pawn i, scored — exported for the inspector (03). */
export function scoreOffers(s: SimState, i: number): ScoredOffer[] {
  const p = s.pawns;
  const st = s.settlements[p.settlementId[i]];
  if (!st || st.razed) return [];
  const N = s.map.size;
  const offers: ScoredOffer[] = [];
  const px = p.x[i], py = p.y[i];
  const centerTile = st.y * N + st.x;
  const isChild = (p.flags[i] & PawnFlag.Child) !== 0;

  const dist = (tile: number) => {
    const tx = tile % N, ty = (tile / N) | 0;
    const dx = tx - px, dy = ty - py;
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    return d;
  };
  const distDiscount = (tile: number) => Math.max(40, 100 - dist(tile) * 2);
  const affinity = (a: ActionId) => (p.jobAffinity[i] === a ? 115 : 100);
  const commit = (a: ActionId) => (p.action[i] === a ? 115 : 100);
  const mk = (action: ActionId, target: number, base: number, work: number) => {
    if (base <= 0) return;
    const score = (base * distDiscount(target) * affinity(action) * commit(action) / 1_000_000) | 0;
    if (score > 0) offers.push({ action, target, score, work });
  };

  const totalFood = st.stockpile[Good.Grain] + st.stockpile[Good.Meat] + st.stockpile[Good.Fish];

  // eat — granary advertises when stocked
  if (totalFood > 0) mk(ActionId.EatFromStockpile, centerTile, hungerCurve(p.hunger[i]) * 3, 1);

  // rest — home advertises
  mk(ActionId.Rest, centerTile, energyCurve(p.energy[i]) * 2, 3);

  if (!isChild) {
    // gathering — payoff scales with settlement food scarcity (rolling avg signal)
    const scarcity = Math.max(30, Math.min(260, 300 - ((effFood(st) / 100) | 0)));
    for (const t of st.resourceTiles.forage) mk(ActionId.Forage, t, scarcity + (s.map.fertility[t] >> 2), 4);
    for (const t of st.resourceTiles.hunt) mk(ActionId.Hunt, t, scarcity + (s.map.game[t] >> 2), 6);
    for (const t of st.resourceTiles.fish) mk(ActionId.Fish, t, scarcity + (s.map.fish[t] >> 2), 4);

    // farming (M2): sow in spring/summer, harvest ripe — the food backbone
    const season = seasonOf(s.tick);
    let sowShown = 0, harvestShown = 0;
    for (const plot of st.farmPlots) {
      const c = s.map.crop[plot];
      if (c >= 200 && harvestShown < 24) {
        mk(ActionId.FarmWork, plot, 250 + (scarcity >> 1), 3);
        harvestShown++;
      } else if (c === 0 && sowShown < 24 &&
                 (season === Season.Spring || (season === Season.Summer && s.tick % 90 < 45))) {
        // no late-summer sowing — frost would take the crop before harvest
        mk(ActionId.FarmWork, plot, 130 + (scarcity >> 1), 3);
        sowShown++;
      }
    }

    // wood/stone/ore economy (M2) — industry throttles when food is insecure:
    // a hungry village sends no miners (labor goes to the granary first)
    const industry = Math.max(25, Math.min(100, (effFood(st) / 250) | 0));
    const ind = (base: number) => (base * industry / 100) | 0;
    const wood = st.stockpile[Good.Wood];
    if (wood < 150) {
      for (const t of st.resourceTiles.wood) mk(ActionId.ChopWood, t, ind(60 + (150 - wood)), 4);
    }
    const stone = st.stockpile[Good.Stone];
    if (stone < 120) {
      for (const t of st.resourceTiles.stone) mk(ActionId.Mine, t, ind(40 + ((120 - stone) >> 1)), 5);
    }
    const hasWorkshop = st.buildings.some(b => b.kind === BuildingKind.Workshop && b.stage === 3);
    for (const t of st.resourceTiles.mine) {
      mk(ActionId.Mine, t, ind(hasWorkshop ? 130 : 80), 5);
    }

    // construction sites advertise (03 smart-world)
    for (const b of st.buildings) {
      if (b.stage >= 3) continue;
      const tile = b.y * s.map.size + b.x;
      mk(b.kind === BuildingKind.House ? ActionId.BuildHouse : ActionId.BuildStructure,
        tile, ind(140 + (st.crowding >> 1)), 3);
    }

    // craftEquipment — workshop with ore (04 dwarven smithing path)
    if (hasWorkshop && st.stockpile[Good.Ore] >= 2 && wood >= 1) {
      const toolNeed = Math.max(20, 120 - st.stockpile[Good.Tools] * 2);
      const ws = st.buildings.find(b => b.kind === BuildingKind.Workshop && b.stage === 3)!;
      mk(ActionId.CraftEquipment, ws.y * s.map.size + ws.x, ind(toolNeed), 4);
    }

    // court — low-pressure default for unpaired adults
    if (p.pairId[i] < 0 && !(p.flags[i] & PawnFlag.Elder)) {
      mk(ActionId.Court, centerTile, socialCurve(p.social[i]), 2);
    }
  }
  return offers;
}

export function utilityAISystem(s: SimState): void {
  const p = s.pawns;
  const stagger = s.tick & 7;

  // settlement caches + rolling signals
  if (s.tick % 90 === 1) {
    for (const st of s.settlements) {
      if (!st.razed) {
        refreshResourceTiles(s, st);
        planSettlement(s, st);
      }
    }
  }
  if (s.tick % 30 === 2) {
    // pop cache + food-per-capita rolling average (season-scale smoothing, 03)
    for (const st of s.settlements) st.popCache = 0;
    for (let i = 0; i < s.pawnCount; i++) {
      if (!(p.flags[i] & PawnFlag.Alive)) continue;
      const st = s.settlements[p.settlementId[i]];
      if (st) st.popCache++;
    }
    for (const st of s.settlements) {
      if (st.razed || st.popCache === 0) continue;
      const totalFood = st.stockpile[Good.Grain] + st.stockpile[Good.Meat] + st.stockpile[Good.Fish];
      // ×1000 fixed point: 21000 ≈ one year of food per capita
      const fpc = Math.min(40000, (totalFood * 1000 / st.popCache) | 0);
      st.foodPerCapitaAvg += ((fpc - st.foodPerCapitaAvg) / 3) | 0;
      // net flow, annualized per capita (12 windows/yr), year-scale smoothing
      const flow = ((totalFood - st.lastFoodStock) * 12 * 1000 / st.popCache) | 0;
      st.lastFoodStock = totalFood;
      st.foodFlowAvg += ((Math.max(-40000, Math.min(40000, flow)) - st.foodFlowAvg) / 12) | 0;
      // crowding vs the land's carrying capacity (03 §soft capacity):
      // how many mouths can farms + hunting + fishing + foraging feed here?
      const rt = st.resourceTiles;
      // land-based, pop-independent: fertile tiles ≈ 1 mouth each (farming),
      // plus sustainable hunt/fish/forage — no feedback through claimed plots
      const capacity = ((st.fertileLand * 9) / 10 | 0) + rt.hunt.length * 3 +
        rt.fish.length * 4 + rt.forage.length * 2 + 6;
      const crowdPct = (st.popCache * 100 / capacity) | 0;
      st.crowding = crowdPct > 80 ? Math.min(255, (crowdPct - 80) * 5) : 0;
    }
  }

  for (let i = 0; i < s.pawnCount; i++) {
    if (!(p.flags[i] & PawnFlag.Alive)) continue;

    // ---- Layer 1: reflexes, every tick, override everything (03) ----
    const st = s.settlements[p.settlementId[i]];
    if (st && !st.razed) {
      const totalFood = st.stockpile[Good.Grain] + st.stockpile[Good.Meat] + st.stockpile[Good.Fish];
      const centerTile = st.y * s.map.size + st.x;
      if (p.hunger[i] >= 235 && totalFood > 0 && p.action[i] !== ActionId.EatFromStockpile) {
        setAction(s, i, ActionId.EatFromStockpile, centerTile, 1);
        continue;
      }
      if (p.shelter[i] >= 200 && p.action[i] !== ActionId.SeekShelter && p.action[i] !== ActionId.Rest) {
        setAction(s, i, ActionId.SeekShelter, centerTile, 3);
        continue;
      }
      if (p.safety[i] >= 180 && p.action[i] !== ActionId.Flee && p.squadId[i] === 65535) {
        setAction(s, i, ActionId.Flee, centerTile, 0);
        continue;
      }
    }

    // ---- Layer 2: staggered utility decision when free ----
    if ((i & 7) !== stagger) continue;
    if (p.action[i] !== ActionId.Idle) continue;         // commitment: run to completion
    if (p.squadId[i] !== 65535) continue;                // squad layer owns soldiers

    if (st && !st.razed) {
      const best = pickBest(s, i, st);
      if (best) {
        setAction(s, i, best.action, best.target, best.work);
        continue;
      }
    }

    // ---- Layer 3: idle/ambient — wander near home ----
    if (st && !st.razed) {
      const rng = s.rng.get('idle');
      const wx = st.x + rng.int(13) - 6;
      const wy = st.y + rng.int(13) - 6;
      const N = s.map.size;
      const cx = Math.min(N - 1, Math.max(0, wx));
      const cy = Math.min(N - 1, Math.max(0, wy));
      setAction(s, i, ActionId.Idle, cy * N + cx, 2);
    }
  }
}

export function setAction(s: SimState, i: number, action: ActionId, target: number, work: number): void {
  const p = s.pawns;
  p.action[i] = action;
  p.actionTarget[i] = target;
  p.actionTicks[i] = work;
  if (action !== ActionId.Idle && action !== ActionId.Rest && action !== ActionId.SeekShelter) {
    p.flags[i] &= ~PawnFlag.InShelter;
  }
}
