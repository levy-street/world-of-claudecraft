// Pure plan of the Guardian of the Breath's provisional body (breath_body.ts
// paints it; docs/design/raid/smith_heart.md sections 5.14 and 7.2). The
// Breath vein's art rule: primal and divine, living granite, crystal and
// storm, NOTHING metal and no machinery. The "bellows" is a creature that
// breathes: a great chest of storm granite flanked by two bellows plates
// (the Breath kit's scalloped windbreaks) that swell out and fall in with
// every breath, a wind-horn for a mouth (its bell open forward, the vein's
// light deep in its throat), wings of fluted wind-blades on its back, crystal
// spines down its spine, heavy arms of the mountain's rock ending in
// wind-carved claws, and no legs: below the waist it thins into a whirl of
// loose stones turning in its own wind. About three and a half players tall.
//
// At half health the storm breaks (its 'heart_breath_storm_break' bar): it
// draws the wind in, freezes, and tears open. Through phase 2 it is a body of
// LIGHTNING, a different shape and material: every stone flies off its joint
// into a ring of shards turning round a core of living lightning (a tall
// storm figure, lightning wings, a white crystal heart), arcs leaping from
// the core to the shards.
//
// The JOINTS and the TIMELINES (the slots, the arms, the poses, the shell's
// orbit) are kept apart from the PIECES (which kit node sits on which joint,
// at what size), so the official pipeline's model replaces the pieces and
// keeps the joints.
//
// Sizes in yards in the body's frame: x to its left, y up from its feet, z
// forward (0 = +z). Three-free, DOM-free, deterministic (a hash, never rng).

import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_GUARDIAN,
  type BreathWindPhase,
} from '../../sim/encounters/smith_heart/breath_ids';
import type { V3 } from './final_fx_core';

export type { V3 };

export { BREATH_GUARDIAN };

/** The kits the pieces come from (render/smith_heart/heart_kit.ts urls). */
export const BREATH_BODY_KITS = {
  breath: '/models/props/smith_heart_breath_kit.glb',
  heart: '/models/props/smith_heart_heart_kit.glb',
} as const;
export type BreathBodyKit = keyof typeof BREATH_BODY_KITS;

/** Feet to crown (yards): the manifest height (smith_heart_breath_guardian
 *  2.0) times the template's scale (content/smith_heart.ts 3.4). */
export const BREATH_BODY_HEIGHT = 2.0 * 3.4;

/** A joint a piece rides. Side joints are mirrored; `whirl` pieces orbit
 *  under the waist. */
export type BreathJoint =
  | 'whirl'
  | 'waist'
  | 'chest'
  | 'lung'
  | 'heart'
  | 'head'
  | 'mouth'
  | 'horn'
  | 'wing'
  | 'spine'
  | 'shoulder'
  | 'upper'
  | 'fore'
  | 'hand';

/** How a piece is lit: plain stone, its ':glow' meshes on the body's light,
 *  or the whole piece a crystal. */
export type BreathPieceLight = 'stone' | 'seam' | 'crystal';

export interface BreathBodyPiece {
  id: string;
  kit: BreathBodyKit;
  node: string;
  joint: BreathJoint;
  side: -1 | 0 | 1;
  size: V3;
  at: V3;
  tilt: V3;
  light: BreathPieceLight;
}

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const ZERO = v(0, 0, 0);

function piece(
  id: string,
  kit: BreathBodyKit,
  node: string,
  joint: BreathJoint,
  side: -1 | 0 | 1,
  size: V3,
  at: V3 = ZERO,
  tilt: V3 = ZERO,
  light: BreathPieceLight = 'seam',
): BreathBodyPiece {
  return { id, kit, node, joint, side, size, at, tilt, light };
}

