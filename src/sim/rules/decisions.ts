// Rule engine (05): computes legal decision options per situation, builds the
// situation digest, and EXECUTES chosen options. The LLM (or RuleBrain) only
// ever picks one string from the options list; rules do everything else.
import {
  DiploState, EventType, Good, RACE_NAMES, Season, TICKS_PER_YEAR,
  DecisionDigest, JournalEntry,
} from '../../shared/types';
import {
  SimState, Faction, pairKey, PawnFlag, effFood, NamedCharacter, Memory,
} from '../state';
import { emitEvent, recentEvents, yearOf } from '../events/events';
import { seasonOf } from '../systems/calendarSystem';
import { RACE_TABLE } from '../raceData';
import { canProsperExpand, findExpansionSite, foundSettlement } from '../settlementOps';

export function livingFactions(s: SimState): Faction[] {
  return s.factions.filter(f => !f.extinct);
}

export function factionPop(s: SimState, fid: number): number {
  let n = 0;
  for (let i = 0; i < s.pawnCount; i++) {
    if ((s.pawns.flags[i] & PawnFlag.Alive) && s.pawns.factionId[i] === fid) n++;
  }
  return n;
}

export function factionFood(s: SimState, fid: number): number {
  let t = 0;
  for (const st of s.settlements) {
    if (!st.razed && st.factionId === fid) {
      t += st.stockpile[Good.Grain] + st.stockpile[Good.Meat] + st.stockpile[Good.Fish];
    }
  }
  return t;
}

export function armyStrength(s: SimState, fid: number): number {
  const f = s.factions[fid];
  if (!f || f.extinct) return 0;
  let adults = 0;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
    if (s.pawns.factionId[i] !== fid) continue;
    if (s.pawns.flags[i] & PawnFlag.Child) continue;
    adults++;
  }
  const rs = RACE_TABLE[f.race];
  return (adults * (rs.combat + rs.defense) * f.equipmentTier / 20000) | 0;
}

/** Dominance share for coalition brake (04): settlements share. */
export function dominanceShare(s: SimState, fid: number): number {
  const total = s.settlements.filter(st => !st.razed).length;
  if (total === 0) return 0;
  const mine = s.settlements.filter(st => !st.razed && st.factionId === fid).length;
  return (mine * 100 / total) | 0;
}

export function atWar(s: SimState, a: number, b: number): boolean {
  return s.pairs[pairKey(a, b)].diplo === DiploState.War;
}

// ---- Legal options per situation kind ----

export function councilOptions(s: SimState, fid: number): string[] {
  const opts: string[] = ['CONSOLIDATE'];
  const me = s.factions[fid];
  const myArmy = armyStrength(s, fid);
  const myFood = effFoodFaction(s, fid);
  for (const other of livingFactions(s)) {
    if (other.id === fid) continue;
    const pk = pairKey(fid, other.id);
    const pair = s.pairs[pk];
    const theirArmy = armyStrength(s, other.id);
    switch (pair.diplo) {
      case DiploState.War:
        opts.push(`SUE_FOR_PEACE(${other.id})`);
        opts.push(`SET_WAR_OBJECTIVE(${other.id},raid)`);
        opts.push(`SET_WAR_OBJECTIVE(${other.id},conquer)`);
        opts.push(`SET_WAR_OBJECTIVE(${other.id},burn)`);
        break;
      case DiploState.Hostile:
      case DiploState.Neutral:
      case DiploState.Trade: {
        if (s.tick >= pair.truceUntil && me.vassalOf < 0) {
          // war is legal when grudged, hungry (raid EV), or opportunistic-strong
          const hungry = myFood < 8000;
          const stronger = myArmy > theirArmy * 13 / 10;
          if (pair.grudge >= 4 || hungry || stronger) opts.push(`DECLARE_WAR(${other.id})`);
        }
        if (pair.diplo !== DiploState.Trade) opts.push(`PROPOSE_TRADE(${other.id})`);
        opts.push(`SEND_GIFT(${other.id})`);
        if (myArmy > theirArmy) opts.push(`DEMAND_TRIBUTE(${other.id})`);
        opts.push(`PROPOSE_ALLIANCE(${other.id})`);
        if (pair.diplo === DiploState.Trade) opts.push(`EMBARGO(${other.id})`);
        break;
      }
      case DiploState.Alliance:
        opts.push(`SEND_GIFT(${other.id})`);
        break;
      default:
        break;
    }
  }
  // coalition brake (04): ALLY_AGAINST when someone dominates
  if (s.config.coalitions) {
    for (const heg of livingFactions(s)) {
      if (heg.id === fid) continue;
      if (dominanceShare(s, heg.id) >= 45) {
        for (const co of livingFactions(s)) {
          if (co.id === fid || co.id === heg.id) continue;
          if (s.pairs[pairKey(fid, co.id)].diplo >= DiploState.Neutral && !atWar(s, fid, co.id)) {
            opts.push(`ALLY_AGAINST(${heg.id},${co.id})`);
            break;
          }
        }
        break;
      }
    }
  }
  opts.push('CONSCRIPT', 'DISBAND_SOLDIERS', 'RESERVE_STORES');
  // EXPAND (11 §F fix 3): kings charter daughter villages from prosperity;
  // paced one charter per ~8y so growth reads as a story, not a burst
  const mine = s.settlements.filter(st => !st.razed && st.factionId === fid);
  if (mine.length > 0 && mine.length < 4 &&
      s.tick - (me.lastExpansionTick ?? 0) > 8 * TICKS_PER_YEAR &&
      mine.some(st => canProsperExpand(st))) {
    opts.push('EXPAND');
  }
  return [...new Set(opts)];
}

