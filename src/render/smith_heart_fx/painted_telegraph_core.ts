// The Guardian of the Breath's, the Hammer Council's and the Guardian of the
// Quench's floor warnings, as
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
//     racing out from the strike point with the fill, flickering, surging and
//     flashing blue over the bar's last stretch;
//   - charged (the ground a strike leaves): blackened stone with arcs crawling
//     over its cracks, re-striking;
//   - wind (the vortex, the loose gales, the pinned, the exhale): pale air, a
//     spiral of streaks turning (inward for the vortex, outward for the blast);
//   - calm (Thessaly's circle, the anchored): a still mint pool, slow ripples,
//     never a threat's flicker;
//   - quake (the council's Wake the Stone, the heir's rising stone, the Falling
//     Rock's soak, the Echo, the slab, the song): fissures splitting out from
//     the middle with the fill, dark trenches with molten cores, granite
//     plates heaving, dust in the splits; the soak's rock throws its shadow
//     (black and crisp as it lands) and heats the cores as it drops, its
//     crater cooling after;
//   - rubble (a fallen pillar's footprint): broken stone and gravel, the cracks
//     glowing faintly ochre;
//   - frost (every Guardian of the Quench footprint: Quenching Breath's cone,
//     a crack's hole, the freeze's shatter ring, a slash's lane; Jose's
//     playtest of 2026-11-04): the lake frozen deep under the mark, fracture
//     lines and rime feathers lit behind a crystallising front, shards of ice
//     standing along every edge pointing in, a crack opening to black water, a
//     slash's lane split by the blade's groove with frost ferns off it.
// The flicker, the motes, the fine cracks and the dust are the cosmetic layers
// the low tier sheds (`uDetail`); the edge, the fill's front and the main lines
// draw on every tier and never hide the area or its timing.
//
// Three-free, DOM-free, deterministic.

/** The paints. */
export type TelegraphPaintKind =
  | 'bolt'
  | 'charged'
  | 'wind'
  | 'calm'
  | 'quake'
  | 'rubble'
  | 'frost';

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
  | 'rush'
  | 'resonance'
  | 'song'
  | 'crater';

/** Every Guardian of the Quench footprint the fight paints. */
export type QuenchTelegraphKind = 'breath' | 'crack' | 'splash' | 'slash';

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
  /** Wind: the spiral's twist and turn (signed: the way it turns). Frost:
   *  the shards' length along the edges (yards). */
  spin: number;
  /** Wind: the streaks' flow along the radius (+ outward, - inward). Frost:
   *  the black water opening in the middle (0 none, 1 a crack's hole). */
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
  strike: look('bolt', 0.8, 1, 0.85, 1),
  drawnStrike: look('bolt', 0.8, 1, 0.85, 1),
  drawnBar: look('bolt', 0.62, 0.9, 0.85, 0.95, { curtain: false }),
  drawnMark: look('bolt', 0.4, 0.8, 1.4, 0.85, { rim: 0.9, curtain: false }),
  fork: look('bolt', 0.6, 0.85, 0.5, 0.8, { rim: 0.9, curtain: false }),
  lance: look('bolt', 0.65, 1, 0.8, 1),
  // The cradle goes without the kit's curtain: a pale shell over the lifted
  // player that washed the storm out seen close.
  cradle: look('bolt', 0.55, 0.9, 0.6, 0.9, { curtain: false }),
  charged: look('charged', 0.8, 1, 0.9, 1, { curtain: false }),
  vortex: look('wind', 0.55, 1, 0.5, 1, { spin: 1.4, flow: -1.2, curtain: false }),
  gale: look('wind', 0.5, 1, 0.8, 1, { spin: 2.6, flow: 0.25, curtain: false }),
  pinned: look('wind', 0.3, 0.9, 1.2, 0.9, { spin: 0, flow: 1.6, curtain: false }),
  gust: look('wind', 0.1, 0.6, 0.12, 0.55, { spin: 0.12, flow: 1.4 }),
  calm: look('calm', 0.12, 1, 0.6, 0.8),
  anchor: look('calm', 0.1, 0.8, 1.4, 0.7, { rim: 0.85, curtain: false }),
};

/** Per kind. Wake the Stone's throw and the heir's rising stone split the
 *  floor from the middle (a pillar coming up), the soak's rock cracks the
 *  floor it will land on, a pillar's rubble is broken stone; Mountain's
 *  Rush's mark and lane split the stone the charge will tear through,
 *  Resonance's spread ring only scores it lightly (a ring to keep out of). */
