// The Masterless Strength's floor telegraphs, as numbers (the shaders are
// final_telegraph_glsl.ts and, for the Heat quarter, the Heat guardian's own
// heat_telegraph_glsl.ts; the dressing final_telegraphs.ts): which element
// each of the four quarter kits' footprints paints in, and how.
//
// The SHAPE and the TIMING stay the shared kit's (../floor_telegraph): every
// footprint is draped at the sim's exact radius and its fill is the sim's own
// bar or the painter's clock off the sim's template (final_kit_fx_core.ts).
// Only the paint changes, each quarter in its own language at the Heat's bar:
//   - fire (the Heat): the molten basalt of heat_telegraph_core.ts;
//   - frost (the Quench): the floor frost-bitten, ice fractures and rime
//     feathers creeping in from the rim toward the break;
//   - storm (the Breath): the floor storm-scorched, streaks and forks
//     crawling out from the middle, a crackling front;
//   - stone (the Hammer): the granite split dark, fissures opening with gold
//     glints behind the front.
// The threat colour (danger, lethal, the soak's gold) is the edge's, set by
// the footprint's style; the element is the paint. Every look reads on every
// tier; the rime, the streaks, the grain and the glints are what the low tier
// sheds (`detail`).
//
// Three-free, DOM-free, deterministic.

/** The four strengths' paints. */
export type FinalElement = 'fire' | 'frost' | 'storm' | 'stone';

/** Every floor warning the four quarter kits paint. */
export type FinalTelegraphKind =
  | 'whirl'
  | 'pool'
  | 'ember'
  | 'crack'
  | 'drawn'
  | 'bolt'
  | 'orb'
  | 'tremor'
  | 'anvil'
  | 'crushed'
  // The woken stars (the rework of 2026-11-18): a pillar's rise in granite,
  // a Sky Strike's white storm spot, Arcing Stone's ring round its pillar.
  | 'rise'
  | 'strike'
  | 'arcRing'
  // Part 2 (final_phase_fx.ts): each Splinter's Shearing Blow in its own
  // element, Bursting Coal's reach, Gale Pounce's landing, the hunt's
  // Buffeting Gale.
  | 'shearFire'
  | 'shearFrost'
  | 'shearStorm'
  | 'shearStone'
  | 'coal'
  | 'pounce'
  | 'buffet';

export interface FinalTelegraphLook {
  element: FinalElement;
  /** How strongly the element takes the floor under the mark (multiply). */
  char: number;
  /** The element's second layer: the molten flow, the rime, the streaks,
   *  the grain (0 none). */
  body: number;
  /** The lines' cell size: cells per yard (smaller marks, finer cells). */
  cells: number;
  /** The lines' light (0..1). */
  crack: number;
  /** The edge line's strength (1 a hard edge). */
  rim: number;
  /** Fire only: 1 hotter toward the middle (a falloff of damage). */
  falloff: number;
  /** 1: the fill creeps in from the rim (frost closing on its break); 0: it
   *  breaks out from the middle. */
  inward: 0 | 1;
  /** Whether the kit's cosmetic glowing curtain stands on its edge (a mark
   *  riding a moving body goes without: it would jitter). */
  curtain: boolean;
}

const look = (
  element: FinalElement,
  char: number,
  body: number,
  cells: number,
  crack: number,
  opts: Partial<Pick<FinalTelegraphLook, 'rim' | 'falloff' | 'inward' | 'curtain'>> = {},
): FinalTelegraphLook => ({
  element,
  char,
  body,
  cells,
  crack,
  rim: opts.rim ?? 1,
  falloff: opts.falloff ?? 0,
  inward: opts.inward ?? 0,
  curtain: opts.curtain ?? true,
});

/** Per kind. The Heat's three borrow the guardian's own looks (a whirl the
 *  cinder's moving reach, a pool the river's landed flow, an ember mark the
 *  fall's). The lethal crack and the Anvil take the deepest marks; the
 *  marks riding a player (the cold's reach, Drawn Lightning's, the bolt's,
 *  an ember, Crushed) go without a curtain. */
export const FINAL_TELEGRAPH_LOOKS: Readonly<Record<FinalTelegraphKind, FinalTelegraphLook>> = {
  whirl: look('fire', 0.32, 0.5, 1.2, 0.85, { falloff: 0.5, curtain: false }),
  pool: look('fire', 0.45, 0.9, 0.5, 0.95),
  ember: look('fire', 0.55, 1, 0.9, 1, { curtain: false }),
  crack: look('frost', 0.62, 1, 0.75, 1, { inward: 1 }),
  drawn: look('storm', 0.3, 0.9, 0.5, 0.85, { curtain: false }),
  bolt: look('storm', 0.4, 0.9, 0.6, 1, { curtain: false }),
  orb: look('storm', 0.36, 0.7, 0.9, 0.9),
  tremor: look('stone', 0.58, 0.8, 0.55, 1),
  anvil: look('stone', 0.6, 0.9, 0.32, 1),
  crushed: look('stone', 0.4, 0.6, 0.9, 0.8, { rim: 0.8, curtain: false }),
  rise: look('stone', 0.55, 0.9, 0.7, 1),
  strike: look('storm', 0.42, 1, 0.8, 1),
  arcRing: look('storm', 0.3, 0.9, 0.35, 1, { rim: 1 }),
  shearFire: look('fire', 0.55, 1, 0.6, 1, { curtain: false }),
  shearFrost: look('frost', 0.6, 1, 0.6, 1, { curtain: false }),
  shearStorm: look('storm', 0.5, 0.9, 0.6, 1, { curtain: false }),
  shearStone: look('stone', 0.62, 0.9, 0.5, 1, { curtain: false }),
  coal: look('fire', 0.3, 0.7, 0.6, 0.9, { falloff: 0.6, curtain: false }),
  pounce: look('storm', 0.45, 0.9, 0.9, 1, { curtain: false }),
  buffet: look('storm', 0.22, 0.8, 0.5, 0.7, { rim: 0.85, curtain: false }),
};

/** The dressed fans each element keeps (fixed, allocated at build): the
 *  most of its kinds the kit can show at once, with room to spare. */
export const FINAL_TELEGRAPH_POOLS: Readonly<Record<FinalElement, number>> = {
  // Six whirls, ten pools, three ember marks.
  fire: 22,
  // Two to four cracks.
  frost: 8,
  // Six orbs, two Drawn Lightning marks, the bolt's target, a volley of Sky
  // Strikes and their Arcing Stone rings (two volleys can overlap).
  storm: 24,
  // Four tremors, the Anvil, the Crushed, a volley of rises.
  stone: 18,
};

/** The element a kind paints in. */
export function finalTelegraphElement(kind: FinalTelegraphKind): FinalElement {
  return FINAL_TELEGRAPH_LOOKS[kind].element;
}

/** The element's floor tint under a mark at `strength` 0..1 (the char pass's
 *  multiply; mirrors final_telegraph_glsl.ts's `tint`, fire excepted: its
 *  char is the Heat's scorched basalt). Each a different hue so the four
 *  quarters read apart at a glance. */
export const FINAL_ELEMENT_TINTS: Readonly<
  Record<Exclude<FinalElement, 'fire'>, readonly [number, number, number]>
> = {
  frost: [0.46, 0.6, 0.84],
  storm: [0.62, 0.58, 0.74],
  stone: [0.5, 0.45, 0.4],
};