export function responseOptions(kind: string, fromFaction: number): string[] {
  switch (kind) {
    case 'tributeDemand':
      return ['PAY_TRIBUTE', 'REFUSE_TRIBUTE'];
    case 'allianceProposal':
    case 'tradeProposal':
    case 'marriageProposal':
      return ['ACCEPT_PROPOSAL', 'REJECT_PROPOSAL'];
    case 'truceOffer':
      return ['ACCEPT_TRUCE', 'REJECT_TRUCE'];
    default:
      return ['CONSOLIDATE'];
  }
}

export function postWarOptions(): string[] {
  return ['TAKE_TRIBUTE', 'SHIFT_BORDER', 'VASSALIZE', 'RAZE'];
}

function effFoodFaction(s: SimState, fid: number): number {
  let sum = 0, n = 0;
  for (const st of s.settlements) {
    if (!st.razed && st.factionId === fid) { sum += effFood(st); n++; }
  }
  return n ? (sum / n) | 0 : 0;
}

// ---- Situation digest (05 §DecisionRequest) ----

export function buildDigest(s: SimState, fid: number, options: string[]): DecisionDigest {
  const f = s.factions[fid];
  const king = f.leaderId >= 0 ? s.named[f.leaderId] : null;
  const grudges = livingFactions(s)
    .filter(o => o.id !== fid)
    .map(o => {
      const pair = s.pairs[pairKey(fid, o.id)];
      const why = pair.ledger.slice(-3).map(l => l.why).join('; ') || 'old frictions';
      return { faction: `${o.name} (${o.id})`, weight: pair.grudge, why };
    })
    .filter(g => g.weight > 0);
  const treaties: string[] = [];
  for (const o of livingFactions(s)) {
    if (o.id === fid) continue;
    const d = s.pairs[pairKey(fid, o.id)].diplo;
    if (d !== DiploState.Neutral) treaties.push(`${DIPLO_TEXT[d]} with ${o.name} (${o.id})`);
  }
  const enemyEstimates: Record<string, string> = {};
  for (const o of livingFactions(s)) {
    if (o.id === fid) continue;
    const ratio = armyStrength(s, o.id) * 100 / Math.max(1, armyStrength(s, fid));
    enemyEstimates[`${o.name} (${o.id})`] =
      ratio > 140 ? 'much stronger than us' : ratio > 105 ? 'somewhat stronger' :
      ratio > 75 ? 'roughly our equal' : ratio > 40 ? 'weaker than us' : 'far weaker';
  }
  const foodMonths = ((factionFood(s, fid) / Math.max(1, factionPop(s, fid))) * 12 / 21) | 0;
  return {
    persona: {
      name: king?.name ?? 'The Council',
      race: RACE_NAMES[f.race],
      traits: personaTraits(s, king),
      age: king ? Math.max(16, ((s.tick - king.bornTick) / TICKS_PER_YEAR) | 0) : 50,
      yearsRuled: king ? Math.max(0, ((s.tick - king.bornTick) / TICKS_PER_YEAR - 20) | 0) : 0,
      god: f.god,
      culture: f.culture,
    },
    memories: king ? king.memories.map(m => m.text) : [],
    grudges,
    situation: {
      year: yearOf(s.tick),
      season: ['spring', 'summer', 'autumn', 'winter'][seasonOf(s.tick)],
      foodStores: `${foodMonths} months`,
      armyStrength: describeArmy(s, fid),
      population: factionPop(s, fid),
      settlements: s.settlements.filter(st => !st.razed && st.factionId === fid).length,
      enemyEstimates,
      activeTreaties: treaties,
      recentEvents: recentEvents(s, fid, 5 * TICKS_PER_YEAR, 6).map(e => e.text),
    },
    recentChoices: king ? king.recentChoices.slice(-3) : [],
    options,
  };
}

