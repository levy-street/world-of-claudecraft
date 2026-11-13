// The Guardian of the Quench's death as numbers, "Frozen from within": the
// pure half of quench_death_fx.ts. The counterpart of her entrance
// (quench_entrance_core.ts, "Under the ice": a web of cracks racing out from
// her across the lake, the breach, her blades rising out of the ice): here
// the cold takes her and the lake closes over the wound.
//
//   the freeze   a cold light blooms in her heart and frost races out over
//                her from the inside, her body glazed to an ice statue from
//                the heart out (her own material's statue glaze)
//   the blades   her floating swords of ice lose their hold: they fall one by
//                one and spear into the lake round her, each with a star of
//                cracks and a spray of ice
//   the crack    a deep crack: she splits into a lattice of glowing seams
//                running over her body, held a beat, pulsing brighter
//   the shatter  the statue's shell bursts into glittering shards and frost
//                mist (the corpse stays, a dull husk of clear ice, its loot
//                where it always is)
//   the calm     the lake's cracks heal from their tips back to her, the
//                blades sink away, the ice settles into a still mirror-calm
//                sheet with snow drifting down over it
//
// Presentation only: no camera, no input, nothing held back from loot or
// exit. A guardian first seen long dead is the husk in the calm, none of the
// scene; a dev replay (`/dev heart quench death`) plays it on her living
// body and stands her back up. Node-only (RENDER_PURE_CORES): no three.js,
// no DOM, deterministic (a hash, never rng).

import { QUENCH_SOCKETS, type QuenchSocketId, quenchSocketIndex } from './quench_body_core';
import { QUENCH_ENTRANCE_BLADES } from './quench_entrance_core';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const spike = (since: number, span: number) =>
  since < 0 ? 0 : Math.min(1, since / 0.05) * (1 - clamp01(since / span)) ** 2;

/** Deterministic hash in [0, 1). */
export function quenchDeathHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash = quenchDeathHash;

/** The scene's beats (seconds after she fell). */
export const QUENCH_DEATH = {
  /** The cold light blooms in her heart; the frost races out over her from
   *  `freezeFrom`, the statue whole by `frozenAt`. */
  bloomTo: 0.5,
  freezeFrom: 0.2,
  frozenAt: 1.9,
  /** The blades fall: the first lets go at `bladesFrom`, each next
   *  `bladeStagger` later. */
  bladesFrom: 0.55,
  bladeStagger: 0.17,
  /** The deep crack and the lattice of seams running over her. */
  crackAt: 2.3,
  seamsFor: 0.5,
  /** The beat held, then the shatter. */
  shatterAt: 3.75,
  /** The lake's cracks: grown out by `webTo`, healing from `healFrom` to
   *  `healTo` (tips back to her). */
  webTo: 2.6,
  healFrom: 4.7,
  healTo: 7.4,
  /** The blades sink away. */
  sinkFrom: 6.4,
  sinkTo: 7.8,
  /** The mirror-calm sheet fades in over the lake, and the snow drifts. */
  calmFrom: 5.2,
  calmFull: 7.2,
  snowFrom: 4.1,
  end: 9.4,
} as const;

const D = QUENCH_DEATH;

/** The camera's thuds (none under reduced motion). */
export const QUENCH_DEATH_SHAKES = {
  blade: { amount: 0.18, reach: 70 },
  crack: { amount: 0.35, reach: 90 },
  shatter: { amount: 0.75, reach: 110 },
} as const;

export function quenchDeathShake(
  amount: number,
  reach: number,
  distance: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || distance >= reach) return 0;
  return amount * (1 - (distance / reach) * 0.6);
}

/** Reduced motion keeps every flash and seam, never a blaze or a flicker. */
export const QUENCH_DEATH_CALM = { flash: 0.6, lightCap: 0.7 } as const;

export function quenchDeathLight(v: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(v * QUENCH_DEATH_CALM.flash, QUENCH_DEATH_CALM.lightCap) : v;
}

