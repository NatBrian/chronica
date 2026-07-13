// RuleBrain (05): grudge-weighted scoring over the same options the LLM sees.
// Journaled identically; replay cannot tell the difference. Lives in /sim so
// the engine can synthesize deadline fallbacks deterministically.
import { DecisionResult } from '../../shared/types';
import { SimState, pairKey } from '../state';
import { PendingDecision } from '../state';
import { armyStrength, factionFood, factionPop, dominanceShare } from './decisions';
import { RACE_TABLE } from '../raceData';
import { Rng, fnv1a } from '../rng/rng';

export function ruleBrainDecide(s: SimState, req: PendingDecision): DecisionResult {
  // Pure function of (seed, requestId): replay may skip this call entirely
  // (journal already has the entry); a shared stream would desync. (01)
  const rng = new Rng((fnv1a(`kingFallback:${req.requestId}`) ^ s.seed) >>> 0);
  const fid = req.factionId;
  const f = s.factions[fid];
  const kingName = f.leaderId >= 0 ? s.named[f.leaderId].name : 'The Council';
  const myArmy = armyStrength(s, fid);
  const myFood = factionFood(s, fid);
  const pop = Math.max(1, factionPop(s, fid));
  const hungry = myFood / pop < 8;
  const rs = RACE_TABLE[f.race];

  let best = req.options[0];
  let bestScore = -Infinity;
  for (const opt of req.options) {
    const m = opt.match(/^([A-Z_]+)(?:\(([^)]*)\))?$/);
    if (!m) continue;
    const op = m[1];
    const args = (m[2] ?? '').split(',').map(a => a.trim());
    const tid = /^\d+$/.test(args[0] ?? '') ? Number(args[0]) : -1;
    const pair = tid >= 0 ? s.pairs[pairKey(fid, tid)] : null;
    const theirArmy = tid >= 0 ? armyStrength(s, tid) : 0;
    let score = 0;
    switch (op) {
      case 'DECLARE_WAR': {
        const advantage = myArmy - theirArmy;
        // desperation raids: a starving people raids regardless of odds;
        // but a DYING people (too few spears) hunkers down instead
        const desperate = hungry && pop >= 90;
        score = (pair?.grudge ?? 0) * 14 + (advantage > 0 ? 22 : desperate ? -5 : -35)
          + (desperate ? 40 + rs.raidAffinity / 3 : 0)
          + (f.culture.aggression - 110) / 3
          - (pop < 90 ? 25 : 0);
        break;
      }
      case 'SUE_FOR_PEACE': {
        const w = s.wars.find(w2 => w2.attacker === fid || w2.defender === fid);
        const myEx = w ? (w.attacker === fid ? w.exhaustionA : w.exhaustionB) : 0;
        const warAge = w ? s.tick - w.startTick : 0;
        // a war just declared is not abandoned before the army even marches
        score = myEx / 4 + (myArmy < theirArmy ? 40 : -10) + (hungry ? 25 : 0)
          - Math.max(0, 45 - (warAge / 20 | 0));
        break;
      }
      case 'SET_WAR_OBJECTIVE': {
        const obj = args[1];
        score = obj === 'raid' ? 20 + (hungry ? 30 : 0) + rs.raidAffinity / 5
          : obj === 'conquer' ? (myArmy > theirArmy * 1.4 ? 35 : 5)
          : (pair?.grudge ?? 0) >= 10 ? 28 : 2;   // burn only for deep hatred
        break;
      }
      case 'ACCEPT_TRUCE': score = 30 + (myArmy < theirArmy ? 25 : 0) + (hungry ? 20 : 0); break;
      case 'REJECT_TRUCE': score = (pair?.grudge ?? 0) * 6 + (myArmy > theirArmy ? 15 : -20); break;
      case 'DEMAND_TRIBUTE': score = (myArmy > theirArmy * 1.5 ? 26 : -12) + (pair?.grudge ?? 0) * 3; break;
      case 'PAY_TRIBUTE': score = myArmy < theirArmy ? 30 : -8; break;
      case 'REFUSE_TRIBUTE': score = (myArmy >= theirArmy ? 32 : 6) + (f.culture.aggression - 100) / 4; break;
      case 'PROPOSE_TRADE': score = 18 + (hungry ? 18 : 0) - (pair?.grudge ?? 0) * 4; break;
      case 'PROPOSE_ALLIANCE': {
        // alliances are earned, not handed out: need warm history AND a reason
        const warmth = pair ? pair.ledger.reduce((a, l) => a + l.delta, 0) : 0;
        const threatened = s.wars.some(w2 => w2.attacker === fid || w2.defender === fid);
        score = -22 + warmth * 3 - (pair?.grudge ?? 0) * 5 + (threatened ? 26 : 0);
        break;
      }
      case 'ALLY_AGAINST': score = 24 + (dominanceShare(s, tid) - 40); break;
      case 'ACCEPT_PROPOSAL': {
        const kind = req.kind.split(':')[0];
        const cp = Number(req.kind.split(':')[1] ?? -1);
        const cpPair = cp >= 0 ? s.pairs[pairKey(fid, cp)] : null;
        const warmth = cpPair ? cpPair.ledger.reduce((a, l) => a + l.delta, 0) : 0;
        if (kind === 'allianceProposal') {
          score = warmth * 3 - (cpPair?.grudge ?? 0) * 5 - 16;  // cold ties → likely reject
        } else {
          score = 22 + (hungry ? 10 : 0) - (cpPair?.grudge ?? 0) * 4;
        }
        break;
      }
      case 'REJECT_PROPOSAL': score = (pair?.grudge ?? 0) * 5 + 2; break;
      case 'SEND_GIFT': score = 4 - (pair?.grudge ?? 0) + (myFood / pop > 30 ? 6 : -10); break;
      case 'EMBARGO': score = (pair?.grudge ?? 0) * 4 - 10; break;
      case 'RESERVE_STORES': score = hungry ? 24 : -6; break;
      case 'CONSCRIPT': {
        const threatened = s.wars.some(w => w.attacker === fid || w.defender === fid);
        score = threatened ? 30 : (f.culture.aggression > 150 ? 10 : -8);
        break;
      }
      case 'DISBAND_SOLDIERS': score = s.wars.length === 0 && f.conscriptTarget > 0 ? 14 : -20; break;
      case 'CONSOLIDATE': score = 10; break;
      case 'EXPAND': {
        // prosperity founding: instinct kings do it when rich and at peace
        const threatened = s.wars.some(w => w.attacker === fid || w.defender === fid);
        score = 34 + (hungry ? -40 : 8) + (f.culture.wanderlust - 100) / 4 - (threatened ? 22 : 0);
        break;
      }
      case 'TAKE_TRIBUTE': score = 25 + (hungry ? 20 : 0); break;
      case 'SHIFT_BORDER': score = 22 + (f.culture.aggression - 110) / 4; break;
      case 'VASSALIZE': score = 18 + (myArmy > theirArmy * 2 ? 14 : -6); break;
      case 'RAZE': score = (pair?.grudge ?? 0) >= 10 ? 26 : -15; break;
      default: score = 0;
    }
    score += rng.int(8);                                   // seeded tie jitter
    if (score > bestScore) { bestScore = score; best = opt; }
  }

  return {
    choice: best,
    reasoning: templateReasoning(kingName, best, f.name),
  };
}

