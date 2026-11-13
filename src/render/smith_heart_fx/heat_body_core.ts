// The Guardian of the Heat's own model (docs/design/raid/smith_heart.md
// sections 5.16 and 7.4): the pure half of heat_body.ts. Jose's concept, built
// on the official pipeline (a T-pose turnaround, Tripo3D, a skeleton made for
// the mesh in Blender with hand-solved weights, every clip authored for it at
// 30 fps): a giant of dark basalt plates over a molten core, a crown of two
// curved horns and a central spike, a molten ring in its chest, bronze rune
// bracers and belt, great clawed rock fists (it fights bare-handed), and below
// the belt a twisting vortex of lava and rock tapering to a point. It stands
// in the first wellspring the whole fight, the vortex sunk in the lava; it
// sinks all the way under while the Hearth overflows and bursts back out.
//
// The rig plays the motion (characters/smith_heart_boss_looks.ts binds the
// clips); this module plans what the effects layer adds on top: the gesture
// ids the stance swaps answer, the clip beats the bursts are timed to, the
// sockets the fire rides (points on the model at rest, carried by their bones),
// the flame recipe per socket, the orbiting molten rocks, the cast's
// gathering, the death's cooling. Node-only (RENDER_PURE_CORES): no three.js,
// no DOM, deterministic (a hash, never rng).

import {
  HEAT_AURAS,
  HEAT_GUARDIAN,
  HEAT_GUARDIAN_SCALE,
  HEAT_STAGES,
} from '../../sim/encounters/smith_heart/heat_ids';
import type { V3 } from './final_fx_core';

export type { V3 };
export { HEAT_GUARDIAN };

// ---- the model -------------------------------------------------------------------------

/** The shipped body (public/models/creatures). */
export const HEAT_BODY_URL = 'models/creatures/smith_heart_heat_guardian.glb';

/** Every clip the GLB carries. */
export const HEAT_BODY_CLIPS = [
  'Idle',
  'Attack',
  'Attack2',
  'Slam',
  'Cast',
  'Sink',
  'Under',
  'Rise',
  'Death',
  'Throw',
] as const;

/** The model's own height (tip of the vortex to the crown's spike), in its
 *  authored units, and where the wellspring's surface crosses it: the vortex's
 *  lower quarter stands in the lava. */
export const HEAT_MODEL_UNITS = 8;
export const HEAT_MODEL_LAVA = 1.9;

/** The drawn height at scale 1 (the template draws it at scale 4 since pass
 *  4): the crown some eighteen yards over the lava, about nine players over
 *  the shore, the whole body about twenty-four tall. */
export const HEAT_BODY_HEIGHT = 6;

/** The template's scale (content/smith_heart.ts, the sim's
 *  HEAT_GUARDIAN_SCALE) the fx reckon in. */
export const HEAT_BODY_SCALE = HEAT_GUARDIAN_SCALE;

/** How much bigger the body is drawn than the scale its fire was first tuned
 *  at (3): every yard-sized piece of its fire (the tongues, the vortex, the
 *  halos, the orbiting rocks, its bursts) grows by this, so the fire keeps
 *  its proportions on the grown body. */
export const HEAT_FX_GROW = HEAT_BODY_SCALE / 3;

/** Yards a model unit is drawn at. */
export const HEAT_YD_PER_UNIT = (HEAT_BODY_HEIGHT * HEAT_BODY_SCALE) / HEAT_MODEL_UNITS;

/** The visual's hover (at scale 1): negative, the body sunk so the wellspring's
 *  surface (the guardian's own position) crosses it at HEAT_MODEL_LAVA. */
export const HEAT_BODY_HOVER = -(HEAT_MODEL_LAVA / HEAT_MODEL_UNITS) * HEAT_BODY_HEIGHT;

/** The clips' beats, in seconds at a time scale of 1 (frame / 30). */
export const HEAT_BODY_CLIP = {
  /** A plain swing's fist meets the shore (Attack and Attack2). */
  attack: 19 / 30,
  /** Basalt Fist's fist comes down (Slam; played at contact / bar so it lands
   *  on the bar's end). */
  slam: 84 / 30,
  /** The cast: the hands meet before the chest, then throw the fire out. */
  castGather: 13 / 30,
  castRelease: 26 / 30,
  /** The rise: the body breaches the lava (Rise). */
  riseBreach: 34 / 30,
  /** The death: it slumps onto the wellspring and goes still (Death). */
  deathSlump: 58 / 30,
  /** The meteor throw (Throw, pass 4: the Hearthseeds): both hands plunge
   *  into the lava and scoop, heave the molten rock high over its head and
   *  fling it; the meteors leave its hands on the release and the clip
   *  settles back to the Idle stance at its end. */
  throwScoop: 17 / 30,
  throwRelease: 34 / 30,
  throwEnd: 84 / 30,
} as const;

