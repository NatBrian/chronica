// System 11: faction layer: succession, diplomacy upkeep, grudge decay,
// council/crisis decision requests, war campaigns (muster), expansion,
// vassal tribute, rebellion. All decisions flow through the rule engine.
import { DiploState, EventType, Good, TICKS_PER_YEAR } from '../../shared/types';
import {
  SimState, PawnFlag, pairKey, effFood, MAX_FACTIONS, Faction, Settlement,
} from '../state';
import {
  councilOptions, postWarOptions, queueDecision, factionPop, armyStrength,
  endWar, adjustLedger, setDiplo, payTribute,
} from '../rules/decisions';
import { emitEvent, yearOf } from '../events/events';
import { promoteNamed } from '../namedOps';
import { RACE_TABLE } from '../raceData';
import { findExpansionSite, foundSettlement } from '../settlementOps';
import { computeLoyalty } from '../rules/loyalty';
import { driftCulture } from '../rules/identity';
import { eraMods } from '../rules/eras';

export function factionSystem(s: SimState): void {
  if (s.wars.length > 0) s.warTicksThisYear++;

  // yearly-ish maintenance, staggered per faction
  for (const f of s.factions) {
    if (f.extinct) continue;
    const phase = (s.tick + f.id * 90) % TICKS_PER_YEAR;

    if (phase === 10) {
      maintainDiplomacy(s, f);
      checkExtinction(s, f);
      // a crown wears in: legitimacy drifts toward 100 (M9, P1.4)
      if (f.legitimacy !== undefined && f.legitimacy < 100) f.legitimacy++;
    }
    if (phase === 20) {
      checkSuccession(s, f);
    }
    if (phase === 45 && f.leaderId >= 0) {
      // annual council (05): the rule engine offers options, a brain chooses
      queueDecision(s, f.id, 'council', 1, councilOptions(s, f.id));
    }
    if (phase === 60) {
      considerExpansion(s, f);
    }
    if (phase === 75 && f.vassalOf >= 0 && !s.factions[f.vassalOf]?.extinct) {
      payTribute(s, f.id, f.vassalOf, 'tribute');          // vassal dues (04)
    }
    if (phase === 90) {
      // yearly loyalty refresh (P1.2), then the trigger reads it
      for (const st of s.settlements) {
        if (!st.razed && st.factionId === f.id) st.loyalty = computeLoyalty(s, st);
      }
      checkRebellion(s, f);
    }

    // crisis trigger: famine (checked seasonally, at most one crisis pending)
    if (phase === 130 || phase === 220) {
      let worst = 999999;
      for (const st of s.settlements) {
        if (!st.razed && st.factionId === f.id) worst = Math.min(worst, effFood(st));
      }
      if (worst < 4000 && f.leaderId >= 0) {
        queueDecision(s, f.id, 'famine', 2, councilOptions(s, f.id));
      }
    }
  }

  // war campaign management: attackers muster + march (every 15 ticks)
  if (s.tick % 15 === 5) {
    for (const w of s.wars) {
      manageCampaign(s, w.attacker, w);
      // passive exhaustion; wars end, they don't grind forever (04)
      w.exhaustionA += 1;
      w.exhaustionB += 1;
      if (w.exhaustionA > 400 || w.exhaustionB > 400) {
        endWar(s, w, 'truce', -1);
      }
    }
  }
}

