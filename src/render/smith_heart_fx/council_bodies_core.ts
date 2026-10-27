// Pure plan of the Hammer Council's two provisional bodies (council_bodies.ts
// paints them; docs/design/raid/smith_heart.md section 7.1): the Slabwright,
// broad and blocky with slab shoulders, and the Seam Singer, tall and slender
// with glowing ochre seam crystals. Like the Masterless Strength's colossus
// (final_fx_core.ts) each body is floating rock bound by threads of the vein's
// light, but small: about 2 to 2.5 times a player.
//
// The JOINTS and the TIMELINES (the slots, the arms, the poses, the fall) are
// kept apart from the PIECES (which kit node sits on which joint, at what
// size), so the final models from the official pipeline replace the pieces
// and keep the joints.
//
// Every size is in yards in the body's own frame: x to its left, y up from
// its feet, z forward (the sim's facing, 0 = +z). A piece is fitted to its
// box non-uniformly, so its kit shape never decides the silhouette.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { colossusArmIk, type V3 } from './final_fx_core';

export type { V3 };

/** The two bodies, by their sim template ids. */
export const COUNCIL_BODY_TEMPLATES = {
  slabwright: 'heart_slabwright',
  singer: 'heart_seam_singer',
} as const;
export type CouncilBodyKind = keyof typeof COUNCIL_BODY_TEMPLATES;

/** The kind a template draws as, or null. */
export function councilBodyKindOf(templateId: string): CouncilBodyKind | null {
  if (templateId === COUNCIL_BODY_TEMPLATES.slabwright) return 'slabwright';
  if (templateId === COUNCIL_BODY_TEMPLATES.singer) return 'singer';
  return null;
}

/** The kits the pieces come from (render/smith_heart/heart_kit.ts urls). */
export const COUNCIL_BODY_KITS = {
  hammer: '/models/props/smith_heart_hammer_kit.glb',
  heart: '/models/props/smith_heart_heart_kit.glb',
} as const;
export type CouncilBodyKit = keyof typeof COUNCIL_BODY_KITS;

/** The kit nodes the bodies may use (the shipped GLBs' Kit_* names). */
export const COUNCIL_KIT_NODES: Readonly<Record<CouncilBodyKit, readonly string[]>> = {
  hammer: [
    'Kit_CutBlockA',
    'Kit_CutBlockB',
    'Kit_SlabChunkA',
    'Kit_SlabChunkB',
    'Kit_SlabChunkC',
    'Kit_FallenBlockA',
    'Kit_FallenBlockB',
    'Kit_GeodeA',
    'Kit_GeodeB',
  ],
  heart: [
    'Kit_ColHip',
    'Kit_ColTorso',
    'Kit_ColHead',
    'Kit_ColShoulder',
    'Kit_ColUpperArm',
    'Kit_ColForearm',
    'Kit_ColFist',
    'Kit_ColShardA',
    'Kit_ColShardB',
    'Kit_ColShardC',
    'Kit_HeartCrystal',
  ],
};

/** A joint a piece rides. `fixed` joints move with the body's breath; the
 *  arm joints follow the two-bone reach; `skirt` and `halo` pieces orbit. */
export type CouncilJoint =
  | 'base'
  | 'hip'
  | 'torso'
  | 'head'
  | 'shoulder'
  | 'upper'
  | 'fore'
  | 'hand'
  | 'skirt'
  | 'halo';

/** How a piece is lit: plain stone, its ':glow' meshes on the body's seam
 *  glow, or the whole piece a crystal on the body's crystal glow. */
export type CouncilPieceLight = 'stone' | 'seam' | 'crystal';

export interface CouncilBodyPiece {
  id: string;
  kit: CouncilBodyKit;
  node: string;
  joint: CouncilJoint;
  /** -1 its right, 1 its left, 0 the middle (a side piece is mirrored). */
  side: -1 | 0 | 1;
  /** The box it is fitted to (yards, before any turn). */
  size: V3;
  /** Its centre's offset from its joint (body frame, x mirrored by side). */
  at: V3;
  /** A fixed tilt (radians about x, y, z): dressed stone set a touch askew. */
  tilt: V3;
  light: CouncilPieceLight;
}

