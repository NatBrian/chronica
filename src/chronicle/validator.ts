// Entity/year validator (05 §Hallucination stance): prose may be flowery,
// never WRONG. Named entities must exist in the fact list; years must match.
import { WorldEvent, TICKS_PER_YEAR } from '../shared/types';

export interface ValidationInput {
  prose: string;
  facts: WorldEvent[];
  /** every legal proper noun: actors, factions, places, gods, island */
  knownNames: string[];
  yearStart: number;
  yearEnd: number;
}

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

const COMMON_WORDS = new Set([
  'The', 'A', 'An', 'In', 'It', 'They', 'Their', 'When', 'Then', 'But', 'And',
  'Year', 'Years', 'War', 'Peace', 'King', 'Queen', 'Warchief', 'Thane', 'Lord',
  'Winter', 'Spring', 'Summer', 'Autumn', 'North', 'South', 'East', 'West',
  'No', 'Not', 'Nothing', 'None', 'What', 'Who', 'That', 'This', 'Those', 'These',
  'For', 'From', 'By', 'At', 'On', 'Of', 'To', 'With', 'Was', 'Were', 'Is', 'Had',
  'His', 'Her', 'Its', 'He', 'She', 'We', 'Our', 'So', 'Yet', 'Still', 'Some',
  'Many', 'Few', 'All', 'Both', 'Each', 'Even', 'Now', 'Here', 'There', 'Thus',
  'Chapter', 'Era', 'Age', 'Court', 'Kingdom', 'Hold', 'Horde', 'Council',
  'Battle', 'Banners', 'Grain', 'Ash', 'Fire', 'Blood', 'Iron', 'Stone', 'Gods',
  'Let', 'As', 'If', 'Or', 'Nor', 'Before', 'After', 'During', 'Against',
]);

export function validateChapter(input: ValidationInput): ValidationResult {
  const violations: string[] = [];
  const known = new Set<string>();
  for (const n of input.knownNames) {
    for (const part of n.split(/\s+/)) known.add(part.toLowerCase());
  }

  // entity check: capitalized mid-sentence words must be known
  const words = input.prose.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const raw = words[i].replace(/[^A-Za-z''-]/g, '');
    if (!raw || !/^[A-Z]/.test(raw)) continue;
    const prev = i > 0 ? words[i - 1] : '';
    const sentenceStart = i === 0 || /[.!?"]$/.test(prev);
    if (sentenceStart) continue;                  // can't judge sentence-initial caps
    if (COMMON_WORDS.has(raw)) continue;
    const base = raw.replace(/'s$/, '').toLowerCase();
    if (!known.has(base)) {
      violations.push(`unknown entity "${raw}"`);
    }
  }

  // year check: every mentioned year must fall within the chapter span (±2)
  const yearRefs = [...input.prose.matchAll(/\b(?:Y|[Yy]ear )(\d{1,4})\b/g)];
  for (const m of yearRefs) {
    const y = Number(m[1]);
    if (y < input.yearStart - 2 || y > input.yearEnd + 2) {
      violations.push(`year ${y} outside chapter span ${input.yearStart}-${input.yearEnd}`);
    }
  }

  return { ok: violations.length === 0, violations: [...new Set(violations)].slice(0, 8) };
}

/** All proper nouns the prose is allowed to use, from facts + world names. */
export function chapterKnownNames(
  facts: WorldEvent[],
  namedNames: string[], factionNames: string[], settlementNames: string[],
  gods: string[], islandName: string,
): string[] {
  const names = new Set<string>([...namedNames, ...factionNames, ...settlementNames, ...gods, islandName]);
  // harvest capitalized words from fact texts (they are ground truth)
  for (const f of facts) {
    for (const w of f.text.split(/\s+/)) {
      const clean = w.replace(/[^A-Za-z''-]/g, '');
      if (/^[A-Z]/.test(clean)) names.add(clean.replace(/'s$/, ''));
    }
  }
  return [...names];
}