function maintainDiplomacy(s: SimState, f: Faction): void {
  for (const o of s.factions) {
    if (o.id <= f.id || o.extinct) continue;
    const pk = pairKey(f.id, o.id);
    const pair = s.pairs[pk];
    // grudge decay ~2 generations unless refreshed (04): fade when quiet 5y
    const lastOffense = pair.ledger.filter(l => l.delta < 0).slice(-1)[0];
    if (pair.grudge > 0 && (!lastOffense || s.tick - lastOffense.tick > 5 * TICKS_PER_YEAR)) {
      const forgive = Math.min(RACE_TABLE[f.race].forgiveRate, RACE_TABLE[o.race].forgiveRate);
      if (forgive >= 100 || (s.tick / TICKS_PER_YEAR) % 2 === 0) {
        pair.grudge = Math.max(0, pair.grudge - 1);
      }
      // gentle ages mend fences a little faster (M12, P4.2)
      const mend = eraMods(s.seed, yearOf(s.tick), s.config.eraWheel ?? true).grudgeMend;
      if (mend > 0) pair.grudge = Math.max(0, pair.grudge - mend);
    }
    // truce expiry: hostile cools to neutral
    if (pair.diplo === DiploState.Hostile && s.tick > pair.truceUntil + 5 * TICKS_PER_YEAR) {
      pair.diplo = DiploState.Neutral;
    }
    // embargo lifts on friendly transition
    if (pair.embargo && pair.diplo >= DiploState.Trade) pair.embargo = false;

    // alliances strain and break under accumulated grudges (04: rise AND fall)
    if (pair.diplo === DiploState.Alliance && pair.grudge >= 5) {
      pair.diplo = DiploState.Neutral;
      emitEvent(s, {
        type: EventType.ProposalRefused, factions: [f.id, o.id], severity: 3,
        text: `Y${yearOf(s.tick)}: The old alliance between ${f.name} and ${o.name} collapses under its quarrels.`,
      });
    }
    // alliances without shared purpose quietly lapse (~12y, no common war)
    if (pair.diplo === DiploState.Alliance) {
      if (pair.allianceSince === undefined) pair.allianceSince = s.tick;
      const sharedWar = s.wars.some(w =>
        (w.attacker === f.id || w.defender === f.id) || (w.attacker === o.id || w.defender === o.id));
      if (sharedWar) pair.allianceSince = s.tick;           // renewed by need
      if (s.tick - pair.allianceSince > 12 * TICKS_PER_YEAR) {
        pair.diplo = DiploState.Trade;
        pair.allianceSince = undefined;
        emitEvent(s, {
          type: EventType.TradeOpened, factions: [f.id, o.id], severity: 2,
          text: `Y${yearOf(s.tick)}: The alliance of ${f.name} and ${o.name}, no longer needed, quietly lapses into plain trade.`,
        });
      }
    } else if (pair.allianceSince !== undefined) {
      pair.allianceSince = undefined;
    }

    // border friction (02 §shared frontier): close settlements breed disputes
    // (allies quarrel too, just less; alliances are not eternal peace)
    if (pair.diplo >= DiploState.Neutral) {
      const frictionOdds = pair.diplo === DiploState.Alliance ? 8 : 3;
      let closest = Infinity;
      let fx = 0, fy = 0;
      for (const sa of s.settlements) {
        if (sa.razed || sa.factionId !== f.id) continue;
        for (const sb of s.settlements) {
          if (sb.razed || sb.factionId !== o.id) continue;
          const dx = sa.x - sb.x, dy = sa.y - sb.y;
          const d = dx * dx + dy * dy;
          if (d < closest) { closest = d; fx = (sa.x + sb.x) >> 1; fy = (sa.y + sb.y) >> 1; }
        }
      }
      if (closest < 28 * 28 && s.rng.get('friction').chance(1, frictionOdds)) {
        const disputes = [
          'a quarrel over hunting grounds', 'stolen livestock', 'a poisoned well blamed on outsiders',
          'timber felled on claimed land', 'an insult at a border market', 'a bride promised and refused',
        ];
        const why = s.rng.get('friction').pick(disputes);
        adjustLedger(s, f.id, o.id, -1, why);
        emitEvent(s, {
          type: EventType.GrudgeFormed, factions: [f.id, o.id],
          x: fx, y: fy, severity: 2,
          text: `Y${yearOf(s.tick)}: Bad blood between ${f.name} and ${o.name}; ${why}.`,
        });
      }
    }
  }
}

