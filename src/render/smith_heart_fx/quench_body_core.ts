// Pure plan of the Guardian of the Quench's provisional body (quench_body.ts
// paints it; docs/design/raid/smith_heart.md sections 5.15 and 7.3). The
// Quench vein's art rule: primal and divine, living stone, ice and the cold;
// NOTHING metal, no machinery (the old "black iron plates" are gone with the
// rule). An ice guardian of the lake: a body of pale frost-bound granite (the
// Heart kit's colossus rock, repainted the vein's frost) clad in clear lake
// ice: plates of it on its chest, a crest of ice blades rising off its back
// and crowning its head, pauldrons of heaved ice, forearms and shins of frozen
// falls (fused ice columns, an icicle beard), the lake's cold blue light deep
// in a crystal heart and threads of it running between its joints. It stands
// on two legs, about three and a half players tall.
//
// The JOINTS and the TIMELINES (the rig, the arms' solve, the poses) are kept
// apart from the PIECES (which kit node sits on which joint, at what size),
// so the official pipeline's model replaces the pieces and keeps the joints.
//
// Sizes in yards in the body's frame: x to its left, y up from its feet, z
// forward (0 = +z). Three-free, DOM-free, deterministic (a hash, never rng).

import {
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_GUARDIAN,
} from '../../sim/encounters/smith_heart/quench_ids';
import type { V3 } from './final_fx_core';

export type { V3 };
export { QUENCH_GUARDIAN };

/** The kits the pieces come from (render/smith_heart/heart_kit.ts urls). */
export const QUENCH_BODY_KITS = {
  quench: '/models/props/smith_heart_quench_kit.glb',
  heart: '/models/props/smith_heart_heart_kit.glb',
} as const;
export type QuenchBodyKit = keyof typeof QUENCH_BODY_KITS;

/** Feet to crown (yards): the manifest height (smith_heart_quench_guardian
 *  2.3) times the template's scale (content/smith_heart.ts 3). */
export const QUENCH_BODY_HEIGHT = 2.3 * 3;

/** The rig's joints, by index. */
export const QJ = {
  hip: 0,
  chest: 1,
  head: 2,
  shoulderL: 3,
  shoulderR: 4,
  elbowL: 5,
  elbowR: 6,
  wristL: 7,
  wristR: 8,
  kneeL: 9,
  kneeR: 10,
  footL: 11,
  footR: 12,
  maw: 13,
  back: 14,
  hipL: 15,
  hipR: 16,
} as const;
export const QUENCH_RIG_JOINTS = 17;

/** The rest joints (body frame). Side joints are given on the left (+x). */
export const QUENCH_SLOTS = {
  hip: v(0, 2.6, 0),
  chest: v(0, 4.25, 0.05),
  head: v(0, 5.95, 0.45),
  maw: v(0, 5.65, 1.2),
  back: v(0, 4.7, -0.95),
  shoulder: v(2.0, 5.0, 0),
  hipJoint: v(0.85, 2.45, 0),
  knee: v(0.95, 1.35, 0.32),
  foot: v(1.0, 0.25, 0.18),
} as const;

/** The arm: its root, its two lengths, the wrist at rest. */
export const QUENCH_ARM = {
  root: v(2.05, 4.95, 0.05),
  upper: 1.75,
  fore: 1.75,
  idle: v(2.45, 2.0, 0.85),
} as const;

/** How a piece is lit: plain stone (repainted the frost granite), clear ice,
 *  or the whole piece the lake's light (a crystal). */
export type QuenchPieceLight = 'stone' | 'ice' | 'crystal';

/** Where a piece sits: on one joint (an offset in the joint's frame), or
 *  spanning two (a limb: its length the distance between them). */
export interface QuenchBodyPiece {
  id: string;
  kit: QuenchBodyKit;
  node: string;
  /** The joint it rides (QJ), or the two it spans. */
  joint: number;
  to?: number;
  /** The head's frame (it lifts with the head) rather than the body's. */
  head?: boolean;
  size: V3;
  at: V3;
  tilt: V3;
  light: QuenchPieceLight;
}

