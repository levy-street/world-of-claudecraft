// The Guardian of the Heat's death as numbers, "The fire goes home": the
// pure half of heat_death_fx.ts. The counterpart of its entrance
// (heat_entrance_core.ts: cold coal, the spiral, its fire climbing from its
// foot to its crown, the ring of fire racing out): here it all runs back.
//
//   the choke   its fire is sucked inward: flames and embers drawn in from
//               the air round it into its heart, a ring of fire closing in
//               across the floor onto it (the entrance's ring, reversed);
//               its flames roar a breath, then shrink
//   the gutter  its flames gutter and go out from its crown down (the
//               entrance lit them foot to crown); its eyes and the vortex at
//               its foot die; its body blazes white-hot, then cools through
//               red to black coal with glowing cracks
//   the exhale  a last great breath of embers and smoke out of its chest,
//               spiralling up into the dark
//   the cracks  the glowing cracks on the coal husk die one by one, each
//               with a wisp of smoke
//   the crumble the husk crumbles a little: chunks of basalt falling off it,
//               a slide of ash
// The Hearth's heat dims with it: the wellspring crusts over (the entrance's
// kindling run back, read by heat_well_fx.ts through heat_entrance_state.ts),
// its flames and vortex out (heat_body.ts reads the same look).
//
// Presentation only: no camera, no input, nothing held back from loot or
// exit. A guardian first seen long dead is a cold coal husk; a dev replay
// (`/dev heart heat death`) plays it on the living body and gives the fire
// back. Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a
// hash, never rng).

import { HEAT_SOCKETS, type HeatSocketId, heatSocketIndex } from './heat_body_core';
import { type HeatEntranceLook, SOCKET_HEIGHT } from './heat_entrance_core';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const spike = (since: number, span: number) =>
  since < 0 ? 0 : Math.min(1, since / 0.05) * (1 - clamp01(since / span)) ** 2;

/** Deterministic hash in [0, 1). */
export function heatDeathHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash = heatDeathHash;

/** The scene's beats (seconds after it fell). */
export const HEAT_DEATH = {
  /** The choke: the fire drawn into it, the ring closing in. */
  chokeTo: 1.3,
  /** The ring of fire closing in: from this far (yards) onto it. */
  ringFrom: 34,
  /** Its flames go out crown first, from `gutterFrom`, each over
   *  `gutterEach`, the last by `gutterTo`. */
  gutterFrom: 1.2,
  gutterTo: 2.7,
  gutterEach: 0.45,
  /** White-hot at its peak, red by `redAt`, black coal by `coldAt`. */
  hotAt: 1.25,
  redAt: 2.8,
  coldAt: 4.3,
  /** The last great exhale of embers and smoke, and how long its spiral
   *  climbs. */
  exhaleAt: 2.95,
  spiralFor: 2.2,
  /** The cracks die one by one between these. */
  cracksFrom: 4.3,
  cracksTo: 6.3,
  /** The husk crumbles. */
  crumbleAt: 6.15,
  end: 7.6,
} as const;

/** The camera's thuds (none under reduced motion). */
export const HEAT_DEATH_SHAKES = {
  choke: { amount: 0.3, reach: 90 },
  exhale: { amount: 0.55, reach: 110 },
  crumble: { amount: 0.25, reach: 60 },
} as const;

export function heatDeathShake(
  amount: number,
  reach: number,
  distance: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || distance >= reach) return 0;
  return amount * (1 - (distance / reach) * 0.6);
}

/** Reduced motion keeps every flash and flare, never a blaze. */
export const HEAT_DEATH_CALM = { flash: 0.65, lightCap: 0.75 } as const;

export function heatDeathLight(v: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(v * HEAT_DEATH_CALM.flash, HEAT_DEATH_CALM.lightCap) : v;
}

/** Did the scene cross `at` between `prev` and `t` (once, only for a scene
 *  seen crossing it)? */
export function heatDeathCrossed(prev: number, t: number, at: number): boolean {
  return prev >= 0 && prev < at && t >= at && t - at < 0.5;
}

// ---- the clock -----------------------------------------------------------------------------

/** A dev replay plays this long, then the fire comes back. */
export const HEAT_REPLAY_SECONDS = HEAT_DEATH.end + 0.6;

/** The scene's clock: seconds since it fell at `deadAt` (a corpse first seen
 *  dead is dated long past), or since a dev replay began at `replayAt`
 *  (-1 none); -1 when neither (it burns). */