export interface CouncilBodyPlan {
  kind: CouncilBodyKind;
  /** Feet to crown (yards): the manifest height times the template scale. */
  height: number;
  /** How high its lowest piece floats off the floor. */
  hover: number;
  /** The fixed joints (body frame; a shoulder's x is its left one). */
  slots: { base: V3; hip: V3; torso: V3; head: V3; shoulder: V3 };
  /** The arm: the shoulder joint (x mirrored), its two lengths, the wrist at rest. */
  arm: { root: V3; upper: number; fore: number; idle: V3 };
  /** The orbiting pieces: how many, how far out, how high, how fast. */
  skirt: { count: number; r: number; y: number; spin: number };
  halo: { count: number; r: number; y: number; spin: number };
  pieces: readonly CouncilBodyPiece[];
  /** The threads' light (the vein's ochre) and the crystals' glow. */
  thread: number;
  glow: number;
  /** The threads' thickness (yards). */
  threadWidth: number;
}

/** The manifest heights times the template scales (characters/manifest.ts
 *  smith_heart_slabwright 2.15, smith_heart_seam_singer 2.5; content
 *  smith_heart.ts scales 2.2 and 2.0). */
export const COUNCIL_BODY_HEIGHTS: Readonly<Record<CouncilBodyKind, number>> = {
  slabwright: 2.15 * 2.2,
  singer: 2.5 * 2.0,
};

/** The vein's ochre (the threads) and the seam crystals' hotter amber. */
export const COUNCIL_BODY_COLORS = {
  ochre: SMITH_HEART_VEIN_COLORS.hammer,
  amber: 0xffb04a,
  /** The Wrath's white-gold, the threads and crystals burning under it. */
  wrath: 0xfff0c8,
  dust: [0.72, 0.62, 0.48] as const,
  /** Each body's granite (LINEAR vertex rgb, so about twice as light on
   *  screen): the Slabwright a warm umber dressed stone, a value darker than
   *  the quarry it stands against; the Singer a cool dark slate the amber
   *  crystals burn out of. */
  granite: {
    slabwright: [0.2, 0.15, 0.11] as const,
    singer: [0.11, 0.105, 0.12] as const,
  },
  spark: [1.0, 0.78, 0.4] as const,
} as const;

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const ZERO = v(0, 0, 0);

function piece(
  id: string,
  kit: CouncilBodyKit,
  node: string,
  joint: CouncilJoint,
  side: -1 | 0 | 1,
  size: V3,
  at: V3 = ZERO,
  tilt: V3 = ZERO,
  light: CouncilPieceLight = 'seam',
): CouncilBodyPiece {
  return { id, kit, node, joint, side, size, at, tilt, light };
}

/** The Slabwright: a mason's golem of dressed slabs, hulking. A heavy hip
 *  block over a floating plinth, a broad chest faced with a dressed slab and
 *  backed by a greater one, two cut slab shoulders standing proud like
 *  pauldrons (the widest thing on it), a squat head sunk between them, thick
 *  arms ending in block fists, a skirt of slab chips turning low. */
