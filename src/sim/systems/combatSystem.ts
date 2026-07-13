// System 9: squads, battles, morale, rout contagion, leader-death shock,
// automatic defense (never decision-gated; 04 §War / 05 §Latency fairness).
import { ActionId, EventType, Good, DiploState } from '../../shared/types';
import { SimState, PawnFlag, Squad, pairKey } from '../state';
import { RACE_TABLE } from '../raceData';
import { killPawn } from '../pawnOps';
import { emitEvent, yearOf } from '../events/events';
import { isPassable } from '../world/map';
import { getField, stepToCenter, inField, fieldDist } from '../world/flowField';
import { getRoute, nearestRouteIdx } from '../world/routes';
import { promoteNamed } from '../namedOps';
import { endWar, razeSettlement, queueDecision, postWarOptions, adjustLedger } from '../rules/decisions';

const MUSTER_TICKS = 12;

export function combatSystem(s: SimState): void {
  if (s.squads.length === 0 && s.wars.length === 0) return;

  // ---- automatic defense: garrison forms the tick a threat appears (04) ----
  for (const st of s.settlements) {
    if (st.razed) continue;
    const threat = s.squads.find(sq =>
      sq.state !== 'disband' && sq.state !== 'rout' &&
      sq.factionId !== st.factionId &&
      isHostile(s, sq.factionId, st.factionId) &&
      Math.max(Math.abs(sq.x - st.x), Math.abs(sq.y - st.y)) <= 10);
    if (!threat) continue;
    const hasGarrison = s.squads.some(sq =>
      sq.factionId === st.factionId && sq.homeSettlement === st.id &&
      (sq.state === 'defend' || sq.state === 'fight') && sq.warId < 0);
    if (hasGarrison) continue;
    // a broken garrison needs a season to rally another (P1.5): the pause is
    // when a siege's capture bar actually moves
    if (st.garrisonCooldownUntil !== undefined && s.tick < st.garrisonCooldownUntil) continue;
    const members: number[] = [];
    for (let i = 0; i < s.pawnCount && members.length < 34; i++) {
      const fl = s.pawns.flags[i];
      if (!(fl & PawnFlag.Alive) || (fl & PawnFlag.Child)) continue;
      if (s.pawns.settlementId[i] !== st.id) continue;
      if (s.pawns.squadId[i] !== 65535) continue;
      members.push(i);
    }
    if (members.length < 4) continue;
    const squadId = s.nextEntityId++;
    for (const m of members) s.pawns.squadId[m] = squadId;
    s.squads.push({
      id: squadId, factionId: st.factionId,
      x: st.x, y: st.y, targetX: st.x, targetY: st.y,
      members, morale: 235, state: 'defend',
      warId: -1, homeSettlement: st.id, pathIdx: 0, startSize: members.length,
    });
  }

  // ---- field rations: armies eat from the column's supplies (home-funded) ----
  // combat overrides the eat reflex every tick, so soldiers are fed here.
  if (s.tick % 25 === 3) {
    for (const sq of s.squads) {
      const home = s.settlements[sq.homeSettlement];
      for (const m of sq.members) {
        if (!(s.pawns.flags[m] & PawnFlag.Alive)) continue;
        if (s.pawns.hunger[m] > 100) {
          let paid = false;
          if (home && !home.razed) {
            for (const g of [Good.Grain, Good.Fish, Good.Meat]) {
              if (home.stockpile[g] > 0) { home.stockpile[g]--; paid = true; break; }
            }
          }
          s.pawns.hunger[m] = paid ? 40 : Math.max(0, s.pawns.hunger[m] - 60);
        }
      }
    }
  }

  // ---- squad state machines ----
  for (const sq of s.squads) {
    sq.members = sq.members.filter(m => s.pawns.flags[m] & PawnFlag.Alive);
    if (sq.members.length === 0) { sq.state = 'disband'; continue; }

    switch (sq.state) {
      case 'muster': {
        // members walk to the banner; march when most arrived or timer up
        let near = 0;
        for (const m of sq.members) {
          setSoldierTarget(s, m, sq.x, sq.y);
          if (Math.max(Math.abs(s.pawns.x[m] - sq.x), Math.abs(s.pawns.y[m] - sq.y)) <= 3) near++;
        }
        if (near >= (sq.members.length * 3) >> 2) sq.state = 'march';
        break;
      }
      case 'march': {
        moveBanner(s, sq, sq.targetX, sq.targetY);
        for (const m of sq.members) setSoldierTarget(s, m, sq.x, sq.y);
        const enemy = findEngagement(s, sq);
        if (enemy) { engage(s, sq, enemy); }
        else if (Math.max(Math.abs(sq.x - sq.targetX), Math.abs(sq.y - sq.targetY)) <= 2) {
          // arrived at the objective: the siege begins (P1.5)
          beginSiege(s, sq);
        }
        break;
      }
      case 'siege': {
        for (const m of sq.members) setSoldierTarget(s, m, sq.x, sq.y);
        const enemy = findEngagement(s, sq);
        if (enemy) { engage(s, sq, enemy); break; }
        const w = s.wars.find(w2 => w2.id === sq.warId);
        if (!w) { sq.state = 'disband'; break; }
        const target = s.settlements[w.targetSettlement];
        if (!target || target.razed || target.factionId !== w.defender) {
          sq.state = 'disband';
          break;
        }
        // capture stalls while any defender stands nearby: the walls hold
        const defendersHold = s.squads.some(o =>
          o.id !== sq.id && o.state !== 'disband' && o.state !== 'rout' &&
          isHostile(s, sq.factionId, o.factionId) &&
          Math.max(Math.abs(o.x - sq.x), Math.abs(o.y - sq.y)) <= 8);
        if (!defendersHold && s.tick % 2 === 0) {
          w.captureProgress = (w.captureProgress ?? 0) + 1;
          if (w.captureProgress >= 100) {
            w.captureProgress = 0;
            resolveObjective(s, sq);
          }
        }
        break;
      }
      case 'defend': {
        for (const m of sq.members) setSoldierTarget(s, m, sq.x, sq.y);
        const enemy = findEngagement(s, sq);
        if (enemy) { engage(s, sq, enemy); }
        else if (!anyThreatNear(s, sq)) {
          sq.state = 'disband';                            // threat gone; go home
        }
        break;
      }
      case 'fight': {
        const enemy = findEngagement(s, sq);
        if (!enemy) {
          // won the field (or enemy fled)
          if (sq.warId >= 0) {
            const w = s.wars.find(w2 => w2.id === sq.warId);
            if (w && Math.max(Math.abs(sq.x - sq.targetX), Math.abs(sq.y - sq.targetY)) <= 4) {
              beginSiege(s, sq);                             // walls next (P1.5)
            } else {
              sq.state = 'march';
            }
          } else {
            sq.state = 'defend';
          }
          break;
        }
        if (s.tick % 2 === 0) battleRound(s, sq, enemy);
        break;
      }
      case 'rout': {
        const home = s.settlements[sq.homeSettlement];
        if (home) moveBanner(s, sq, home.x, home.y);
        for (const m of sq.members) setSoldierTarget(s, m, sq.x, sq.y);
        if (!home || Math.max(Math.abs(sq.x - home.x), Math.abs(sq.y - home.y)) <= 3) {
          sq.state = 'disband';
        }
        break;
      }
      case 'disband': break;
    }
  }

  // release disbanded members, deposit raided goods, drop squads
  for (const sq of s.squads) {
    if (sq.state !== 'disband') continue;
    if (sq.warId < 0) {
      // defense squad ends (wiped or threat gone): rally cooldown (P1.5)
      const home = s.settlements[sq.homeSettlement];
      if (home) home.garrisonCooldownUntil = s.tick + 90;
    }
    for (const m of sq.members) {
      if (s.pawns.flags[m] & PawnFlag.Alive) {
        s.pawns.squadId[m] = 65535;
        s.pawns.action[m] = ActionId.Idle;
        s.pawns.actionTarget[m] = -1;
        s.pawns.flags[m] &= ~PawnFlag.Fighting;
      }
    }
  }
  s.squads = s.squads.filter(sq => sq.state !== 'disband');
}

