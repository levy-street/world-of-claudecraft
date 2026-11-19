// Pure collision-aware PLACEMENT for the vivid floating combat text: which lane a new
// number rises in and how far its start is nudged, so it never lands on top of a number
// that is still on screen. Host-agnostic and DETERMINISTIC (NO Math.random, NO clock, NO
// DOM; registered in UI_PURE_CORES), so a Node test drives it directly and the FCT painter
// stays a thin consumer.
//
// WHY. The fan-out used to deal lanes in a fixed rotation, and every lane started from the
// same head point. A burst of more than four numbers inside one floater life reused a lane
// from the same spot (the fifth hit sat exactly on the first), every crit popped in one
// centre column, and everything over the player (damage taken, heals, absorbs, avoidance
// words) rose up that same column. This core predicts where each live floater WILL be over
// the new one's life and picks the first lane and nudge with nothing in the way.
//
// HOW. Every vivid lane has a fixed START offset from the anchor (written once into left /
// top at spawn) and a fixed TRAVEL path (the static @keyframes in hud.css / hud.mobile.css,
// run with a linear timing function so this model is exact). All lanes share the same
// vertical profile, so two numbers in one lane keep the vertical gap they started with for
// their whole life: separating them at birth separates them for good. Placement samples the
// new floater's opaque life against every live floater's predicted box and takes the first
// candidate with no overlap: every lane unpushed first (spread sideways before stacking),
// then each lane nudged down, then up. When nothing is clear (a huge AoE burst), it takes
// the candidate with the least overlap, so a number is never refused, only placed as well as
// the screen allows.
//
// Presentation only: nothing here feeds the sim, and every number still shows in full, so
// the graphics-fairness rule is untouched. Classic Combat Text never reaches this core.

/** A vivid lane: centre, near-left, near-right, far-left, far-right. */
export type FctLane = 'c' | 'l' | 'r' | 'll' | 'rr';

/** One point of a lane's travel: at fraction `f` of the animation, offset (dx, dy) in px. */
export interface FctWaypoint {
  readonly f: number;
  readonly dx: number;
  readonly dy: number;
}

/** The screen geometry of one device class (desktop or touch). All lengths in author px. */
export interface FctLayoutProfile {
  /** Where each lane starts, relative to the projected head anchor. */
  readonly start: Readonly<Record<FctLane, { readonly x: number; readonly y: number }>>;
  /** Each lane's travel from its start, mirrored 1:1 by its static @keyframes. */
  readonly path: Readonly<Record<FctLane, readonly FctWaypoint[]>>;
  /** Font sizes the CSS gives each class of floater, before --fct-scale. */
  readonly fontPx: {
    readonly normal: number;
    readonly lane: number;
    readonly crit: number;
    readonly minor: number;
  };
  /** Step of one nudge; a nudged number starts this many px below (or above) its lane start. */
  readonly nudgePx: number;
}

/**
 * Shared vertical profile of every lane (desktop): a quick first third, then a steady climb.
 * Kept identical across lanes on purpose (see HOW above). The @keyframes in hud.css carry
 * these exact numbers and tests/fct_layout_core.test.ts pins the two together.
 */
const RISE_EARLY = -30;
const RISE_END = -96;
const MOBILE_RISE_EARLY = -20;
const MOBILE_RISE_END = -64;
/** Fraction of the animation the quick first leg takes. */
export const FCT_LANE_EARLY_F = 0.3;

function path(dxEarly: number, dxEnd: number, early: number, end: number): readonly FctWaypoint[] {
  return [
    { f: 0, dx: 0, dy: 0 },
    { f: FCT_LANE_EARLY_F, dx: dxEarly, dy: early },
    { f: 1, dx: dxEnd, dy: end },
  ];
}

export const FCT_LAYOUT_DESKTOP: FctLayoutProfile = {
  start: {
    c: { x: 0, y: 0 },
    l: { x: -40, y: 8 },
    r: { x: 40, y: 8 },
    ll: { x: -86, y: 22 },
    rr: { x: 86, y: 22 },
  },
  path: {
    c: path(0, 0, RISE_EARLY, RISE_END),
    l: path(-12, -20, RISE_EARLY, RISE_END),
    r: path(12, 20, RISE_EARLY, RISE_END),
    ll: path(-18, -30, RISE_EARLY, RISE_END),
    rr: path(18, 30, RISE_EARLY, RISE_END),
  },
  fontPx: { normal: 17, lane: 19, crit: 30, minor: 15 },
  nudgePx: 26,
};

export const FCT_LAYOUT_MOBILE: FctLayoutProfile = {
  start: {
    c: { x: 0, y: 0 },
    l: { x: -26, y: 6 },
    r: { x: 26, y: 6 },
    ll: { x: -60, y: 16 },
    rr: { x: 60, y: 16 },
  },
  path: {
    c: path(0, 0, MOBILE_RISE_EARLY, MOBILE_RISE_END),
    l: path(-8, -14, MOBILE_RISE_EARLY, MOBILE_RISE_END),
    r: path(8, 14, MOBILE_RISE_EARLY, MOBILE_RISE_END),
    ll: path(-12, -20, MOBILE_RISE_EARLY, MOBILE_RISE_END),
    rr: path(12, 20, MOBILE_RISE_EARLY, MOBILE_RISE_END),
  },
  fontPx: { normal: 14, lane: 15, crit: 20, minor: 12 },
  nudgePx: 21,
};