/** The fixed joints (body frame; a side joint's x is its left one). */
export const BREATH_SLOTS = {
  whirl: v(0, 0.9, 0),
  waist: v(0, 2.2, 0),
  chest: v(0, 3.9, 0),
  lung: v(1.75, 3.85, -0.1),
  heart: v(0, 3.7, 1.05),
  head: v(0, 5.55, 0.75),
  mouth: v(0, 5.3, 1.9),
  horn: v(0.65, 6.15, 0.45),
  wing: v(1.15, 4.9, -1.05),
  spine: v(0, 4.5, -1.35),
  shoulder: v(2.15, 4.85, 0.05),
} as const;

/** The arm: the shoulder joint, its two lengths, the wrist at rest. */
export const BREATH_ARM = {
  root: v(2.3, 4.7, 0.1),
  upper: 1.75,
  fore: 1.7,
  idle: v(2.8, 2.3, 0.9),
} as const;

/** The whirl under its waist: how many loose stones, how far out, how fast. */
export const BREATH_WHIRL = { count: 7, r: 1.55, y: 0.9, spin: 1.15 } as const;

/** The body's pieces (the Breath kit's storm granite and the Heart kit's
 *  rock and crystal). */
export const BREATH_BODY_PIECES: readonly BreathBodyPiece[] = [
  // The waist: two of the Cornice's rod drums stacked and turned.
  piece('waist', 'breath', 'Kit_StormRod', 'waist', 0, v(1.9, 1.7, 1.7), ZERO, v(0, 0.4, 0)),
  // The chest: the mountain's torso block, a broad barrel.
  piece('chest', 'heart', 'Kit_ColTorso', 'chest', 0, v(3.0, 2.5, 2.3)),
  // The bellows: two thick scalloped windbreaks either side of the chest,
  // their scallops out, swelling with each breath.
  piece('lungL', 'breath', 'Kit_WindShelter', 'lung', 1, v(1.0, 2.6, 2.7), ZERO, v(0, 1.57, 0.1)),
  piece('lungR', 'breath', 'Kit_WindShelter', 'lung', -1, v(1.0, 2.6, 2.7), ZERO, v(0, 1.57, 0.1)),
  // The lungs' light: a crystal heart set in the chest's front.
  piece('heart', 'heart', 'Kit_HeartCrystal', 'heart', 0, v(1.0, 1.4, 0.8), ZERO, ZERO, 'crystal'),
  // The head: a heavy brow of rock, two fluted horns raking back.
  piece('head', 'heart', 'Kit_ColHead', 'head', 0, v(1.45, 1.3, 1.5)),
  piece(
    'hornL',
    'breath',
    'Kit_ChannelJamb',
    'horn',
    1,
    v(0.35, 1.7, 0.45),
    ZERO,
    v(-0.65, 0, -0.35),
  ),
  piece(
    'hornR',
    'breath',
    'Kit_ChannelJamb',
    'horn',
    -1,
    v(0.35, 1.7, 0.45),
    ZERO,
    v(-0.65, 0, -0.35),
  ),
  // The mouth: a stone wind-horn, its bell open forward (the bellows' throat).
  piece('mouth', 'breath', 'Kit_WindHorn', 'mouth', 0, v(1.15, 1.05, 2.1)),
  // The wings: two pairs of fluted wind-blades fanning off its back.
  piece('wingL', 'breath', 'Kit_ChannelJamb', 'wing', 1, v(0.6, 4.4, 0.95), ZERO, v(-0.3, 0, -0.6)),
  piece(
    'wingR',
    'breath',
    'Kit_ChannelJamb',
    'wing',
    -1,
    v(0.6, 4.4, 0.95),
    ZERO,
    v(-0.3, 0, -0.6),
  ),
  piece(
    'wingLowL',
    'breath',
    'Kit_ChannelJamb',
    'wing',
    1,
    v(0.45, 3.0, 0.75),
    v(0.55, -1.2, 0.2),
    v(-0.45, 0, -1.05),
  ),
  piece(
    'wingLowR',
    'breath',
    'Kit_ChannelJamb',
    'wing',
    -1,
    v(0.45, 3.0, 0.75),
    v(0.55, -1.2, 0.2),
    v(-0.45, 0, -1.05),
  ),
  // The crystal spines down its back.
  piece(
    'spine0',
    'heart',
    'Kit_ColShardA',
    'spine',
    0,
    v(0.55, 1.5, 0.5),
    v(0, 1.0, 0.1),
    v(-0.5, 0, 0),
    'crystal',
  ),
  piece(
    'spine1',
    'heart',
    'Kit_ColShardB',
    'spine',
    0,
    v(0.5, 1.2, 0.45),
    v(0, 0, 0),
    v(-0.7, 0, 0),
    'crystal',
  ),
  piece(
    'spine2',
    'heart',
    'Kit_ColShardC',
    'spine',
    0,
    v(0.42, 0.95, 0.4),
    v(0, -0.9, -0.05),
    v(-0.9, 0, 0),
    'crystal',
  ),
  // The shoulders and the arms of the mountain's rock.
  piece('shoulderL', 'heart', 'Kit_ColShoulder', 'shoulder', 1, v(1.5, 1.2, 1.5)),
  piece('shoulderR', 'heart', 'Kit_ColShoulder', 'shoulder', -1, v(1.5, 1.2, 1.5)),
  piece('upperL', 'heart', 'Kit_ColUpperArm', 'upper', 1, v(0.8, 1.85, 0.8)),
  piece('upperR', 'heart', 'Kit_ColUpperArm', 'upper', -1, v(0.8, 1.85, 0.8)),
  piece('foreL', 'heart', 'Kit_ColForearm', 'fore', 1, v(0.72, 1.75, 0.72)),
  piece('foreR', 'heart', 'Kit_ColForearm', 'fore', -1, v(0.72, 1.75, 0.72)),
  // The hands: wind-carved standing stones, twisted into claws.
  piece('handL', 'breath', 'Kit_StormStone', 'hand', 1, v(0.85, 1.25, 0.75)),
  piece('handR', 'breath', 'Kit_StormStone', 'hand', -1, v(0.85, 1.25, 0.75)),
  // The whirl of loose stones under the waist.
  ...Array.from({ length: BREATH_WHIRL.count }, (_, i) =>
    piece(
      `whirl${i}`,
      i % 2 ? 'heart' : 'breath',
      i % 2 ? (i % 4 === 1 ? 'Kit_ColShardA' : 'Kit_ColShardB') : 'Kit_StormStone',
      'whirl',
      0,
      v(0.55 + 0.12 * (i % 3), 0.6 + 0.15 * (i % 2), 0.5),
      ZERO,
      v(0.3, i * 0.9, 0.4),
      i % 2 ? 'crystal' : 'stone',
    ),
  ),
];