function checkSuccession(s: SimState, f: Faction): void {
  const king = f.leaderId >= 0 ? s.named[f.leaderId] : null;
  if (king && king.deathTick < 0) return;                  // throne occupied

  // D1: heir first, else trait-ranked elder pool, else dissolve
  let heirNamed = s.named.find(n =>
    n.deathTick < 0 && n.factionId === f.id && n.role === 'heir' && n.parentNamedId === f.leaderId);
  if (!heirNamed) {
    heirNamed = s.named.find(n => n.deathTick < 0 && n.factionId === f.id && n.role === 'heir');
  }

  // heirless succession fractures a wide realm (M9, P1.3): before any elder
  // is elected, the most disloyal far province seizes the moment
  if (!heirNamed && s.factions.filter(x => !x.extinct).length < MAX_FACTIONS) {
    const mine = s.settlements.filter(st => !st.razed && st.factionId === f.id);
    if (mine.length >= 3) {
      const provinces = mine
        .filter(st => st.id !== f.capital && st.popCache > 40)
        .sort((a, b) => a.loyalty - b.loyalty);
      if (provinces.length > 0) {
        emitEvent(s, {
          type: EventType.Succession, factions: [f.id], severity: 4,
          x: s.settlements[f.capital]?.x ?? 0, y: s.settlements[f.capital]?.y ?? 0,
          text: `Y${yearOf(s.tick)}: ${king ? `${king.name} is dead and` : 'The throne stands empty and'} no heir holds ${f.name}. The realm trembles.`,
        });
        splitFaction(s, f, provinces[0]);
      }
    }
  }

  let newKingPawn = heirNamed?.pawnIdx ?? -1;
  if (newKingPawn < 0) {
    // elder pool, ranked by the culture's succession rule (M10, P2.1)
    const rule = f.culture.succession ?? 'election';
    let best = -1, bestScore = -1;
    for (let i = 0; i < s.pawnCount; i++) {
      if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
      if (s.pawns.factionId[i] !== f.id) continue;
      if (s.pawns.flags[i] & PawnFlag.Child) continue;
      const renown = s.pawns.namedId[i] >= 0 ? s.named[s.pawns.namedId[i]].kills * 40 : 0;
      const score =
        rule === 'eldest' ? s.pawns.age[i] * 4 + s.pawns.charisma[i] / 4 :
        rule === 'renowned' ? renown + s.pawns.strength[i] + s.pawns.charisma[i] :
        s.pawns.charisma[i] * 2 + s.pawns.age[i] / 90;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    newKingPawn = best;
  }
  if (newKingPawn < 0) {
    // no successor; the faction dissolves (D1)
    f.extinct = true;
    emitEvent(s, {
      type: EventType.FactionDissolved, factions: [f.id], severity: 4,
      text: `Y${yearOf(s.tick)}: With no one left to lead, ${f.name} passes into memory.`,
    });
    return;
  }
  const causes = king && king.deathCauseEventId >= 0 ? [king.deathCauseEventId] : [];
  let nc = s.pawns.namedId[newKingPawn] >= 0 ? s.named[s.pawns.namedId[newKingPawn]] : null;
  if (!nc) {
    nc = promoteNamed(s, newKingPawn, 'king', `Crowned after the death of ${king?.name ?? 'the old ruler'}.`, causes);
    if (!nc) return;
  }
  nc.role = 'king';
  if (king) nc.parentNamedId = nc.parentNamedId >= 0 ? nc.parentNamedId : king.id;
  f.leaderId = nc.id;
  // dynasty + legitimacy bookkeeping (M9, P1.4)
  const blood = heirNamed !== undefined && nc.id === heirNamed.id;
  f.legitimacy = blood ? 90 : 50;
  const newClan = nc.name.split(' ').slice(-1)[0];
  if (f.dynasty && newClan !== f.dynasty.clan && !blood) {
    const reigned = yearOf(s.tick - f.dynasty.foundedTick);
    emitEvent(s, {
      type: EventType.Succession, actors: [nc.id], factions: [f.id],
      causes, severity: 4,
      x: s.settlements[f.capital]?.x ?? 0, y: s.settlements[f.capital]?.y ?? 0,
      text: `Y${yearOf(s.tick)}: The crown of ${f.name} passes from House ${f.dynasty.clan} to House ${newClan}${reigned >= 20 ? ` after ${reigned} years of ${f.dynasty.clan} rule` : ''}.`,
    });
    f.dynasty = { clan: newClan, foundedTick: s.tick };
  } else if (!f.dynasty) {
    f.dynasty = { clan: newClan, foundedTick: s.tick };
  }
  nc.renown = (nc.renown ?? 0) + 10;   // a crown is renown (M11, P3.3)
  // grudges of the dead pass to heirs via the faction ledger; landmark memory:
  nc.memories.push({
    text: `Y${yearOf(s.tick)}: I took the crown of ${f.name}${king ? ` after ${king.name}` : ''}`,
    landmark: true, weight: 10, tick: s.tick,
  });
  emitEvent(s, {
    type: EventType.Coronation,
    actors: [nc.id], factions: [f.id],
    causes, severity: 3,
    x: s.settlements[f.capital]?.x ?? 0, y: s.settlements[f.capital]?.y ?? 0,
    text: `Y${yearOf(s.tick)}: ${nc.name} is crowned ruler of ${f.name}.`,
  });
}

function checkExtinction(s: SimState, f: Faction): void {
  const pop = factionPop(s, f.id);
  if (pop > 0) return;
  f.extinct = true;
  for (const w of [...s.wars]) {
    if (w.attacker === f.id || w.defender === f.id) endWar(s, w, 'extinct', -1);
  }
  const raceLeft = s.factions.some(o => !o.extinct && o.id !== f.id && o.race === f.race);
  emitEvent(s, {
    type: raceLeft ? EventType.FactionDissolved : EventType.RaceExtinct,
    factions: [f.id], severity: 5,
    text: raceLeft
      ? `Y${yearOf(s.tick)}: The last hearths of ${f.name} grow cold.`
      : `Y${yearOf(s.tick)}: The last of the ${['humans', 'elves', 'dwarves', 'orcs'][f.race]} is gone. An entire people has passed from the world.`,
  });
}

function manageCampaign(s: SimState, attackerId: number, w: import('../state').War): void {
  const f = s.factions[attackerId];
  if (!f || f.extinct) return;
  if (s.tick < (w.musterCooldownUntil ?? 0)) return;       // campaigns take seasons
  const existing = s.squads.find(sq => sq.warId === w.id && sq.factionId === attackerId &&
    sq.state !== 'disband' && sq.state !== 'rout');
  if (existing) return;
  // re-validate target
  let target = s.settlements[w.targetSettlement];
  if (!target || target.razed || target.factionId !== w.defender) {
    const alt = s.settlements.find(st => !st.razed && st.factionId === w.defender);
    if (!alt) return;                                       // defender has nothing left
    w.targetSettlement = alt.id;
    target = alt;
  }
  // muster from capital (conscription shifts the job mix; 04)
  const home = s.settlements[f.capital] && !s.settlements[f.capital].razed
    ? s.settlements[f.capital]
    : s.settlements.find(st => !st.razed && st.factionId === attackerId);
  if (!home) return;
  const members: number[] = [];
  const want = Math.max(10, f.conscriptTarget || 18);
  for (let i = 0; i < s.pawnCount && members.length < want; i++) {
    const fl = s.pawns.flags[i];
    if (!(fl & PawnFlag.Alive) || (fl & PawnFlag.Child)) continue;
    if (s.pawns.factionId[i] !== attackerId) continue;
    if (s.pawns.squadId[i] !== 65535) continue;
    if (s.pawns.settlementId[i] !== home.id) continue;
    if (s.pawns.hp[i] < 60) continue;
    members.push(i);
  }
  if (members.length < 8) return;                           // too few to march
  const squadId = s.nextEntityId++;
  for (const m of members) s.pawns.squadId[m] = squadId;
  s.squads.push({
    id: squadId,
    factionId: attackerId,
    x: home.x, y: home.y,
    targetX: target.x, targetY: target.y,
    members,
    morale: 220,
    state: 'muster',
    warId: w.id,
    homeSettlement: home.id,
    pathIdx: 0,
    startSize: members.length,
  });
}

function considerExpansion(s: SimState, f: Faction): void {
  // Automatic path: crowding pressure only (survival). Prosperity founding is
  // the king's call via the EXPAND council option (11 §F fixes 1+3); RuleBrain
  // reliably picks it when rich, so instinct kings expand too.
  const mySettlements = s.settlements.filter(st => !st.razed && st.factionId === f.id);
  if (mySettlements.length === 0 || mySettlements.length >= 4) return;
  const crowded = mySettlements.find(st => st.crowding > 100 && st.popCache > 45);
  if (!crowded) return;
  if (crowded.stockpile[Good.Wood] < 60 || crowded.stockpile[Good.Grain] < 250) return;
  const site = findExpansionSite(s, crowded);
  if (!site) return;
  foundSettlement(s, f, crowded, site[0], site[1]);
}

function checkRebellion(s: SimState, f: Faction): void {
  // vassal rebellion: overlord weakness + resentment (04)
  if (f.vassalOf >= 0) {
    const overlord = s.factions[f.vassalOf];
    if (!overlord || overlord.extinct) {
      f.vassalOf = -1;
      return;
    }
    if (armyStrength(s, f.id) > armyStrength(s, overlord.id) * 12 / 10) {
      setDiplo(s, f.id, overlord.id, DiploState.Hostile);
      f.vassalOf = -1;
      adjustLedger(s, overlord.id, f.id, -4, 'vassal rebellion');
      emitEvent(s, {
        type: EventType.Rebellion, factions: [f.id, overlord.id], severity: 4,
        text: `Y${yearOf(s.tick)}: ${f.name} casts off the yoke of ${overlord.name}.`,
      });
    }
    return;
  }
  // settlement rebellion → faction split (bigness rots; 04). The trigger
  // reads the legible loyalty score (P1.2), not an opaque mood+distance rule.
  if (s.factions.filter(x => !x.extinct).length >= MAX_FACTIONS) return;
  const mySettlements = s.settlements.filter(st => !st.razed && st.factionId === f.id);
  if (mySettlements.length < 3) return;
  for (const st of mySettlements) {
    if (st.id === f.capital) continue;
    if (st.loyalty <= 20 && st.popCache > 50) {
      splitFaction(s, f, st);
      break;
    }
  }
}

/** A dead faction's id is a free slot (04): pairKey addressing is MAX_FACTIONS
 *  wide, so rebellion-born factions must reuse extinct ids, never grow past 8. */
function claimFactionSlot(s: SimState): number {
  const reuse = s.factions.find(f =>
    f.extinct && !s.settlements.some(st => !st.razed && st.factionId === f.id));
  if (reuse) {
    // wipe the old pair rows: a new banner owes and is owed nothing
    for (const o of s.factions) {
      if (o.id === reuse.id) continue;
      s.pairs[pairKey(reuse.id, o.id)] = {
        diplo: DiploState.Neutral, grudge: 0, ledger: [], embargo: false, truceUntil: 0,
      };
      if (o.vassalOf === reuse.id) o.vassalOf = -1;   // dead overlord's chains break
    }
    return reuse.id;
  }
  return s.factions.length < MAX_FACTIONS ? s.factions.length : -1;
}

function splitFaction(s: SimState, parent: Faction, st: Settlement): void {
  const slot = claimFactionSlot(s);
  if (slot < 0) return;                              // the world is full
  const nf: Faction = {
    id: slot,
    race: parent.race,
    name: `Free ${st.name}`,
    god: parent.god,
    leaderId: -1,
    culture: {
      aggression: Math.min(255, parent.culture.aggression + 20),
      piety: parent.culture.piety,
      wanderlust: parent.culture.wanderlust,
      // rebellion drifts the mother culture (M10, doc 12 Q4: drift is alive)
      ...driftCulture(
        {
          doctrine: parent.culture.doctrine ?? 'defensive',
          succession: parent.culture.succession ?? 'eldest',
          values: parent.culture.values ?? [],
        },
        parent.race, s.rng.get('culture')),
    },
    equipmentTier: parent.equipmentTier,
    extinct: false,
    reserveStores: false,
    conscriptTarget: 0,
    foodSignalAvg: 22000,
    capital: st.id,
    vassalOf: -1,
    prospectEffort: 0,
    llmCoverageNum: 0, llmCoverageDen: 0,
  };
  if (slot < s.factions.length) s.factions[slot] = nf;
  else s.factions.push(nf);
  st.factionId = nf.id;
  st.loyalty = 100;                // its own banner now
  st.capturedTick = -1;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive)) continue;
    if (s.pawns.settlementId[i] === st.id) s.pawns.factionId[i] = nf.id;
  }
  // soldiers of the seceded town desert their old banner and go home (M9)
  for (const sq of s.squads) {
    if (sq.factionId !== parent.id) continue;
    sq.members = sq.members.filter(m => {
      if (s.pawns.factionId[m] !== nf.id) return true;
      s.pawns.squadId[m] = 65535;
      s.pawns.flags[m] &= ~PawnFlag.Fighting;
      return false;
    });
    if (sq.members.length === 0) sq.state = 'disband';
  }
  // rebel leader
  let best = -1, bestScore = -1;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(s.pawns.flags[i] & PawnFlag.Alive) || s.pawns.factionId[i] !== nf.id) continue;
    if (s.pawns.flags[i] & PawnFlag.Child) continue;
    if (s.pawns.charisma[i] > bestScore) { bestScore = s.pawns.charisma[i]; best = i; }
  }
  const ev = emitEvent(s, {
    type: EventType.FactionSplit,
    factions: [parent.id, nf.id],
    x: st.x, y: st.y, severity: 4,
    text: `Y${yearOf(s.tick)}: ${st.name} rises in revolt and breaks from ${parent.name}.`,
  });
  if (best >= 0) {
    const nc = promoteNamed(s, best, 'king', `Led the revolt of ${st.name}.`, [ev.id]);
    if (nc) {
      nf.leaderId = nc.id;
      nf.dynasty = { clan: nc.name.split(' ').slice(-1)[0], foundedTick: s.tick };
    }
  }
  nf.legitimacy = 40;              // a rebel crown sits uneasy (P1.4)
  setDiplo(s, parent.id, nf.id, DiploState.Hostile);
  adjustLedger(s, parent.id, nf.id, -5, 'rebellion');
}