function v(x: number, y: number, z: number): V3 {
  return { x, y, z };
}
const ZERO = v(0, 0, 0);

function on(
  id: string,
  kit: QuenchBodyKit,
  node: string,
  joint: number,
  size: V3,
  at: V3 = ZERO,
  tilt: V3 = ZERO,
  light: QuenchPieceLight = 'stone',
  head = false,
): QuenchBodyPiece {
  return { id, kit, node, joint, size, at, tilt, light, ...(head ? { head } : {}) };
}

function limb(
  id: string,
  kit: QuenchBodyKit,
  node: string,
  from: number,
  to: number,
  thick: V3,
  light: QuenchPieceLight = 'stone',
  tilt: V3 = ZERO,
): QuenchBodyPiece {
  return { id, kit, node, joint: from, to, size: thick, at: ZERO, tilt, light };
}

const J = QJ;

/** The body's pieces (the Heart kit's colossus rock and crystal, the Quench
 *  kit's ice). A limb's `size.y` is a share of its span (1: end to end). */
export const QUENCH_BODY_PIECES: readonly QuenchBodyPiece[] = [
  // The core of living stone.
  on('hip', 'heart', 'Kit_ColHip', J.hip, v(2.5, 1.35, 1.7)),
  on('torso', 'heart', 'Kit_ColTorso', J.chest, v(3.0, 2.5, 2.1)),
  on('head', 'heart', 'Kit_ColHead', J.head, v(1.45, 1.35, 1.55), ZERO, ZERO, 'stone', true),
  // The lake's light: a crystal heart in the chest's front.
  on(
    'heart',
    'heart',
    'Kit_HeartCrystal',
    J.chest,
    v(0.85, 1.25, 0.75),
    v(0, 0.05, 0.98),
    ZERO,
    'crystal',
  ),
  // Plates of clear lake ice over the chest, either side of the heart.
  on(
    'plateL',
    'quench',
    'Kit_IceBlade',
    J.chest,
    v(1.0, 1.9, 0.6),
    v(0.85, 0.15, 0.9),
    v(0.2, 0.25, -0.55),
    'ice',
  ),
  on(
    'plateR',
    'quench',
    'Kit_IceBlade',
    J.chest,
    v(1.0, 1.9, 0.6),
    v(-0.85, 0.15, 0.9),
    v(0.2, -0.25, 0.55),
    'ice',
  ),
  // The crest: great blades of ice rising off its back, raked behind it.
  on(
    'crestA',
    'quench',
    'Kit_IceBlade',
    J.back,
    v(1.1, 3.4, 0.8),
    v(0, 0.9, -0.1),
    v(-0.45, 0, 0),
    'ice',
  ),
  on(
    'crestB',
    'quench',
    'Kit_IceBlade',
    J.back,
    v(0.9, 2.6, 0.7),
    v(0.85, 0.55, 0.05),
    v(-0.4, 0.4, -0.35),
    'ice',
  ),
  on(
    'crestC',
    'quench',
    'Kit_IceBlade',
    J.back,
    v(0.9, 2.6, 0.7),
    v(-0.85, 0.55, 0.05),
    v(-0.4, -0.4, 0.35),
    'ice',
  ),
  // A crown of ice blades on the head.
  on(
    'crownA',
    'quench',
    'Kit_IceBlade',
    J.head,
    v(0.5, 1.6, 0.4),
    v(0, 0.95, -0.25),
    v(-0.35, 0, 0),
    'ice',
    true,
  ),
  on(
    'crownB',
    'quench',
    'Kit_IceBlade',
    J.head,
    v(0.42, 1.2, 0.35),
    v(0.5, 0.75, -0.15),
    v(-0.3, 0, -0.45),
    'ice',
    true,
  ),
  on(
    'crownC',
    'quench',
    'Kit_IceBlade',
    J.head,
    v(0.42, 1.2, 0.35),
    v(-0.5, 0.75, -0.15),
    v(-0.3, 0, 0.45),
    'ice',
    true,
  ),
  // The shoulders: rock, under pauldrons of heaved ice.
  on('shoulderL', 'heart', 'Kit_ColShoulder', J.shoulderL, v(1.65, 1.35, 1.65)),
  on('shoulderR', 'heart', 'Kit_ColShoulder', J.shoulderR, v(1.65, 1.35, 1.65)),
  on(
    'pauldronL',
    'quench',
    'Kit_IceBlade',
    J.shoulderL,
    v(0.8, 2.0, 0.7),
    v(0.3, 0.8, -0.1),
    v(0, 0, -0.55),
    'ice',
  ),
  on(
    'pauldronR',
    'quench',
    'Kit_IceBlade',
    J.shoulderR,
    v(0.8, 2.0, 0.7),
    v(-0.3, 0.8, -0.1),
    v(0, 0, 0.55),
    'ice',
  ),
  // The arms: rock above the elbow, frozen falls below, rock fists.
  limb('upperL', 'heart', 'Kit_ColUpperArm', J.shoulderL, J.elbowL, v(1.0, 1.05, 1.0)),
  limb('upperR', 'heart', 'Kit_ColUpperArm', J.shoulderR, J.elbowR, v(1.0, 1.05, 1.0)),
  limb('foreL', 'quench', 'Kit_FrozenFallA', J.elbowL, J.wristL, v(1.15, 1.05, 1.05), 'ice'),
  limb('foreR', 'quench', 'Kit_FrozenFallA', J.elbowR, J.wristR, v(1.15, 1.05, 1.05), 'ice'),
  on('fistL', 'heart', 'Kit_ColFist', J.wristL, v(1.2, 1.1, 1.2)),
  on('fistR', 'heart', 'Kit_ColFist', J.wristR, v(1.2, 1.1, 1.2)),
  // The legs: frost-cracked stone thighs, shins of frozen falls, stone feet.
  limb('thighL', 'quench', 'Kit_FrostStone', J.hipL, J.kneeL, v(1.25, 1.1, 1.2)),
  limb('thighR', 'quench', 'Kit_FrostStone', J.hipR, J.kneeR, v(1.25, 1.1, 1.2)),
  limb('shinL', 'quench', 'Kit_FrozenFallB', J.kneeL, J.footL, v(1.1, 1.15, 1.0), 'ice'),
  limb('shinR', 'quench', 'Kit_FrozenFallB', J.kneeR, J.footR, v(1.1, 1.15, 1.0), 'ice'),
  on('footL', 'heart', 'Kit_ColShardB', J.footL, v(1.3, 0.6, 1.7), v(0, 0, 0.3)),
  on('footR', 'heart', 'Kit_ColShardB', J.footR, v(1.3, 0.6, 1.7), v(0, 0, 0.3)),
];