/** Did the scene cross `at` between `prev` and `t` (once, only for a scene
 *  seen crossing it)? */
export function quenchDeathCrossed(prev: number, t: number, at: number): boolean {
  return prev >= 0 && prev < at && t >= at && t - at < 0.5;
}

// ---- the clock -----------------------------------------------------------------------------

/** A dev replay plays this long, then she stands. */
export const QUENCH_REPLAY_SECONDS = D.end + 0.6;

/** The scene's clock: seconds since she fell at `deadAt` (a corpse first
 *  seen dead is dated long past), or since a dev replay began at `replayAt`
 *  (-1 none); -1 when neither (she stands). */
export function quenchDeathTime(
  clock: number,
  deadAt: number,
  replayAt: number,
  dead: boolean,
): number {
  if (dead) return clock - deadAt;
  if (replayAt >= 0 && clock >= replayAt && clock - replayAt < QUENCH_REPLAY_SECONDS)
    return clock - replayAt;
  return -1;
}

// ---- her body, through quench_death_state.ts ----------------------------------------------

/** What her body does through the scene (quench_body.ts rides it). */
export interface QuenchDeathBodyLook {
  active: boolean;
  /** The statue glaze on her material (characters/surface_response.ts):
   *  how high it has climbed, its cold rim's light, the veins of frost
   *  light through it, how strongly it shows. */
  glazeHeight: number;
  glazeGlow: number;
  glazeBite: number;
  glazeAlpha: number;
  /** Her heart's light (past 1 blooming), her eyes, crown and bracers, and
   *  her whole light's share (0 out). */
  heart: number;
  eyes: number;
  crown: number;
  life: number;
  /** The mist rolling off her (0..1). */
  mist: number;
}

export function newQuenchDeathBodyLook(): QuenchDeathBodyLook {
  return {
    active: false,
    glazeHeight: 0,
    glazeGlow: 0,
    glazeBite: 0,
    glazeAlpha: 0,
    heart: 1,
    eyes: 1,
    crown: 1,
    life: 1,
    mist: 0,
  };
}

/** Her look at scene time `t` (allocation free). */
export function quenchDeathBodyLook(t: number, out: QuenchDeathBodyLook): QuenchDeathBodyLook {
  const tt = Math.max(0, t);
  out.active = true;
  const freeze = smooth(D.freezeFrom, D.frozenAt, tt);
  // The glaze climbs her fast (its own program runs feet up; the frost's
  // race from her heart is the painter's, over it).
  out.glazeHeight = 1.05 * freeze;
  const seams = quenchSeamLevel(tt);
  out.glazeGlow = 0.7 + 1.1 * (1 - freeze) * (tt > D.freezeFrom ? 1 : 0) + 1.2 * seams;
  out.glazeBite = freeze > 0.05 && tt < D.shatterAt ? 0.6 + 0.4 * seams : 0;
  // A clear husk of ice after the shatter: the glaze dulled, still whole.
  out.glazeAlpha =
    tt < D.freezeFrom ? 0 : Math.min(1, 0.4 + freeze) * (tt < D.shatterAt ? 1 : 0.85);
  const bloom = smooth(0, D.bloomTo, tt);
  out.heart = 1 + 1.6 * bloom * (1 - smooth(D.frozenAt, D.crackAt, tt)) + 1.4 * seams;
  out.eyes = 1 - smooth(D.freezeFrom, D.frozenAt, tt);
  out.crown = 1 + 1.2 * seams;
  out.life = 1 - smooth(D.shatterAt, D.shatterAt + 0.5, tt);
  out.mist =
    smooth(0.2, 1.2, tt) * (1 - smooth(D.end - 2, D.end, tt)) + 1.2 * spike(tt - D.shatterAt, 2);
  return out;
}

// ---- the frost racing out from her heart ---------------------------------------------------

/** The sockets the frost races out to from her heart (her limbs, her crown,
 *  her gown's hem). */
