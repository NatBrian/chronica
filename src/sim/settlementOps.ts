// Settlement-level planning: building sites, farm-plot expansion, prospecting,
// and settlement founding (M8: shared by auto-expansion and the EXPAND council
// option). Runs from the periodic refresh (deterministic, index-ordered).
import { BuildingKind, EventType, Good, GOOD_COUNT } from '../shared/types';
import { SimState, Settlement, Faction, PawnFlag } from './state';
import { TileFlag, isPassable } from './world/map';
import { emitEvent, yearOf } from './events/events';
import { settlementName } from './world/names';
import { promoteNamed } from './namedOps';

/** Land-based carrying capacity (03 §soft capacity); the crowding source. */
export function settlementCapacity(st: Settlement): number {
  const rt = st.resourceTiles;
  return ((st.fertileLand * 9) / 10 | 0) + rt.hunt.length * 3 +
    rt.fish.length * 4 + rt.forage.length * 2 + 6;
}

export function crowdPctOf(st: Settlement): number {
  return (st.popCache * 100 / settlementCapacity(st)) | 0;
}

/** Prosperity charter (11 §F fix 1): rich, comfortable villages plant
 *  daughters; no need to starve first. Gates the EXPAND council option.
 *  Two roads there: land pressure while growing, or a brimming granary at
 *  maturity (mature capacity is huge, so crowding alone never re-fires). */
export function canProsperExpand(st: Settlement): boolean {
  if (st.stockpile[Good.Wood] < 60 || st.popCache < 120) return false;
  const grain = st.stockpile[Good.Grain];
  if (crowdPctOf(st) >= 60 && grain >= 1000) return true;
  return grain >= (st.granaryCap * 8) / 10 && st.popCache >= 200 && st.foodFlowAvg >= 0;
}

/** Score frontier sites near `from`: fertile, far from every settlement.
 *  16-direction integer table ×1000; Math.sin/cos are engine-dependent (01). */
const DIR16: readonly (readonly [number, number])[] = [
  [1000, 0], [924, 383], [707, 707], [383, 924], [0, 1000], [-383, 924],
  [-707, 707], [-924, 383], [-1000, 0], [-924, -383], [-707, -707],
  [-383, -924], [0, -1000], [383, -924], [707, -707], [924, -383],
];

export function findExpansionSite(s: SimState, from: Settlement): [number, number] | null {
  const N = s.map.size;
  const rng = s.rng.get('expansion');
  let best: [number, number] | null = null;
  let bestScore = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const [ddx, ddy] = DIR16[rng.int(16)];
    const dist = 28 + rng.int(24);
    const x = from.x + ((dist * ddx / 1000) | 0);
    const y = from.y + ((dist * ddy / 1000) | 0);
    if (x < 8 || y < 8 || x >= N - 8 || y >= N - 8) continue;
    const i = y * N + x;
    if (!isPassable(s.map, i)) continue;
    let tooClose = false;
    for (const st of s.settlements) {
      if (st.razed) continue;
      const dx = st.x - x, dy = st.y - y;
      if (dx * dx + dy * dy < 22 * 22) { tooClose = true; break; }
      // territorial respect: charter your own hinterland, never a site that
      // sits closer to a foreign settlement than to the mother village
      // (leapfrog expansion strangled weak neighbors; early-extinction gate)
      if (st.factionId !== from.factionId && dx * dx + dy * dy < dist * dist) {
        tooClose = true; break;
      }
    }
    if (tooClose) continue;
    let fert = 0;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        fert += s.map.fertility[yy * N + xx];
      }
    }
    if (fert > bestScore) { bestScore = fert; best = [x, y]; }
  }
  return bestScore >= 8000 ? best : null;
}

export function foundSettlement(s: SimState, f: Faction, from: Settlement, x: number, y: number): void {
  const rng = s.rng.get('expansion');
  const st: Settlement = {
    id: s.settlements.length,
    factionId: f.id,
    x, y,
    name: settlementName(f.race, rng),
    stockpile: new Array(GOOD_COUNT).fill(0),
    buildings: [{ kind: 1, x, y, stage: 3, hp: 200, workDone: 0 }],
    farmPlots: [],
    founded: s.tick,
    razed: false,
    granaryCap: 4000, popCache: 0, moodAvg: 150, crowding: 0,
    loyalty: 100, capturedTick: -1,
    foodPerCapitaAvg: 22000, foodFlowAvg: 0, lastFoodStock: 300, lodStatistical: false,
    resourceTiles: { forage: [], hunt: [], fish: [], wood: [], mine: [], stone: [] },
    fertileLand: 40,
  };
  from.stockpile[Good.Wood] -= 60;
  from.stockpile[Good.Grain] -= 300;
  st.stockpile[Good.Grain] = 300;
  st.stockpile[Good.Wood] = 40;
  s.settlements.push(st);
  // founding party: ~14 pawns walk over (reuses movement)
  const N = s.map.size;
  let moved = 0, founderPawn = -1;
  for (let i = 0; i < s.pawnCount && moved < 14; i++) {
    const fl = s.pawns.flags[i];
    if (!(fl & PawnFlag.Alive) || (fl & PawnFlag.Child)) continue;
    if (s.pawns.settlementId[i] !== from.id) continue;
    if (s.pawns.squadId[i] !== 65535 || s.pawns.namedId[i] >= 0) continue;
    s.pawns.settlementId[i] = st.id;
    s.pawns.actionTarget[i] = y * N + x;
    s.pawns.action[i] = 20;   // SettleNewVillage; walks to the new home
    s.pawns.actionTicks[i] = 2;
    if (founderPawn < 0) founderPawn = i;
    moved++;
  }
  f.lastExpansionTick = s.tick;
  const ev = emitEvent(s, {
    type: EventType.SettlementFounded,
    factions: [f.id], x, y, severity: 3,
    text: `Y${yearOf(s.tick)}: Settlers from ${from.name} raise the first roofs of ${st.name}.`,
  });
  if (founderPawn >= 0) {
    const nc = promoteNamed(s, founderPawn, 'founder', `Founded ${st.name}.`, [ev.id]);
    if (nc) nc.bio.push(`First of ${st.name}.`);
  }
}

