// The Guardian of the Breath's own model (docs/design/raid/smith_heart.md
// sections 5.14 and 7.2): the pure half of breath_body.ts. Jose's concept,
// built on the official pipeline (a three-view sheet of the solid pieces,
// Tripo3D, a rig made for them in Blender, every clip authored for it at
// 30 fps): a colossus of PURE AIR held together by floating pieces of ancient
// armor that never touch: a stone face-mask with glowing eyes and a war-horn
// mouth under a crystal crown, a bronze halo of runes, two granite pauldrons,
// a chest plate with a glowing spiral, segmented bronze-banded bracers, clawed
// granite hands with crystal claws, and a chain of tapering tail plates. One
// bone carries each piece (no skin weights), so the arms' shoulders and elbows
// are empty air and every piece trails and overshoots as if carried on wind.
// At half health the storm breaks: the same model, its Storm Breaks clip
// flings every piece out to a wider spacing it keeps for phase 2.
//
// The rig plays the motion (characters/smith_heart_boss_looks.ts binds the
// clips); this module plans what the effects layer adds on top: the gesture
// ids the stance swaps answer, the clip beats the bursts are timed to, the
// sockets the wind rides (points on the model at rest, carried by their
// bones), the currents of wind wound piece to piece that ARE its body, the
// storm's lightning between the pieces, the orbiting stones and shards, and
// the looks of every bar. Node-only (RENDER_PURE_CORES): no three.js, no DOM,
// deterministic (a hash, never rng).

import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_GUARDIAN,
  type BreathWindPhase,
} from '../../sim/encounters/smith_heart/breath_ids';
import { ISLE_CASTS } from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { V3 } from './final_fx_core';

export type { V3 };
export { BREATH_GUARDIAN };

// ---- the model -------------------------------------------------------------------------

/** The shipped body (public/models/creatures). */
export const BREATH_BODY_URL = 'models/creatures/smith_heart_breath_guardian.glb';

/** Every clip the GLB carries: the calm wind's set, the transition, and the
 *  storm's set (the same motions on the wider spacing, crackling). */
export const BREATH_BODY_CLIPS = [
  'Idle',
  'Move',
  'Attack',
  'Attack2',
  'Cast',
  'Channel',
  'Inhale',
  'Roar',
  'StormBreaks',
  'StormIdle',
  'StormMove',
  'StormAttack',
  'StormAttack2',
  'StormCast',
  'StormChannel',
  'Death',
  'StormDeath',
] as const;

/** The model's own height (the tail's tip to the halo's crystal) in its
 *  authored units; the crown's crystals top out a little under it. */
export const BREATH_MODEL_UNITS = 10;
export const BREATH_MODEL_CROWN = 9.37;

/** The template's scale (content/smith_heart.ts heart_breath_guardian). */
export const BREATH_BODY_SCALE = 3.4;

/** The drawn height at scale 1: the whole body some eighteen yards, the
 *  crown about seventeen over the Cornice, near nine players (the provisional
 *  body stood three and a half; the Heat guardian's crown is about eighteen
 *  over its lava): as imposing as the Heat. */
export const BREATH_BODY_HEIGHT = 5.3;

/** Yards a model unit is drawn at. */
export const BREATH_YD_PER_UNIT = (BREATH_BODY_HEIGHT * BREATH_BODY_SCALE) / BREATH_MODEL_UNITS;

/** The clips' beats, in seconds at a time scale of 1 (frame / 30). */
export const BREATH_BODY_CLIP = {
  /** A claw swipe's crystal claws cross before it (Attack, Attack2). */
  attack: 18 / 30,
  /** The cast: the pointing hand thrusts out (Cast; played at release / bar
   *  so it points on the bar's end, the bolt's launch). */
  castRelease: 21 / 30,
  /** The Indrawn Breath's clip runs the whole bar and holds its last pose. */
  inhale: 150 / 30,
  /** The Summit Roar's thrust: the mask and the arms flung forward (Roar;
   *  played at thrust / bar so it lands on the bar's end). */
  roar: 42 / 30,
  /** Storm Breaks (the 4 s bar): drawn in, frozen, torn apart. */
  breakFreeze: 66 / 30,
  breakTear: 103 / 30,
  breakEnd: 120 / 30,
  /** The death: its last breath, then the pieces start falling. */
  deathFall: 24 / 30,
} as const;