/** Average glyph advance of the bold display face, as a share of the font size. */
export const FCT_GLYPH_W = 0.62;
/** Line box height as a share of the font size. */
export const FCT_LINE_H = 1.15;
/** Breathing room kept around every box, so neighbours never touch. */
export const FCT_PAD_PX = 3;
/** How much bigger a crit reads while its pop plays (the scale overshoot), as a box factor. */
export const FCT_CRIT_POP_BOX = 1.3;
/** The share of its life a crit's pop lasts (the scale keyframes settle by about here). */
export const FCT_CRIT_POP_F = 0.3;
/**
 * The share of its life a floater still counts as an obstacle. Vivid numbers hold full
 * opacity to 60% and are nearly gone by here; a nearly faded number may be overlapped.
 */
export const FCT_SOLID_F = 0.8;
/** Points of the new floater's life sampled for a collision (its readable stretch). */
export const FCT_SAMPLES: readonly number[] = [0, 0.08, 0.16, 0.24, 0.32, 0.42, 0.52, 0.62, 0.72];
/** Nudge steps tried after every lane is taken unpushed: down first, then up. */
export const FCT_NUDGES: readonly number[] = [1, -1, 2, -2, 3];

/** A floater already on screen, as the painter recorded it at spawn (structural). */
export interface FctPlaced {
  /** Start centre in author px (anchor + lane start + nudge + jitter). */
  x: number;
  y: number;
  /** Box size in author px, as estimated at spawn. */
  w: number;
  h: number;
  lane: FctLane;
  crit: boolean;
  bornAt: number;
  /** Animation length in ms (the floater's TTL). */
  durMs: number;
}

/** What the painter asks for a new floater. */
export interface FctPlaceRequest {
  /** Projected anchor in author px, horizontal jitter already applied. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly crit: boolean;
  readonly durMs: number;
  /** Lanes to try, best first. */
  readonly lanes: readonly FctLane[];
  /**
   * Combat Text Size (the --fct-scale setting). Lane starts and the nudge step grow with
   * the text so bigger numbers keep the same spacing. Absent reads as 1.
   */
  readonly textScale?: number;
}

/** The answer: the lane, and the start centre to write (lane start and nudge applied). */
export interface FctPlacement {
  lane: FctLane;
  x: number;
  y: number;
  /** Nudge step taken (0 = the lane's own start). */
  nudge: number;
}

/** A lane's travel offset at fraction `f` of its life (piecewise linear, as the CSS runs). */
export function laneOffset(
  profile: FctLayoutProfile,
  lane: FctLane,
  f: number,
): { dx: number; dy: number } {
  const pts = profile.path[lane];
  const t = f <= 0 ? 0 : f >= 1 ? 1 : f;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (t <= b.f) {
      const a = pts[i - 1];
      const u = b.f === a.f ? 1 : (t - a.f) / (b.f - a.f);
      return { dx: a.dx + (b.dx - a.dx) * u, dy: a.dy + (b.dy - a.dy) * u };
    }
  }
  const last = pts[pts.length - 1];
  return { dx: last.dx, dy: last.dy };
}

/** Estimated box of a floater's text: width from its length, height from its font. */
export function fctBoxSize(text: string, fontPx: number): { w: number; h: number } {
  return {
    w: Math.max(1, text.length) * fontPx * FCT_GLYPH_W,
    h: fontPx * FCT_LINE_H,
  };
}

/** Overlap area of two centred boxes, padding included (0 when apart). */
function overlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  const ox = (aw + bw) / 2 + FCT_PAD_PX - Math.abs(ax - bx);
  if (ox <= 0) return 0;
  const oy = (ah + bh) / 2 + FCT_PAD_PX - Math.abs(ay - by);
  if (oy <= 0) return 0;
  return ox * oy;
}

/** Box growth while a crit's pop plays. */
function popScale(crit: boolean, f: number): number {
  return crit && f < FCT_CRIT_POP_F ? FCT_CRIT_POP_BOX : 1;
}

/** Total predicted overlap of a candidate start against every live floater. */
function cost(
  profile: FctLayoutProfile,
  req: FctPlaceRequest,
  lane: FctLane,
  sx: number,
  sy: number,
  live: readonly FctPlaced[],
  now: number,
): number {
  let total = 0;
  for (let s = 0; s < FCT_SAMPLES.length; s++) {
    const f = FCT_SAMPLES[s];
    const t = now + f * req.durMs;
    const me = laneOffset(profile, lane, f);
    const k = popScale(req.crit, f);
    const mx = sx + me.dx;
    const my = sy + me.dy;
    for (let i = 0; i < live.length; i++) {
      const o = live[i];
      const of = o.durMs > 0 ? (t - o.bornAt) / o.durMs : 1;
      if (of < 0 || of > FCT_SOLID_F) continue;
      const op = laneOffset(profile, o.lane, of);
      const ok = popScale(o.crit, of);
      total += overlap(mx, my, req.w * k, req.h * k, o.x + op.dx, o.y + op.dy, o.w * ok, o.h * ok);
    }
  }
  return total;
}