function isHostile(s: SimState, a: number, b: number): boolean {
  if (a === b) return false;
  const d = s.pairs[pairKey(a, b)].diplo;
  return d === DiploState.War;
}

function setSoldierTarget(s: SimState, m: number, x: number, y: number): void {
  s.pawns.action[m] = ActionId.Fight;
  s.pawns.actionTarget[m] = y * s.map.size + x;
  s.pawns.actionTicks[m] = 0;
  s.pawns.flags[m] |= PawnFlag.Fighting;
  s.pawns.safety[m] = Math.min(255, s.pawns.safety[m] + 2);
}

function moveBanner(s: SimState, sq: Squad, tx: number, ty: number): void {
  // armies move at pawn speed; 1 tile/tick on the route
  const N = s.map.size;
  // inside the destination settlement's flow-field window → follow the field
  // (banners never jam in mountain country; same fix as pawn movement)
  const destSt = s.settlements.find(st => st.x === tx && st.y === ty);
  if (destSt) {
    const f = getField(s, destSt);
    if (inField(f, sq.x, sq.y) && fieldDist(f, sq.x, sq.y) !== 65535) {
      const nxt = stepToCenter(f, sq.x, sq.y);
      if (nxt) { sq.x = nxt[0]; sq.y = nxt[1]; marchColumn(s, sq); return; }
    }
  }
  // long-distance: cached A* route from home settlement to destination
  const home = s.settlements[sq.homeSettlement];
  if (home) {
    const route = getRoute(s, home.x, home.y, tx, ty);
    if (route) {
      sq.pathIdx = nearestRouteIdx(route, N, sq.x, sq.y, sq.pathIdx);
      const nxt = Math.min(route.length - 1, sq.pathIdx + 1);
      sq.x = route[nxt] % N;
      sq.y = (route[nxt] / N) | 0;
      sq.pathIdx = nxt;
      marchColumn(s, sq);
      return;
    }
  }
  const dx = Math.sign(tx - sq.x), dy = Math.sign(ty - sq.y);
  const cands = [[dx, dy], [dx, 0], [0, dy], [dy, dx], [-dy, -dx]];
  for (const [mx, my] of cands) {
    if (mx === 0 && my === 0) continue;
    const nx = sq.x + mx, ny = sq.y + my;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (!isPassable(s.map, ny * N + nx)) continue;
    sq.x = nx; sq.y = ny;
    marchColumn(s, sq);
    return;
  }
  // hard-jammed: sidestep perpendicular scanning for any passable tile
  for (let r = 1; r <= 3; r++) {
    for (const [mx, my] of [[0, r], [0, -r], [r, 0], [-r, 0]]) {
      const nx = sq.x + mx, ny = sq.y + my;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (!isPassable(s.map, ny * N + nx)) continue;
      sq.x = nx; sq.y = ny;
      marchColumn(s, sq);
      return;
    }
  }
}