/** The threads of the lake's cold light between the joints (QJ pairs). */
export const QUENCH_THREAD_PAIRS: readonly [number, number][] = [
  [J.hip, J.chest],
  [J.chest, J.head],
  [J.chest, J.shoulderL],
  [J.chest, J.shoulderR],
  [J.shoulderL, J.elbowL],
  [J.shoulderR, J.elbowR],
  [J.elbowL, J.wristL],
  [J.elbowR, J.wristR],
  [J.hipL, J.kneeL],
  [J.hipR, J.kneeR],
  [J.kneeL, J.footL],
  [J.kneeR, J.footR],
  [J.chest, J.back],
];

/** The joints the motes of cold light sit on. */
export const QUENCH_MOTE_JOINTS: readonly number[] = [
  J.chest,
  J.shoulderL,
  J.shoulderR,
  J.elbowL,
  J.elbowR,
  J.kneeL,
  J.kneeR,
];

/** The palette (linear 0..1, hex for the lights). The lake's blue is its
 *  light, never a threat colour. */
export const QUENCH_BODY_COLORS = {
  /** The frost-bound granite: a pale cold grey with blue in its shade. */
  granite: [0.62, 0.68, 0.76] as const,
  graniteShade: [0.3, 0.36, 0.46] as const,
  /** The threads, the heart and the eyes. */
  thread: 0x8fdcff,
  glow: 0xbfeeff,
  core: 0xe8f9ff,
  breath: [0.82, 0.92, 1.0] as const,
  mist: [0.7, 0.8, 0.9] as const,
  shard: [0.75, 0.9, 1.0] as const,
} as const;