/** Presentation gestures (the renderer's triggerAttack seam). Never sim ids. */
export const BREATH_BODY_GESTURES = {
  /** The calm wind's stance (phase 1, and a wipe's reset). */
  calm: 'smith_heart_breath_body_calm',
  /** The storm's stance (its body torn open: phase 2). */
  storm: 'smith_heart_breath_body_storm',
  /** Its eyes, crystals and spiral flaring (the indrawn breath's end, the
   *  roar, the storm tearing open). */
  flare: 'smith_heart_breath_body_flare',
} as const;

/** The stance gesture for the guardian's storm body. */
export function breathStanceGesture(stormForm: boolean): string {
  return stormForm ? BREATH_BODY_GESTURES.storm : BREATH_BODY_GESTURES.calm;
}

/** The bars that play a cast clip timed onto the bar's end, and the beat that
 *  lands there. The Indrawn Breath and Storm Breaks run their whole bar. */
export const BREATH_SYNCED_CASTS: Readonly<Record<string, number>> = {
  [BREATH_CASTS.inhale]: BREATH_BODY_CLIP.inhale,
  [BREATH_CASTS.gust]: BREATH_BODY_CLIP.roar,
  [BREATH_CASTS.storm]: BREATH_BODY_CLIP.breakEnd,
  [BREATH_CASTS.fork]: BREATH_BODY_CLIP.castRelease,
  [BREATH_CASTS.drawn]: BREATH_BODY_CLIP.castRelease,
  [BREATH_CASTS.cradle]: BREATH_BODY_CLIP.castRelease,
  [BREATH_CASTS.lance]: BREATH_BODY_CLIP.castRelease,
};

/** The held channels (both arms raised, looping): the Thunder's Cradle's
 *  hold and the Gale Bulwark. */
export const BREATH_CHANNELS: readonly string[] = [BREATH_CASTS.cradleHold, ISLE_CASTS.bulwark];

// ---- the sockets: points on the model at rest, carried by their bones -------------------

export type BreathSocketId =
  | 'mouth'
  | 'eyeL'
  | 'eyeR'
  | 'crown'
  | 'neck'
  | 'halo'
  | 'heart'
  | 'core'
  | 'back'
  | 'shoulderL'
  | 'shoulderR'
  | 'spikeL'
  | 'spikeR'
  | 'armL'
  | 'armR'
  | 'elbowL'
  | 'elbowR'
  | 'wristL'
  | 'wristR'
  | 'handL'
  | 'handR'
  | 'clawL'
  | 'clawR'
  | 'waist'
  | 'tail1'
  | 'tail2'
  | 'tail3'
  | 'tip';

/** A socket: a point of the model at rest (`at`, its authored units, y up, its
 *  face toward +z: the fallback while a view loads) and the same point in the
 *  frame of the bone that carries it (`local`, read off the shipped GLB's rest
 *  pose; tests/smith_heart_breath_body.test.ts re-derives it from the file).
 *  Bone names as authored (the loader drops the dots: `hand.L` is `handL`). */
export interface BreathSocket {
  id: BreathSocketId;
  bone: string;
  at: readonly [number, number, number];
  local: readonly [number, number, number];
}

/** `at` authored in the Blender frame (x its left, y back, z up) and turned
 *  into the model's (x, z, -y) here, so the numbers read against the .blend. */
function sock(
  id: BreathSocketId,
  bone: string,
  blender: readonly [number, number, number],
  local: readonly [number, number, number],
): BreathSocket {
  const [x, y, z] = blender;
  return { id, bone, at: [x, z, -y], local };
}