/** Column cohesion: stragglers >10 tiles behind rejoin the marching column. */
function marchColumn(s: SimState, sq: Squad): void {
  for (const m of sq.members) {
    if (!(s.pawns.flags[m] & PawnFlag.Alive)) continue;
    if (Math.max(Math.abs(s.pawns.x[m] - sq.x), Math.abs(s.pawns.y[m] - sq.y)) > 10) {
      s.pawns.x[m] = sq.x;
      s.pawns.y[m] = sq.y;
    }
  }
}

/** Battle joined; the event feed learns armies met (chronicle anchor). */
function engage(s: SimState, a: Squad, b: Squad): void {
  if (a.state === 'fight' && b.state === 'fight') return;
  a.state = 'fight'; b.state = 'fight';
  const w = s.wars.find(w2 => w2.id === (a.warId >= 0 ? a.warId : b.warId));
  emitEvent(s, {
    type: EventType.BattleFought,
    factions: [a.factionId, b.factionId],
    x: a.x, y: a.y,
    causes: w ? w.causeEventIds.slice(0, 1) : [],
    severity: 3,
    text: `Y${yearOf(s.tick)}: The hosts of ${s.factions[a.factionId].name} and ${s.factions[b.factionId].name} meet in battle near ${nearestPlaceName(s, a.x, a.y)}.`,
  });
}