const SLABWRIGHT: CouncilBodyPlan = {
  kind: 'slabwright',
  height: COUNCIL_BODY_HEIGHTS.slabwright,
  hover: 0.3,
  slots: {
    base: v(0, 0.45, 0),
    hip: v(0, 1.2, 0),
    torso: v(0, 2.6, 0),
    // The head stands up out of the pauldrons and a little forward (the
    // review: sunk between them it read as a headless block).
    head: v(0, 4.08, 0.48),
    shoulder: v(1.75, 3.2, -0.1),
  },
  arm: { root: v(1.95, 3.0, 0), upper: 1.35, fore: 1.3, idle: v(2.35, 1.0, 0.5) },
  skirt: { count: 7, r: 1.75, y: 0.7, spin: 0.35 },
  halo: { count: 0, r: 0, y: 0, spin: 0 },
  pieces: [
    piece('plinth', 'hammer', 'Kit_FallenBlockA', 'base', 0, v(2.0, 0.5, 1.4), ZERO, v(0, 0.2, 0)),
    piece('hip', 'hammer', 'Kit_CutBlockB', 'hip', 0, v(2.4, 1.1, 1.6), ZERO, ZERO, 'stone'),
    piece('torso', 'heart', 'Kit_ColTorso', 'torso', 0, v(3.0, 2.2, 1.9)),
    piece(
      'chestSlab',
      'hammer',
      'Kit_SlabChunkA',
      'torso',
      0,
      v(2.1, 1.4, 0.5),
      v(0, 0.15, 0.95),
      v(0.08, 0, 0),
      'stone',
    ),
    piece(
      'backSlab',
      'hammer',
      'Kit_SlabChunkB',
      'torso',
      0,
      v(2.8, 2.2, 0.7),
      v(0, 0.35, -1.1),
      v(-0.14, 0, 0.04),
      'stone',
    ),
    piece('head', 'heart', 'Kit_ColHead', 'head', 0, v(1.15, 1.05, 1.1)),
    piece(
      'shoulderL',
      'hammer',
      'Kit_CutBlockB',
      'shoulder',
      1,
      v(1.8, 1.2, 1.9),
      v(0.2, 0.15, 0),
      v(0, 0, -0.2),
      'stone',
    ),
    piece(
      'shoulderR',
      'hammer',
      'Kit_CutBlockB',
      'shoulder',
      -1,
      v(1.8, 1.2, 1.9),
      v(0.2, 0.15, 0),
      v(0, 0, -0.2),
      'stone',
    ),
    piece('upperL', 'heart', 'Kit_ColUpperArm', 'upper', 1, v(0.95, 1.4, 0.95)),
    piece('upperR', 'heart', 'Kit_ColUpperArm', 'upper', -1, v(0.95, 1.4, 0.95)),
    piece('foreL', 'heart', 'Kit_ColForearm', 'fore', 1, v(1.05, 1.3, 1.05)),
    piece('foreR', 'heart', 'Kit_ColForearm', 'fore', -1, v(1.05, 1.3, 1.05)),
    piece(
      'fistL',
      'hammer',
      'Kit_CutBlockA',
      'hand',
      1,
      v(1.25, 1.1, 1.25),
      ZERO,
      v(0.2, 0.3, 0),
      'stone',
    ),
    piece(
      'fistR',
      'hammer',
      'Kit_CutBlockA',
      'hand',
      -1,
      v(1.25, 1.1, 1.25),
      ZERO,
      v(0.2, -0.3, 0),
      'stone',
    ),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) =>
      piece(
        `chip${i}`,
        'hammer',
        ['Kit_SlabChunkA', 'Kit_SlabChunkC', 'Kit_FallenBlockB'][i % 3],
        'skirt',
        0,
        v(0.6 + 0.15 * (i % 3), 0.42 + 0.08 * (i % 2), 0.55),
        ZERO,
        v(0.3 * (i % 2), i * 0.9, 0.2),
        'stone',
      ),
    ),
  ],
  thread: COUNCIL_BODY_COLORS.ochre,
  glow: COUNCIL_BODY_COLORS.ochre,
  threadWidth: 0.15,
};

/** The Seam Singer: a tall, slender figure of seam stone, a long robe of
 *  shards trailing under it, a narrow chest with an amber heart crystal,
 *  great amber geodes breaking out of its shoulders and back, a crown of
 *  crystal, long arms ending in crystal fingers, a slow halo of shards. */