export const BREATH_SOCKETS: readonly BreathSocket[] = [
  sock('mouth', 'head', [0, -0.85, 7.85], [0, 0.35, 0.9]),
  sock('eyeL', 'head', [0.18, -0.78, 8.33], [0.18, 0.83, 0.83]),
  sock('eyeR', 'head', [-0.18, -0.78, 8.33], [-0.18, 0.83, 0.83]),
  sock('crown', 'head', [0, -0.1, 9.2], [0, 1.7, 0.15]),
  sock('neck', 'head', [0, 0, 7.45], [0, -0.05, 0.05]),
  sock('halo', 'halo', [0, 0.95, 9.0], [0, 0, 0.05]),
  sock('heart', 'chest', [0, -1.2, 6.05], [0, 0.8, 1.2]),
  sock('core', 'chest', [0, -0.2, 6.1], [0, 0.85, 0.2]),
  sock('back', 'chest', [0, 0.35, 6.2], [0, 0.95, -0.35]),
  sock('shoulderL', 'shoulder.L', [1.8, 0.35, 7.2], [-0.25, 0.75, -0.05]),
  sock('shoulderR', 'shoulder.R', [-1.8, 0.35, 7.2], [0.25, 0.75, -0.05]),
  sock('spikeL', 'shoulder.L', [2.05, 0.4, 8.3], [-1.35, 1, -0.1]),
  sock('spikeR', 'shoulder.R', [-2.05, 0.4, 8.3], [1.35, 1, -0.1]),
  sock('armL', 'upperarm.L', [1.2, 0.15, 6.25], [0, 0, 0]),
  sock('armR', 'upperarm.R', [-1.2, 0.15, 6.25], [0, 0, 0]),
  sock('elbowL', 'forearm.L', [1.6, 0.2, 5.6], [-0.003, 0.05, 0]),
  sock('elbowR', 'forearm.R', [-1.6, 0.2, 5.6], [0.003, 0.05, 0]),
  sock('wristL', 'forearm.L', [2.95, 0.2, 5.5], [0.003, 1.404, 0]),
  sock('wristR', 'forearm.R', [-2.95, 0.2, 5.5], [-0.003, 1.404, 0]),
  sock('handL', 'hand.L', [3.3, -0.3, 4.95], [0.07, 0.528, 0.035]),
  sock('handR', 'hand.R', [-3.3, -0.3, 4.95], [-0.07, 0.528, 0.035]),
  sock('clawL', 'claws.L', [3.95, -0.5, 4.45], [0.033, 0.582, 0.055]),
  sock('clawR', 'claws.R', [-3.95, -0.5, 4.45], [-0.033, 0.582, 0.055]),
  sock('waist', 'tail0', [0, -0.3, 4.75], [0, 0.15, 0.1]),
  sock('tail1', 'tail1', [0, -0.16, 4.0], [0, 0.45, -0.02]),
  sock('tail2', 'tail2', [0, -0.2, 3.0], [0, 0.5, 0]),
  sock('tail3', 'tail3', [0, -0.2, 1.6], [0, 0.7, 0]),
  sock('tip', 'tail3', [0, -0.2, 0.15], [0, 2.15, 0]),
];

/** A socket's index by id (the painter keeps its live points in this order). */
export function breathSocketIndex(id: BreathSocketId): number {
  return BREATH_SOCKETS.findIndex((s) => s.id === id);
}

// ---- the wind body: currents wound piece to piece ------------------------------------------

/** One current of the wind body: `ribbons` streams wound round a path through
 *  sockets, each `turns` times along it, `radius` (model units, per path
 *  point) out from the path, `width` (model units) wide. `tailCurl` runs the
 *  path on past its last socket in a curl over the floor (the wind tail). */
export interface BreathCurrent {
  id: string;
  path: readonly BreathSocketId[];
  radius: readonly number[];
  ribbons: number;
  turns: number;
  width: number;
  alpha: number;
  /** Spin of the winding (turns a second; the sign is the hand). */
  spin: number;
  tailCurl?: boolean;
  /** A soft body strand: wide, smooth, glowing from within (the volume the
   *  torn filaments stream over), not a filament. */
  soft?: boolean;
  /** Billows of storm air along it (breath_wind_volume.ts): how many, and
   *  their size (model units, per path point). The body's solid volume. */
  puffs?: number;
  puffSize?: readonly number[];
}