/** The palette. The vein's teal is its light; never a threat colour. */
export const BREATH_BODY_COLORS = {
  /** The threads and seams: the Breath's teal. */
  thread: 0x5ab8e8,
  /** The crystals' hotter glow. */
  glow: 0x9fe4ff,
  /** The storm's lightning core: white with a teal edge. */
  core: 0xe6faff,
  coreEdge: 0x47b8ff,
  /** Its storm granite (LINEAR vertex rgb): a cool slate, a value darker
   *  than the pale scoured Cornice it stands on, so it reads against it. */
  granite: [0.2, 0.22, 0.26] as const,
  wind: [0.86, 0.93, 0.98] as const,
  spark: [0.7, 0.93, 1.0] as const,
  dust: [0.58, 0.62, 0.66] as const,
} as const;

/** The threads between the joints (indices into the rig's joint points). */
export const BREATH_RIG_JOINTS = 12;
/** 0 whirl, 1 waist, 2 chest, 3 head, 4 shoulderL, 5 shoulderR, 6 elbowL,
 *  7 elbowR, 8 wristL, 9 wristR, 10 mouth, 11 spine. */
export const BREATH_THREAD_PAIRS: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [2, 4],
  [2, 5],
  [4, 6],
  [5, 7],
  [6, 8],
  [7, 9],
  [3, 10],
  [2, 11],
];