const SINGER: CouncilBodyPlan = {
  kind: 'singer',
  height: COUNCIL_BODY_HEIGHTS.singer,
  hover: 0.35,
  slots: {
    base: v(0, 0.55, 0),
    hip: v(0, 1.95, 0),
    torso: v(0, 3.05, 0),
    head: v(0, 4.05, 0.05),
    shoulder: v(0.75, 3.85, -0.05),
  },
  arm: { root: v(0.85, 3.75, 0), upper: 1.4, fore: 1.35, idle: v(1.05, 1.25, 0.4) },
  skirt: { count: 0, r: 0, y: 0, spin: 0 },
  halo: { count: 6, r: 1.3, y: 3.9, spin: 0.28 },
  pieces: [
    piece(
      'robeLow',
      'heart',
      'Kit_ColShardC',
      'base',
      0,
      v(1.15, 1.0, 1.0),
      ZERO,
      v(Math.PI, 0.4, 0),
    ),
    piece(
      'robe',
      'heart',
      'Kit_ColShardB',
      'base',
      0,
      v(1.5, 1.55, 1.1),
      v(0, 0.85, 0),
      v(Math.PI, 0, 0),
    ),
    // The robe's flaring sides, set BEHIND its front and leaning out like a
    // hem (the review: two shards either side of the robe read as legs).
    piece(
      'robeL',
      'heart',
      'Kit_ColShardA',
      'base',
      1,
      v(0.6, 1.25, 0.5),
      v(0.3, 0.75, -0.24),
      v(Math.PI, 0, -0.26),
    ),
    piece(
      'robeR',
      'heart',
      'Kit_ColShardA',
      'base',
      -1,
      v(0.6, 1.25, 0.5),
      v(0.3, 0.75, -0.24),
      v(Math.PI, 0, -0.26),
    ),
    piece('hip', 'heart', 'Kit_ColHip', 'hip', 0, v(1.1, 0.6, 0.75)),
    piece('torso', 'heart', 'Kit_ColTorso', 'torso', 0, v(1.25, 1.7, 0.85)),
    piece(
      'heart',
      'heart',
      'Kit_HeartCrystal',
      'torso',
      0,
      v(0.5, 0.7, 0.4),
      v(0, 0.15, 0.5),
      ZERO,
      'crystal',
    ),
    piece(
      'back',
      'hammer',
      'Kit_GeodeA',
      'torso',
      0,
      v(1.3, 1.7, 0.9),
      v(0, 0.35, -0.6),
      v(-0.35, 0, 0),
      'crystal',
    ),
    piece('head', 'heart', 'Kit_ColHead', 'head', 0, v(0.72, 0.8, 0.7)),
    piece(
      'crown',
      'hammer',
      'Kit_GeodeB',
      'head',
      0,
      v(0.8, 0.6, 0.7),
      v(0, 0.4, -0.05),
      ZERO,
      'crystal',
    ),
    piece(
      'shoulderL',
      'hammer',
      'Kit_GeodeB',
      'shoulder',
      1,
      v(0.9, 1.05, 0.9),
      v(0.05, 0.15, 0),
      v(0, 0, -0.35),
      'crystal',
    ),
    piece(
      'shoulderR',
      'hammer',
      'Kit_GeodeB',
      'shoulder',
      -1,
      v(0.9, 1.05, 0.9),
      v(0.05, 0.15, 0),
      v(0, 0, -0.35),
      'crystal',
    ),
    piece('upperL', 'heart', 'Kit_ColUpperArm', 'upper', 1, v(0.42, 1.4, 0.42)),
    piece('upperR', 'heart', 'Kit_ColUpperArm', 'upper', -1, v(0.42, 1.4, 0.42)),
    piece('foreL', 'heart', 'Kit_ColForearm', 'fore', 1, v(0.4, 1.35, 0.4)),
    piece('foreR', 'heart', 'Kit_ColForearm', 'fore', -1, v(0.4, 1.35, 0.4)),
    piece('handL', 'heart', 'Kit_ColShardA', 'hand', 1, v(0.4, 0.7, 0.32), ZERO, ZERO, 'crystal'),
    piece('handR', 'heart', 'Kit_ColShardA', 'hand', -1, v(0.4, 0.7, 0.32), ZERO, ZERO, 'crystal'),
    ...[0, 1, 2, 3, 4, 5].map((i) =>
      piece(
        `halo${i}`,
        'heart',
        i % 2 ? 'Kit_ColShardC' : 'Kit_ColShardA',
        'halo',
        0,
        v(0.3, 0.55 + 0.1 * (i % 3), 0.26),
        ZERO,
        v(0, i * 1.1, 0.25),
        'crystal',
      ),
    ),
  ],
  thread: COUNCIL_BODY_COLORS.ochre,
  glow: COUNCIL_BODY_COLORS.amber,
  threadWidth: 0.1,
};

export const COUNCIL_BODY_PLANS: Readonly<Record<CouncilBodyKind, CouncilBodyPlan>> = {
  slabwright: SLABWRIGHT,
  singer: SINGER,
};

// ---- the casts ------------------------------------------------------------------------

/** What a cast bar does to the body: the Slabwright raises its arms and
 *  slams (Wake the Stone, Falling Rock); the Singer sings, arms up, its
 *  crystals flaring (the song), or points one hand (Seam Bolt); either one
 *  hunches and gathers the Wrath it inherited. */
export type CouncilBodyAction = 'idle' | 'swing' | 'raise' | 'sing' | 'point' | 'wrath';