export const BREATH_CURRENTS: readonly BreathCurrent[] = [
  // The trunk: from the neck down through the chest, the waist and every
  // tail plate to the tip and on into a curl over the floor.
  {
    id: 'trunk',
    path: ['neck', 'core', 'waist', 'tail1', 'tail2', 'tail3', 'tip'],
    radius: [0.55, 1.15, 0.85, 0.6, 0.5, 0.42, 0.34],
    ribbons: 5,
    turns: 2.6,
    width: 0.55,
    alpha: 0.62,
    spin: 0.32,
    puffs: 16,
    puffSize: [1.4, 2.5, 2.0, 1.6, 1.35, 1.1, 0.9],
    tailCurl: true,
  },
  // The arms: out of the chest, through the empty shoulder and elbow, along
  // the bracer, wrapping the hand.
  {
    id: 'armL',
    path: ['core', 'armL', 'elbowL', 'wristL', 'handL', 'clawL'],
    radius: [0.7, 0.62, 0.5, 0.45, 0.42, 0.26],
    ribbons: 3,
    turns: 2.2,
    width: 0.38,
    alpha: 0.58,
    spin: 0.42,
    puffs: 7,
    puffSize: [1.7, 1.4, 1.1, 1.0, 0.95, 0.6],
  },
  {
    id: 'armR',
    path: ['core', 'armR', 'elbowR', 'wristR', 'handR', 'clawR'],
    radius: [0.7, 0.62, 0.5, 0.45, 0.42, 0.26],
    ribbons: 3,
    turns: 2.2,
    width: 0.38,
    alpha: 0.58,
    spin: -0.42,
    puffs: 7,
    puffSize: [1.7, 1.4, 1.1, 1.0, 0.95, 0.6],
  },
  // The shoulders: the air the pauldrons float on, up to their crystals.
  {
    id: 'shoulderL',
    path: ['core', 'armL', 'shoulderL', 'spikeL'],
    radius: [0.6, 0.8, 0.85, 0.35],
    ribbons: 2,
    turns: 1.3,
    width: 0.48,
    alpha: 0.5,
    spin: 0.3,
    puffs: 3,
    puffSize: [1.5, 1.8, 1.7, 0.9],
  },
  {
    id: 'shoulderR',
    path: ['core', 'armR', 'shoulderR', 'spikeR'],
    radius: [0.6, 0.8, 0.85, 0.35],
    ribbons: 2,
    turns: 1.3,
    width: 0.48,
    alpha: 0.5,
    spin: -0.3,
    puffs: 3,
    puffSize: [1.5, 1.8, 1.7, 0.9],
  },
  // The neck and the head: up behind the mask to its crown and the halo.
  {
    id: 'head',
    path: ['core', 'neck', 'mouth', 'crown', 'halo'],
    radius: [0.7, 0.6, 0.72, 0.5, 0.3],
    ribbons: 2,
    turns: 1.4,
    width: 0.42,
    alpha: 0.45,
    spin: 0.36,
    puffs: 3,
    puffSize: [1.6, 1.4, 1.2, 1.0, 0.6],
  },
  // The volume under the filaments: wide soft strands of glowing air down
  // the trunk and the tail, along the arms and over the shoulders.
  {
    id: 'trunkSoft',
    path: ['neck', 'core', 'waist', 'tail1', 'tail2', 'tail3', 'tip'],
    radius: [0.25, 0.55, 0.4, 0.3, 0.26, 0.22, 0.2],
    ribbons: 3,
    turns: 1.2,
    width: 1.5,
    alpha: 0.42,
    spin: 0.16,
    tailCurl: true,
    soft: true,
  },
  {
    id: 'armLSoft',
    path: ['core', 'armL', 'elbowL', 'wristL', 'handL'],
    radius: [0.3, 0.28, 0.22, 0.2, 0.18],
    ribbons: 2,
    turns: 0.9,
    width: 0.95,
    alpha: 0.38,
    spin: 0.22,
    soft: true,
  },
  {
    id: 'armRSoft',
    path: ['core', 'armR', 'elbowR', 'wristR', 'handR'],
    radius: [0.3, 0.28, 0.22, 0.2, 0.18],
    ribbons: 2,
    turns: 0.9,
    width: 0.95,
    alpha: 0.38,
    spin: -0.22,
    soft: true,
  },
  {
    id: 'shouldersSoft',
    path: ['shoulderR', 'armR', 'core', 'armL', 'shoulderL'],
    radius: [0.3, 0.35, 0.4, 0.35, 0.3],
    ribbons: 2,
    turns: 0.8,
    width: 1.2,
    alpha: 0.34,
    spin: 0.12,
    soft: true,
  },
  // Two great wisps sweeping round the whole body from the tail over a
  // shoulder (the concept's long streams).
  {
    id: 'wispL',
    path: ['tip', 'tail2', 'waist', 'core', 'shoulderL', 'spikeL'],
    radius: [0.9, 1.4, 1.7, 1.9, 1.5, 0.8],
    ribbons: 1,
    turns: 1.1,
    width: 0.75,
    alpha: 0.36,
    spin: 0.18,
  },
  {
    id: 'wispR',
    path: ['tip', 'tail2', 'waist', 'core', 'shoulderR', 'spikeR'],
    radius: [0.9, 1.4, 1.7, 1.9, 1.5, 0.8],
    ribbons: 1,
    turns: 1.1,
    width: 0.75,
    alpha: 0.36,
    spin: -0.18,
  },
];