export const QUENCH_FROST_TARGETS: readonly number[] = (
  [
    'crown',
    'crownL',
    'crownR',
    'eyeL',
    'shoulderL',
    'shoulderR',
    'bracerL',
    'bracerR',
    'handL',
    'handR',
    'hem0',
    'hem2',
    'hem4',
    'hem6',
    'footL',
    'footR',
    'tipL',
    'tipR',
  ] as QuenchSocketId[]
).map(quenchSocketIndex);

/** How far the frost has raced out toward its targets at `t` (0 at the
 *  heart, 1 at the tips; -1 not yet). */
export function quenchFrostReach(t: number): number {
  if (t < D.freezeFrom) return -1;
  return smooth(D.freezeFrom, D.frozenAt - 0.2, t);
}

// ---- the blades ----------------------------------------------------------------------------

/** One floating blade: its bearing round her (off her facing; none straight
 *  before or behind her, so none stands between her and the raid), how far out, its hover height
 *  (its point), when it lets go, the tilt it lands at (radians off upright),
 *  how deep it spears in (share of its length). */
export interface QuenchDeathBlade {
  angle: number;
  r: number;
  hover: number;
  dropAt: number;
  tilt: number;
  depth: number;
}

/** The order the blades let go in (not round her: a ragged fall). */
const BLADE_ORDER = [0, 3, 1, 4, 2, 5] as const;
/** Their bearings off her facing: three a side, clear of her front and back. */
const BLADE_BEARINGS = [0.75, 1.6, 2.4, -0.75, -1.6, -2.4] as const;

export const QUENCH_DEATH_BLADES: readonly QuenchDeathBlade[] = Array.from(
  { length: QUENCH_ENTRANCE_BLADES.count },
  (_, i) => ({
    angle: BLADE_BEARINGS[i % BLADE_BEARINGS.length] + (hash(i, 2) - 0.5) * 0.2,
    r: 8.5 + 2.5 * hash(i, 3),
    hover: 6 + 2.5 * hash(i, 5),
    // Not in order round her: a ragged fall.
    dropAt: D.bladesFrom + D.bladeStagger * BLADE_ORDER[i % BLADE_ORDER.length],
    tilt: 0.12 + 0.22 * hash(i, 7),
    depth: 0.3 + 0.12 * hash(i, 11),
  }),
);

export const QUENCH_BLADE_GRAVITY = 40;

/** Blade `b` at `t`: its point's height over the ice (yards; negative in
 *  it), its tilt (0 upright, the point down), its wobble while it hangs,
 *  whether it has struck, seconds since it struck, and its sink (0 none, 1
 *  gone under). Allocation free. */
export function quenchBladeAt(
  b: QuenchDeathBlade,
  t: number,
  out: { y: number; tilt: number; wobble: number; struck: boolean; since: number; sink: number },
) {
  const L = QUENCH_ENTRANCE_BLADES.length;
  const fall = t - b.dropAt;
  const land = Math.sqrt((2 * b.hover) / QUENCH_BLADE_GRAVITY);
  out.sink = smooth(D.sinkFrom, D.sinkTo, t);
  if (fall < 0) {
    out.y = b.hover + 0.25 * Math.sin(t * 2.4 + b.angle * 3);
    out.tilt = 0;
    out.wobble = smooth(b.dropAt - 0.5, b.dropAt, t);
    out.struck = false;
    out.since = -1;
    return out;
  }
  out.wobble = 0;
  if (fall < land) {
    out.y = b.hover - 0.5 * QUENCH_BLADE_GRAVITY * fall * fall;
    out.tilt = b.tilt * (fall / land);
    out.struck = false;
    out.since = -1;
    return out;
  }
  out.struck = true;
  out.since = fall - land;
  out.tilt = b.tilt;
  // Driven in on the strike (a shudder as it bites), then held, then sunk.
  const bite = 1 - Math.exp(-out.since * 30);
  out.y = -b.depth * L * bite - out.sink * L * 1.1;
  return out;
}

// ---- the lattice of seams ------------------------------------------------------------------

/** The seams the crack runs along over her body (socket pairs), each lit
 *  in turn from her heart outward. */