export const COUNCIL_BODY_CASTS = {
  wake: 'heart_wake_the_stone',
  rock: 'heart_falling_rock',
  bolt: 'heart_seam_bolt',
  song: 'heart_song_of_the_seam',
  songUnbroken: 'heart_song_of_the_seam_unbroken',
  wrath: 'heart_mountains_wrath',
} as const;

export function councilCastAction(
  kind: CouncilBodyKind,
  castId: string | null,
): CouncilBodyAction | null {
  if (!castId) return null;
  const C = COUNCIL_BODY_CASTS;
  if (castId === C.wrath) return 'wrath';
  if (kind === 'slabwright' && (castId === C.wake || castId === C.rock)) return 'raise';
  if (castId === C.song || castId === C.songUnbroken) return 'sing';
  if (castId === C.bolt) return 'point';
  return null;
}

/** A bar's fill 0..1 from the entity's bar. */
export function councilCastFill(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - castRemaining / castTotal));
}

/** When in its own bar a raise turns into the slam (the arms come down). */
export const COUNCIL_RAISE_SLAM_AT = 0.78;
/** Seconds of a melee swing's pose. */
export const COUNCIL_SWING_SECONDS = 0.8;

// ---- the poses ------------------------------------------------------------------------

/** The body's slow breath: its bob (yards), how far pieces drift off their
 *  joints, and the threads' stretch, by render time. The Singer sways more
 *  and slower; the Slabwright barely lifts. */
export function councilBreath(
  kind: CouncilBodyKind,
  t: number,
  out: { bob: number; drift: number } = { bob: 0, drift: 0 },
): { bob: number; drift: number } {
  if (kind === 'singer') {
    out.bob = 0.12 * Math.sin(t * 0.8);
    out.drift = 0.06 + 0.04 * Math.sin(t * 1.1 + 0.6);
  } else {
    out.bob = 0.06 * Math.sin(t * 1.1);
    out.drift = 0.05 + 0.03 * Math.sin(t * 1.4 + 0.3);
  }
  return out;
}

const lerp3 = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * Where one wrist (side 1 left, -1 right) wants to be (body frame) for an
 * action at `k` (0..1: a swing's own clock, a bar's fill), and how far the
 * body leans forward (radians).
 */
export function councilWristTarget(
  plan: CouncilBodyPlan,
  action: CouncilBodyAction,
  side: -1 | 1,
  k: number,
  swingSide: -1 | 1 = 1,
): { wrist: V3; lean: number } {
  const I = plan.arm.idle;
  const R = plan.arm.root;
  const idle = v(side * I.x, I.y, I.z);
  const reach = plan.arm.upper + plan.arm.fore;
  const t = clamp01(k);
  switch (action) {
    case 'swing': {
      if (side !== swingSide) return { wrist: idle, lean: 0.12 * Math.sin(Math.PI * t) };
      // Wound back and up, then down and across in front.
      const back = v(side * (R.x + 0.3), R.y + 0.4, -0.5);
      const hit = v(side * R.x * 0.5, R.y - reach * 0.5, reach * 0.62);
      const p =
        t < 0.4 ? lerp3(idle, back, ease(t / 0.4)) : lerp3(back, hit, ease((t - 0.4) / 0.6));
      return { wrist: p, lean: 0.25 * Math.sin(Math.PI * t) };
    }
    case 'raise': {
      // Both arms high over the head, then slammed down into the floor ahead.
      const up = v(side * (R.x * 0.7), R.y + reach * 0.85, 0.25);
      const down = v(side * (R.x * 0.55), R.y - reach * 0.85, reach * 0.35);
      if (t < COUNCIL_RAISE_SLAM_AT)
        return { wrist: lerp3(idle, up, ease(t / COUNCIL_RAISE_SLAM_AT)), lean: -0.12 * t };
      const s = (t - COUNCIL_RAISE_SLAM_AT) / (1 - COUNCIL_RAISE_SLAM_AT);
      return { wrist: lerp3(up, down, ease(s)), lean: -0.1 + 0.45 * ease(s) };
    }
    case 'sing': {
      // Arms open and lifting, palms up, a slow sway: the song rising.
      const open = v(side * (R.x + reach * 0.75), R.y + reach * 0.35 * ease(t), 0.35);
      return { wrist: lerp3(idle, open, ease(Math.min(1, t * 2.5))), lean: -0.08 * ease(t) };
    }
    case 'point': {
      // The left hand drawn back, then thrust at its mark.
      if (side === -1) return { wrist: idle, lean: 0 };
      const drawn = v(R.x * 0.8, R.y + 0.2, -0.3);
      const thrust = v(R.x * 0.4, R.y - 0.1, reach * 0.86);
      const p =
        t < 0.75
          ? lerp3(idle, drawn, ease(t / 0.75))
          : lerp3(drawn, thrust, ease((t - 0.75) / 0.25));
      return { wrist: p, lean: 0.1 * t };
    }
    case 'wrath': {
      // Hunched over its gathering strength, both fists drawn in to its chest.
      const gather = v(side * 0.5, R.y - reach * 0.45, 0.55);
      return { wrist: lerp3(idle, gather, ease(Math.min(1, t * 3))), lean: 0.35 * ease(t) };
    }
    default:
      return { wrist: idle, lean: 0 };
  }
}