function findEngagement(s: SimState, sq: Squad): Squad | null {
  for (const other of s.squads) {
    if (other.id === sq.id || other.state === 'disband' || other.state === 'rout') continue;
    if (!isHostile(s, sq.factionId, other.factionId)) continue;
    if (Math.max(Math.abs(other.x - sq.x), Math.abs(other.y - sq.y)) <= 6) return other;
  }
  return null;
}

function anyThreatNear(s: SimState, sq: Squad): boolean {
  return s.squads.some(o =>
    o.id !== sq.id && o.state !== 'disband' && o.state !== 'rout' &&
    isHostile(s, sq.factionId, o.factionId) &&
    Math.max(Math.abs(o.x - sq.x), Math.abs(o.y - sq.y)) <= 14);
}

function squadPower(s: SimState, sq: Squad, defending: boolean): number {
  const f = s.factions[sq.factionId];
  const rs = RACE_TABLE[f.race];
  let p = 0;
  for (const m of sq.members) {
    if (!(s.pawns.flags[m] & PawnFlag.Alive)) continue;
    p += (defending ? rs.defense : rs.combat) + (s.pawns.strength[m] >> 5);
  }
  p = (p * f.equipmentTier / 1000) | 0;
  if (defending) p = (p * 13 / 10) | 0;                     // home-ground bonus
  return p;
}

function battleRound(s: SimState, a: Squad, b: Squad): void {
  const rng = s.rng.get('combat');
  const powerA = squadPower(s, a, a.state === 'defend' || a.warId < 0);
  const powerB = squadPower(s, b, b.state === 'defend' || b.warId < 0);
  const casualtiesOnB = applyCasualties(s, b, ((powerA / 300) | 0) + (rng.chance(powerA % 300, 300) ? 1 : 0), rng);
  const casualtiesOnA = applyCasualties(s, a, ((powerB / 300) | 0) + (rng.chance(powerB % 300, 300) ? 1 : 0), rng);

  // morale: casualties + leader-death shock (03); rout cascades below
  a.morale = Math.max(0, a.morale - casualtiesOnA.count * 9 - (casualtiesOnA.namedDied ? 60 : 0));
  b.morale = Math.max(0, b.morale - casualtiesOnB.count * 9 - (casualtiesOnB.namedDied ? 60 : 0));

  // war exhaustion from blood (04)
  const w = s.wars.find(w2 => w2.id === (a.warId >= 0 ? a.warId : b.warId));
  if (w) {
    const att = s.factions[w.attacker];
    const aIsAttacker = a.factionId === w.attacker;
    w.exhaustionA += (aIsAttacker ? casualtiesOnA.count : casualtiesOnB.count) * 3;
    w.exhaustionB += (aIsAttacker ? casualtiesOnB.count : casualtiesOnA.count) * 3;
  }

  for (const [sq, other] of [[a, b], [b, a]] as const) {
    // rout on broken morale OR 40% losses; small hosts break, not evaporate
    const broken = sq.morale < 80 || sq.members.length * 10 < sq.startSize * 6;
    if (broken && sq.state !== 'rout') {
      sq.state = 'rout';
      // a beaten army licks its wounds; no instant re-muster treadmill,
      // and lost battles drain the will to fight (04: wars END)
      if (w) {
        w.musterCooldownUntil = Math.max(w.musterCooldownUntil ?? 0, s.tick + 320);
        if (sq.factionId === w.attacker) w.exhaustionA += 55;
        else w.exhaustionB += 55;
      }
      // rout contagion (03): nearby friendly squads shaken
      for (const friend of s.squads) {
        if (friend.id === sq.id || friend.factionId !== sq.factionId) continue;
        if (Math.max(Math.abs(friend.x - sq.x), Math.abs(friend.y - sq.y)) <= 8) {
          friend.morale = Math.max(0, friend.morale - 25);
        }
      }
      const battleEv = emitEvent(s, {
        type: EventType.BattleFought,
        factions: [a.factionId, b.factionId],
        x: sq.x, y: sq.y,
        causes: w ? w.causeEventIds.slice(0, 1) : [],
        severity: 3,
        text: `Y${yearOf(s.tick)}: Battle near ${nearestPlaceName(s, sq.x, sq.y)}; the ${s.factions[sq.factionId].name} line breaks and runs.`,
      });
      // war hero promotion: strongest survivor of the winning side
      promoteHero(s, other, battleEv.id);
    }
  }
}