export const QUENCH_SEAMS: readonly [QuenchSocketId, QuenchSocketId][] = [
  ['heart', 'core'],
  ['heart', 'shoulderL'],
  ['heart', 'shoulderR'],
  ['heart', 'hem0'],
  ['shoulderL', 'bracerL'],
  ['shoulderR', 'bracerR'],
  ['bracerL', 'handL'],
  ['bracerR', 'handR'],
  ['core', 'crown'],
  ['crown', 'crownL'],
  ['crown', 'crownR'],
  ['core', 'hem2'],
  ['core', 'hem6'],
  ['hem0', 'hem1'],
  ['hem2', 'hem3'],
  ['hem6', 'hem5'],
  ['heart', 'tipL'],
  ['core', 'tipR'],
];

/** The lattice's light at `t` (0 none): running out over `seamsFor` from the
 *  crack, held and pulsing brighter to the shatter, gone with it. */
export function quenchSeamLevel(t: number): number {
  if (t < D.crackAt || t >= D.shatterAt + 0.08) return 0;
  const on = smooth(D.crackAt, D.crackAt + D.seamsFor, t);
  const swell = 0.7 + 0.3 * smooth(D.crackAt + D.seamsFor, D.shatterAt, t);
  return on * swell;
}

/** When seam `i` lights (from her heart outward). */
export function quenchSeamAt(i: number): number {
  return D.crackAt + (D.seamsFor * i) / QUENCH_SEAMS.length;
}

// ---- the shatter ---------------------------------------------------------------------------

/** One shard of the statue's shell: the socket it bursts from, its heading
 *  (radians), its speed out and up, its size, spin. */
export interface QuenchShard {
  socket: number;
  angle: number;
  out: number;
  up: number;
  size: number;
  spin: number;
}

const SHARD_SOCKETS: readonly QuenchSocketId[] = [
  'heart',
  'core',
  'shoulderL',
  'shoulderR',
  'bracerL',
  'bracerR',
  'crown',
  'hem1',
  'hem3',
  'hem5',
  'hem7',
  'handL',
  'handR',
];

export const QUENCH_SHARDS: readonly QuenchShard[] = Array.from({ length: 40 }, (_, i) => ({
  socket: quenchSocketIndex(SHARD_SOCKETS[i % SHARD_SOCKETS.length]),
  angle: hash(i, 13) * Math.PI * 2,
  out: 5 + 9 * hash(i, 17),
  up: 2 + 7 * hash(i, 19),
  size: 0.8 + 1.4 * hash(i, 23) ** 1.5,
  spin: 3 + 8 * hash(i, 29),
}));

export const QUENCH_SHARD_GRAVITY = 26;

/** Shard `s` `since` seconds after the shatter, born `drop` yards over the
 *  ice: how far out (yards along its heading), its height off its birth, its
 *  tumble, landed, its scale (melting away after it lands). Allocation free. */
export function quenchShardAt(
  s: QuenchShard,
  since: number,
  drop: number,
  out: { out: number; y: number; turn: number; landed: boolean; scale: number },
) {
  if (since < 0) {
    out.out = 0;
    out.y = 0;
    out.turn = 0;
    out.landed = false;
    out.scale = 0;
    return out;
  }
  const g = QUENCH_SHARD_GRAVITY;
  const d = Math.max(0, drop);
  const land = (s.up + Math.sqrt(s.up * s.up + 2 * g * d)) / g;
  const ft = Math.min(since, land);
  out.landed = since >= land;
  // A skitter over the ice after it lands, slowing.
  const slide = out.landed ? (1 - Math.exp(-(since - land) * 3)) * s.out * 0.12 : 0;
  out.out = s.out * ft + slide;
  out.y = out.landed ? -d : s.up * since - 0.5 * g * since * since;
  out.turn = s.spin * ft;
  const melt = out.landed ? smooth(0.9, 2.6, since - land) : 0;
  out.scale = s.size * smooth(0, 0.05, since) * (1 - melt);
  return out;
}

// ---- the lake -------------------------------------------------------------------------------