// ---- the motion -----------------------------------------------------------------------

/** What the body is doing. */
export type QuenchBodyAction =
  | 'idle'
  | 'swing'
  | 'strike'
  | 'breath'
  | 'exhale'
  | 'wake'
  | 'raised';

/** The fight's state as the body reads it (all mirrored entity state, plus
 *  the painter's own clocks of the cues it saw). */
export interface QuenchBodyInput {
  castId: string | null;
  castFill: number;
  /** Seconds since the breath landed (its exhale), Infinity: never. */
  sinceBreath: number;
  /** Seconds since Tempering Strike's swing, Infinity: never. */
  sinceStrike: number;
  /** Seconds since a plain melee swing, Infinity: never. */
  sinceSwing: number;
  /** Seconds since the blades woke (its arms come down), Infinity: never. */
  sinceWake: number;
  /** The blades are awake (phase 2). */
  awake: boolean;
}

export interface QuenchBodyActionState {
  action: QuenchBodyAction;
  k: number;
}

/** Seconds of each one-shot motion. */
export const QUENCH_SWING_SECONDS = 0.85;
export const QUENCH_STRIKE_SECONDS = 1.1;
export const QUENCH_EXHALE_SECONDS = 0.9;
export const QUENCH_RAISED_SECONDS = 1.2;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** The action and its clock (0..1) for the body's input, written into `out`
 *  (no allocation on the frame path). The bars first, then the one-shots. */
export function quenchBodyAction(
  input: QuenchBodyInput,
  out: QuenchBodyActionState = { action: 'idle', k: 0 },
): QuenchBodyActionState {
  if (input.castId === QUENCH_CASTS.wake) {
    out.action = 'wake';
    out.k = clamp01(input.castFill);
  } else if (input.castId === QUENCH_CASTS.breath) {
    out.action = 'breath';
    out.k = clamp01(input.castFill);
  } else if (input.sinceWake < QUENCH_RAISED_SECONDS) {
    out.action = 'raised';
    out.k = input.sinceWake / QUENCH_RAISED_SECONDS;
  } else if (input.sinceBreath < QUENCH_EXHALE_SECONDS) {
    out.action = 'exhale';
    out.k = input.sinceBreath / QUENCH_EXHALE_SECONDS;
  } else if (input.sinceStrike < QUENCH_STRIKE_SECONDS) {
    out.action = 'strike';
    out.k = input.sinceStrike / QUENCH_STRIKE_SECONDS;
  } else if (input.sinceSwing < QUENCH_SWING_SECONDS) {
    out.action = 'swing';
    out.k = input.sinceSwing / QUENCH_SWING_SECONDS;
  } else {
    out.action = 'idle';
    out.k = 0;
  }
  return out;
}

/** The body's look: the chest's swell (0..1, past 1 drawn in hard), the
 *  head's lift (radians back), the lean (forward), the light (its heart and
 *  threads), the crest's light (the blades' kin, brighter once awake), the
 *  frost breath out of the maw (0..1). */
export interface QuenchBodyLook {
  swell: number;
  lift: number;
  lean: number;
  glow: number;
  crest: number;
  breath: number;
}