export const COUNCIL_TELEGRAPH_LOOKS: Readonly<Record<CouncilTelegraphKind, PaintedTelegraphLook>> =
  {
    wake: look('quake', 0.72, 1, 0.55, 1, { curtain: false }),
    rock: look('quake', 0.74, 1, 0.42, 1, { curtain: false }),
    rise: look('quake', 0.74, 1, 0.55, 1),
    rubble: look('rubble', 0.55, 1, 1.1, 0.75),
    echo: look('quake', 0.62, 0.9, 0.3, 1),
    rush: look('quake', 0.66, 1, 0.5, 1, { curtain: false }),
    resonance: look('quake', 0.3, 0.7, 0.9, 0.8, { rim: 0.9, curtain: false }),
    song: look('quake', 0.22, 0.6, 0.45, 0.6, { rim: 0.85 }),
    crater: look('quake', 0.8, 1, 0.7, 1, { rim: 0.9, curtain: false }),
  };

/** Per kind. Every one in the frost paint; the threat colour stays the
 *  owner's (the kit's edge). The cone and the lane wear the longest shards
 *  (their edges are what a player dodges across); the crack opens to black
 *  water; the freeze's ring rides a frozen body, so it goes without the kit's
 *  curtain, and so does every other (a pale curtain washed the frost out). */
export const QUENCH_TELEGRAPH_LOOKS: Readonly<Record<QuenchTelegraphKind, PaintedTelegraphLook>> = {
  breath: look('frost', 0.72, 1, 0.42, 1, { spin: 1.3, curtain: false }),
  crack: look('frost', 0.7, 1, 0.75, 1, { spin: 0.7, flow: 1, curtain: false }),
  splash: look('frost', 0.6, 0.9, 0.6, 0.9, { spin: 0.9, curtain: false }),
  slash: look('frost', 0.7, 1, 0.55, 1, { spin: 0.85, curtain: false }),
};

/** The glow passes' encounter rungs, each over every char rung of its owner
 *  (BreathFightFx's fans 6 to 13, BreathFx's exhale ring 10, CouncilFx's
 *  rubble 12, marks and spots 14, the Echo's and the Song's outer ring 16), so
 *  an owner's multiplies all land before its sums and crossing marks commute. */
export const BREATH_TELEGRAPH_GLOW_STEP = 14;
export const BREATH_GUST_GLOW_STEP = 15;
export const COUNCIL_TELEGRAPH_GLOW_STEP = 17;
/** The Quench's glow rung: over every char rung of its owners (QuenchFx's
 *  cone 10; QuenchFightFx's cracks 8, shatter rings 10, lanes 11). */
export const QUENCH_TELEGRAPH_GLOW_STEP = 13;

/** The crater a Falling Rock leaves where it lands (cosmetic: no threat
 *  colour on its edge, the soak is over): the rock's own size, split stone
 *  settling for `seconds`. */
export const ROCK_CRATER = {
  /** Its radius as a share of the soak's. */
  share: 0.72,
  seconds: 4,
  /** Seconds the dark pit (the rock's shadow, carried on) holds. */
  pitSeconds: 1.8,
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

/** The crater's pit at `age` seconds: the falling rock's shadow carried on
 *  into the crater from the very impact frame (so the hit reads dark and
 *  heavy, never a pale flash over the floor), shrinking into the pit over
 *  its first seconds. `share` of the crater's radius (0: gone), `near` its
 *  darkness and edge (rockShadowLook). */
export function craterPit(
  age: number,
  out: { share: number; near: number } = { share: 0, near: 0 },
): { share: number; near: number } {
  if (age < 0 || age >= ROCK_CRATER.pitSeconds) {
    out.share = 0;
    out.near = 0;
    return out;
  }
  const t = age / ROCK_CRATER.pitSeconds;
  out.share = 1.05 * (1 - t * t);
  out.near = 1 - t;
  return out;
}

/** The crater's fissures cooling: white hot at the impact, dull ember by
 *  its end (the paint's `uHeat`). */
export function craterHeat(age: number): number {
  const T = ROCK_CRATER.seconds;
  if (age < 0 || age >= T) return 0;
  return (1 - age / T) ** 1.6;
}

/** The stone's crescendo as the Falling Rock drops (the paint's `uHeat`):
 *  a low ember while it hangs, rising through its last fall of `fallSeconds`
 *  to full at the landing. */
export function rockCrescendo(remaining: number, fallSeconds: number): number {
  if (remaining <= 0) return 1;
  if (remaining >= fallSeconds) return 0.12;
  const t = 1 - remaining / fallSeconds;
  return 0.12 + 0.88 * t * t;
}

/** The rock's shadow under the soak, drawn by the stone paint's char pass
 *  (so the fissures glow through it): its radius as a share of the soak's
 *  (`share`, from soakCountdown) and `near` 0..1 (the rock's approach) to its
 *  darkness and its edge, soft and pale while the rock hangs high, black and
 *  crisp as it lands. Mirrored in council_telegraph_glsl.ts. */
export function rockShadowLook(near: number): { dark: number; soft: number } {
  const n = Math.max(0, Math.min(1, near));
  return { dark: 0.55 + 0.4 * n ** 0.6, soft: 0.55 - 0.47 * n ** 0.8 };
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