/** Every ribbon of the wind body, in order (a current's ribbons together). */
export const BREATH_RIBBON_COUNT = BREATH_CURRENTS.reduce((a, c) => a + c.ribbons, 0);
/** The low tier keeps the first ribbons of each current (cosmetic volume). */
export function breathRibbonKept(current: BreathCurrent, ribbon: number, low: boolean): boolean {
  if (!low) return true;
  return ribbon < Math.max(1, Math.ceil(current.ribbons / 2));
}
/** Every billow of the body volume (a current's billows together). */
export const BREATH_PUFF_COUNT = BREATH_CURRENTS.reduce((a, c) => a + (c.puffs ?? 0), 0);
/** The low tier keeps every other billow (cosmetic volume; the body still
 *  reads, thinner). */
export function breathPuffKept(index: number, low: boolean): boolean {
  return !low || index % 2 === 0;
}

/** Segments along every ribbon (and the wind tail's curl, in path units). */
export const BREATH_RIBBON_SEGMENTS = 28;
export const BREATH_TAIL_CURL = { points: 3, reach: 0.9, drop: 0.12 } as const;

/** The position on a Catmull-Rom spline through `n` points (flat xyz in `p`)
 *  at u (0..1), and its tangent (not normalized), written into `out`
 *  (x, y, z, tx, ty, tz). Allocation-free. */
export function splineAt(p: ArrayLike<number>, n: number, u: number, out: Float32Array): void {
  const span = Math.max(1, n - 1);
  const f = Math.max(0, Math.min(1, u)) * span;
  const i = Math.min(span - 1, Math.floor(f));
  const t = f - i;
  const i0 = Math.max(0, i - 1);
  const i2 = Math.min(n - 1, i + 1);
  const i3 = Math.min(n - 1, i + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  for (let k = 0; k < 3; k++) {
    const a = p[i0 * 3 + k];
    const b = p[i * 3 + k];
    const c = p[i2 * 3 + k];
    const d = p[i3 * 3 + k];
    out[k] =
      0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
    out[3 + k] =
      0.5 * (c - a + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (3 * b - a - 3 * c + d) * t2);
  }
}

/** A radius profile's value at u (linear between the path points). */
export function profileAt(r: readonly number[], u: number): number {
  const span = Math.max(1, r.length - 1);
  const f = Math.max(0, Math.min(1, u)) * span;
  const i = Math.min(span - 1, Math.floor(f));
  const t = f - i;
  return r[i] + (r[Math.min(r.length - 1, i + 1)] - r[i]) * t;
}

/** A ribbon's end fade: it thins in at both ends (never a cut edge). */
export function ribbonFade(u: number): number {
  const a = Math.max(0, Math.min(1, u / 0.12));
  const b = Math.max(0, Math.min(1, (1 - u) / 0.18));
  return a * a * (3 - 2 * a) * b * b * (3 - 2 * b);
}

// ---- the storm's lightning ----------------------------------------------------------------

/** The arcs that leap between the pieces through phase 2 (socket pairs). */
export const BREATH_ARC_PAIRS: readonly [BreathSocketId, BreathSocketId][] = [
  ['heart', 'shoulderL'],
  ['heart', 'shoulderR'],
  ['shoulderL', 'wristL'],
  ['shoulderR', 'wristR'],
  ['wristL', 'clawL'],
  ['wristR', 'clawR'],
  ['heart', 'mouth'],
  ['crown', 'halo'],
  ['heart', 'waist'],
  ['waist', 'tail2'],
  ['tail2', 'tip'],
  ['spikeL', 'crown'],
  ['spikeR', 'crown'],
  ['handL', 'heart'],
  ['handR', 'heart'],
];

/** The arcs' pool, their life and how often a new one leaps (a second). */
export const BREATH_ARCS = { pool: 12, poolLow: 5, life: 0.24, rate: 22, segments: 14 } as const;

/** Lightning from A to B: `segs + 1` points (flat xyz into `out`), jagged by
 *  midpoint displacement off a hash of `seed`, `jag` its kink as a share of
 *  the length; the ends sit on A and B. */
export function arcPath(
  seed: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  segs: number,
  jag: number,
  out: Float32Array,
): void {
  const len = Math.hypot(bx - ax, by - ay, bz - az) || 1;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    // Two octaves of hashed kinks, zero at both ends.
    const env = Math.sin(u * Math.PI);
    const k1 = breathBodyHash(seed, i * 3 + 1) - 0.5;
    const k2 = breathBodyHash(seed, i * 3 + 2) - 0.5;
    const k3 = breathBodyHash(seed, i * 3 + 3) - 0.5;
    const big = Math.sin(u * Math.PI * 2 + breathBodyHash(seed, 97) * 6.28) * 0.5;
    const a = jag * len * env;
    out[i * 3] = ax + (bx - ax) * u + (k1 + big * 0.6) * a;
    out[i * 3 + 1] = ay + (by - ay) * u + (k2 + big * 0.4) * a;
    out[i * 3 + 2] = az + (bz - az) * u + k3 * a;
  }
}