/** Presentation gestures (the renderer's triggerAttack seam). Never sim ids. */
export const HEAT_BODY_GESTURES = {
  /** It plunges into the wellspring (the Under stance, entered by its Sink). */
  sink: 'smith_heart_heat_body_sink',
  /** Already under (a view built while it is): the Under stance, no plunge. */
  under: 'smith_heart_heat_body_under',
  /** It bursts back out (the fighting stance, entered by its Rise). */
  rise: 'smith_heart_heat_body_rise',
  /** Already standing (a view built while it does): the fighting stance. */
  stand: 'smith_heart_heat_body_stand',
  /** Both hands gather the fire and throw it (Hearth Flare, the Wakefire). */
  cast: 'smith_heart_heat_body_cast',
  /** It scoops molten rock out of the wellspring and hurls the Hearthseeds
   *  (the Throw clip; its meteors are heat_meteor_fx.ts's). */
  throw: 'smith_heart_heat_body_throw',
} as const;

/** The stance gesture for the guardian's stage, given the stage seen a scan
 *  ago (-1: none, the view is new): a transition plays its plunge or its
 *  breach, a steady stage (or one first seen mid-way) only holds its stance. */
export function heatStanceGesture(stage: number, prev: number): string {
  const S = HEAT_STAGES;
  const G = HEAT_BODY_GESTURES;
  if (stage === S.sinking) return prev === S.fight ? G.sink : G.under;
  if (stage === S.under) return G.under;
  if (stage === S.rising) return prev === S.under || prev === S.sinking ? G.rise : G.stand;
  return G.stand;
}

/** Seconds between two cast gestures (Hearth Flare strikes every few seconds
 *  and the seeds land in a volley: one gathering reads, a stutter does not). */
export const HEAT_CAST_GAP = 2.4;

// ---- the sockets: points on the model at rest, carried by their bones -------------------

export type HeatSocketId =
  | 'fistL'
  | 'fistR'
  | 'shoulderL'
  | 'shoulderR'
  | 'hornL'
  | 'hornR'
  | 'crown'
  | 'eyeL'
  | 'eyeR'
  | 'heart'
  | 'buckle'
  | 'back'
  | 'vortexHigh'
  | 'vortexMid';

/** A socket: a point of the model at rest (`at`, its authored units, y up, its
 *  face toward +z: the fallback while a view loads) and the same point in the
 *  frame of the bone that carries it (`local`, read off the shipped GLB's rest
 *  pose; tests/smith_heart_heat_body.test.ts re-derives it from the file). Bone
 *  names as authored (the loader drops the dots: `hand.L` is `handL`). */
export interface HeatSocket {
  id: HeatSocketId;
  bone: string;
  at: readonly [number, number, number];
  local: readonly [number, number, number];
}

/** `at` authored in the Blender frame (x its left, y back, z up) and turned
 *  into the model's (x, z, -y) here, so the numbers read against the .blend. */
function sock(
  id: HeatSocketId,
  bone: string,
  blender: readonly [number, number, number],
  local: readonly [number, number, number],
): HeatSocket {
  const [x, y, z] = blender;
  return { id, bone, at: [x, z, -y], local };
}

export const HEAT_SOCKETS: readonly HeatSocket[] = [
  sock('fistL', 'hand.L', [4.45, 0.05, 5.4], [0.08, 0.505, 0.03]),
  sock('fistR', 'hand.R', [-4.45, 0.05, 5.4], [-0.08, 0.505, 0.03]),
  sock('shoulderL', 'clavicle.L', [1.55, 0.35, 6.35], [-0.579, 1.117, -0.041]),
  sock('shoulderR', 'clavicle.R', [-1.55, 0.35, 6.35], [0.579, 1.117, -0.041]),
  sock('hornL', 'head', [1.15, 0.3, 7.55], [1.15, 0.9, -0.25]),
  sock('hornR', 'head', [-1.15, 0.3, 7.55], [-1.15, 0.9, -0.25]),
  sock('crown', 'head', [0, 0.35, 7.95], [0, 1.3, -0.3]),
  sock('eyeL', 'head', [0.17, -0.74, 7.0], [0.17, 0.35, 0.79]),
  sock('eyeR', 'head', [-0.17, -0.74, 7.0], [-0.17, 0.35, 0.79]),
  sock('heart', 'chest', [0, -1.1, 5.85], [0, 0.65, 1.15]),
  sock('buckle', 'hips', [0, -1.28, 3.87], [0, 0.32, 1.33]),
  sock('back', 'chest', [0, 0.95, 5.7], [0, 0.5, -0.9]),
  sock('vortexHigh', 'vortex1', [0, -0.05, 3.0], [0, 0.549, 0.106]),
  sock('vortexMid', 'vortex2', [0, -0.05, 2.2], [0, 0.401, 0.106]),
];