function applyCasualties(
  s: SimState, sq: Squad, dmgUnits: number, rng: import('../rng/rng').Rng,
): { count: number; namedDied: boolean } {
  let count = 0, namedDied = false;
  for (let k = 0; k < dmgUnits && sq.members.length > 0; k++) {
    const m = sq.members[rng.int(sq.members.length)];
    if (!(s.pawns.flags[m] & PawnFlag.Alive)) continue;
    const dmg = 25 + rng.int(30);
    if (s.pawns.hp[m] <= dmg) {
      if (s.pawns.namedId[m] >= 0) namedDied = true;
      killPawn(s, m, 'combat');
      count++;
    } else {
      s.pawns.hp[m] -= dmg;
    }
  }
  sq.members = sq.members.filter(m => s.pawns.flags[m] & PawnFlag.Alive);
  return { count, namedDied };
}

function promoteHero(s: SimState, winner: Squad, causeEventId: number): void {
  let best = -1, bestScore = -1;
  for (const m of winner.members) {
    if (!(s.pawns.flags[m] & PawnFlag.Alive)) continue;
    if (s.pawns.namedId[m] >= 0) {
      s.named[s.pawns.namedId[m]].kills++;
      continue;
    }
    if (s.pawns.strength[m] > bestScore) { bestScore = s.pawns.strength[m]; best = m; }
  }
  if (best >= 0 && s.rng.get('promotion').chance(1, 3)) {
    const nc = promoteNamed(s, best, 'hero', 'Stood unbroken when the enemy line shattered.', [causeEventId]);
    if (nc) nc.kills = 2;
  }
}

/** Arrival at the war objective opens a siege; the capture bar (P1.5) ticks
 *  in the siege state and the war strip renders it. */
function beginSiege(s: SimState, sq: Squad): void {
  const w = s.wars.find(w2 => w2.id === sq.warId);
  if (!w) { sq.state = 'disband'; return; }
  if (sq.state !== 'siege') {
    sq.state = 'siege';
    if (w.captureProgress === undefined) w.captureProgress = 0;
    const target = s.settlements[w.targetSettlement];
    if (target) {
      emitEvent(s, {
        type: EventType.BattleFought,
        factions: [sq.factionId, w.defender],
        x: target.x, y: target.y,
        causes: w.causeEventIds.slice(0, 1), severity: 3,
        text: `Y${yearOf(s.tick)}: The host of ${s.factions[sq.factionId].name} lays siege to ${target.name}.`,
      });
    }
  }
}