function templateReasoning(king: string, choice: string, factionName: string): string {
  const op = choice.split('(')[0];
  const lines: Record<string, string> = {
    DECLARE_WAR: `${king}'s patience is spent. The council of ${factionName} votes for war.`,
    SUE_FOR_PEACE: `${king} counts the dead and finds the price too high. Peace must be sought.`,
    SET_WAR_OBJECTIVE: `${king} sets the war's course with cold arithmetic.`,
    ACCEPT_TRUCE: `${king} accepts the truce. Wounds need binding.`,
    REJECT_TRUCE: `${king} will not sheathe a half-drawn blade.`,
    DEMAND_TRIBUTE: `${king} sees weakness and names its price.`,
    PAY_TRIBUTE: `${king} pays; grain is cheaper than graves.`,
    REFUSE_TRIBUTE: `${king} will not kneel for threats.`,
    PROPOSE_TRADE: `${king} reckons more is won by wagon than by sword.`,
    PROPOSE_ALLIANCE: `${king} seeks friends against uncertain years.`,
    ALLY_AGAINST: `${king} fears the growing shadow and seeks common cause.`,
    ACCEPT_PROPOSAL: `${king} weighs the offer and finds it fair.`,
    REJECT_PROPOSAL: `${king} finds the offer wanting.`,
    SEND_GIFT: `${king} sends gifts; goodwill is stored like grain.`,
    EMBARGO: `${king} closes the roads. Let them feel the silence.`,
    RESERVE_STORES: `${king} orders the granaries sealed against the lean months.`,
    CONSCRIPT: `${king} calls the young to the mustering field.`,
    DISBAND_SOLDIERS: `${king} sends the soldiers home to their fields.`,
    CONSOLIDATE: `${king} tends the hearth and bides.`,
    EXPAND: `${king} looks past full granaries to empty horizons. New roofs will rise.`,
    TAKE_TRIBUTE: `${king} takes the victor's due.`,
    SHIFT_BORDER: `${king} redraws the border in the victor's ink.`,
    VASSALIZE: `${king} spares the defeated; as servants.`,
    RAZE: `${king} orders the torches lit. Let it be remembered.`,
  };
  return lines[op] ?? `${king} decides: ${choice}.`;
}