const DIPLO_TEXT = ['at war', 'hostile', 'neutral', 'trading', 'allied', 'vassal'];

function describeArmy(s: SimState, fid: number): string {
  const mine = armyStrength(s, fid);
  let maxOther = 1;
  for (const o of livingFactions(s)) {
    if (o.id !== fid) maxOther = Math.max(maxOther, armyStrength(s, o.id));
  }
  const r = mine * 100 / maxOther;
  return r > 130 ? 'strong' : r > 80 ? 'adequate' : r > 45 ? 'weak' : 'desperate';
}

function personaTraits(s: SimState, king: NamedCharacter | null): string[] {
  if (!king) return ['collective', 'cautious'];
  // the rolled character traits lead (M10, P2.2: verbatim in the prompt);
  // earned epithets follow
  const t: string[] = [...(king.traits ?? [])];
  const f = s.factions[king.factionId];
  if (king.kills > 3) t.push('battle-scarred');
  if (king.pawnIdx >= 0 && s.pawns.charisma[king.pawnIdx] > 160) t.push('charismatic');
  if (t.length === 0) {
    if (f.culture.aggression > 140) t.push('aggressive');
    else t.push('pragmatic');
  }
  return t.slice(0, 3);
}

// ---- Execution: apply a chosen option to the sim (brainInboxSystem) ----