export function heatDeathTime(
  clock: number,
  deadAt: number,
  replayAt: number,
  dead: boolean,
): number {
  if (dead) return clock - deadAt;
  if (replayAt >= 0 && clock >= replayAt && clock - replayAt < HEAT_REPLAY_SECONDS)
    return clock - replayAt;
  return -1;
}

// ---- the body's fire, through the entrance's seam ------------------------------------------

/** When socket `i` (HEAT_SOCKETS order) goes out: the crown first, the
 *  lowest last (the entrance lit them foot to crown). */
export function socketOutAt(i: number): number {
  const D = HEAT_DEATH;
  const h = SOCKET_HEIGHT[i] ?? 0;
  return D.gutterFrom + (1 - h) * (D.gutterTo - D.gutterEach - D.gutterFrom);
}

/** The model's skin through the scene: its emissive's share of the authored
 *  (`glow`: past 1 white-hot, falling through red to the cracks' last light,
 *  then out) and its colour's share (`coal`: past 1 whitened, 0.24 black
 *  coal). */
export function heatDeathSkin(t: number, out: { glow: number; coal: number }) {
  const D = HEAT_DEATH;
  if (t < 0) {
    out.glow = 1;
    out.coal = 1;
    return out;
  }
  const hot = smooth(0.15, D.hotAt, t);
  const toRed = smooth(D.hotAt, D.redAt, t);
  const toCold = smooth(D.redAt, D.coldAt, t);
  // White-hot 3.6, red 0.9, the cracks' glow 0.35, out as they die.
  let glow = 1 + 2.6 * hot;
  glow = glow + (0.9 - glow) * toRed;
  glow = glow + (0.35 - glow) * toCold;
  glow *= 0.1 + 0.9 * (1 - heatCracksGone(t));
  out.glow = Math.max(0.03, glow);
  let coal = 1 + 0.6 * hot;
  coal = coal + (0.62 - coal) * toRed;
  coal = coal + (0.24 - coal) * toCold;
  out.coal = coal;
  return out;
}

/** The share of the cracks gone dark at `t` (0 all lit, 1 all out). */
export function heatCracksGone(t: number): number {
  let n = 0;
  for (const c of HEAT_CRACKS) if (t >= c.outAt) n++;
  return n / HEAT_CRACKS.length;
}

/** The scene's look at `t` in the entrance's shape (heat_entrance_state.ts
 *  holds it for the body's fire and the wellspring): every socket's flame,
 *  the eyes, the vortex, the wellspring's heat, the skin. `replay`: the fire
 *  given back at its end. Allocation free. */
export function heatDeathBodyLook(t: number, out: HeatEntranceLook): HeatEntranceLook {
  const D = HEAT_DEATH;
  out.active = true;
  out.death = true;
  out.cold = false;
  out.t = 0;
  out.spiral = 1;
  out.ash = 0;
  out.embers = 0;
  out.trail = 0;
  out.front = 1;
  out.crown = 0;
  out.haze = 0;
  out.sparks = 0;
  out.rage = 0;
  out.cracks = 0;
  out.crackHeat = 0;
  out.rain = 0;
  out.sinceBlast = -99;
  out.columnH = 0;
  out.columnR = 0;
  out.column = 0;
  out.ringR = 0;
  out.ring = 0;
  out.flash = 0;
  out.smoke = 0;
  const tt = Math.max(0, t);
  // The flames roar a breath as the fire is drawn in, then shrink and gutter.
  const roar = 1 + 0.45 * spike(tt - 0.1, 0.9);
  const choke = 1 - 0.35 * smooth(0.3, D.chokeTo, tt);
  for (let i = 0; i < out.socket.length; i++) {
    const at = socketOutAt(i);
    const gutter = 1 - smooth(at, at + D.gutterEach, tt);
    // A last flicker as it goes.
    const flick = tt > at && tt < at + D.gutterEach ? 0.75 + 0.25 * Math.sin(tt * 40 + i * 3) : 1;
    out.socket[i] = roar * choke * gutter * flick;
  }
  out.fire = 1 - smooth(D.gutterFrom, D.gutterTo, tt);
  out.eyes =
    Math.max(0, 1 - smooth(0.9, 2.1, tt)) *
    (tt > 1.4 && tt < 2.1 ? 0.6 + 0.4 * Math.sin(tt * 31) : 1);
  out.vortex = 1 - smooth(0.4, 1.9, tt);
  out.well = 1 - 0.86 * smooth(1.0, 5.0, tt);
  heatDeathSkin(tt, _skin);
  out.glow = _skin.glow;
  out.coal = _skin.coal;
  return out;
}
const _skin = { glow: 1, coal: 1 };