function resolveObjective(s: SimState, sq: Squad): void {
  const w = s.wars.find(w2 => w2.id === sq.warId);
  if (!w) { sq.state = 'disband'; return; }
  w.musterCooldownUntil = s.tick + 300;   // campaigns pace out AFTER a strike
  const target = s.settlements[w.targetSettlement];
  if (!target || target.razed || target.factionId !== w.defender) {
    sq.state = 'disband';
    return;
  }
  const year = yearOf(s.tick);
  const att = s.factions[w.attacker], def = s.factions[w.defender];
  switch (w.objective) {
    case 'raid': {
      const stolen = Math.min(target.stockpile[Good.Grain], 350);
      target.stockpile[Good.Grain] -= stolen;
      const home = s.settlements[sq.homeSettlement];
      if (home) home.stockpile[Good.Grain] = Math.min(home.granaryCap, home.stockpile[Good.Grain] + stolen);
      adjustLedger(s, w.defender, w.attacker, -3, `${target.name} plundered`);
      emitEvent(s, {
        type: EventType.BattleFought,
        factions: [w.attacker, w.defender],
        x: target.x, y: target.y,
        causes: w.causeEventIds.slice(0, 1), severity: 3,
        text: `Y${year}: Raiders of ${att.name} strip the granaries of ${target.name}.`,
      });
      w.exhaustionB += 60;                                  // being raided is exhausting
      w.exhaustionA += 90;                                  // raiders got what they came for
      endWarIfDone(s, w, true);
      sq.state = 'rout' as const;                           // reuse: walk home
      sq.state = 'disband';
      break;
    }
    case 'conquer': {
      target.factionId = w.attacker;
      target.capturedTick = s.tick;                          // conquered folk remember (P1.2)
      // inhabitants flee to kin rather than change banners (04 §Refugees);
      // only with nowhere left to run do they remain as subjects
      const N2 = s.map.size;
      let haven = -1, havenD = Infinity;
      for (const other of s.settlements) {
        if (other.razed || other.id === target.id) continue;
        if (other.factionId !== w.defender) continue;
        const ddx = other.x - target.x, ddy = other.y - target.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < havenD) { havenD = d2; haven = other.id; }
      }
      for (let i = 0; i < s.pawnCount; i++) {
        if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
        if (s.pawns.settlementId[i] !== target.id || s.pawns.squadId[i] !== 65535) continue;
        if (haven >= 0) {
          const hSt = s.settlements[haven];
          s.pawns.settlementId[i] = haven;
          s.pawns.actionTarget[i] = hSt.y * N2 + hSt.x;
          s.pawns.action[i] = ActionId.Flee;
          s.pawns.flags[i] |= PawnFlag.Refugee;
        } else {
          s.pawns.factionId[i] = w.attacker;                // assimilated; last resort
        }
      }
      adjustLedger(s, w.defender, w.attacker, -5, `${target.name} taken`);
      emitEvent(s, {
        type: EventType.SettlementTaken,
        factions: [w.attacker, w.defender],
        x: target.x, y: target.y,
        causes: w.causeEventIds.slice(0, 1), severity: 4,
        text: `Y${year}: The banners of ${att.name} rise over ${target.name}.`,
      });
      endWarIfDone(s, w, true);
      sq.state = 'disband';
      break;
    }
    case 'burn': {
      razeSettlement(s, target.id, w.attacker);
      endWarIfDone(s, w, true);
      sq.state = 'disband';
      break;
    }
  }
}

/** After an objective lands: defender broken → victory + post-war terms. */
function endWarIfDone(s: SimState, w: import('../state').War, attackerWon: boolean): void {
  const defenderLeft = s.settlements.some(st => !st.razed && st.factionId === w.defender);
  const heavyExhaustion = w.exhaustionA > 300 || w.exhaustionB > 300;
  if (!defenderLeft || heavyExhaustion || w.objective === 'raid') {
    endWar(s, w, 'victory', w.attacker);
    if (attackerWon && defenderLeft && !s.factions[w.defender].extinct) {
      // victor dictates terms (05 catalog: post-war group)
      queueDecision(s, w.attacker, 'postWar', 3, postWarOptions(), w.defender);
    }
    emitEvent(s, {
      type: EventType.PeaceMade,
      factions: [w.attacker, w.defender],
      causes: w.causeEventIds.slice(0, 1),
      severity: 3,
      text: `Y${yearOf(s.tick)}: The war between ${s.factions[w.attacker].name} and ${s.factions[w.defender].name} ends.`,
    });
  }
}

export function nearestPlaceName(s: SimState, x: number, y: number): string {
  let best = 'the wilds', bestD = Infinity;
  for (const st of s.settlements) {
    const dx = st.x - x, dy = st.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = st.name; }
  }
  return best;
}