// ---- what the body is doing -------------------------------------------------------------

export type BreathBodyAction =
  | 'idle'
  | 'gather'
  | 'blow'
  | 'inhale'
  | 'roar'
  | 'cast'
  | 'channel'
  | 'break'
  | 'storm';

/** The fight's state as the body reads it (all mirrored entity state). */
export interface BreathBodyInput {
  /** The guardian's bar, and its fill 0..1. */
  castId: string | null;
  castFill: number;
  /** The wind object's phase and how far into it (0..1). */
  windPhase: BreathWindPhase | null;
  windFill: number;
  /** Its storm body is on (BREATH_AURAS.stormForm). */
  stormForm: boolean;
}

/** The action and its clock (0..1) for the body's input. */
export interface BreathBodyActionState {
  action: BreathBodyAction;
  k: number;
}

/** The action and its clock (0..1) for the body's input, written into `out`
 *  (the painter passes one scratch every frame; no allocation). */
export function breathBodyAction(
  input: BreathBodyInput,
  out: BreathBodyActionState = { action: 'idle', k: 0 },
): BreathBodyActionState {
  const c = input.castId;
  let action: BreathBodyAction = input.stormForm ? 'storm' : 'idle';
  let k = 0;
  if (c === BREATH_CASTS.storm) {
    action = 'break';
    k = input.castFill;
  } else if (c === BREATH_CASTS.inhale) {
    action = 'inhale';
    k = input.castFill;
  } else if (c === BREATH_CASTS.gust) {
    action = 'roar';
    k = input.castFill;
  } else if (c !== null && BREATH_CHANNELS.includes(c)) {
    action = 'channel';
    k = input.castFill;
  } else if (c !== null && BREATH_SYNCED_CASTS[c] !== undefined) {
    action = 'cast';
    k = input.castFill;
  } else if (input.windPhase === 'gather' || input.windPhase === 'gustgather') {
    action = 'gather';
    k = input.windFill;
  } else if (input.windPhase === 'blow' || input.windPhase === 'gust') {
    action = 'blow';
    k = input.windFill;
  }
  out.action = action;
  out.k = k;
  return out;
}

/** The wind body's look for an action: how dense the currents are (0..1),
 *  how far out they wind (a share of their rest radius: the indrawn breath
 *  pulls them in tight, the roar flings them out), how fast they flow and
 *  spin, the eyes' and the spiral's light, the streams drawn into the mouth
 *  (0..1), how far the storm has taken it (0 the calm, 1 the storm), and a
 *  shiver (0..1). */
