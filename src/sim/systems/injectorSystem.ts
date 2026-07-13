// System 12.5: pressure injectors (04 §Monsters & 08 M6): boring-equilibrium
// insurance. All seeded + state-triggered; wealth-targeted where the doc says
// so (the dragon smells gold; plague rides the busiest roads).
import { EventType, Good, TICKS_PER_YEAR, DiploState } from '../../shared/types';
import { SimState, PawnFlag, effFood, pairKey } from '../state';
import { emitEvent, yearOf } from '../events/events';
import { killPawn } from '../pawnOps';
import { promoteNamed } from '../namedOps';
import { Biome } from '../../shared/types';

export function injectorSystem(s: SimState): void {
  if (!s.config.injectors) return;

  // ---- monster behavior every 5 ticks ----
  if (s.tick % 5 === 2 && s.monsters.length > 0) {
    stepMonsters(s);
  }

  // ---- plague spread (SIR-lite) monthly ----
  if (s.weather.plagueActive && s.tick % 30 === 17) {
    stepPlague(s);
  }

  // ---- yearly injector scheduling (seeded; no 50y window event-free, 04) ----
  if (s.tick % TICKS_PER_YEAR !== 77) return;
  const rng = s.rng.get('injectors');
  const year = yearOf(s.tick);
  if (year < 8) return;

  // wolves: livestock/child threat near forest settlements (~1/8y)
  if (rng.chance(1, 8) && s.monsters.filter(m => m.kind === 'wolf').length < 2) {
    const target = s.settlements.find(st => !st.razed && st.popCache > 60 &&
      nearBiome(s, st.x, st.y, Biome.Forest, 12));
    if (target) {
      s.monsters.push({
        id: s.nextEntityId++, kind: 'wolf',
        x: target.x + 8, y: target.y + 8, hp: 60,
        targetSettlement: target.id, ticksLeft: TICKS_PER_YEAR,
      });
      emitEvent(s, {
        type: EventType.WolfAttack, factions: [target.factionId],
        x: target.x, y: target.y, severity: 2,
        text: `Y${year}: Wolves circle ${target.name}. Herds thin; children are kept indoors.`,
      });
    }
  }

  // troll: blocks the roads near a settlement (~1/15y), taxes trade
  if (rng.chance(1, 15) && !s.monsters.some(m => m.kind === 'troll')) {
    const target = s.settlements.find(st => !st.razed &&
      nearBiome(s, st.x, st.y, Biome.Hills, 14));
    if (target) {
      s.monsters.push({
        id: s.nextEntityId++, kind: 'troll',
        x: target.x - 6, y: target.y - 6, hp: 220,
        targetSettlement: target.id, ticksLeft: 4 * TICKS_PER_YEAR,
      });
      emitEvent(s, {
        type: EventType.TrollBlockade, factions: [target.factionId],
        x: target.x - 6, y: target.y - 6, severity: 3,
        text: `Y${year}: A troll squats by the ${target.name} road, and caravans go the long way or not at all.`,
      });
    }
  }

  // dragon: rare (~1/60y), targets the RICHEST granary (wealth attracts trouble)
  if (year > 40 && rng.chance(1, 60) && !s.monsters.some(m => m.kind === 'dragon')) {
    let richest = null as import('../state').Settlement | null;
    for (const st of s.settlements) {
      if (st.razed) continue;
      if (!richest || st.stockpile[Good.Grain] + st.stockpile[Good.Ore] * 4 >
          richest.stockpile[Good.Grain] + richest.stockpile[Good.Ore] * 4) richest = st;
    }
    if (richest) {
      s.monsters.push({
        id: s.nextEntityId++, kind: 'dragon',
        x: richest.x + 20, y: richest.y - 20, hp: 500,
        targetSettlement: richest.id, ticksLeft: TICKS_PER_YEAR,
      });
      emitEvent(s, {
        type: EventType.DragonRaid, factions: [richest.factionId],
        x: richest.x, y: richest.y, severity: 5,
        text: `Y${year}: A shadow crosses the sun. The dragon has smelled the wealth of ${richest.name}.`,
      });
    }
  }

  // plague: starts at the busiest trade hub (~1/25y), rides caravans
  if (!s.weather.plagueActive && year > 20 && rng.chance(1, 25)) {
    const hub = s.settlements.find(st => !st.razed && st.popCache > 90);
    if (hub) {
      s.weather.plagueActive = true;
      s.plague.settlementInfections = { [hub.id]: 100 };
      emitEvent(s, {
        type: EventType.Plague, factions: [hub.factionId],
        x: hub.x, y: hub.y, severity: 4,
        text: `Y${year}: A sickness arrives in ${hub.name} with the trade wagons. The healers burn herbs and pray.`,
      });
    }
  }

  // forest fire: drought year + forest (~1/3 in drought years)
  if (s.weather.drought > 0 && rng.chance(1, 3)) {
    const N = s.map.size;
    // find a forested area near a settlement
    const st = s.settlements.find(x => !x.razed && nearBiome(s, x.x, x.y, Biome.Forest, 12));
    if (st) {
      let burned = 0;
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const x = st.x + 6 + dx, y = st.y + 6 + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const i = y * N + x;
          if (s.map.forest[i] > 60 && rng.chance(2, 3)) {
            s.map.forest[i] = 4;
            s.map.flags[i] |= 8; // Burned
            burned++;
          }
        }
      }
      if (burned > 30) {
        emitEvent(s, {
          type: EventType.ForestFire, factions: [st.factionId],
          x: st.x + 6, y: st.y + 6, severity: 3,
          text: `Y${year}: Fire takes the woods near ${st.name}. The sky is brown for a season.`,
        });
      }
    }
  }
}

