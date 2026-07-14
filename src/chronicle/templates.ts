// Template chapters (05): the LLM-less fallback; dry but factual and
// readable. Also used when the validator rejects twice.
import { WorldEvent, TICKS_PER_YEAR, ChronicleChapter, ChronicleAnchor } from '../shared/types';
import { ChapterDraft } from './detector';

const OPENERS: Record<string, string> = {
  war: 'As wars often do, it began smaller than it ended.',
  famine: 'The land itself turned against its people in these years.',
  succession: 'A crown changed heads, and with it the fate of a people.',
  founding: 'New roofs rose against the sky.',
  disaster: 'Calamity wrote this chapter; the people merely endured it.',
  'era-life': 'Not all history is made of battles.',
  ending: 'Every people believes it will last forever. History disagrees.',
};

/** "The hosts of X" → lowercase; "Gruk declares..." → keep the name's capital. */
function startsProperNoun(factText: string): boolean {
  const body = factText.replace(/^Y\d+: /, '');
  const firstWord = body.split(/\s+/)[0] ?? '';
  // articles/pronouns are safe to lowercase; anything else treat as a name
  return !/^(The|A|An|With|It|Hunger|Fire|Bad|Raiders|Settlers|Prospectors|Elders|Wolves|Tribute|Trade|Battle|Defeated|Exhausted)$/.test(firstWord);
}

export function templateChapter(draft: ChapterDraft, facts: WorldEvent[], title: string, era: string): ChronicleChapter {
  const paragraphs: { text: string; anchor: ChronicleAnchor }[] = [];
  const opener = OPENERS[draft.kind] ?? 'These things happened, and were remembered.';
  // group facts into paragraphs of ~4
  for (let i = 0; i < facts.length; i += 4) {
    const group = facts.slice(i, i + 4);
    const text = (i === 0 ? opener + ' ' : '') +
      group.map(f => f.text.replace(/^Y(\d+): (.)/, (_m, y: string, c: string) =>
        `In the year ${y}, ${/[A-Z]/.test(c) && !startsProperNoun(f.text) ? c.toLowerCase() : c}`)).join(' ');
    paragraphs.push({
      text,
      anchor: {
        year: Math.floor(group[0].tick / TICKS_PER_YEAR),
        x: group[0].x, y: group[0].y, eventId: group[0].id,
      },
    });
  }
  return {
    id: draft.id,
    title,
    era,
    yearStart: draft.yearStart,
    yearEnd: draft.yearEnd,
    paragraphs,
    factIds: draft.factIds,
    source: 'template',
  };
}

/** Deterministic-ish chapter title from the draft (LLM may override). */
export function draftTitle(draft: ChapterDraft, facts: WorldEvent[], factionNames: string[]): string {
  const y = draft.yearStart === draft.yearEnd ? `Y${draft.yearStart}` : `Y${draft.yearStart}–${draft.yearEnd}`;
  switch (draft.kind) {
    case 'war': {
      // the war already has a name from its casus belli (M10, P6.2)
      const declared = facts.find(f => typeof f.data?.warName === 'string');
      if (declared) {
        const n = String(declared.data!.warName);
        return `${n.charAt(0).toUpperCase()}${n.slice(1)} (${y})`;
      }
      const names = draft.factionIds.map(f => factionNames[f]).filter(Boolean);
      const razed = facts.find(f => f.text.includes('burns'));
      if (razed) return `The Burning (${y})`;
      return names.length >= 2
        ? `The War of ${shortName(names[0])} and ${shortName(names[1])} (${y})`
        : `A War of the Age (${y})`;
    }
    case 'famine': return `The Hungry Years (${y})`;
    case 'succession': return `The Passing of a Crown (${y})`;
    case 'crisis': {
      const rebel = facts.find(f => f.text.includes('rises in revolt'));
      return rebel ? `The Realm Breaks (${y})` : `A Crown Contested (${y})`;
    }
    case 'ending': return `The Last Days (${y})`;
    case 'era-life': return `Life on the Island (${y})`;
    default: return `Chronicle (${y})`;
  }
}

function shortName(full: string): string {
  return full.replace(/ (Kingdom|Court|Hold|Horde)$/, '');
}