export function ringSpots(s: SimState, cx: number, cy: number, rMax: number): [number, number][] {
  const out: [number, number][] = [];
  const N = s.map.size;
  for (let d = 1; d <= rMax; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
        if (!isPassable(s.map, y * N + x)) continue;
        out.push([x, y]);
      }
    }
  }
  return out;
}

function freeSpot(s: SimState, st: Settlement): [number, number] | null {
  const N = s.map.size;
  const occupied = new Set(st.buildings.map(b => b.y * N + b.x));
  for (const [x, y] of ringSpots(s, st.x, st.y, 14)) {
    const i = y * N + x;
    if (occupied.has(i)) continue;
    if (s.map.flags[i] & TileFlag.Farm) continue;
    return [x, y];
  }
  return null;
}

/** Periodic settlement planning: house/workshop sites, plots, prospecting. */
export function planSettlement(s: SimState, st: Settlement): void {
  if (st.razed) return;
  const N = s.map.size;

  // farm-plot expansion: roughly one plot per mouth (a pawn can tend several)
  const targetPlots = Math.min(140, st.popCache + 15);
  if (st.farmPlots.length < targetPlots) {
    let need = Math.min(10, targetPlots - st.farmPlots.length);
    for (const [x, y] of ringSpots(s, st.x, st.y, 12)) {
      if (need === 0) break;
      const i = y * N + x;
      if (s.map.flags[i] & TileFlag.Farm) continue;
      if (s.map.fertility[i] < 45) continue;
      if (st.buildings.some(b => b.x === x && b.y === y)) continue;
      s.map.flags[i] |= TileFlag.Farm;
      st.farmPlots.push(i);
      need--;
    }
  }

  const sites = st.buildings.filter(b => b.stage < 3).length;
  const houses = st.buildings.filter(b => b.kind === BuildingKind.House && b.stage === 3).length;

  // house site when crowded (soft capacity; 03)
  if (sites < 2 && st.popCache > houses * 7 && st.stockpile[Good.Wood] >= 30) {
    const spot = freeSpot(s, st);
    if (spot) {
      st.stockpile[Good.Wood] -= 30;
      st.buildings.push({ kind: BuildingKind.House, x: spot[0], y: spot[1], stage: 0, hp: 40, workDone: 0 });
    }
  }

  // one workshop per settlement once established
  if (sites < 2 && st.popCache > 55 &&
      !st.buildings.some(b => b.kind === BuildingKind.Workshop) &&
      st.stockpile[Good.Wood] >= 25 && st.stockpile[Good.Stone] >= 30) {
    const spot = freeSpot(s, st);
    if (spot) {
      st.stockpile[Good.Wood] -= 25;
      st.stockpile[Good.Stone] -= 30;
      st.buildings.push({ kind: BuildingKind.Workshop, x: spot[0], y: spot[1], stage: 0, hp: 60, workDone: 0 });
    }
  }

  // temple (04 light religion): pious cultures build one once established
  const faction = s.factions[st.factionId];
  if (sites < 2 && faction && faction.culture.piety > 100 && st.popCache > 70 &&
      !st.buildings.some(b => b.kind === BuildingKind.Temple) &&
      st.stockpile[Good.Stone] >= 50 && st.stockpile[Good.Wood] >= 20) {
    const spot = freeSpot(s, st);
    if (spot) {
      st.stockpile[Good.Stone] -= 50;
      st.stockpile[Good.Wood] -= 20;
      st.buildings.push({ kind: BuildingKind.Temple, x: spot[0], y: spot[1], stage: 0, hp: 80, workDone: 0 });
    }
  }

  // prospecting (02 §Resources): mining effort reveals hidden veins nearby
  if (s.config.oreDepletion && st.resourceTiles.mine.length === 0) {
    const faction = s.factions[st.factionId];
    if (faction && faction.prospectEffort > 0) {
      for (let v = 0; v < s.hiddenVeins.length; v++) {
        const vein = s.hiddenVeins[v];
        const dx = vein.x - st.x, dy = vein.y - st.y;
        if (dx * dx + dy * dy > 30 * 30) continue;
        if (faction.prospectEffort < vein.effortThreshold) continue;
        // reveal: pour the vein into the ore plane around (x,y)
        const i = vein.y * N + vein.x;
        s.map.ore[i] = Math.min(65535, s.map.ore[i] + vein.amount);
        s.hiddenVeins.splice(v, 1);
        faction.prospectEffort = 0;
        emitEvent(s, {
          type: EventType.OreDiscovered, factions: [st.factionId],
          x: vein.x, y: vein.y, severity: 3,
          text: `Y${yearOf(s.tick)}: Prospectors of ${st.name} strike a new ore vein in the hills.`,
        });
        break;
      }
    }
  }
}