/** The arm's pole (where its elbow bends: out, back and a little down). */
export function councilElbowPole(side: -1 | 1): V3 {
  return v(side * 0.8, -0.2, -0.6);
}

/** Shoulder, elbow and wrist of one arm for a wrist target (two-bone reach). */
export function councilArm(
  plan: CouncilBodyPlan,
  side: -1 | 1,
  wrist: V3,
): { root: V3; elbow: V3; wrist: V3 } {
  const root = v(side * plan.arm.root.x, plan.arm.root.y, plan.arm.root.z);
  const ik = colossusArmIk(root, wrist, plan.arm.upper, plan.arm.fore, councilElbowPole(side));
  return { root, elbow: ik.elbow, wrist: ik.wrist };
}

/** How bright the seams and crystals burn (0.6 at rest, up to 2.4): they
 *  breathe idle, flare with a song's fill, burn white under the Wrath. */
export function councilGlowLevel(action: CouncilBodyAction, k: number, clock: number): number {
  const breath = 0.7 + 0.12 * Math.sin(clock * 1.7);
  if (action === 'sing') return breath + 1.2 * clamp01(k) + 0.25 * Math.sin(clock * 9);
  if (action === 'point') return breath + 0.8 * clamp01(k);
  if (action === 'wrath') return breath + 1.6 * clamp01(k);
  if (action === 'raise') return breath + 0.5 * clamp01(k);
  return breath;
}

/** The Wrath's white-gold over the body's own colour, by its fill (0..1). */
export function councilWrathTint(action: CouncilBodyAction, k: number): number {
  return action === 'wrath' ? ease(clamp01(k)) : 0;
}

/** Deterministic hash in [0, 1). */
export function bodyHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** An orbiting piece's place (body frame) at render time `t`. */
export function councilOrbitSlot(
  plan: CouncilBodyPlan,
  joint: 'skirt' | 'halo',
  index: number,
  t: number,
  out: V3 = { x: 0, y: 0, z: 0 },
): V3 {
  const o = joint === 'skirt' ? plan.skirt : plan.halo;
  const n = Math.max(1, o.count);
  const a = (index / n) * Math.PI * 2 + t * o.spin;
  out.x = Math.sin(a) * o.r;
  out.y = o.y + 0.18 * Math.sin(t * 1.3 + index * 1.9);
  out.z = Math.cos(a) * o.r;
  return out;
}

// ---- the fall --------------------------------------------------------------------------------

/** The death: the threads snap, every piece drops and tumbles to the floor
 *  round where it stood, a breath of dust as each lands, then lies as
 *  rubble for as long as the corpse does. */
export const COUNCIL_FALL = {
  /** Seconds the threads take to snap (flaring, then gone). */
  snap: 0.25,
  /** Each piece starts falling a little after the one above it. */
  stagger: 0.035,
  /** Seconds of the drop itself. */
  drop: 0.75,
  /** Seconds after the death when every piece lies still. */
  end: 1.6,
} as const;

/** Where a piece comes to rest (body frame, on the floor) and how it lies. */
export function councilFallRest(
  plan: CouncilBodyPlan,
  index: number,
  from: V3,
): { at: V3; tilt: V3; delay: number } {
  const p = plan.pieces[index];
  const out = 0.6 + bodyHash(index, 31) * 1.4;
  const a = bodyHash(index, 37) * Math.PI * 2;
  const lie = Math.min(p.size.x, p.size.y, p.size.z) * 0.5;
  return {
    at: v(from.x * 0.6 + Math.sin(a) * out, lie, from.z * 0.6 + Math.cos(a) * out),
    tilt: v(
      (bodyHash(index, 41) - 0.5) * 2.4,
      bodyHash(index, 43) * Math.PI * 2,
      (bodyHash(index, 47) - 0.5) * 2.4,
    ),
    // The highest pieces fall last (the head from the top of the heap).
    delay: COUNCIL_FALL.snap + Math.max(0, from.y) * COUNCIL_FALL.stagger * 2,
  };
}