/** The look of `action` at `k`, the slow idle breath on render time `t`. */
export function quenchBodyLook(
  action: QuenchBodyAction,
  k: number,
  t: number,
  awake: boolean,
  out: QuenchBodyLook = { swell: 0, lift: 0, lean: 0, glow: 0, crest: 0, breath: 0 },
): QuenchBodyLook {
  const idle = 0.5 + 0.2 * Math.sin((t * Math.PI * 2) / 5.2);
  out.swell = idle;
  out.lift = 0.03 * Math.sin((t * Math.PI * 2) / 5.2);
  out.lean = 0.04;
  out.glow = 0.9 + 0.2 * idle;
  out.crest = awake ? 1.4 + 0.3 * Math.sin(t * 2.3) : 0.6;
  // A slow plume of frost on every out-breath.
  out.breath = 0.25 * clamp01(Math.sin((t * Math.PI * 2) / 5.2 + 1.2));
  const p = clamp01(k);
  switch (action) {
    case 'breath':
      // Rears back and fills with the cold, its heart blazing.
      out.swell = idle + (1.35 - idle) * ease(p);
      out.lift = 0.38 * ease(p);
      out.lean = -0.18 * ease(p);
      out.glow = 1.1 + 1.6 * ease(p);
      out.breath = 0.1;
      break;
    case 'exhale':
      // Throws the cold out down its cone: hunched forward, head down.
      out.swell = 1.35 - 1.0 * ease(p * 1.6);
      out.lift = 0.38 - 0.62 * ease(p * 2.2);
      out.lean = -0.18 + 0.5 * ease(p * 2.2) - 0.25 * ease((p - 0.5) * 2);
      out.glow = 2.6 - 1.4 * p;
      out.breath = 1.2 * (1 - p);
      break;
    case 'strike':
      // Both fists raised and brought down on the ice before it.
      out.lean = p < 0.35 ? -0.12 * ease(p / 0.35) : -0.12 + 0.45 * ease((p - 0.35) / 0.35);
      out.lift = p < 0.35 ? 0.2 * ease(p / 0.35) : 0.2 - 0.35 * ease((p - 0.35) / 0.35);
      out.glow = 1.2 + 0.6 * (p < 0.5 ? p * 2 : (1 - p) * 2);
      break;
    case 'swing':
      out.lean = 0.1 * Math.sin(p * Math.PI);
      break;
    case 'wake':
      // Raises its arms to the sky, the cold gathering in it and its crest.
      out.lift = 0.45 * ease(p);
      out.lean = -0.2 * ease(p);
      out.swell = idle + (1.3 - idle) * ease(p);
      out.glow = 1.2 + 2.4 * ease(p);
      out.crest = 0.6 + 2.6 * ease(p);
      break;
    case 'raised':
      // The blades answer: its arms thrown down, the light flaring out.
      out.lift = 0.45 - 0.5 * ease(p * 1.5);
      out.lean = -0.2 + 0.35 * ease(p * 1.5) - 0.15 * ease((p - 0.5) * 2);
      out.glow = 3.6 - 2.2 * p;
      out.crest = 3.2 - 1.6 * p;
      break;
    default:
      break;
  }
  return out;
}

function lerpInto(
  out: V3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  s: number,
): V3 {
  out.x = ax + (bx - ax) * s;
  out.y = ay + (by - ay) * s;
  out.z = az + (bz - az) * s;
  return out;
}

/** Where one wrist (side 1 left, -1 right) wants to be (body frame) for an
 *  action at `k`, written into `out` (no allocation on the frame path). */
