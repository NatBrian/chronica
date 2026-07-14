// Named-character promotion (03): plain pawns become story-trackable when
// they trip a story-worthiness detector. Scarcity enforced by a dynamic cap.
import { EventType } from '../shared/types';
import { NamedCharacter, PawnFlag, SimState } from './state';
import { fullName } from './world/names';
import { emitEvent, yearOf } from './events/events';
import { rollTraits } from './rules/identity';

export function namedCap(s: SimState): number {
  // breathing cap (03): war/crisis raises the ceiling
  const drama = s.wars.length * 5 + (s.weather.plagueActive ? 5 : 0);
  return Math.min(s.config.namedCapMax, s.config.namedCapBase + drama);
}

export function promoteNamed(
  s: SimState, pawnIdx: number, role: string, bio: string, causeEventIds: number[] = [],
): NamedCharacter | null {
  if (pawnIdx < 0 || !(s.pawns.flags[pawnIdx] & PawnFlag.Alive)) return null;
  if (s.pawns.namedId[pawnIdx] >= 0) return s.named[s.pawns.namedId[pawnIdx]];
  if (s.namedActive >= namedCap(s) && role !== 'king') return null;
  const fid = s.pawns.factionId[pawnIdx];
  const faction = s.factions[fid];
  if (!faction) return null;
  const rng = s.rng.get('names');
  const nc: NamedCharacter = {
    id: s.named.length,
    pawnIdx,
    name: fullName(faction.race, rng),
    role,
    factionId: fid,
    bornTick: s.tick - s.pawns.age[pawnIdx] * 4,
    deathTick: -1,
    deathCauseEventId: -1,
    bio: [bio],
    memories: [],
    recentChoices: [],
    kills: 0,
    parentNamedId: -1,
    traits: rollTraits(s.seed, s.named.length),
    renown: role === 'king' ? 10 : role === 'hero' || role === 'founder' ? 5 : 2,
  };
  s.named.push(nc);
  s.namedActive++;
  s.pawns.namedId[pawnIdx] = nc.id;
  s.pawns.flags[pawnIdx] |= PawnFlag.Named;
  emitEvent(s, {
    type: EventType.CharacterPromoted,
    actors: [nc.id], factions: [fid],
    x: s.pawns.x[pawnIdx], y: s.pawns.y[pawnIdx],
    causes: causeEventIds,
    severity: 2,
    text: `Y${yearOf(s.tick)}: ${nc.name} ${promotionPhrase(role)}`,
  });
  return nc;
}

function promotionPhrase(role: string): string {
  switch (role) {
    case 'hero': return 'earns renown on the field of battle.';
    case 'founder': return 'leads settlers into the wilds.';
    case 'survivor': return 'alone walks out of the ashes.';
    case 'heir': return 'is presented to the court as heir.';
    case 'prodigy': return 'is spoken of in every hall; a rare talent.';
    default: return 'rises to prominence.';
  }
}