/** The lake round her at `t`: the web of cracks (grown share `grow`, light
 *  `glow`), the mirror-calm sheet's strength, the snow's rate share, the
 *  shatter's flash. Allocation free. */
export function quenchDeathLake(
  t: number,
  out: { grow: number; glow: number; calm: number; snow: number; flash: number },
) {
  if (t < 0) {
    out.grow = 0;
    out.glow = 0;
    out.calm = 0;
    out.snow = 0;
    out.flash = 0;
    return out;
  }
  const firstStrike = D.bladesFrom + 0.4;
  const grow = smooth(firstStrike, D.webTo, t);
  const heal = smooth(D.healFrom, D.healTo, t);
  out.grow = grow * (1 - heal);
  out.glow =
    (0.6 * grow + 0.9 * spike(t - D.shatterAt, 1.4) + 0.35 * quenchSeamLevel(t)) * (1 - heal * 0.7);
  out.calm = smooth(D.calmFrom, D.calmFull, t) * (1 - smooth(D.end - 1.4, D.end, t));
  out.snow = smooth(D.snowFrom, D.snowFrom + 1.5, t) * (1 - smooth(D.end - 1, D.end, t));
  out.flash = spike(t - D.shatterAt, 0.55);
  return out;
}

/** The low tier's share of a plan: every k-th kept (the shape whole). */
export function quenchDeathKept(i: number, share: number): boolean {
  if (share >= 1) return true;
  const k = Math.max(1, Math.round(1 / Math.max(0.05, share)));
  return i % k === 0;
}

// ---- the sounds ------------------------------------------------------------------------------

export interface QuenchDeathSound {
  at: number;
  key: string;
  gain: number;
  rate: number;
}

/** The scene's sounds (her own `heart_quench_*` samples; her death line is
 *  the sim's and plays over them). */
export const QUENCH_DEATH_SOUNDS: readonly QuenchDeathSound[] = [
  { at: 0.03, key: 'heart_quench_freeze', gain: 1, rate: 0.8 },
  { at: 0.5, key: 'heart_quench_climb', gain: 0.8, rate: 0.9 },
  ...QUENCH_DEATH_BLADES.map((b, i) => ({
    at: b.dropAt + Math.sqrt((2 * b.hover) / QUENCH_BLADE_GRAVITY),
    key: 'heart_quench_bite',
    gain: 0.75,
    rate: 0.8 + 0.06 * (i % 4),
  })),
  { at: D.crackAt, key: 'heart_quench_crack', gain: 1, rate: 0.5 },
  { at: D.crackAt + 0.05, key: 'heart_quench_hole', gain: 0.7, rate: 0.55 },
  { at: D.shatterAt - 0.2, key: 'heart_quench_wake_charge', gain: 0.6, rate: 1.3 },
  { at: D.shatterAt, key: 'heart_quench_shatter', gain: 1, rate: 0.85 },
  { at: D.shatterAt + 0.05, key: 'heart_quench_shatter', gain: 0.8, rate: 1.25 },
  { at: D.healFrom, key: 'heart_quench_rim', gain: 0.5, rate: 0.8 },
  { at: D.calmFrom + 0.6, key: 'heart_quench_echo', gain: 0.45, rate: 0.85 },
];

/** The gestures (characters/smith_heart_boss_looks.ts binds the fall: her
 *  Death clip on the living body for a dev replay, held down). */
export const QUENCH_DEATH_GESTURES = {
  fall: 'smith_heart_quench_death_fall',
} as const;

/** The particles' rates (a second, before the tier's share). */
export const QUENCH_DEATH_RATES = {
  /** The frost racing out over her. */
  frost: 140,
  /** The snow drifting down over the lake at full. */
  snow: 46,
} as const;

/** The socket her heart's light and the frost's race start from. */
export const QUENCH_DEATH_HEART = quenchSocketIndex('heart');
/** Every socket, for the plan's tests. */
export const QUENCH_DEATH_SOCKETS = QUENCH_SOCKETS.length;
