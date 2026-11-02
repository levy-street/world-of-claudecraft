// The Guardian of the Breath's and the Hammer Council's floor warnings, as
// numbers: which paint each of their footprints wears and how strongly (the
// shaders are breath_telegraph_glsl.ts and council_telegraph_glsl.ts, the
// dressing painted_telegraphs.ts). Brought to the Guardian of the Heat's
// molten telegraphs' bar (heat_telegraph_core.ts): a footprint reads as its
// element, never as the bare shared disc.
//
// The SHAPE and the TIMING stay the shared kit's (../floor_telegraph): every
// footprint is draped at the sim's exact radius, its fill is the sim's own bar
// or the painter's clock off the sim's template, its edge a crisp line in the
// THREAT colour (danger, lethal, control, the soak's gold, the calm's mint)
// on every tier. The paint only changes what fills it:
//   - bolt (the storm's strikes, Drawn Lightning, Leaping Bolt's reach, the
//     Thunder's Cradle): the floor storm-scorched, branching lightning cracks
//     racing out from the strike point with the fill, flickering, flaring white
//     over the bar's last stretch;
//   - charged (the ground a strike leaves): blackened stone with arcs crawling
//     over its cracks, re-striking;
//   - wind (the vortex, the loose gales, the pinned, the exhale): pale air, a
//     spiral of streaks turning (inward for the vortex, outward for the blast);
//   - calm (Thessaly's circle, the anchored): a still mint pool, slow ripples,
//     never a threat's flicker;
//   - quake (the council's Wake the Stone, the heir's rising stone, the Falling
//     Rock's soak, the Echo, the slab, the song): fissures splitting out from
//     the middle with the fill, granite plates heaving, ochre light and dust in
//     the splits;
//   - rubble (a fallen pillar's footprint): broken stone and gravel, the cracks
//     glowing faintly ochre.
// The flicker, the motes, the fine cracks and the dust are the cosmetic layers
// the low tier sheds (`uDetail`); the edge, the fill's front and the main lines
// draw on every tier and never hide the area or its timing.
//
// Three-free, DOM-free, deterministic.

/** The paints. */
export type TelegraphPaintKind = 'bolt' | 'charged' | 'wind' | 'calm' | 'quake' | 'rubble';

/** Every Breath footprint the fight paints. */
export type BreathTelegraphKind =
  | 'strike'
  | 'drawnStrike'
  | 'drawnBar'
  | 'drawnMark'
  | 'fork'
  | 'lance'
  | 'cradle'
  | 'charged'
  | 'vortex'
  | 'gale'
  | 'pinned'
  | 'gust'
  | 'calm'
  | 'anchor';

/** Every Hammer Council footprint the fight paints. */
export type CouncilTelegraphKind =
  | 'wake'
  | 'rock'
  | 'rise'
  | 'rubble'
  | 'echo'
  | 'slabGrind'
  | 'slabCrush'
  | 'song'
  | 'crater';

export interface PaintedTelegraphLook {
  paint: TelegraphPaintKind;
  /** How strongly the paint takes the floor under the mark (the multiply). */
  char: number;
  /** The paint's second layer (the bolts' halo, the streaks' body, the dust). */
  body: number;
  /** The lines' cell size: cells per yard (smaller marks, finer cells). */
  cells: number;
  /** The lines' light (0..1). */
  crack: number;
  /** The edge line's strength (1 a hard edge). */
  rim: number;
  /** Wind: the spiral's twist and turn (signed: the way it turns). */
  spin: number;
  /** Wind: the streaks' flow along the radius (+ outward, - inward). */
  flow: number;
  /** Whether the kit's cosmetic curtain stands on its edge (a mark riding a
   *  moving body goes without: it would jitter). */
  curtain: boolean;
}

const look = (
  paint: TelegraphPaintKind,
  char: number,
  body: number,
  cells: number,
  crack: number,
  opts: Partial<Pick<PaintedTelegraphLook, 'rim' | 'spin' | 'flow' | 'curtain'>> = {},
): PaintedTelegraphLook => ({
  paint,
  char,
  body,
  cells,
  crack,
  rim: opts.rim ?? 1,
  spin: opts.spin ?? 0,
  flow: opts.flow ?? 0,
  curtain: opts.curtain ?? true,
});

/** Per kind. The strikes take the deepest storm scorch; the marks riding a
 *  player go without a curtain; the exhale's ring is the whole Cornice, so its
 *  air is faint (the raid and the anchors read through it). */