/** The joints the embers of light sit on. */
export const BREATH_EMBER_JOINTS: readonly number[] = [1, 2, 4, 5, 6, 7, 10];

// ---- what the body is doing -------------------------------------------------------------

export type BreathBodyAction =
  | 'idle'
  | 'swing'
  | 'gather'
  | 'blow'
  | 'calm'
  | 'inhale'
  | 'gust'
  | 'cast'
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
  let action: BreathBodyAction = 'idle';
  let k = 0;
  if (c === BREATH_CASTS.storm) {
    action = 'break';
    k = input.castFill;
  } else if (c === BREATH_CASTS.inhale) {
    action = 'inhale';
    k = input.castFill;
  } else if (c === BREATH_CASTS.gust) {
    action = 'gust';
    k = input.castFill;
  } else if (
    c === BREATH_CASTS.fork ||
    c === BREATH_CASTS.cradle ||
    c === BREATH_CASTS.drawn ||
    c === BREATH_CASTS.lance
  ) {
    action = 'cast';
    k = input.castFill;
  } else if (input.stormForm) {
    if (input.windPhase === 'gust') {
      action = 'blow';
      k = input.windFill;
    } else if (input.windPhase === 'gustgather') {
      action = 'gather';
      k = input.windFill;
    } else action = 'storm';
  } else if (input.windPhase === 'gather') {
    action = 'gather';
    k = input.windFill;
  } else if (input.windPhase === 'blow') {
    action = 'blow';
    k = input.windFill;
  } else if (input.windPhase === 'calm') {
    action = 'calm';
    k = input.windFill;
  }
  out.action = action;
  out.k = k;
  return out;
}

/** Does the body turn its mouth to the wind's bearing in this action? */
export function breathFacesWind(action: BreathBodyAction): boolean {
  return action === 'gather' || action === 'blow';
}

/** The body's look for an action: the bellows' swell (0 empty, 1 full, over
 *  1 drawn in hard), the head's lift (radians back), the lean (forward), the
 *  wings' spread (0 folded, 1 open), the mouth's breath (how hard it blows),
 *  the light, a freeze's jitter and the storm's tearing (0..1). */