export function applyDecision(s: SimState, entry: JournalEntry): void {
  const fid = entry.factionId;
  const f = s.factions[fid];
  if (!f || f.extinct) return;
  const m = entry.choice.match(/^([A-Z_]+)(?:\(([^)]*)\))?$/);
  if (!m) return;
  const op = m[1];
  const args = (m[2] ?? '').split(',').map(a => a.trim()).filter(Boolean);
  const targetId = args.length > 0 && /^\d+$/.test(args[0]) ? Number(args[0]) : -1;
  const target = targetId >= 0 ? s.factions[targetId] : null;
  const king = f.leaderId >= 0 ? s.named[f.leaderId] : null;
  const year = yearOf(s.tick);

  const addMemory = (text: string, landmark: boolean, weight: number) => {
    if (!king) return;
    pushMemory(king, { text: `Y${year}: ${text}`, landmark, weight, tick: s.tick });
  };

  switch (op) {
    case 'DECLARE_WAR': {
      if (!target || target.extinct) return;
      declareWar(s, fid, targetId, entry, 'raid');
      addMemory(`I declared war on ${target.name}`, true, 9);
      break;
    }
    case 'SUE_FOR_PEACE': {
      if (!target) return;
      offerTruce(s, fid, targetId);
      break;
    }
    case 'SET_WAR_OBJECTIVE': {
      const w = s.wars.find(w2 =>
        (w2.attacker === fid && w2.defender === targetId) ||
        (w2.defender === fid && w2.attacker === targetId));
      const obj = args[1] as 'raid' | 'conquer' | 'burn' | undefined;
      if (w && obj && (w.attacker === fid)) {
        w.objective = obj;
        emitEvent(s, {
          type: EventType.WarObjectiveSet, factions: [fid, targetId], severity: 2,
          text: `Y${year}: ${f.name} sets its war aim: ${obj === 'raid' ? 'plunder' : obj === 'conquer' ? 'conquest' : 'fire and ruin'}.`,
        });
      }
      break;
    }
    case 'ACCEPT_TRUCE': {
      const enemy = targetId >= 0 ? targetId : findWarEnemy(s, fid);
      if (enemy >= 0) makeTruce(s, fid, enemy, entry);
      break;
    }
    case 'REJECT_TRUCE': {
      const enemy = targetId >= 0 ? targetId : findWarEnemy(s, fid);
      if (enemy >= 0) {
        adjustLedger(s, fid, enemy, -1, 'truce rejected');
        emitEvent(s, {
          type: EventType.ProposalRefused, factions: [fid, enemy], severity: 2,
          text: `Y${year}: ${f.name} rejects the offer of truce. The war goes on.`,
        });
      }
      break;
    }
    case 'DEMAND_TRIBUTE': {
      if (!target || target.extinct) return;
      requestResponse(s, targetId, fid, 'tributeDemand');
      emitEvent(s, {
        type: EventType.TributeDemanded, factions: [fid, targetId], severity: 2,
        text: `Y${year}: ${f.name} demands tribute of ${target.name}.`,
      });
      break;
    }
    case 'PAY_TRIBUTE': {
      const demander = entry.requestId >= 0 ? findPendingCounterparty(s, entry) : -1;
      const to = demander >= 0 ? demander : targetId;
      if (to >= 0) payTribute(s, fid, to, 'tribute');
      break;
    }
    case 'REFUSE_TRIBUTE': {
      const demander = findPendingCounterparty(s, entry);
      if (demander >= 0) {
        adjustLedger(s, demander, fid, -3, 'tribute refused');
        emitEvent(s, {
          type: EventType.TributeRefused, factions: [fid, demander], severity: 3,
          text: `Y${year}: ${f.name} refuses to pay tribute to ${s.factions[demander].name}.`,
        });
        addMemory(`we refused tribute to ${s.factions[demander].name}`, false, 5);
      }
      break;
    }
    case 'PROPOSE_TRADE': {
      if (!target || target.extinct) return;
      requestResponse(s, targetId, fid, 'tradeProposal');
      break;
    }
    case 'PROPOSE_ALLIANCE': {
      if (!target || target.extinct) return;
      requestResponse(s, targetId, fid, 'allianceProposal');
      break;
    }
    case 'ALLY_AGAINST': {
      const heg = targetId;
      const co = args.length > 1 ? Number(args[1]) : -1;
      if (heg < 0 || co < 0 || !s.factions[heg] || !s.factions[co]) return;
      setDiplo(s, fid, co, DiploState.Alliance);
      emitEvent(s, {
        type: EventType.AllianceFormed, factions: [fid, co], severity: 3,
        text: `Y${year}: ${f.name} and ${s.factions[co].name} join against the might of ${s.factions[heg].name}.`,
      });
      if (!atWar(s, fid, heg)) declareWar(s, fid, heg, entry, 'raid');
      if (!atWar(s, co, heg)) declareWar(s, co, heg, entry, 'raid');
      addMemory(`we forged a coalition against ${s.factions[heg].name}`, true, 8);
      break;
    }
    case 'ACCEPT_PROPOSAL': {
      const from = findPendingCounterparty(s, entry);
      const kind = findPendingKind(s, entry);
      if (from < 0) return;
      if (kind === 'allianceProposal') {
        setDiplo(s, fid, from, DiploState.Alliance);
        emitEvent(s, {
          type: EventType.AllianceFormed, factions: [fid, from], severity: 3,
          text: `Y${year}: ${f.name} and ${s.factions[from].name} swear alliance.`,
        });
      } else if (kind === 'tradeProposal') {
        setDiplo(s, fid, from, DiploState.Trade);
        emitEvent(s, {
          type: EventType.TradeOpened, factions: [fid, from], severity: 2,
          text: `Y${year}: Trade opens between ${f.name} and ${s.factions[from].name}.`,
        });
      }
      adjustLedger(s, fid, from, 2, 'proposal accepted');
      break;
    }
    case 'REJECT_PROPOSAL': {
      const from = findPendingCounterparty(s, entry);
      if (from >= 0) {
        adjustLedger(s, from, fid, -2, 'proposal spurned');
        emitEvent(s, {
          type: EventType.ProposalRefused, factions: [fid, from], severity: 2,
          text: `Y${year}: ${f.name} spurns the offer from ${s.factions[from].name}.`,
        });
      }
      break;
    }
    case 'SEND_GIFT': {
      if (!target || target.extinct) return;
      payTribute(s, fid, targetId, 'gift');
      break;
    }
    case 'EMBARGO': {
      if (!target) return;
      const pk = pairKey(fid, targetId);
      s.pairs[pk].embargo = true;
      if (s.pairs[pk].diplo === DiploState.Trade) s.pairs[pk].diplo = DiploState.Neutral;
      adjustLedger(s, targetId, fid, -2, 'embargo imposed');
      emitEvent(s, {
        type: EventType.Embargo, factions: [fid, targetId], severity: 2,
        text: `Y${year}: ${f.name} closes its roads to ${target.name}.`,
      });
      break;
    }
    case 'RESERVE_STORES': {
      f.reserveStores = true;
      break;
    }
    case 'CONSCRIPT': {
      f.conscriptTarget = Math.min(60, f.conscriptTarget + 15);
      emitEvent(s, {
        type: EventType.Conscription, factions: [fid], severity: 2,
        text: `Y${year}: ${f.name} calls its folk to arms.`,
      });
      break;
    }
    case 'DISBAND_SOLDIERS': {
      f.conscriptTarget = 0;
      break;
    }
    case 'CONSOLIDATE': {
      f.reserveStores = false;
      break;
    }
    case 'EXPAND': {
      // charter a new village from the most prosperous settlement (11 §F)
      const from = s.settlements
        .filter(st => !st.razed && st.factionId === fid && canProsperExpand(st))
        .sort((a, b) => b.popCache - a.popCache)[0];
      const count = s.settlements.filter(st => !st.razed && st.factionId === fid).length;
      if (!from || count >= 4) return;
      const site = findExpansionSite(s, from);
      if (!site) return;
      foundSettlement(s, f, from, site[0], site[1]);
      addMemory(`we chartered a new village beyond ${from.name}`, true, 7);
      break;
    }
    // post-war terms
    case 'TAKE_TRIBUTE': case 'SHIFT_BORDER': case 'VASSALIZE': case 'RAZE': {
      applyPostWarTerms(s, fid, entry, op);
      break;
    }
    default:
      break;
  }
}

