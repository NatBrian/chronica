// Pawn lifecycle primitives shared by genesis and birthDeathSystem.
import { EventType, TICKS_PER_YEAR } from '../shared/types';
import { RACE_TABLE } from './raceData';
import { AGE_SCALE, PawnFlag, SimState } from './state';
import { emitEvent, yearOf } from './events/events';
import { Rng } from './rng/rng';

export interface SpawnOpts {
  x: number; y: number;
  factionId: number;
  settlementId: number;
  ageYears: number;
  female: boolean;
  motherId?: number;
  fatherId?: number;
  traits?: { strength: number; fertility: number; temper: number; longevity: number; charisma: number };
}

/** Find a free slot and initialize a pawn. Returns index or -1 when full (F1). */
export function spawnPawn(s: SimState, o: SpawnOpts, rng: Rng): number {
  const p = s.pawns;
  const max = s.config.maxPawns;
  let idx = -1;
  // lowest free index — deterministic
  for (let i = 0; i < max; i++) {
    if (!(p.flags[i] & PawnFlag.Alive)) { idx = i; break; }
  }
  if (idx === -1) { s.birthsDeferred++; return -1; }
  if (idx >= s.pawnCount) s.pawnCount = idx + 1;

  const race = s.factions[o.factionId]?.race ?? 0;
  const rs = RACE_TABLE[race as 0];
  p.x[idx] = o.x; p.y[idx] = o.y;
  p.hp[idx] = 100;
  p.hunger[idx] = 40 + rng.int(40);
  p.energy[idx] = 200 + rng.int(55);
  p.shelter[idx] = 0; p.safety[idx] = 0; p.social[idx] = 100;
  p.mood[idx] = 150;
  p.age[idx] = Math.floor(o.ageYears * TICKS_PER_YEAR / AGE_SCALE);
  p.factionId[idx] = o.factionId;
  p.settlementId[idx] = o.settlementId;
  p.action[idx] = 0; p.actionTarget[idx] = -1; p.actionTicks[idx] = 0;
  p.pregTicks[idx] = 0;
  p.pairId[idx] = -1;
  p.motherId[idx] = o.motherId ?? -1;
  p.fatherId[idx] = o.fatherId ?? -1;
  if (o.traits) {
    p.strength[idx] = o.traits.strength; p.fertility[idx] = o.traits.fertility;
    p.temper[idx] = o.traits.temper; p.longevity[idx] = o.traits.longevity;
    p.charisma[idx] = o.traits.charisma;
  } else {
    p.strength[idx] = 100 + rng.int(56); p.fertility[idx] = 100 + rng.int(56);
    p.temper[idx] = 100 + rng.int(56); p.longevity[idx] = 100 + rng.int(56);
    p.charisma[idx] = 100 + rng.int(56);
  }
  p.squadId[idx] = 65535;
  p.namedId[idx] = -1;
  p.jobAffinity[idx] = 0;
  let flags = PawnFlag.Alive;
  if (o.female) flags |= PawnFlag.Female;
  const ageY = o.ageYears;
  if (ageY < rs.adultAtYears) flags |= PawnFlag.Child;
  else if (ageY >= rs.elderAtYears) flags |= PawnFlag.Elder;
  p.flags[idx] = flags;
  s.alivePawns++;
  return idx;
}

export function killPawn(s: SimState, idx: number, cause: string, causeEventIds: number[] = []): void {
  const p = s.pawns;
  if (!(p.flags[idx] & PawnFlag.Alive)) return;
  p.flags[idx] = 0;
  s.alivePawns--;
  s.deathsByCause[cause] = (s.deathsByCause[cause] ?? 0) + 1;
  // unpair partner
  const partner = p.pairId[idx];
  if (partner >= 0 && p.pairId[partner] === idx) p.pairId[partner] = -1;
  p.pairId[idx] = -1;
  // squad removal
  const sqId = p.squadId[idx];
  if (sqId !== 65535) {
    const sq = s.squads.find(q => q.id === sqId);
    if (sq) sq.members = sq.members.filter(m => m !== idx);
    p.squadId[idx] = 65535;
  }
  // named character death bookkeeping
  const nId = p.namedId[idx];
  if (nId >= 0) {
    const nc = s.named[nId];
    if (nc && nc.deathTick < 0) {
      nc.deathTick = s.tick;
      nc.pawnIdx = -1;
      const ev = emitEvent(s, {
        type: EventType.CharacterDied,
        actors: [nId], factions: [p.factionId[idx]],
        x: p.x[idx], y: p.y[idx],
        causes: causeEventIds,
        severity: nc.role === 'king' ? 4 : 3,
        text: `Y${yearOf(s.tick)}: ${nc.name} ${deathPhrase(cause)}`,
        data: { cause },
      });
      nc.deathCauseEventId = ev.id;
      s.namedActive--;
    }
  }
}

function deathPhrase(cause: string): string {
  switch (cause) {
    case 'starvation': return 'starved to death';
    case 'cold': return 'froze in the winter cold';
    case 'combat': return 'fell in battle';
    case 'oldage': return 'died of old age';
    case 'plague': return 'was taken by the plague';
    case 'monster': return 'was slain by a beast';
    default: return 'died';
  }
}

export function ageYears(s: SimState, idx: number): number {
  return Math.floor(s.pawns.age[idx] * AGE_SCALE / TICKS_PER_YEAR);
}
