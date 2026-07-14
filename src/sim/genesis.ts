// Genesis: one-time world initialization from worldgen output.
import { BuildingKind, EventType, Good, GOOD_COUNT, Race, RACE_NAMES, WorldConfig, DiploState } from '../shared/types';
import { SimState, createEmptyState, Settlement, Faction, NamedCharacter, pairKey } from './state';
import { generateWorld } from './world/worldgen';
import { fullName, godName, settlementName } from './world/names';
import { RACE_TABLE } from './raceData';
import { spawnPawn } from './pawnOps';
import { emitEvent } from './events/events';
import { TileFlag, isPassable } from './world/map';
import { rollCulture, rollTraits } from './rules/identity';

export function genesis(seed: number, config: WorldConfig): SimState {
  const s = createEmptyState(seed, config);
  const gen = generateWorld(seed, config);
  s.map = gen.map;
  s.hiddenVeins = gen.hiddenVeins;
  s.spawns = gen.spawns;
  s.islandName = gen.islandName;
  const rng = s.rng.get('genesis');

  const genesisEv = emitEvent(s, {
    type: EventType.WorldGenesis, severity: 5,
    text: `The island of ${s.islandName} rises from the mist. Four peoples make it home.`,
  });

  for (let f = 0; f < gen.spawns.length && f < 4; f++) {
    const spawn = gen.spawns[f];
    const race = config.mirrorMatch ? Race.Human : spawn.race;
    const rs = RACE_TABLE[race];
    const faction: Faction = {
      id: f, race,
      name: '',
      god: godName(race, rng),
      leaderId: -1,
      culture: {
        aggression: rs.aggression, piety: rs.piety, wanderlust: rs.wanderlust,
        ...rollCulture(race, rng),
      },
      equipmentTier: 1000,
      extinct: false,
      reserveStores: false,
      conscriptTarget: 0,
      foodSignalAvg: 22000,
      capital: f,
      vassalOf: -1,
      prospectEffort: 0,
      llmCoverageNum: 0, llmCoverageDen: 0,
    };
    const sName = settlementName(race, rng);
    faction.name = `${sName} ${race === Race.Orc ? 'Horde' : race === Race.Dwarf ? 'Hold' : race === Race.Elf ? 'Court' : 'Kingdom'}`;
    s.factions.push(faction);

    const settlement: Settlement = {
      id: f, factionId: f, x: spawn.x, y: spawn.y, name: sName,
      stockpile: new Array(GOOD_COUNT).fill(0),
      buildings: [], farmPlots: [],
      founded: 0, razed: false,
      granaryCap: 4000, popCache: 0, moodAvg: 150, crowding: 0,
      loyalty: 100, capturedTick: -1,
      foodPerCapitaAvg: 22000, foodFlowAvg: 0, lastFoodStock: 3100, lodStatistical: false,
      resourceTiles: { forage: [], hunt: [], fish: [], wood: [], mine: [], stone: [] },
      fertileLand: 40,
    };
    // deep larders for poor farmers: dwarves hoard grain, orcs dry meat (04)
    settlement.stockpile[Good.Grain] = race === Race.Dwarf ? 4200 : 2600;
    settlement.stockpile[Good.Meat] = race === Race.Orc ? 1400 : 500;
    settlement.stockpile[Good.Wood] = 800;
    settlement.stockpile[Good.Stone] = 300;
    settlement.stockpile[Good.Tools] = 100;
    // starting buildings: granary + houses ring
    settlement.buildings.push({ kind: BuildingKind.Granary, x: spawn.x, y: spawn.y, stage: 3, hp: 200, workDone: 0 });
    const houseSpots = nearbySpots(s, spawn.x, spawn.y, 12);
    for (let h = 0; h < 8 && h < houseSpots.length; h++) {
      const [hx, hy] = houseSpots[h];
      settlement.buildings.push({ kind: BuildingKind.House, x: hx, y: hy, stage: 3, hp: 100, workDone: 0 });
    }
    s.settlements.push(settlement);

    // founding population
    const n = config.startPawnsPerFaction;
    for (let i = 0; i < n; i++) {
      const spot = houseSpots[i % houseSpots.length] ?? [spawn.x, spawn.y];
      const ageYears = i < 4 ? 30 + rng.int(10) : rs.adultAtYears + rng.int(20);
      spawnPawn(s, {
        x: spot[0], y: spot[1], factionId: f, settlementId: f,
        ageYears, female: i % 2 === 0,
      }, rng);
    }

    // leader: named king from the founding elders
    const leaderPawn = findEldestAdult(s, f);
    const king: NamedCharacter = {
      id: s.named.length,
      pawnIdx: leaderPawn,
      name: fullName(race, rng),
      role: 'king',
      factionId: f,
      bornTick: -Math.floor(35 * 360),
      deathTick: -1, deathCauseEventId: -1,
      bio: [`Founding ${race === Race.Orc ? 'warchief' : race === Race.Elf ? 'lord' : race === Race.Dwarf ? 'thane' : 'ruler'} of ${faction.name}.`],
      memories: [{ text: `Y0: I led my people to ${sName} and swore to ${faction.god} we would endure`, landmark: true, weight: 10, tick: 0 }],
      recentChoices: [],
      kills: 0,
      parentNamedId: -1,
      traits: rollTraits(seed, s.named.length),
    };
    if (leaderPawn >= 0) {
      s.pawns.namedId[leaderPawn] = king.id;
      s.pawns.flags[leaderPawn] |= 128; // PawnFlag.Named
    }
    faction.leaderId = king.id;
    faction.dynasty = { clan: king.name.split(' ').slice(-1)[0], foundedTick: 0 };
    faction.legitimacy = 90;
    s.named.push(king);
    s.namedActive++;

    emitEvent(s, {
      type: EventType.SettlementFounded,
      actors: [king.id], factions: [f],
      x: spawn.x, y: spawn.y,
      causes: [genesisEv.id],
      severity: 3,
      text: `Y0: The ${RACE_NAMES[race]}s of ${faction.name} settle ${sName} under ${king.name}.`,
    });
  }

  // initial diplomacy: all neutral (already default)
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    s.pairs[pairKey(a, b)].diplo = DiploState.Neutral;
  }

  // designate initial farm plots near each settlement
  for (const st of s.settlements) {
    const plots = nearbySpots(s, st.x, st.y, 10)
      .filter(([x, y]) => s.map.fertility[y * s.map.size + x] > 80)
      .slice(0, 24);
    for (const [x, y] of plots) {
      const i = y * s.map.size + x;
      s.map.flags[i] |= TileFlag.Farm;
      st.farmPlots.push(i);
    }
  }

  return s;
}

function nearbySpots(s: SimState, cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  const N = s.map.size;
  for (let d = 1; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue; // ring only
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
        const i = y * N + x;
        if (!isPassable(s.map, i)) continue;
        out.push([x, y]);
      }
    }
  }
  return out;
}

function findEldestAdult(s: SimState, factionId: number): number {
  let best = -1, bestAge = -1;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & 1)) continue;
    if (s.pawns.factionId[i] !== factionId) continue;
    if (s.pawns.age[i] > bestAge) { bestAge = s.pawns.age[i]; best = i; }
  }
  return best;
}