export function quenchWristTarget(
  action: QuenchBodyAction,
  side: -1 | 1,
  k: number,
  swingSide: -1 | 1 = 1,
  out: V3 = v(0, 0, 0),
): V3 {
  const I = QUENCH_ARM.idle;
  const R = QUENCH_ARM.root;
  const reach = QUENCH_ARM.upper + QUENCH_ARM.fore;
  const ix = side * I.x;
  const iy = I.y;
  const iz = I.z;
  const p = clamp01(k);
  switch (action) {
    case 'swing': {
      if (side !== swingSide) return lerpInto(out, ix, iy, iz, ix, iy, iz, 0);
      const bx = side * (R.x + 0.4);
      const by = R.y + 0.8;
      const bz = -0.5;
      if (p < 0.4) return lerpInto(out, ix, iy, iz, bx, by, bz, ease(p / 0.4));
      return lerpInto(
        out,
        bx,
        by,
        bz,
        side * 0.6,
        R.y - reach * 0.6,
        reach * 0.7,
        ease((p - 0.4) / 0.6),
      );
    }
    case 'strike': {
      // Overhead, then down on the ice before it.
      const ux = side * 1.0;
      const uy = R.y + reach * 0.85;
      const uz = -0.2;
      if (p < 0.35) return lerpInto(out, ix, iy, iz, ux, uy, uz, ease(p / 0.35));
      if (p < 0.6) return lerpInto(out, ux, uy, uz, side * 0.8, 0.9, 2.9, ease((p - 0.35) / 0.25));
      return lerpInto(out, side * 0.8, 0.9, 2.9, ix, iy, iz, ease((p - 0.6) / 0.4));
    }
    case 'breath':
      // Drawn out and back as the chest fills.
      return lerpInto(out, ix, iy, iz, side * (R.x + reach * 0.5), R.y - 0.6, -1.0, ease(p));
    case 'exhale':
      return lerpInto(
        out,
        side * (R.x + reach * 0.5),
        R.y - 0.6,
        -1.0,
        side * 1.7,
        R.y - 1.6,
        1.9,
        ease(p * 2),
      );
    case 'wake':
      // Both arms raised to the sky.
      return lerpInto(out, ix, iy, iz, side * (R.x + 0.4), R.y + reach * 0.92, 0.3, ease(p * 1.3));
    case 'raised': {
      const hx = side * (R.x + 0.4);
      const hy = R.y + reach * 0.92;
      if (p < 0.35) return lerpInto(out, hx, hy, 0.3, side * 1.4, 1.2, 2.2, ease(p / 0.35));
      return lerpInto(out, side * 1.4, 1.2, 2.2, ix, iy, iz, ease((p - 0.35) / 0.65));
    }
    default:
      return lerpInto(out, ix, iy, iz, ix, iy, iz, 0);
  }
}

/** One arm's solved joints (body frame). */
export interface QuenchArmJoints {
  elbow: V3;
  wrist: V3;
}

/** One arm's elbow and wrist (body frame) toward `wrist`, written into `out`:
 *  the shared two-bone solve (as breath_body_core.ts breathArm), in scalars
 *  so the frame path allocates nothing; the elbow's pole out and back. */
export function quenchArm(
  side: -1 | 1,
  wrist: V3,
  out: QuenchArmJoints = { elbow: v(0, 0, 0), wrist: v(0, 0, 0) },
): QuenchArmJoints {
  const R = QUENCH_ARM.root;
  const l1 = QUENCH_ARM.upper;
  const l2 = QUENCH_ARM.fore;
  const sx = side * R.x;
  const sy = R.y;
  const sz = R.z;
  let dx = wrist.x - sx;
  let dy = wrist.y - sy;
  let dz = wrist.z - sz;
  let d = Math.hypot(dx, dy, dz);
  const reach = (l1 + l2) * 0.999;
  const lo = Math.abs(l1 - l2) * 1.001 + 1e-6;
  const dd = Math.max(lo, Math.min(reach, d || lo));
  if (d < 1e-9) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1;
  }
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  out.wrist.x = sx + ux * dd;
  out.wrist.y = sy + uy * dd;
  out.wrist.z = sz + uz * dd;
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const polX = side * 0.8;
  const polY = -0.2;
  const polZ = -0.6;
  const pd = polX * ux + polY * uy + polZ * uz;
  let px = polX - ux * pd;
  let py = polY - uy * pd;
  let pz = polZ - uz * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  out.elbow.x = sx + ux * a + px * h;
  out.elbow.y = sy + uy * a + py * h;
  out.elbow.z = sz + uz * a + pz * h;
  return out;
}