export function pushMemory(king: NamedCharacter, mem: Memory): void {
  king.memories.push(mem);
  if (king.memories.length > 20) {
    // evict lowest weight×recency non-landmark (05 eviction policy)
    let worst = -1, worstScore = Infinity;
    for (let i = 0; i < king.memories.length; i++) {
      const m = king.memories[i];
      if (m.landmark) continue;
      const score = m.weight * 1000 + m.tick;
      if (score < worstScore) { worstScore = score; worst = i; }
    }
    if (worst >= 0) king.memories.splice(worst, 1);
    else king.memories.splice(0, 1);
  }
}

// ---- shared diplomatic/war primitives (used by rules + systems) ----

export function setDiplo(s: SimState, a: number, b: number, d: DiploState): void {
  s.pairs[pairKey(a, b)].diplo = d;
}

export function adjustLedger(s: SimState, holder: number, about: number, delta: number, why: string): void {
  const pk = pairKey(holder, about);
  const pair = s.pairs[pk];
  pair.ledger.push({ tick: s.tick, delta, why });
  if (pair.ledger.length > 12) pair.ledger.shift();
  if (delta < 0) {
    pair.grudge = Math.min(15, pair.grudge - delta);       // grudges capped (04)
  } else {
    pair.grudge = Math.max(0, pair.grudge - delta);
  }
}

