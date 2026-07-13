// System 12: economy v1 (04): numeraire prices, spoilage/wear sinks,
// physical trade caravans (escortable, raidable), tribute delivery, D5 reroute.
import { DiploState, EventType, Good, GOOD_COUNT, TICKS_PER_YEAR } from '../../shared/types';
import { SimState, Settlement, pairKey, PawnFlag, Caravan, effFood } from '../state';
import { emitEvent, yearOf } from '../events/events';
import { adjustLedger, declareWar } from '../rules/decisions';
import { isPassable } from '../world/map';
import { getRoute, nearestRouteIdx } from '../world/routes';

/** Local price in grain-equivalents ×1000 (04): scarcity ratio, no money. */
export function goodPrice(st: Settlement, g: Good): number {
  const targets = [st.popCache * 20 + 200, st.popCache * 5 + 50, st.popCache * 5 + 50, 120, 90, 50, 40];
  const target = targets[g] ?? 50;
  const stock = st.stockpile[g] + 1;
  return Math.max(100, Math.min(8000, (target * 1000 / stock) | 0));
}

export function economySystem(s: SimState): void {
  // ---- yearly sinks: spoilage + tool wear (04 §Economy stability) ----
  if (s.tick % TICKS_PER_YEAR === 200) {
    for (const st of s.settlements) {
      if (st.razed) continue;
      st.stockpile[Good.Grain] -= (st.stockpile[Good.Grain] / 10) | 0;   // ~10%/yr spoils
      st.stockpile[Good.Meat] -= (st.stockpile[Good.Meat] / 7) | 0;
      st.stockpile[Good.Fish] -= (st.stockpile[Good.Fish] / 7) | 0;
      const wear = Math.max(st.stockpile[Good.Tools] > 0 ? 1 : 0, (st.stockpile[Good.Tools] / 20) | 0);
      st.stockpile[Good.Tools] -= wear;
    }
    // equipment tier decays without maintenance crafting
    for (const f of s.factions) {
      if (!f.extinct && f.equipmentTier > 1000) {
        f.equipmentTier = Math.max(1000, f.equipmentTier - 15);
      }
    }
  }

  // ---- trade caravan spawning: twice yearly per pair, price-gap driven ----
  if (s.tick % TICKS_PER_YEAR === 140 || s.tick % TICKS_PER_YEAR === 320) {
    spawnTradeCaravans(s);
  }

  // ---- caravan movement + raid checks (every 2 ticks) ----
  if (s.tick % 2 === 0) {
    for (const c of s.caravans) {
      stepCaravan(s, c);
    }
    s.caravans = s.caravans.filter(c => c.state !== 'done');
  }
}