// ---- the choke: the ring closing in --------------------------------------------------------

/** The ring of fire closing in across the floor onto it (yards; 0 gone) and
 *  its strength. */
export function heatChokeRing(t: number, out: { r: number; k: number }) {
  const D = HEAT_DEATH;
  if (t < 0 || t >= D.chokeTo) {
    out.r = 0;
    out.k = 0;
    return out;
  }
  const k = clamp01(t / D.chokeTo);
  // Fast at first, slowing as it chokes onto the body.
  out.r = D.ringFrom * (1 - k) ** 1.6 + 2;
  out.k = smooth(0, 0.15, t) * (1 - smooth(D.chokeTo - 0.25, D.chokeTo, t));
  return out;
}

/** How strongly the fire is drawn in (0..1): the inward flames' rate. */
export function heatChokeDraw(t: number): number {
  const D = HEAT_DEATH;
  if (t < 0) return 0;
  return smooth(0, 0.25, t) * (1 - smooth(D.chokeTo - 0.2, D.chokeTo + 0.25, t));
}

/** The exhale's spiral of smoke and embers (0..1 strength). */
export function heatExhale(t: number): number {
  const D = HEAT_DEATH;
  const s = t - D.exhaleAt;
  if (s < 0 || s >= D.spiralFor) return 0;
  return smooth(0, 0.12, s) * (1 - smooth(D.spiralFor * 0.4, D.spiralFor, s));
}

/** The exhale's corkscrew: `arms` bright ember trails winding up round one
 *  axis out of its chest, `turn` radians a second, widening from `r0` by
 *  `grow` yards a second and climbing `climb` yards a second; the trail is
 *  laid every `step` yards of a head's path (before the tier's share). */
export const HEAT_SPIRAL = {
  arms: 3,
  turn: 5.2,
  r0: 1.8,
  grow: 2.2,
  climb: 8.5,
  step: 0.32,
} as const;

/** Where spiral arm `arm`'s head is `s` seconds after the exhale, off the
 *  heart (yards; y up). Allocation free. */
export function heatSpiralHead(s: number, arm: number, out: { x: number; y: number; z: number }) {
  const S = HEAT_SPIRAL;
  const ss = Math.max(0, s);
  const a = ss * S.turn + (arm * Math.PI * 2) / S.arms;
  const r = S.r0 + S.grow * ss;
  out.x = Math.sin(a) * r;
  out.y = S.climb * ss;
  out.z = Math.cos(a) * r;
  return out;
}

// ---- the cracks ------------------------------------------------------------------------------

/** A glowing crack on the coal husk: the socket it glows at, when it goes
 *  out, its size (yards). */
export interface HeatCrack {
  socket: number;
  outAt: number;
  size: number;
}

const CRACK_SOCKETS: readonly HeatSocketId[] = [
  'heart',
  'shoulderL',
  'shoulderR',
  'back',
  'fistL',
  'fistR',
  'buckle',
  'hornL',
  'hornR',
  'crown',
  'eyeL',
  'vortexHigh',
];

export const HEAT_CRACKS: readonly HeatCrack[] = CRACK_SOCKETS.map((id, i) => ({
  socket: heatSocketIndex(id),
  // A shuffled order (the heart's last), spread over the cracks' span.
  outAt:
    id === 'heart'
      ? HEAT_DEATH.cracksTo
      : HEAT_DEATH.cracksFrom + (HEAT_DEATH.cracksTo - HEAT_DEATH.cracksFrom - 0.2) * hash(i, 41),
  size: 1.6 + 1.6 * hash(i, 43),
}));

/** A crack's light at `t` (0 out): lit from the cooling, a last flare as it
 *  dies, then dark. */
export function heatCrackLevel(c: HeatCrack, t: number): number {
  const D = HEAT_DEATH;
  if (t < D.redAt || t >= c.outAt + 0.18) return 0;
  const on = smooth(D.redAt, D.coldAt, t);
  const flare = Math.exp(-(((t - c.outAt) * 9) ** 2)) * 0.9;
  const fade = t > c.outAt ? 1 - (t - c.outAt) / 0.18 : 1;
  return (on * (0.75 + 0.15 * Math.sin(t * 6 + c.socket)) + flare) * fade;
}

// ---- the crumble -----------------------------------------------------------------------------

/** One chunk of basalt falling off the husk: the socket it breaks from, its
 *  heading (radians off the body's facing), how far out and up it is
 *  thrown, its size and spin, its delay after the crumble. */
export interface HeatChunk {
  socket: number;
  angle: number;
  out: number;
  up: number;
  size: number;
  spin: number;
  delay: number;
}