export function declareWar(
  s: SimState, attacker: number, defender: number,
  entry: JournalEntry | null, objective: 'raid' | 'conquer' | 'burn',
): void {
  // D4: mutual declaration in the same window → merge, both aggressors
  const existing = s.wars.find(w =>
    (w.attacker === defender && w.defender === attacker && s.tick - w.startTick < 10));
  if (existing) {
    existing.bothAggressors = true;
    return;
  }
  if (atWar(s, attacker, defender)) return;
  setDiplo(s, attacker, defender, DiploState.War);
  const pk = pairKey(attacker, defender);
  const causes: number[] = [];
  // causality: the grudge ledger entries + recent crises are the causes (04 DAG)
  for (let i = s.events.length - 1; i >= 0 && causes.length < 3; i--) {
    const ev = s.events[i];
    if (ev.factions.includes(attacker) && ev.factions.includes(defender) && ev.severity >= 2) {
      causes.push(ev.id);
    }
  }
  const att = s.factions[attacker], def = s.factions[defender];
  const grudge = s.pairs[pk].grudge;
  const why = s.pairs[pk].ledger.filter(l => l.delta < 0).slice(-1)[0]?.why ?? 'old grudges';
  const warName = nameWar(why, def.name);
  const ev = emitEvent(s, {
    type: EventType.WarDeclared,
    actors: att.leaderId >= 0 ? [att.leaderId] : [],
    factions: [attacker, defender],
    x: s.settlements[att.capital]?.x ?? 0, y: s.settlements[att.capital]?.y ?? 0,
    causes, severity: 4,
    text: `Y${yearOf(s.tick)}: ${att.name} declares war on ${def.name}: ${why}. Men will call it ${warName}.`,
    data: { grudge, warName },
  });
  s.wars.push({
    id: s.nextEntityId++,
    attacker, defender, objective,
    name: warName,
    startTick: s.tick,
    exhaustionA: 0, exhaustionB: 0,
    causeEventIds: [ev.id, ...causes],
    targetSettlement: pickWarTarget(s, attacker, defender),
  });
}

/** Diegetic war name from the casus belli (M10, P6.2 template tier).
 *  WorldBox uses grammar tables; ours names wars from actual facts. */
export function nameWar(why: string, defenderName: string): string {
  const short = defenderName.replace(/ (Kingdom|Court|Hold|Horde)$/, '');
  if (why.includes('tribute')) return 'the Tribute War';
  if (why.includes('hunting grounds')) return 'the War of the Hunting Grounds';
  if (why.includes('livestock')) return 'the War of Stolen Herds';
  if (why.includes('poisoned well')) return 'the Poisoned-Well War';
  if (why.includes('timber')) return 'the Timber War';
  if (why.includes('insult')) return 'the War of the Insult';
  if (why.includes('bride')) return 'the Broken-Promise War';
  if (why.includes('razed')) return `the Vengeance War for ${short}`;
  if (why.includes('plundered')) return 'the Plunder War';
  if (why.includes('rebellion')) return `the War of Free ${short}`;
  if (why.includes('embargo')) return 'the Closed-Roads War';
  return `the ${short} War`;
}

export function pickWarTarget(s: SimState, attacker: number, defender: number): number {
  // nearest enemy settlement to attacker capital
  const cap = s.settlements[s.factions[attacker].capital];
  let best = -1, bestD = Infinity;
  for (const st of s.settlements) {
    if (st.razed || st.factionId !== defender) continue;
    const dx = st.x - (cap?.x ?? 0), dy = st.y - (cap?.y ?? 0);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = st.id; }
  }
  return best;
}

export function offerTruce(s: SimState, from: number, to: number): void {
  requestResponse(s, to, from, 'truceOffer');
}

export function makeTruce(s: SimState, a: number, b: number, entry: JournalEntry | null): void {
  const w = s.wars.find(w2 =>
    (w2.attacker === a && w2.defender === b) || (w2.attacker === b && w2.defender === a));
  if (w) endWar(s, w, 'truce', -1);
}

export function endWar(s: SimState, w: import('../state').War, how: 'truce' | 'victory' | 'extinct', victor: number): void {
  s.wars = s.wars.filter(w2 => w2.id !== w.id);
  const pk = pairKey(w.attacker, w.defender);
  s.pairs[pk].diplo = DiploState.Hostile;
  s.pairs[pk].truceUntil = s.tick + 10 * TICKS_PER_YEAR;
  // disband war squads
  for (const sq of s.squads) {
    if (sq.warId === w.id) sq.state = 'disband';
  }
  if (how === 'truce') {
    emitEvent(s, {
      type: EventType.Truce, factions: [w.attacker, w.defender],
      causes: w.causeEventIds.slice(0, 1), severity: 3,
      text: `Y${yearOf(s.tick)}: Exhausted, ${s.factions[w.attacker].name} and ${s.factions[w.defender].name} lay down arms.`,
    });
  }
}