/** A socket's index by id (the painter keeps its live points in this order). */
export function heatSocketIndex(id: HeatSocketId): number {
  return HEAT_SOCKETS.findIndex((s) => s.id === id);
}

/** The flames that roar off it, per socket: a share of the flame rate, the
 *  tongue's size in yards and how hard it climbs. The shoulders and the back
 *  burn biggest (the concept's flames sheet off its shoulders), the fists
 *  blaze, the horns and the crown lick, the heart's ring and the vortex
 *  smoulder. */
export interface HeatFlameSpec {
  socket: HeatSocketId;
  share: number;
  size: number;
  up: number;
}
export const HEAT_FLAMES: readonly HeatFlameSpec[] = [
  { socket: 'shoulderL', share: 1.4, size: 4.6, up: 6.5 },
  { socket: 'shoulderR', share: 1.4, size: 4.6, up: 6.5 },
  { socket: 'fistL', share: 1.0, size: 3.4, up: 5 },
  { socket: 'fistR', share: 1.0, size: 3.4, up: 5 },
  { socket: 'hornL', share: 0.6, size: 2.6, up: 5 },
  { socket: 'hornR', share: 0.6, size: 2.6, up: 5 },
  { socket: 'crown', share: 0.55, size: 3, up: 6 },
  { socket: 'back', share: 1.1, size: 5.2, up: 7 },
  { socket: 'heart', share: 0.3, size: 2.2, up: 3.5 },
  { socket: 'vortexHigh', share: 0.6, size: 3.4, up: 5 },
];
const FLAME_SHARE_TOTAL = HEAT_FLAMES.reduce((a, f) => a + f.share, 0);

/** The flame spec for a unit draw `u` (0..1): picked by share, so the shoulders
 *  get more tongues than the horns. */
export function heatFlameFor(u: number): HeatFlameSpec {
  let k = Math.max(0, Math.min(0.999999, u)) * FLAME_SHARE_TOTAL;
  for (const f of HEAT_FLAMES) {
    k -= f.share;
    if (k < 0) return f;
  }
  return HEAT_FLAMES[HEAT_FLAMES.length - 1];
}

// ---- the fire's strength ------------------------------------------------------------------

/** How hard the body burns: its flames a second at full density, by phase
 *  (hotter as the fight deepens); none while it is under the lava. */
export function heatFlameRate(phase: number, under: boolean): number {
  if (under) return 0;
  const p = Math.max(1, Math.min(3, phase || 1));
  return 120 + 35 * (p - 1);
}

/** How white the first flame burns in `phase` (1 to 3): gold early, whiter
 *  as the fight deepens. */
export function heatWhiteness(phase: number): number {
  const p = Math.max(1, Math.min(3, phase));
  return 0.1 + 0.32 * (p - 1);
}

/** The death's cooling `t` seconds after it fell: the flames die down, the
 *  smoke climbs and thins, the eyes and the heart go out. */
export function heatDeathLook(t: number): { flame: number; smoke: number; glow: number } {
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return {
    flame: c(1 - t / 2.4) ** 1.5,
    smoke: t < 0 ? 0 : c(t / 0.6) * c(1 - (t - 2.5) / 5),
    glow: c(1 - t / 3) ** 1.2,
  };
}

// ---- the cast: fire gathered between the hands, then thrown ---------------------------------

/** The cast `age` seconds after its gesture: how gathered the fire is between
 *  the hands (0..1, swelling to the release), the release's flash (0..1), and
 *  whether it is over. */
export function heatCastLook(age: number): { gather: number; release: number; done: boolean } {
  const g = HEAT_BODY_CLIP.castRelease;
  if (age < 0) return { gather: 0, release: 0, done: false };
  if (age < g) {
    const k = age / g;
    return { gather: k * k * (3 - 2 * k), release: 0, done: false };
  }
  const r = (age - g) / 0.45;
  return { gather: 0, release: Math.max(0, 1 - r), done: r >= 1 };
}

// ---- the orbiting molten rocks -------------------------------------------------------------

/** How many rocks circle it (cosmetic: the low tier keeps the first few). */
export const HEAT_ROCKS = 7;
export const HEAT_ROCKS_LOW = 3;

/** Rock `i`'s place `t` seconds in, in yards in the body's frame (x its left,
 *  y up from the lava, z forward), its size and its tumble: each on its own
 *  tilted ring round the chest, slow and bobbing, some near, some wide. */
