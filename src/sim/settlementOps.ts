// Settlement-level planning: building sites, farm-plot expansion, prospecting.
// Runs from the periodic refresh (deterministic, index-ordered).
import { BuildingKind, EventType, Good } from '../shared/types';
import { SimState, Settlement } from './state';
import { TileFlag, isPassable } from './world/map';
import { emitEvent, yearOf } from './events/events';

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
