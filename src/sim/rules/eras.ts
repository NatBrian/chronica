// Turning ages (M12, P4.2): a slow deterministic era wheel, pure function of
// (seed, year). WorldBox's ages CAUSE things; ours modulate pressure so the
// macro rhythm never stalls even when politics idle. Config-gated (eraWheel);
// the chronicle narrates the turns it already titles.
import { fnv1a } from '../rng/rng';

export const ERA_SPAN_YEARS = 60;

export interface EraMods {
  name: string;
  /** percent scales, 100 = neutral */
  fertility: number;
  disaster: number;
  /** extra grudge decay per year during gentle ages */
  grudgeMend: number;
}

const WHEEL: EraMods[] = [
  { name: 'quiet years', fertility: 100, disaster: 100, grudgeMend: 0 },
  { name: 'years of plenty', fertility: 118, disaster: 70, grudgeMend: 1 },
  { name: 'the withering', fertility: 82, disaster: 120, grudgeMend: 0 },
  { name: 'an age of storms', fertility: 95, disaster: 160, grudgeMend: 0 },
  { name: 'a golden age', fertility: 112, disaster: 60, grudgeMend: 1 },
  { name: 'the hungry age', fertility: 78, disaster: 110, grudgeMend: 0 },
];

const NEUTRAL: EraMods = WHEEL[0];

export function eraMods(seed: number, year: number, enabled: boolean): EraMods {
  if (!enabled) return NEUTRAL;
  const idx = Math.floor(year / ERA_SPAN_YEARS);
  if (idx === 0) return NEUTRAL;                 // the first age is always calm
  return WHEEL[fnv1a(`era:${seed}:${idx}`) % WHEEL.length];
}
