// DB32 (DawnBringer-32): public-domain 32-color palette (06 §Palette).
// Single source of truth; all sprites/terrain sample from these slots.
export const DB32: readonly string[] = [
  '#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a',
  '#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
  '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
  '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30',
];

export const DB32_RGB: readonly (readonly [number, number, number])[] = DB32.map(hex => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

// Named slots for readability
export const P = {
  black: 0, deepPurple: 1, maroon: 2, brown: 3, rust: 4, orange: 5, tan: 6, peach: 7,
  yellow: 8, lime: 9, green: 10, teal: 11, darkGreen: 12, olive: 13, darkSlate: 14, navy: 15,
  seaBlue: 16, blue: 17, skyBlue: 18, cyan: 19, paleBlue: 20, white: 21, silver: 22, gray: 23,
  darkGray: 24, charcoal: 25, purple: 26, red: 27, salmon: 28, pink: 29, mossYellow: 30, ocher: 31,
} as const;

/** Faction identity ramps (4 colors each) from palette slots (06).
 *  Slots 4-7 belong to rebellion-born factions (M9). */
export const FACTION_RAMPS: readonly (readonly [number, number, number, number])[] = [
  [P.blue, P.skyBlue, P.paleBlue, P.navy],        // faction 0 (humans default)
  [P.green, P.lime, P.darkGreen, P.teal],          // faction 1 (elves)
  [P.ocher, P.tan, P.rust, P.brown],               // faction 2 (dwarves)
  [P.red, P.salmon, P.maroon, P.charcoal],         // faction 3 (orcs)
  [P.purple, P.pink, P.deepPurple, P.navy],        // faction 4 (rebel)
  [P.cyan, P.paleBlue, P.seaBlue, P.teal],         // faction 5 (rebel)
  [P.pink, P.salmon, P.purple, P.maroon],          // faction 6 (rebel)
  [P.mossYellow, P.yellow, P.olive, P.darkGreen],  // faction 7 (rebel)
];

/** Faction UI colors (8 slots; 4-7 reserved for M9 faction births). */
export const FACTION_HEX: readonly string[] = [
  '#639bff', '#6abe30', '#8a6f30', '#ac3232', '#76428a', '#5fcde4', '#d77bba', '#8f974a',
];

/** Seasonal grading tints (r,g,b multipliers ×100). */
export const SEASON_TINT: readonly (readonly [number, number, number])[] = [
  [100, 104, 100], // spring; slightly lusher greens
  [104, 102, 96],  // summer; warm
  [106, 98, 90],   // autumn; warmed + browned
  [92, 96, 108],   // winter; desaturated blue
];