/** A small integer hash in [0, 1). */
export function quenchBodyHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x1b873593)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The fall: when its pieces drop after its death, and where each lies
 *  (body frame), tumbled, round where it stood. */
export const QUENCH_FALL = { end: 2.6 } as const;

export function quenchFallRest(index: number, from: V3): { at: V3; tilt: V3; delay: number } {
  const a = quenchBodyHash(index, 31) * Math.PI * 2;
  const r = 1.0 + quenchBodyHash(index, 37) * 3.2;
  return {
    at: v(from.x * 0.5 + Math.sin(a) * r, 0.35, from.z * 0.5 + Math.cos(a) * r),
    tilt: v(
      (quenchBodyHash(index, 41) - 0.5) * 2.4,
      quenchBodyHash(index, 43) * 6.28,
      (quenchBodyHash(index, 47) - 0.5) * 2.4,
    ),
    delay: Math.min(0.9, from.y * 0.07) + quenchBodyHash(index, 53) * 0.25,
  };
}

/** A piece's fall `t` seconds into the death: 0..1 and whether it landed. */
export function quenchFallProgress(
  t: number,
  delay: number,
  out: { k: number; landed: boolean } = { k: 0, landed: false },
): { k: number; landed: boolean } {
  const k = clamp01((t - delay) / 0.75);
  out.k = k * k;
  out.landed = k >= 1;
  return out;
}

/** Are the blades awake (the marker on the guardian)? */
export function bladesAwakeOn(auras: readonly { id: string }[]): boolean {
  for (const a of auras) if (a.id === QUENCH_AURAS.awake) return true;
  return false;
}

/** The tallest point of the body at rest (its crest's tip). */
export function quenchBodyTop(): number {
  let top = 0;
  for (const p of QUENCH_BODY_PIECES) {
    if (p.to !== undefined) continue;
    const j = restJoint(p.joint);
    top = Math.max(top, j.y + p.at.y + p.size.y / 2);
  }
  return top;
}

/** A joint's rest place (body frame). */
export function restJoint(i: number, out: V3 = v(0, 0, 0)): V3 {
  const S = QUENCH_SLOTS;
  const set = (p: V3, side = 1) => {
    out.x = p.x * side;
    out.y = p.y;
    out.z = p.z;
    return out;
  };
  switch (i) {
    case J.hip:
      return set(S.hip);
    case J.chest:
      return set(S.chest);
    case J.head:
      return set(S.head);
    case J.maw:
      return set(S.maw);
    case J.back:
      return set(S.back);
    case J.shoulderL:
      return set(S.shoulder);
    case J.shoulderR:
      return set(S.shoulder, -1);
    case J.hipL:
      return set(S.hipJoint);
    case J.hipR:
      return set(S.hipJoint, -1);
    case J.kneeL:
      return set(S.knee);
    case J.kneeR:
      return set(S.knee, -1);
    case J.footL:
      return set(S.foot);
    case J.footR:
      return set(S.foot, -1);
    case J.elbowL:
    case J.elbowR:
    case J.wristL:
    case J.wristR: {
      const side: -1 | 1 = i === J.elbowL || i === J.wristL ? 1 : -1;
      const w = quenchArm(side, {
        x: side * QUENCH_ARM.idle.x,
        y: QUENCH_ARM.idle.y,
        z: QUENCH_ARM.idle.z,
      });
      return set(i === J.elbowL || i === J.elbowR ? w.elbow : w.wrist);
    }
    default:
      return set(ZERO);
  }
}

/** Pools at full density. */
export const QUENCH_BODY_POOLS = { threads: QUENCH_THREAD_PAIRS.length } as const;