export function heatRockOrbit(
  i: number,
  t: number,
  out: { x: number; y: number; z: number; size: number; spin: number },
): { x: number; y: number; z: number; size: number; spin: number } {
  const G = HEAT_FX_GROW;
  const r = (7.5 + 4.5 * heatBodyHash(i, 3)) * G;
  const speed = (0.16 + 0.12 * heatBodyHash(i, 5)) * (heatBodyHash(i, 7) < 0.5 ? 1 : -1);
  const a = heatBodyHash(i, 11) * Math.PI * 2 + t * speed;
  const tilt = (heatBodyHash(i, 13) - 0.5) * 0.7;
  const h = (6 + 7 * heatBodyHash(i, 17)) * G;
  out.x = Math.cos(a) * r;
  out.z = Math.sin(a) * r;
  out.y = h + Math.sin(a) * r * tilt + 0.6 * G * Math.sin(t * 0.9 + i * 1.7);
  out.size = (0.55 + 0.6 * heatBodyHash(i, 19)) * G;
  out.spin = t * (0.4 + 0.6 * heatBodyHash(i, 23)) + i;
  return out;
}

// ---- the state off its aura -------------------------------------------------------------------

/** What the body reads off the guardian's state aura: its phase (0 out of
 *  the fight), its stage and how far into a timed one. */
export interface HeatBodyState {
  phase: number;
  stage: number;
  fill: number;
}

/** The guardian's state off its auras, written into `out` (no allocation on
 *  the frame path). */
export function heatBodyState(
  auras: readonly {
    id: string;
    value?: number;
    value2?: number;
    remaining?: number;
    duration?: number;
  }[],
  out: HeatBodyState = { phase: 0, stage: 0, fill: 0 },
): HeatBodyState {
  out.phase = 0;
  out.stage = 0;
  out.fill = 0;
  for (const a of auras) {
    if (a.id === HEAT_AURAS.state) {
      out.phase = Math.round(a.value ?? 0);
      out.stage = Math.round(a.value2 ?? 0);
      const d = a.duration ?? 0;
      out.fill = d > 0 && d < 1000 ? Math.max(0, Math.min(1, 1 - (a.remaining ?? 0) / d)) : 0;
    }
  }
  return out;
}

/** A deterministic 0..1 hash. */
export function heatBodyHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- the palette --------------------------------------------------------------------------------

/** The Hearth's first flame (shared with the fight's floor and the wellspring:
 *  heat_fx.ts, heat_well_fx.ts). Linear 0..1, hex for the glows. */
export const HEAT_BODY_COLORS = {
  /** The Hearth's basalt: a warm dark grey, umber baked in its shade. */
  basalt: [0.36, 0.33, 0.31] as const,
  basaltShade: [0.13, 0.11, 0.1] as const,
  /** The first flame: gold at rest, white at the top of the heat. */
  gold: 0xffb848,
  fire: 0xffd27a,
  white: 0xfff6e6,
  thread: 0xffc860,
  ember: [1.0, 0.78, 0.4] as const,
  spark: [1.0, 0.9, 0.62] as const,
  haze: [0.95, 0.85, 0.66] as const,
  smoke: [0.28, 0.25, 0.23] as const,
} as const;

/** The modeled body's own fire (Jose's concept: orange-red flame round a
 *  yellow core, dark smoke; his review of 2026-11-06 moved it off the pale
 *  yellow of the first pass): what the effects layer paints round it. A
 *  flame puff's first channel is its heat on the pyre ramp (held in the
 *  ramp's orange, never its white top). The tongues' own ramp is
 *  heat_flame_core.ts HEAT_FIRE_RAMP. */
export const HEAT_MODEL_COLORS = {
  flameHeat: [0.56, 0, 0] as const,
  flameHot: [0.66, 0, 0] as const,
  lava: [1.0, 0.36, 0.05] as const,
  ember: [1.0, 0.46, 0.1] as const,
  spark: [1.0, 0.66, 0.26] as const,
  smoke: [0.11, 0.085, 0.075] as const,
  ash: [0.3, 0.26, 0.24] as const,
  haze: [1.0, 0.5, 0.25] as const,
  glow: 0xff5414,
  core: 0xff9a3c,
  eye: 0xffc860,
  /** An impact's short flash (orange-gold, never white). */
  flash: 0xffa65a,
  /** The shockwave racing over the floor. */
  ring: 0xff6a24,
} as const;

/** Pools at full density. */
export const HEAT_BODY_POOLS = {
  sockets: HEAT_SOCKETS.length,
  rocks: HEAT_ROCKS,
  flashes: 4,
  /** The basalt chunks the blows fling (the low tier keeps fewer). */
  debris: 28,
  debrisLow: 10,
} as const;