/**
 * Place a new floater: the first lane and nudge, in preference order, whose whole readable
 * life clears every live floater; failing that, the candidate with the least overlap.
 * Unpushed lanes are all tried before any nudge, so a burst spreads sideways first and only
 * stacks once every lane is busy. Pure: same request, same live set, same answer.
 */
export function placeFct(
  profile: FctLayoutProfile,
  req: FctPlaceRequest,
  live: readonly FctPlaced[],
  now: number,
): FctPlacement {
  const lanes = req.lanes.length > 0 ? req.lanes : (['c'] as const);
  const k = req.textScale ?? 1;
  let best: FctPlacement | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let n = -1; n < FCT_NUDGES.length; n++) {
    const nudge = n < 0 ? 0 : FCT_NUDGES[n];
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      const st = profile.start[lane];
      const sx = req.x + st.x * k;
      const sy = req.y + st.y * k + nudge * profile.nudgePx * k;
      const c = cost(profile, req, lane, sx, sy, live, now);
      if (c === 0) return { lane, x: sx, y: sy, nudge };
      if (c < bestCost) {
        bestCost = c;
        best = { lane, x: sx, y: sy, nudge };
      }
    }
  }
  return best as FctPlacement;
}

/**
 * Who a floater is about, which decides where it prefers to rise: your own outgoing hit,
 * your pet's or guardian's hit, damage you took, a heal, an absorb or avoidance word over
 * you, or an informational floater.
 */
export type FctRole = 'out' | 'pet' | 'in' | 'heal' | 'guard' | 'info';

/** The size class of a floater, which picks its font size (and so its box). */
export type FctSizeClass = 'normal' | 'lane' | 'crit' | 'minor';

/** The font size, in author px, a profile gives a size class at a Combat Text Size. */
export function fctFontPx(
  profile: FctLayoutProfile,
  size: FctSizeClass,
  textScale: number,
): number {
  return profile.fontPx[size] * textScale;
}

/** The four side lanes in their alternating order (near-left, near-right, far-left, far-right). */
const SIDE_LANES: readonly FctLane[] = ['l', 'r', 'll', 'rr'];

/** Every rotation of the side lanes, built once so a spawn allocates no preference list. */
const OUT_PREFS: readonly (readonly FctLane[])[] = SIDE_LANES.map((_, o) => [
  ...SIDE_LANES.slice(o),
  ...SIDE_LANES.slice(0, o),
  'c',
]);
const OUT_CRIT_PREFS: readonly (readonly FctLane[])[] = SIDE_LANES.map((_, o) => [
  'c',
  ...SIDE_LANES.slice(o),
  ...SIDE_LANES.slice(0, o),
]);
const PET_PREFS: readonly (readonly FctLane[])[] = [
  ['ll', 'rr', 'l', 'r', 'c'],
  ['rr', 'll', 'r', 'l', 'c'],
];
const IN_PREFS: readonly FctLane[] = ['c', 'l', 'r', 'll', 'rr'];
const HEAL_PREFS: readonly FctLane[] = ['r', 'rr', 'c', 'l', 'll'];
const GUARD_PREFS: readonly FctLane[] = ['l', 'll', 'c', 'r', 'rr'];
const INFO_PREFS: readonly FctLane[] = ['c', 'l', 'r'];

/**
 * The lane preference for one floater. `ordinal` rotates which side lane an outgoing number
 * tries first, so with nothing on screen consecutive numbers still alternate sides exactly
 * like the old fan-out. Roles:
 *  - your own outgoing hits: the side lanes, rotating; a crit wants the centre first;
 *  - a pet's or guardian's hit: the far lanes first, so your own numbers keep the near ones;
 *  - incoming damage over you: the centre first, then the near lanes;
 *  - a heal: the right side first; an absorb or avoidance word over you: the left side
 *    first, so the three things that happen to you rise in three different places;
 *  - informational floaters (xp, Honor, a self note): the centre.
 */
export function fctLanePrefs(role: FctRole, crit: boolean, ordinal: number): readonly FctLane[] {
  switch (role) {
    case 'out': {
      const n = SIDE_LANES.length;
      const o = ((ordinal % n) + n) % n;
      return crit ? OUT_CRIT_PREFS[o] : OUT_PREFS[o];
    }
    case 'pet':
      return PET_PREFS[((ordinal % 2) + 2) % 2];
    case 'in':
      return IN_PREFS;
    case 'heal':
      return HEAL_PREFS;
    case 'guard':
      return GUARD_PREFS;
    case 'info':
      return INFO_PREFS;
  }
}