/** A piece's fall at `t` seconds after the death: 0 on its joint, 1 at rest
 *  (an eased drop with a small bounce), and whether it has landed. */
export function councilFallProgress(t: number, delay: number): { k: number; landed: boolean } {
  const s = (t - delay) / COUNCIL_FALL.drop;
  if (s <= 0) return { k: 0, landed: false };
  if (s >= 1) return { k: 1, landed: true };
  return { k: s * s, landed: false };
}

/** A fixed joint's place (body frame) for a piece riding it, before its own
 *  offset: the breath lifts the upper body more than the base. */
export function councilJointPoint(
  plan: CouncilBodyPlan,
  joint: 'base' | 'hip' | 'torso' | 'head' | 'shoulder',
  side: -1 | 0 | 1,
  bob: number,
  drift: number,
  out: V3 = { x: 0, y: 0, z: 0 },
): V3 {
  const s = plan.slots[joint];
  const lift = joint === 'base' ? 0.4 : joint === 'hip' ? 0.7 : 1;
  const spread = joint === 'shoulder' ? drift : 0;
  const up = joint === 'head' ? drift * 1.5 : joint === 'torso' ? drift * 0.5 : 0;
  out.x = side === 0 ? s.x : side * (s.x + spread);
  out.y = s.y + plan.hover + bob * lift + up;
  out.z = s.z;
  return out;
}

/** The top of the plan's highest fixed piece (its crown), body frame. */
export function councilPlanTop(plan: CouncilBodyPlan): number {
  let top = 0;
  for (const p of plan.pieces) {
    if (p.joint === 'upper' || p.joint === 'fore' || p.joint === 'hand') continue;
    if (p.joint === 'skirt' || p.joint === 'halo') continue;
    const j = plan.slots[p.joint];
    top = Math.max(top, j.y + plan.hover + p.at.y + p.size.y / 2);
  }
  return top;
}

/** The plan's widest reach across (shoulder pieces included), body frame. */
export function councilPlanWidth(plan: CouncilBodyPlan): number {
  let half = 0;
  for (const p of plan.pieces) {
    if (p.joint === 'skirt' || p.joint === 'halo') continue;
    if (p.joint === 'upper' || p.joint === 'fore' || p.joint === 'hand') {
      half = Math.max(half, plan.arm.root.x + p.size.x / 2);
      continue;
    }
    const j = plan.slots[p.joint];
    half = Math.max(half, Math.abs(j.x) + p.at.x + p.size.x / 2);
  }
  return half * 2;
}

/** The joints that burn as embers of the vein's light between the pieces
 *  (indices into the rig's joint list: hip, torso, the shoulders, the
 *  elbows), and each ember's size as a share of the body's height. */
export const COUNCIL_EMBER_JOINTS: readonly number[] = [1, 2, 4, 5, 6, 7];
export const COUNCIL_EMBER_SIZE: Readonly<Record<CouncilBodyKind, number>> = {
  slabwright: 0.26,
  singer: 0.17,
};

/** The pool sizes (two bodies of each kind in view at most). */
export const COUNCIL_BODY_POOLS = {
  rigsPerKind: 2,
  /** Threads per rig (joints chained plus arm segments). */
  threads: 12,
} as const;

/** The chain of joints the threads stitch, by joint name pairs: base to
 *  hip, hip to torso, torso to head, torso to each shoulder, each shoulder
 *  to its elbow, each elbow to its wrist. Indices into a rig's joint list
 *  (councilRigJoints order). */
export const COUNCIL_THREAD_PAIRS: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [2, 4],
  [2, 5],
  [4, 6],
  [5, 7],
  [6, 8],
  [7, 9],
];
/** A rig's joint list order: base, hip, torso, head, shoulder L, shoulder R,
 *  elbow L, elbow R, wrist L, wrist R. */
export const COUNCIL_RIG_JOINTS = 10;