export const BREATH_TELEGRAPH_LOOKS: Readonly<Record<BreathTelegraphKind, PaintedTelegraphLook>> = {
  strike: look('bolt', 0.7, 1, 0.85, 1),
  drawnStrike: look('bolt', 0.7, 1, 0.85, 1),
  drawnBar: look('bolt', 0.5, 0.9, 0.85, 0.9, { curtain: false }),
  drawnMark: look('bolt', 0.3, 0.8, 1.4, 0.8, { rim: 0.9, curtain: false }),
  fork: look('bolt', 0.35, 0.8, 0.5, 0.7, { rim: 0.9, curtain: false }),
  lance: look('bolt', 0.55, 1, 0.8, 1),
  cradle: look('bolt', 0.42, 0.9, 0.6, 0.8),
  charged: look('charged', 0.62, 1, 0.9, 1, { curtain: false }),
  vortex: look('wind', 0.45, 1, 0.5, 1, { spin: 1.4, flow: -1.2, curtain: false }),
  gale: look('wind', 0.4, 1, 0.8, 1, { spin: 2.6, flow: 0.25, curtain: false }),
  pinned: look('wind', 0.3, 0.9, 1.2, 0.9, { spin: 0, flow: 1.6, curtain: false }),
  gust: look('wind', 0.1, 0.6, 0.12, 0.55, { spin: 0.12, flow: 1.4 }),
  calm: look('calm', 0.12, 1, 0.6, 0.8),
  anchor: look('calm', 0.1, 0.8, 1.4, 0.7, { rim: 0.85, curtain: false }),
};

/** Per kind. Wake the Stone's throw and the heir's rising stone split the
 *  floor from the middle (a pillar coming up), the soak's rock cracks the
 *  floor it will land on, a pillar's rubble is broken stone. */
export const COUNCIL_TELEGRAPH_LOOKS: Readonly<Record<CouncilTelegraphKind, PaintedTelegraphLook>> =
  {
    wake: look('quake', 0.68, 0.9, 0.55, 1, { curtain: false }),
    rock: look('quake', 0.6, 0.7, 0.42, 0.9, { curtain: false }),
    rise: look('quake', 0.7, 1, 0.55, 1),
    rubble: look('rubble', 0.55, 1, 1.1, 0.75),
    echo: look('quake', 0.62, 0.9, 0.3, 1),
    slabGrind: look('quake', 0.32, 0.7, 0.5, 0.7, { rim: 0.85, curtain: false }),
    slabCrush: look('quake', 0.55, 1, 0.6, 1, { curtain: false }),
    song: look('quake', 0.22, 0.6, 0.45, 0.6, { rim: 0.85 }),
    crater: look('quake', 0.7, 1, 0.7, 1, { rim: 0.9, curtain: false }),
  };

/** The glow passes' encounter rungs, each over every char rung of its owner
 *  (BreathFightFx's fans 6 to 13, BreathFx's exhale ring 10, CouncilFx's
 *  rubble 12, marks and spots 14, the Echo's and the Song's outer ring 16), so
 *  an owner's multiplies all land before its sums and crossing marks commute.
 *  The council's sits under the slab's crush ring (18) and its gouges (19). */
export const BREATH_TELEGRAPH_GLOW_STEP = 14;
export const BREATH_GUST_GLOW_STEP = 15;
export const COUNCIL_TELEGRAPH_GLOW_STEP = 17;

/** The crater a Falling Rock leaves where it lands (cosmetic: no threat
 *  colour on its edge, the soak is over): the rock's own size, split stone
 *  settling for `seconds`. */
export const ROCK_CRATER = {
  /** Its radius as a share of the soak's. */
  share: 0.55,
  seconds: 3.5,
  /** The edge: a dark umber line, never a threat's hue. */
  color: 0x4a3018,
  accent: 0xffb35a,
} as const;

/** The crater's fade at `age` seconds: full for the first half, then gone
 *  smoothly by `ROCK_CRATER.seconds` (0 past it). */
export function craterFade(age: number): number {
  const T = ROCK_CRATER.seconds;
  if (age < 0 || age >= T) return 0;
  const k = Math.max(0, (age - T * 0.5) / (T * 0.5));
  return 1 - k * k * (3 - 2 * k);
}

/** How many times a second the lightning re-strikes (a new set of forks):
 *  the bolt's flicker, the charged ground's crawl. */
export const BOLT_RESTRIKE_HZ = 13;
export const CHARGED_CRAWL_HZ = 19;

/** The lightning's reach out from the strike point at `fill` (0..1 of the
 *  bar), as a share of the radius: the forks race out with the bar and stand
 *  a hair inside the edge once it lands, so the area itself (the rim) always
 *  carries the exact radius and the forks the timing. */
export function boltReach(fill: number): number {
  const f = Math.max(0, Math.min(1, fill));
  return 0.45 + 0.51 * f;
}

/** The white flare over the bar's last stretch (0 until `from`, 1 at the
 *  landing): the strike about to fall. Never on a static footprint. */
export function boltFlare(fill: number, from = 0.86): number {
  const f = Math.max(0, Math.min(1, fill));
  if (f <= from) return 0;
  const k = (f - from) / (1 - from);
  return k * k;
}

/** A fan's seed: a deterministic spread so two strikes side by side never
 *  fork alike (the pool's slot index). */
export function telegraphSeed(slot: number): number {
  return ((slot * 0.618034) % 1) * 97 + 3.1;
}