const CHUNK_SOCKETS: readonly HeatSocketId[] = [
  'shoulderL',
  'shoulderR',
  'back',
  'hornL',
  'hornR',
  'crown',
  'fistL',
  'fistR',
];

export const HEAT_CHUNKS: readonly HeatChunk[] = Array.from({ length: 16 }, (_, i) => ({
  socket: heatSocketIndex(CHUNK_SOCKETS[i % CHUNK_SOCKETS.length]),
  angle: (hash(i, 51) * 2 - 1) * Math.PI,
  out: 1 + 3.5 * hash(i, 53),
  up: 0.5 + 3 * hash(i, 57),
  size: 0.5 + 1.1 * hash(i, 59) ** 1.4,
  spin: 1.5 + 5 * hash(i, 61),
  delay: 0.5 * hash(i, 67),
}));

export const HEAT_CHUNK_GRAVITY = 28;

/** A chunk `since` seconds after the crumble, `drop` yards over the floor:
 *  out, up (from its birth), its tumble, landed. A husk long dead keeps its
 *  chunks lying at its feet. */
export function heatChunkAt(
  c: HeatChunk,
  since: number,
  drop: number,
  out: { out: number; y: number; turn: number; landed: boolean; shown: boolean },
) {
  const t = since - c.delay;
  if (t < 0) {
    out.shown = false;
    out.landed = false;
    out.out = 0;
    out.y = 0;
    out.turn = 0;
    return out;
  }
  const g = HEAT_CHUNK_GRAVITY;
  const d = Math.max(0, drop);
  const land = (c.up + Math.sqrt(c.up * c.up + 2 * g * d)) / g;
  const ft = Math.min(t, land);
  out.shown = true;
  out.out = c.out * ft;
  out.y = t < land ? c.up * t - 0.5 * g * t * t : -d;
  out.turn = c.spin * ft;
  out.landed = t >= land;
  return out;
}

/** The low tier's share of a plan: every k-th kept (the shape whole). */
export function heatDeathKept(i: number, share: number): boolean {
  if (share >= 1) return true;
  const k = Math.max(1, Math.round(1 / Math.max(0.05, share)));
  return i % k === 0;
}

// ---- the sounds ------------------------------------------------------------------------------

export interface HeatDeathSound {
  at: number;
  key: string;
  gain: number;
  rate: number;
}

/** The scene's sounds (the raid's own samples; the guardian's death line is
 *  the sim's and plays over them). */
export const HEAT_DEATH_SOUNDS: readonly HeatDeathSound[] = [
  { at: 0.02, key: 'heart_heat_fist_charge', gain: 0.9, rate: 1.35 },
  { at: 0.05, key: 'heart_heat_sink', gain: 0.9, rate: 0.75 },
  { at: HEAT_DEATH.chokeTo - 0.1, key: 'heart_final_overload_pulse', gain: 0.7, rate: 0.6 },
  { at: HEAT_DEATH.gutterFrom + 0.2, key: 'heart_heat_settle', gain: 0.9, rate: 0.7 },
  { at: HEAT_DEATH.exhaleAt - 0.05, key: 'heart_heat_swell', gain: 1, rate: 0.55 },
  { at: HEAT_DEATH.exhaleAt, key: 'heart_heat_cinder_burst', gain: 1, rate: 0.6 },
  ...HEAT_CRACKS.map((c, i) => ({
    at: c.outAt,
    key: 'heart_heat_seed',
    gain: 0.35,
    rate: 0.55 + 0.04 * (i % 5),
  })),
  { at: HEAT_DEATH.crumbleAt, key: 'heart_council_rock_fall', gain: 0.8, rate: 0.7 },
  { at: HEAT_DEATH.crumbleAt + 0.35, key: 'heart_council_slab_grind', gain: 0.6, rate: 0.5 },
];

/** The gestures (characters/smith_heart_boss_looks.ts binds the fall: its
 *  Death clip on the living body for a dev replay). */
export const HEAT_DEATH_GESTURES = {
  fall: 'smith_heart_heat_death_fall',
} as const;

/** The particles' rates (a second, before the tier's share). */
export const HEAT_DEATH_RATES = {
  /** Flames and embers drawn in. */
  draw: 260,
  /** The ring of fire's flames. */
  ring: 340,
} as const;

/** The sockets the choke draws into (the heart) and the exhale leaves by. */
export const HEAT_DEATH_HEART = heatSocketIndex('heart');
/** Every socket, for the plan's tests. */
export const HEAT_DEATH_SOCKETS = HEAT_SOCKETS.length;