function spawnTradeCaravans(s: SimState): void {
  const active = s.caravans.filter(c => c.purpose === 'trade').length;
  if (active >= 6) return;
  for (let a = 0; a < s.factions.length; a++) {
    for (let b = a + 1; b < s.factions.length; b++) {
      const fa = s.factions[a], fb = s.factions[b];
      if (!fa || !fb || fa.extinct || fb.extinct) continue;
      const pair = s.pairs[pairKey(a, b)];
      if (pair.embargo || pair.diplo < DiploState.Neutral) continue;
      // find the best good gap between their capitals
      const sa = s.settlements.find(st => !st.razed && st.factionId === a);
      const sb = s.settlements.find(st => !st.razed && st.factionId === b);
      if (!sa || !sb) continue;
      // grain rushes to a starving partner first (dwarves buy grain with ore; 04).
      // Neutral neighbors sell to the hungry too; formal Trade opens the rest.
      const aStarves = effFood(sa) < 12000, bStarves = effFood(sb) < 12000;
      if (aStarves !== bStarves) {
        const src = aStarves ? sb : sa, dst = aStarves ? sa : sb;
        // reserveStores stops OUTGOING wagons only; never blocks relief
        if (s.factions[src.factionId].reserveStores) continue;
        if (src.stockpile[Good.Grain] > 500) {
          const amount = Math.min(260, (src.stockpile[Good.Grain] / 4) | 0);
          src.stockpile[Good.Grain] -= amount;
          const goods = new Array(GOOD_COUNT).fill(0);
          goods[Good.Grain] = amount;
          s.caravans.push({
            id: s.nextEntityId++,
            from: src.id, to: dst.id, factionId: src.factionId,
            x: src.x, y: src.y, goods,
            purpose: 'trade', escorts: [], state: 'travel', raided: false, pathIdx: 0,
          });
          continue;
        }
      }
      if (pair.diplo < DiploState.Trade) continue;   // routine commerce needs a pact
      let bestGood = -1, bestGap = 0, dir = 0;
      for (let g = 0 as Good; g < GOOD_COUNT; g++) {
        const pa = goodPrice(sa, g), pb = goodPrice(sb, g);
        if (pb - pa > bestGap && sa.stockpile[g] > 150 && !fa.reserveStores) { bestGap = pb - pa; bestGood = g; dir = 1; }
        if (pa - pb > bestGap && sb.stockpile[g] > 150 && !fb.reserveStores) { bestGap = pa - pb; bestGood = g; dir = -1; }
      }
      if (bestGood < 0 || bestGap < 800) continue;
      const src = dir === 1 ? sa : sb, dst = dir === 1 ? sb : sa;
      const amount = Math.min(200, (src.stockpile[bestGood] / 4) | 0);
      if (amount < 30) continue;
      src.stockpile[bestGood] -= amount;
      const goods = new Array(GOOD_COUNT).fill(0);
      goods[bestGood] = amount;
      s.caravans.push({
        id: s.nextEntityId++,
        from: src.id, to: dst.id, factionId: src.factionId,
        x: src.x, y: src.y, goods,
        purpose: 'trade', escorts: [], state: 'travel', raided: false, pathIdx: 0,
      });
    }
  }
}

function stepCaravan(s: SimState, c: Caravan): void {
  const dest = c.state === 'travel' ? s.settlements[c.to] : s.settlements[c.from];

  // D5: destination razed mid-route → reroute to next legal partner or home
  if (c.state === 'travel' && (!dest || dest.razed)) {
    const alt = s.settlements.find(st =>
      !st.razed && st.factionId === s.settlements[c.to]?.factionId && st.id !== c.to);
    if (alt) {
      c.to = alt.id;
      c.pathIdx = 0;
    } else {
      c.state = 'return';
      c.pathIdx = 0;
      emitEvent(s, {
        type: EventType.CaravanRaided, factions: [c.factionId],
        x: c.x, y: c.y, severity: 2,
        text: `Y${yearOf(s.tick)}: A caravan finds only ashes where its market stood, and turns for home.`,
      });
    }
    return;
  }
  if (!dest) { c.state = 'done'; return; }

  // raid check: hostile squad nearby (traveling loot is an orc magnet; 04)
  for (const sq of s.squads) {
    if (sq.state === 'disband' || sq.state === 'rout') continue;
    if (sq.factionId === c.factionId) continue;
    const d = s.pairs[pairKey(sq.factionId, c.factionId)].diplo;
    if (d > DiploState.Hostile) continue;
    if (Math.max(Math.abs(sq.x - c.x), Math.abs(sq.y - c.y)) <= 4) {
      c.raided = true;
      c.state = 'done';
      const raider = s.factions[sq.factionId];
      const ev = emitEvent(s, {
        type: EventType.CaravanRaided,
        factions: [sq.factionId, c.factionId],
        x: c.x, y: c.y, severity: 3,
        text: `Y${yearOf(s.tick)}: ${raider.name} riders fall upon a ${s.factions[c.factionId].name} caravan and carry off its goods.`,
      });
      // stolen goods to raider's nearest settlement
      const rh = s.settlements.find(st => !st.razed && st.factionId === sq.factionId);
      if (rh) {
        for (let g = 0; g < GOOD_COUNT; g++) {
          rh.stockpile[g] = Math.min(9999, rh.stockpile[g] + c.goods[g]);
        }
      }
      // grudge + casus belli (04): a raided tribute caravan can spark war
      adjustLedger(s, c.factionId, sq.factionId, -4, 'caravan raided');
      if (c.purpose !== 'trade' && s.pairs[pairKey(c.factionId, sq.factionId)].grudge >= 8) {
        declareWar(s, c.factionId, sq.factionId, null, 'raid');
      }
      return;
    }
  }

  // movement: cached A* route between the two settlements (mountain-proof).
  // Route endpoints are fixed (settlement centers) so the cache key is stable.
  const N = s.map.size;
  const origin = c.state === 'travel' ? s.settlements[c.from] : s.settlements[c.to];
  const route = origin ? getRoute(s, origin.x, origin.y, dest.x, dest.y) : null;
  if (route) {
    c.pathIdx = nearestRouteIdx(route, N, c.x, c.y, c.pathIdx);
    const nxt = Math.min(route.length - 1, c.pathIdx + 1);
    c.x = route[nxt] % N;
    c.y = (route[nxt] / N) | 0;
    c.pathIdx = nxt;
  } else {
    // truly unreachable → give up (goods lost with the wagons)
    c.state = 'done';
    return;
  }

  if (Math.abs(c.x - dest.x) <= 1 && Math.abs(c.y - dest.y) <= 1) {
    if (c.state === 'travel') {
      arriveCaravan(s, c, dest);
    } else {
      // returned home with exchange goods
      for (let g = 0; g < GOOD_COUNT; g++) {
        dest.stockpile[g] = Math.min(9999, dest.stockpile[g] + c.goods[g]);
      }
      c.state = 'done';
    }
  }
}