function nearBiome(s: SimState, cx: number, cy: number, biome: number, r: number): boolean {
  const N = s.map.size;
  for (let dy = -r; dy <= r; dy += 3) {
    for (let dx = -r; dx <= r; dx += 3) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (s.map.biome[y * N + x] === biome) return true;
    }
  }
  return false;
}

function stepMonsters(s: SimState): void {
  const rng = s.rng.get('monsters');
  for (const m of s.monsters) {
    m.ticksLeft -= 5;
    const target = s.settlements[m.targetSettlement];
    if (!target || target.razed) { m.ticksLeft = 0; continue; }
    // drift toward target
    m.x += Math.sign(target.x - m.x);
    m.y += Math.sign(target.y - m.y);
    const dist = Math.max(Math.abs(m.x - target.x), Math.abs(m.y - target.y));

    if (m.kind === 'wolf' && dist <= 6) {
      // kill an unlucky pawn occasionally; raises fear
      if (rng.chance(1, 6)) {
        const victim = findPawnNear(s, m.x, m.y, 6);
        if (victim >= 0) {
          s.pawns.safety[victim] = 255;
          if (rng.chance(1, 5)) killPawn(s, victim, 'monster');
        }
      }
    }
    if (m.kind === 'dragon' && dist <= 2) {
      // torch the granary (04: wealth-targeted); survivors remember
      const stolen = (target.stockpile[Good.Grain] * 2 / 3) | 0;
      target.stockpile[Good.Grain] -= stolen;
      let kills = 0;
      for (let k = 0; k < 6; k++) {
        const v = findPawnNear(s, target.x, target.y, 5);
        if (v >= 0) { killPawn(s, v, 'monster'); kills++; }
      }
      const ev = emitEvent(s, {
        type: EventType.DragonRaid, factions: [target.factionId],
        x: target.x, y: target.y, severity: 5,
        text: `Y${yearOf(s.tick)}: The dragon burns the granaries of ${target.name} and is gone before the ash settles. ${kills} souls with it.`,
      });
      // survivor of a monster attack that killed 5+ → promotion (03)
      if (kills >= 5) {
        const survivor = findPawnNear(s, target.x, target.y, 4);
        if (survivor >= 0) {
          promoteNamed(s, survivor, 'survivor', `Walked out of the dragonfire at ${target.name}.`, [ev.id]);
        }
      }
      m.ticksLeft = 0;
    }
    if (m.kind === 'troll') {
      // trolls tax passing caravans (goods vanish)
      for (const c of s.caravans) {
        if (Math.max(Math.abs(c.x - m.x), Math.abs(c.y - m.y)) <= 3) {
          for (let g = 0; g < c.goods.length; g++) c.goods[g] = (c.goods[g] * 2 / 3) | 0;
        }
      }
      // garrison may drive it off: nearby squads damage it
      for (const sq of s.squads) {
        if (Math.max(Math.abs(sq.x - m.x), Math.abs(sq.y - m.y)) <= 4) {
          m.hp -= sq.members.length;
        }
      }
      if (m.hp <= 0) {
        emitEvent(s, {
          type: EventType.MonsterSlain, factions: [target.factionId],
          x: m.x, y: m.y, severity: 3,
          text: `Y${yearOf(s.tick)}: The troll of the ${target.name} road is slain. The wagons roll again.`,
        });
        m.ticksLeft = 0;
      }
    }
  }
  s.monsters = s.monsters.filter(m => m.ticksLeft > 0 && m.hp > 0);
}

function stepPlague(s: SimState): void {
  const rng = s.rng.get('plague');
  const infections = s.plague.settlementInfections;
  let anyActive = false;
  for (const key of Object.keys(infections).sort((a, b) => Number(a) - Number(b))) {
    const stId = Number(key);
    const st = s.settlements[stId];
    let level = infections[stId];
    if (!st || st.razed || level <= 0) { delete infections[stId]; continue; }
    anyActive = true;
    // deaths: ~1% of pop per month at peak, scaled by infection level
    const deaths = Math.max(0, (st.popCache * level / 8000) | 0) + (rng.chance(level, 400) ? 1 : 0);
    for (let k = 0; k < deaths; k++) {
      const v = findPawnNear(s, st.x, st.y, 14);
      if (v >= 0) killPawn(s, v, 'plague');
    }
    // recover/decay
    level -= 6 + rng.int(5);
    if (level <= 0) {
      delete infections[stId];
      emitEvent(s, {
        type: EventType.Plague, factions: [st.factionId],
        x: st.x, y: st.y, severity: 2,
        text: `Y${yearOf(s.tick)}: The sickness releases its grip on ${st.name}.`,
      });
    } else {
      infections[stId] = level;
    }
    // spread via active caravans from this settlement (trade routes spread disease)
    for (const c of s.caravans) {
      if (c.from !== stId || c.state !== 'travel') continue;
      const dst = s.settlements[c.to];
      if (dst && !dst.razed && infections[dst.id] === undefined && rng.chance(1, 3)) {
        infections[dst.id] = 80;
        emitEvent(s, {
          type: EventType.Plague, factions: [dst.factionId],
          x: dst.x, y: dst.y, severity: 3,
          text: `Y${yearOf(s.tick)}: The sickness reaches ${dst.name}, riding in a wagon of grain.`,
        });
      }
    }
  }
  if (!anyActive) s.weather.plagueActive = false;
}

function findPawnNear(s: SimState, x: number, y: number, r: number): number {
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
    if (Math.abs(s.pawns.x[i] - x) <= r && Math.abs(s.pawns.y[i] - y) <= r) return i;
  }
  return -1;
}