export interface BreathWindLook {
  density: number;
  radius: number;
  flow: number;
  spin: number;
  glow: number;
  drawIn: number;
  storm: number;
  shiver: number;
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** When in the storm bar the drawing in turns to the freeze, and the freeze
 *  to the tearing (the clip's own beats over its 4 s). */
export const BREAK_FREEZE_AT = BREATH_BODY_CLIP.breakFreeze / BREATH_BODY_CLIP.breakEnd;
export const BREAK_TEAR_AT = BREATH_BODY_CLIP.breakTear / BREATH_BODY_CLIP.breakEnd;

/** The roar's thrust as a share of its bar (the clip's thrust lands on the
 *  bar's end, so the blast is the bar's last instant and after it). */
export function newWindLook(): BreathWindLook {
  return { density: 1, radius: 1, flow: 1, spin: 1, glow: 1, drawIn: 0, storm: 0, shiver: 0 };
}

/** The look of `action` at `k` on render time `t`, written into `out`. */
export function breathWindLook(
  action: BreathBodyAction,
  k: number,
  t: number,
  out: BreathWindLook = newWindLook(),
): BreathWindLook {
  const breath = Math.sin((t * Math.PI * 2) / 4);
  out.density = 1;
  out.radius = 1 + 0.06 * breath;
  out.flow = 1;
  out.spin = 1;
  out.glow = 1 + 0.12 * breath;
  out.drawIn = 0;
  out.storm = 0;
  out.shiver = 0;
  const p = clamp01(k);
  switch (action) {
    case 'gather':
      out.flow = 1 + 0.8 * ease(p);
      out.glow = 1.1 + 0.3 * ease(p);
      break;
    case 'blow':
      out.flow = 1.9;
      out.spin = 1.4;
      out.glow = 1.3;
      break;
    case 'inhale':
      // The currents drawn in tight and racing, every stream pouring into
      // the mouth, the light swelling to the bar's end.
      out.radius = 1 - 0.42 * ease(p);
      out.flow = 1.4 + 1.6 * ease(p);
      out.spin = 1.2 + 1.4 * ease(p);
      out.glow = 1.2 + 1.3 * ease(p);
      out.drawIn = 0.35 + 0.65 * ease(p);
      out.shiver = 0.6 * ease(p);
      break;
    case 'roar':
      // Held drawn in, then flung out on the bar's end with the blast.
      out.radius = 0.6 + (p > 0.93 ? 0.9 * ease((p - 0.93) / 0.07) : 0);
      out.flow = 2.6;
      out.spin = 2.2;
      out.glow = 2.4;
      out.drawIn = p < 0.93 ? 0.8 : 0;
      out.shiver = p < 0.93 ? 0.8 : 0.2;
      break;
    case 'cast':
      out.flow = 1.3 + 0.5 * ease(p);
      out.glow = 1.2 + 0.8 * ease(p);
      break;
    case 'channel':
      out.radius = 1.15;
      out.flow = 1.8;
      out.spin = 1.8;
      out.glow = 1.5 + 0.15 * Math.sin(t * 5.3);
      break;
    case 'break':
      if (p < BREAK_FREEZE_AT) {
        const q = p / BREAK_FREEZE_AT;
        out.radius = 1 - 0.45 * ease(q);
        out.flow = 1.4 + 2 * ease(q);
        out.spin = 1.2 + 1.6 * ease(q);
        out.glow = 1.3 + 1.2 * ease(q);
        out.drawIn = 0.5 + 0.5 * ease(q);
        out.shiver = 0.4 * ease(q);
      } else if (p < BREAK_TEAR_AT) {
        const q = (p - BREAK_FREEZE_AT) / (BREAK_TEAR_AT - BREAK_FREEZE_AT);
        out.radius = 0.55;
        out.flow = 3.4;
        out.spin = 2.8;
        out.glow = 2.5 + 1.0 * q;
        out.drawIn = 1;
        out.shiver = 0.6 + 0.4 * q;
        out.storm = 0.35 * q;
      } else {
        const q = (p - BREAK_TEAR_AT) / (1 - BREAK_TEAR_AT);
        out.radius = 0.55 + 1.1 * ease(q * 1.6) - 0.15 * ease((q - 0.6) / 0.4);
        out.flow = 3;
        out.spin = 2.4;
        out.glow = 3;
        out.shiver = 1;
        out.storm = 0.35 + 0.65 * ease(q * 1.4);
      }
      break;
    case 'storm':
      out.radius = 1.12 + 0.06 * breath;
      out.flow = 1.6;
      out.spin = 1.5;
      out.glow = 1.3 + 0.35 * Math.sin(t * 7.1) * Math.sin(t * 3.3);
      out.storm = 1;
      out.shiver = 0.3;
      break;
    default:
      break;
  }
  return out;
}

/** The death `t` seconds after it fell: the wind thrown off in one last gust
 *  (the currents flung out and fading), the eyes, the spiral and the
 *  crystals going dark, the stones and shards dropping. */
export function breathDeathLook(t: number): {
  wind: number;
  fling: number;
  glow: number;
  drop: number;
} {
  const c = clamp01;
  return {
    wind: t < 0 ? 1 : c(1 - t / 1.6) ** 1.4,
    fling: 1 + 1.8 * ease(t / 1.2),
    glow: c(1 - t / 2.6) ** 1.2,
    drop: ease((t - 0.4) / 1.4),
  };
}

/** The cast `age` seconds after its bar's end (the clip points on it): the
 *  bolt's flash at the pointing hand (0..1) and whether it is over. */
export function breathCastLook(age: number): { release: number; done: boolean } {
  if (age < 0) return { release: 0, done: false };
  const r = age / 0.5;
  return { release: Math.max(0, 1 - r), done: r >= 1 };
}

// ---- the orbiting stones and shards --------------------------------------------------------

/** How many circle it: grey stones and crystal shards (cosmetic: the low tier
 *  keeps the first few). */
export const BREATH_STONES = 12;
export const BREATH_SHARDS = 10;
export const BREATH_ORBIT_LOW = 5;

/** Orbiter `i`'s place `t` seconds in, in yards in the body's frame (x its
 *  left, y up from its feet, z forward), its size and its tumble: each on its
 *  own tilted ring round the chest, slow and bobbing; the storm (`storm` 0..1)
 *  throws them wider and faster. */
export function breathOrbit(
  i: number,
  t: number,
  storm: number,
  out: { x: number; y: number; z: number; size: number; spin: number },
): { x: number; y: number; z: number; size: number; spin: number } {
  const U = BREATH_YD_PER_UNIT;
  const wide = 1 + 0.45 * clamp01(storm);
  const r = (2.6 + 2.6 * breathBodyHash(i, 3)) * U * wide;
  const speed =
    (0.22 + 0.18 * breathBodyHash(i, 5)) * (breathBodyHash(i, 7) < 0.5 ? 1 : -1) * (1 + storm);
  const a = breathBodyHash(i, 11) * Math.PI * 2 + t * speed;
  const tilt = (breathBodyHash(i, 13) - 0.5) * 0.9;
  const h = (2.5 + 6.5 * breathBodyHash(i, 17)) * U;
  out.x = Math.cos(a) * r;
  out.z = Math.sin(a) * r;
  out.y = h + Math.sin(a) * r * tilt + 0.25 * U * Math.sin(t * 1.1 + i * 1.7);
  out.size = (0.12 + 0.16 * breathBodyHash(i, 19)) * U;
  out.spin = t * (0.6 + 1.2 * breathBodyHash(i, 23)) * (1 + storm) + i;
  return out;
}

// ---- the palette ------------------------------------------------------------------------

/** Living wind (pale blue-white, a steel-blue body so it reads on the pale
 *  Cornice, white edges), the storm (a dark cloud core, blue-white
 *  lightning), the crystals' cyan. Linear 0..1, hex for the glows. */
export const BREATH_BODY_COLORS = {
  wind: [0.24, 0.36, 0.58] as const,
  windEdge: [0.8, 0.96, 1.0] as const,
  windShade: [0.035, 0.065, 0.13] as const,
  cloud: [0.5, 0.58, 0.72] as const,
  storm: [0.06, 0.075, 0.15] as const,
  stormEdge: [0.55, 0.78, 1.0] as const,
  stormShade: [0.012, 0.016, 0.04] as const,
  stormCloud: [0.07, 0.08, 0.14] as const,
  dust: [0.72, 0.94, 1.0] as const,
  spark: [0.78, 0.92, 1.0] as const,
  grit: [0.58, 0.62, 0.66] as const,
  eye: 0x7fe8ff,
  heart: 0x5ad2ff,
  crystal: 0x9fe8ff,
  lightning: 0xd8f2ff,
  lightningEdge: 0x4aa8ff,
  /** An impact's short flash (pale cyan, never white). */
  flash: 0xa8e4ff,
  ring: 0xb8e6ff,
} as const;

/** Bounded bursts (the Heat pass's lesson: a flash on its point only, a ring
 *  that never washes the floor). */
export const BREATH_BURST = {
  flashPeak: 0.55,
  flashLife: 0.22,
  flashSize: 5,
  ring: { wake: 0.35, crest: 0.18, strength: 0.6 },
} as const;

/** Pools at full density. */
export const BREATH_BODY_POOLS = {
  sockets: BREATH_SOCKETS.length,
  ribbons: BREATH_RIBBON_COUNT,
  puffs: BREATH_PUFF_COUNT,
  arcs: BREATH_ARCS.pool,
  stones: BREATH_STONES,
  shards: BREATH_SHARDS,
  flashes: 4,
  /** The slashes a claw swipe leaves (one live per hand, and a spare). */
  slashes: 3,
} as const;

/** A small integer hash in [0, 1). */
export function breathBodyHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Is the guardian in its storm body (the aura on it)? */
export function stormFormOn(auras: readonly { id: string }[]): boolean {
  for (const a of auras) if (a.id === BREATH_AURAS.stormForm) return true;
  return false;
}