/** Emit a response-type decision request for a faction's king. */
export function requestResponse(s: SimState, responder: number, from: number, kind: string): void {
  const f = s.factions[responder];
  if (!f || f.extinct) return;
  queueDecision(s, responder, kind, 2, responseOptions(kind, from), from);
}

/** One pending per actor (L1): crisis supersedes council; superseded → void. */
export function queueDecision(
  s: SimState, fid: number, kind: string, priority: number,
  options: string[], counterparty = -1,
): void {
  const f = s.factions[fid];
  if (!f || f.extinct || options.length === 0) return;
  const actorId = f.leaderId;
  if (actorId < 0) return;
  const existing = s.pending.find(p => p.actorId === actorId);
  if (existing) {
    if (priority <= existing.priority) return;             // keep higher-priority
    s.pending = s.pending.filter(p => p.actorId !== actorId); // supersede (L1)
  }
  const digestOptions = shuffleOptions(s, options);
  const req = {
    requestId: s.nextRequestId++,
    actorId, factionId: fid,
    tick: s.tick,
    applyAtTick: s.tick + s.config.decisionWindowTicks,
    kind, priority,
    options: digestOptions,
  };
  s.pending.push({ ...req });
  s.outbox.push({
    ...req,
    digest: buildDigest(s, fid, digestOptions),
  });
  // counterparty stashed in pending kind string for response resolution
  if (counterparty >= 0) {
    s.pending[s.pending.length - 1].kind = `${kind}:${counterparty}`;
  }
}

/** Option order shuffled per request (anti-first-option-bias, 05); seeded. */
function shuffleOptions(s: SimState, options: string[]): string[] {
  return s.rng.get('optionShuffle').shuffle([...options]);
}

function findWarEnemy(s: SimState, fid: number): number {
  const w = s.wars.find(w2 => w2.attacker === fid || w2.defender === fid);
  if (!w) return -1;
  return w.attacker === fid ? w.defender : w.attacker;
}

function findPendingCounterparty(s: SimState, entry: JournalEntry): number {
  const p = s.pending.find(p2 => p2.requestId === entry.requestId);
  if (!p) return -1;
  const parts = p.kind.split(':');
  return parts.length > 1 ? Number(parts[1]) : -1;
}

function findPendingKind(s: SimState, entry: JournalEntry): string {
  const p = s.pending.find(p2 => p2.requestId === entry.requestId);
  return p ? p.kind.split(':')[0] : '';
}

/** Tribute/gift rides a physical caravan (05 execution notes); no teleporting. */
export function payTribute(s: SimState, from: number, to: number, purpose: 'tribute' | 'gift'): void {
  const src = s.settlements.find(st => !st.razed && st.factionId === from && st.id === s.factions[from].capital)
    ?? s.settlements.find(st => !st.razed && st.factionId === from);
  const dst = s.settlements.find(st => !st.razed && st.factionId === to && st.id === s.factions[to].capital)
    ?? s.settlements.find(st => !st.razed && st.factionId === to);
  if (!src || !dst) {
    // D6: cannot pay ≠ will not pay; automatic distinct ledger event
    adjustLedger(s, to, from, -1, 'tribute failed (could not pay)');
    emitEvent(s, {
      type: EventType.TributeFailed, factions: [from, to], severity: 2,
      text: `Y${yearOf(s.tick)}: ${s.factions[from].name} could not deliver what was owed.`,
    });
    return;
  }
  const goods = new Array(7).fill(0);
  const amount = Math.min(purpose === 'gift' ? 120 : 300, (src.stockpile[Good.Grain] / 3) | 0);
  if (amount < 20) {
    adjustLedger(s, to, from, -1, 'tribute failed (could not pay)');
    emitEvent(s, {
      type: EventType.TributeFailed, factions: [from, to], severity: 2,
      text: `Y${yearOf(s.tick)}: The granaries of ${s.factions[from].name} could not cover what was owed.`,
    });
    return;
  }
  src.stockpile[Good.Grain] -= amount;
  goods[Good.Grain] = amount;
  s.caravans.push({
    id: s.nextEntityId++,
    from: src.id, to: dst.id, factionId: from,
    x: src.x, y: src.y, goods, purpose,
    escorts: [], state: 'travel', raided: false, pathIdx: 0,
  });
}