function arriveCaravan(s: SimState, c: Caravan, dest: Settlement): void {
  const year = yearOf(s.tick);
  for (let g = 0; g < GOOD_COUNT; g++) {
    dest.stockpile[g] = Math.min(9999, dest.stockpile[g] + c.goods[g]);
  }
  if (c.purpose === 'tribute') {
    adjustLedger(s, dest.factionId, c.factionId, 2, 'tribute delivered');
    emitEvent(s, {
      type: EventType.TributePaid, factions: [c.factionId, dest.factionId],
      x: dest.x, y: dest.y, severity: 2,
      text: `Y${year}: Tribute wagons from ${s.factions[c.factionId].name} roll into ${dest.name}.`,
    });
    c.state = 'done';
    return;
  }
  if (c.purpose === 'gift') {
    adjustLedger(s, dest.factionId, c.factionId, 3, 'generous gift');
    emitEvent(s, {
      type: EventType.GiftSent, factions: [c.factionId, dest.factionId],
      x: dest.x, y: dest.y, severity: 2,
      text: `Y${year}: ${s.factions[c.factionId].name} sends gifts to ${dest.name}.`,
    });
    c.state = 'done';
    return;
  }
  // trade: exchange; load the good the destination has cheapest & home wants
  const home = s.settlements[c.from];
  adjustLedger(s, dest.factionId, c.factionId, 1, 'honest trade');
  if (home && !home.razed) {
    let bestGood = -1, bestGap = 0;
    for (let g = 0 as Good; g < GOOD_COUNT; g++) {
      const gap = goodPrice(home, g) - goodPrice(dest, g);
      if (gap > bestGap && dest.stockpile[g] > 100) { bestGap = gap; bestGood = g; }
    }
    c.goods.fill(0);
    c.pathIdx = 0;
    if (bestGood >= 0) {
      const amount = Math.min(160, (dest.stockpile[bestGood] / 4) | 0);
      dest.stockpile[bestGood] -= amount;
      c.goods[bestGood] = amount;
    }
    c.state = 'return';
  } else {
    c.state = 'done';
  }
}