export interface BreathBodyLook {
  swell: number;
  lift: number;
  lean: number;
  spread: number;
  mouth: number;
  glow: number;
  jitter: number;
  tear: number;
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** When in the storm bar the drawing in turns to the freeze, and the freeze
 *  to the tearing. */
export const BREAK_FREEZE_AT = 0.55;
export const BREAK_TEAR_AT = 0.86;
/** Seconds the shell takes to fly out to its orbit once the storm body is on. */
export const STORM_TEAR_SECONDS = 1.3;
/** Seconds of a melee swing's pose. */
export const BREATH_SWING_SECONDS = 0.85;

/** The look of `action` at `k`, the slow idle breath on render time `t`. */
export function breathBodyLook(
  action: BreathBodyAction,
  k: number,
  t: number,
  out: BreathBodyLook = {
    swell: 0,
    lift: 0,
    lean: 0,
    spread: 0,
    mouth: 0,
    glow: 0,
    jitter: 0,
    tear: 0,
  },
): BreathBodyLook {
  const idle = 0.5 + 0.22 * Math.sin((t * Math.PI * 2) / 4.4);
  out.swell = idle;
  out.lift = 0.04 * Math.sin((t * Math.PI * 2) / 4.4);
  out.lean = 0;
  out.spread = 0.45 + 0.1 * Math.sin((t * Math.PI * 2) / 4.4 + 0.6);
  out.mouth = 0;
  out.glow = 0.9 + 0.25 * idle;
  out.jitter = 0;
  out.tear = 0;
  const p = clamp01(k);
  switch (action) {
    case 'gather':
      // Drawing breath for the blow, turning to it.
      out.swell = idle + (1.15 - idle) * ease(p);
      out.lift = 0.18 * ease(p);
      out.spread = 0.45 + 0.5 * ease(p);
      out.glow = 1 + 0.6 * ease(p);
      break;
    case 'blow':
      // A long steady exhale: the bellows falling in, wings back, head out.
      out.swell = 1.15 - 1.0 * ease(p * 1.05);
      out.lift = -0.08;
      out.lean = 0.16;
      out.spread = 0.95 - 0.25 * p;
      out.mouth = 1 - 0.3 * p;
      out.glow = 1.5 - 0.4 * p;
      break;
    case 'calm':
      out.swell = 0.15 + (idle - 0.15) * ease(p * 2);
      out.glow = 0.9 + 0.25 * idle * ease(p * 2);
      break;
    case 'inhale':
      // The great indrawn breath: swelling past full, head flung back,
      // wings folding forward round it, its heart blazing.
      out.swell = 0.3 + 1.15 * ease(p);
      out.lift = 0.32 * ease(p);
      out.lean = -0.1 * ease(p);
      out.spread = 0.45 - 0.35 * ease(p);
      out.glow = 1.2 + 1.3 * ease(p);
      break;
    case 'gust':
      // The exhale's blast gathered: hunched forward, everything held, then
      // thrown out at the bar's end.
      out.swell = 1.45 - 0.2 * ease(p) - (p > 0.88 ? 1.1 * ease((p - 0.88) / 0.12) : 0);
      out.lift = 0.3 - 0.45 * ease(p);
      out.lean = 0.35 * ease(p);
      out.spread = 0.1 + (p > 0.88 ? 0.95 * ease((p - 0.88) / 0.12) : 0);
      out.mouth = p > 0.88 ? 1.5 : 0.25 * p;
      out.glow = 2.2;
      break;
    case 'cast':
      out.lean = 0.12 * ease(p);
      out.glow = 1.2 + 0.8 * ease(p);
      break;
    case 'break':
      if (p < BREAK_FREEZE_AT) {
        // Draws the whole wind in.
        const q = p / BREAK_FREEZE_AT;
        out.swell = 0.4 + 1.2 * ease(q);
        out.lift = 0.35 * ease(q);
        out.spread = 0.45 + 0.55 * ease(q);
        out.glow = 1.2 + 1.8 * ease(q);
      } else if (p < BREAK_TEAR_AT) {
        // Frozen, trembling, the light tearing through every seam.
        const q = (p - BREAK_FREEZE_AT) / (BREAK_TEAR_AT - BREAK_FREEZE_AT);
        out.swell = 1.6;
        out.lift = 0.35;
        out.spread = 1;
        out.glow = 3 + 1.5 * q;
        out.jitter = 0.4 + 0.6 * q;
      } else {
        // Tearing open: the shell starts out toward its orbit.
        const q = (p - BREAK_TEAR_AT) / (1 - BREAK_TEAR_AT);
        out.swell = 1.6 + 0.4 * q;
        out.lift = 0.35;
        out.spread = 1;
        out.glow = 4.5;
        out.jitter = 1;
        out.tear = 0.25 * ease(q);
      }
      break;
    case 'storm':
      out.tear = 1;
      out.glow = 1.3 + 0.3 * Math.sin(t * 7.1) * Math.sin(t * 3.3);
      break;
    default:
      break;
  }
  return out;
}

/** How far the shell has torn out toward its orbit `since` seconds after the
 *  storm body went on (0..1), from where the bar's tearing left it. */
export function stormTearProgress(since: number, from = 0.25): number {
  return from + (1 - from) * ease(since / STORM_TEAR_SECONDS);
}

/** Where a piece of the torn shell turns in the storm (body frame): rings of
 *  shards round the core at three radii and heights, each ring the other way
 *  round, every shard tumbling. */
export function stormShardSlot(index: number, t: number, out: V3 = v(0, 0, 0)): V3 {
  const ring = index % 3;
  const r = [2.7, 3.5, 4.3][ring];
  const y = [5.6, 3.6, 1.8][ring] + 0.35 * Math.sin(t * 1.3 + index);
  const spin = [0.55, -0.42, 0.33][ring];
  const a = index * 2.399 + t * spin;
  out.x = Math.sin(a) * r;
  out.y = y;
  out.z = Math.cos(a) * r;
  return out;
}

/** The storm core's figure (body frame): its torso, head and heart, and the
 *  span of its lightning wings. */
export const STORM_CORE = {
  torso: { y: 3.9, rx: 1.15, ry: 2.1, rz: 0.95 },
  head: { y: 6.1, r: 0.62 },
  heart: { y: 4.1, r: 0.55 },
  wingSpan: 6.4,
  wingHeight: 4.2,
  wingY: 5.2,
  /** Arcs leaping from the core to the shards (a fixed pool). */
  arcs: 10,
  /** Times a second the arcs leap anew. */
  arcRate: 9,
} as const;

/** Where a loose stone of the whirl turns (body frame). */
export function whirlSlot(index: number, t: number, out: V3 = v(0, 0, 0)): V3 {
  const a = (index / BREATH_WHIRL.count) * Math.PI * 2 + t * BREATH_WHIRL.spin;
  const r = BREATH_WHIRL.r * (0.75 + 0.25 * Math.sin(t * 1.7 + index));
  out.x = Math.sin(a) * r;
  out.y = BREATH_WHIRL.y + 0.45 * Math.sin(t * 2.1 + index * 1.3) + (index % 3) * 0.35;
  out.z = Math.cos(a) * r;
  return out;
}

/** `out` set `s` of the way from (ax, ay, az) to (bx, by, bz). */
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
export function breathWristTarget(
  action: BreathBodyAction,
  side: -1 | 1,
  k: number,
  swingSide: -1 | 1 = 1,
  out: V3 = v(0, 0, 0),
): V3 {
  const I = BREATH_ARM.idle;
  const R = BREATH_ARM.root;
  const reach = BREATH_ARM.upper + BREATH_ARM.fore;
  const ix = side * I.x;
  const iy = I.y;
  const iz = I.z;
  const p = clamp01(k);
  switch (action) {
    case 'swing': {
      if (side !== swingSide) return lerpInto(out, ix, iy, iz, ix, iy, iz, 0);
      // Back, then down and through.
      const bx = side * (R.x + 0.4);
      const by = R.y + 0.6;
      const bz = -0.6;
      if (p < 0.4) return lerpInto(out, ix, iy, iz, bx, by, bz, ease(p / 0.4));
      return lerpInto(
        out,
        bx,
        by,
        bz,
        side * R.x * 0.4,
        R.y - reach * 0.55,
        reach * 0.66,
        ease((p - 0.4) / 0.6),
      );
    }
    case 'inhale':
    case 'gather':
      // The arms drawn out and back as the chest fills.
      return lerpInto(out, ix, iy, iz, side * (R.x + reach * 0.55), R.y - 0.4, -0.6, ease(p));
    case 'blow':
      return lerpInto(out, ix, iy, iz, side * (R.x + reach * 0.4), R.y - 1.0, -0.9, 0.8);
    case 'gust': {
      // Clasped in before it, thrown wide as it blasts.
      const cx = side * 0.9;
      const cy = R.y - 1.3;
      const cz = 1.6;
      if (p < 0.88) return lerpInto(out, ix, iy, iz, cx, cy, cz, ease(p / 0.88));
      return lerpInto(
        out,
        cx,
        cy,
        cz,
        side * (R.x + reach * 0.8),
        R.y + 0.4,
        0.4,
        ease((p - 0.88) / 0.12),
      );
    }
    case 'cast':
      // The left arm raised to the storm, the right thrust at the mark.
      if (side === 1)
        return lerpInto(out, ix, iy, iz, R.x * 0.7, R.y + reach * 0.85, 0.3, ease(p * 1.6));
      return lerpInto(out, ix, iy, iz, -R.x * 0.45, R.y - 0.2, reach * 0.9, ease(p));
    case 'break':
      return lerpInto(
        out,
        ix,
        iy,
        iz,
        side * (R.x + reach * 0.7),
        R.y + reach * 0.45,
        0.2,
        ease(p / BREAK_FREEZE_AT),
      );
    default:
      return lerpInto(out, ix, iy, iz, ix, iy, iz, 0);
  }
}

/** The elbow's pole: out and back. */
export function breathElbowPole(side: -1 | 1): V3 {
  return v(side * 0.8, -0.2, -0.6);
}

/** One arm's solved joints (body frame). */
export interface BreathArmJoints {
  elbow: V3;
  wrist: V3;
}

/** One arm's elbow and wrist (body frame) toward `wrist`, written into `out`:
 *  the same two-bone solve as colossusArmIk (pinned equal in the test), done
 *  in scalars so the frame path allocates nothing. */
export function breathArm(
  side: -1 | 1,
  wrist: V3,
  out: BreathArmJoints = { elbow: v(0, 0, 0), wrist: v(0, 0, 0) },
): BreathArmJoints {
  const R = BREATH_ARM.root;
  const l1 = BREATH_ARM.upper;
  const l2 = BREATH_ARM.fore;
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
  // Along the line to the wrist, then out along the pole's part across it
  // (the pole: out and back, breathElbowPole).
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
export function breathBodyHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The fall: when the shell drops after its death, and where each piece lies
 *  (body frame), tumbled, round where it stood. */
export const BREATH_FALL = { end: 2.6, snap: 0.5 } as const;

export function breathFallRest(index: number, from: V3): { at: V3; tilt: V3; delay: number } {
  const a = breathBodyHash(index, 31) * Math.PI * 2;
  const r = 1.2 + breathBodyHash(index, 37) * 3.4;
  return {
    at: v(from.x * 0.5 + Math.sin(a) * r, 0.35, from.z * 0.5 + Math.cos(a) * r),
    tilt: v(
      (breathBodyHash(index, 41) - 0.5) * 2.4,
      breathBodyHash(index, 43) * 6.28,
      (breathBodyHash(index, 47) - 0.5) * 2.4,
    ),
    delay: Math.min(0.9, from.y * 0.07) + breathBodyHash(index, 53) * 0.25,
  };
}

/** A piece's fall `t` seconds into the death: 0..1 and whether it landed. */
export function breathFallProgress(
  t: number,
  delay: number,
  out: { k: number; landed: boolean } = { k: 0, landed: false },
): { k: number; landed: boolean } {
  const k = clamp01((t - delay) / 0.75);
  out.k = k * k;
  out.landed = k >= 1;
  return out;
}

/** Is the guardian in its storm body (the aura on it)? */
export function stormFormOn(auras: readonly { id: string }[]): boolean {
  for (const a of auras) if (a.id === BREATH_AURAS.stormForm) return true;
  return false;
}

/** The tallest point of the body at rest (the nameplate rides over it). */
export function breathBodyTop(): number {
  let top = 0;
  for (const p of BREATH_BODY_PIECES) {
    if (p.joint === 'upper' || p.joint === 'fore' || p.joint === 'hand' || p.joint === 'whirl')
      continue;
    const slot = BREATH_SLOTS[p.joint as keyof typeof BREATH_SLOTS];
    if (!slot) continue;
    top = Math.max(top, slot.y + p.at.y + p.size.y / 2);
  }
  return top;
}

/** Pools at full density. */
export const BREATH_BODY_POOLS = { threads: 11, arcs: STORM_CORE.arcs } as const;