function applyPostWarTerms(s: SimState, victor: number, entry: JournalEntry, op: string): void {
  // resolves against the pending postWar request's counterparty
  const loser = findPendingCounterparty(s, entry);
  if (loser < 0 || !s.factions[loser] || s.factions[loser].extinct) return;
  const year = yearOf(s.tick);
  const vf = s.factions[victor], lf = s.factions[loser];
  switch (op) {
    case 'TAKE_TRIBUTE': {
      payTribute(s, loser, victor, 'tribute');
      emitEvent(s, {
        type: EventType.TributePaid, factions: [loser, victor], severity: 3,
        text: `Y${year}: Defeated, ${lf.name} sends wagons of grain to ${vf.name}.`,
      });
      break;
    }
    case 'SHIFT_BORDER': {
      const st = s.settlements.find(x => !x.razed && x.factionId === loser);
      if (st) {
        st.factionId = victor;
        st.capturedTick = s.tick;                            // conquered folk remember (P1.2)
        emitEvent(s, {
          type: EventType.BorderShifted, factions: [victor, loser],
          x: st.x, y: st.y, severity: 3,
          text: `Y${year}: ${st.name} passes to ${vf.name} by right of conquest.`,
        });
      }
      break;
    }
    case 'VASSALIZE': {
      lf.vassalOf = victor;
      setDiplo(s, victor, loser, DiploState.Vassal);
      emitEvent(s, {
        type: EventType.Vassalized, factions: [victor, loser], severity: 4,
        text: `Y${year}: ${lf.name} bends the knee to ${vf.name}.`,
      });
      adjustLedger(s, loser, victor, -4, 'forced into vassalage');
      break;
    }
    case 'RAZE': {
      const st = s.settlements.find(x => !x.razed && x.factionId === loser && x.id !== lf.capital)
        ?? s.settlements.find(x => !x.razed && x.factionId === loser);
      if (st) razeSettlement(s, st.id, victor);
      break;
    }
  }
}

export function razeSettlement(s: SimState, settlementId: number, byFaction: number): void {
  const st = s.settlements[settlementId];
  if (!st || st.razed) return;
  st.razed = true;
  const year = yearOf(s.tick);
  const ev = emitEvent(s, {
    type: EventType.SettlementRazed,
    factions: [byFaction, st.factionId],
    x: st.x, y: st.y, severity: 5,
    text: `Y${year}: ${st.name} burns. ${s.factions[byFaction].name} leaves only ash.`,
  });
  adjustLedger(s, st.factionId, byFaction, -6, `${st.name} razed`);
  // refugees (04): survivors flee to nearest same-faction/race settlement
  const N = s.map.size;
  let dest = -1, bestD = Infinity;
  for (const other of s.settlements) {
    if (other.razed || other.id === settlementId) continue;
    if (other.factionId !== st.factionId &&
        s.factions[other.factionId].race !== s.factions[st.factionId].race) continue;
    const dx = other.x - st.x, dy = other.y - st.y;
    if (dx * dx + dy * dy < bestD) { bestD = dx * dx + dy * dy; dest = other.id; }
  }
  let refugees = 0;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
    if (s.pawns.settlementId[i] !== settlementId) continue;
    if (dest >= 0) {
      const d = s.settlements[dest];
      s.pawns.settlementId[i] = dest;
      s.pawns.factionId[i] = d.factionId;
      s.pawns.actionTarget[i] = d.y * N + d.x;
      s.pawns.action[i] = 16; // Flee; walk to new home
      s.pawns.flags[i] |= PawnFlag.Refugee;
      refugees++;
    } else {
      s.pawns.settlementId[i] = 65535;
    }
  }
  if (refugees > 0 && dest >= 0) {
    emitEvent(s, {
      type: EventType.Refugees, factions: [st.factionId],
      x: st.x, y: st.y, causes: [ev.id], severity: 3,
      text: `Y${year}: ${refugees} survivors of ${st.name} flee to ${s.settlements[dest].name}.`,
    });
  }
}
