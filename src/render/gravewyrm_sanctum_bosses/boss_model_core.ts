// The Gravewyrm Sanctum bosses' bodies, measured: the facts the looks
// (characters/sanctum_boss_looks.ts) and the boss effects (sanctum_boss_fx.ts)
// key on, so a chain leaves Korgath's own manacle and the breath leaves
// Korzul's own jaws. Korgath and Velkhar are art-guide bodies (the designer's
// model guide: concept, Tripo, a rig built for the mesh, every clip animated
// at 30 fps); Korzul is the Blender body from his delivery notes
// (E:/woc/entregas/santuario/korzul/NOTAS.md, 24 fps).
//
// Model space: yards at the authored size, glTF axes: +Y up, the body faces
// +Z, its LEFT is +X; the origin is on the ground under the body. All three
// are drawn at their authored size (model scale 1 at their template's sim
// scale). Clip times are seconds at 1x.
//
// Three-free, DOM-free, deterministic.

import type { SealTool } from '../../sim/encounters/gravewyrm_sanctum/boss_ids';
import { KORZUL_EMERGE } from '../../sim/encounters/gravewyrm_sanctum/korzul_emerge_plan';

export interface BossBody {
  url: string;
  /** The template's sim scale (sim/content/dungeons.ts). */
  simScale: number;
  /** In-game yards per model yard at that sim scale. */
  drawnScale: number;
  /** The Idle pose's skinned bounds, lowest to highest vertex: what
   *  prepareVisual normalizes to the def height. */
  idleBoundsHeight: number;
  /** The gait's reference speed (planted feet slide at it) at model scale 1. */
  walkRef: number;
}

/** Korgath the Bound: the Smith's foreman, a chained giant with a maul, 10.3 yd
 *  at Idle (four knights). */
export const KORGATH_BODY: BossBody = {
  url: 'models/creatures/woc_sanctum_korgath.glb',
  simScale: 1.5,
  drawnScale: 1,
  idleBoundsHeight: 10.27,
  walkRef: 2.65,
};
/** The planted feet's speed in the charge's run loop (ThresholdChargeLoop), at
 *  model scale 1. */
export const KORGATH_RUN_REF = 15.84;

/** Grand Necromancer Velkhar: the mitre and the staff's caged soul flame 5.06
 *  yd at Idle. */
export const VELKHAR_BODY: BossBody = {
  url: 'models/creatures/woc_sanctum_velkhar.glb',
  simScale: 1.25,
  drawnScale: 1,
  idleBoundsHeight: 5.06,
  walkRef: 2.05,
};

/** Korzul the Gravewyrm: withers 12.6 yd, the horns 21.6, 53.7 yd nose to tail. */
export const KORZUL_BODY: BossBody = {
  url: 'models/creatures/sanctum_korzul.glb',
  simScale: 1.8,
  drawnScale: 1,
  idleBoundsHeight: 21.85,
  walkRef: 4.8,
};

/** The def height (pivot to the Idle bounds' top at sim scale 1). */
export function bossLookHeight(b: BossBody): number {
  return (b.idleBoundsHeight * b.drawnScale) / b.simScale;
}

/** In-game yards per model yard for a body drawn at sim `scale`. */
export function bossModelScale(b: BossBody, scale: number): number {
  return (b.drawnScale * scale) / b.simScale;
}

/** A clip's play rate that lands its contact frame on a bar's last frame. */
export function contactRate(contact: number, bar: number): number {
  return bar > 0 ? contact / bar : 1;
}

/** Korgath's clip beats (contact frames, seconds at 1x). The blows land on
 *  frame 18 of their 1.5 s clips; each bar's blow lands on the bar's end, so
 *  every clip plays at 1x. */
export const KORGATH_CLIP = {
  slam: 0.567,
  sweep: 0.567,
  stomp: 1.5,
  strain: 2.0,
  maulArc: 1.6,
  chainFlail: 2.0,
  thresholdCharge: 2.0,
  bellow: 2.0,
  chainBreakSnap: 0.233,
  roarPeak: 0.7,
  deathKnees: 0.967,
} as const;

/** Korgath's four harness anchor bones, by chain, and the broken-chain mesh a
 *  break reveals (only the arm chains carry one). */
export const KORGATH_ANCHORS: Readonly<Record<SealTool, string>> = {
  hammer: 'Anchor_Hammer',
  tongs: 'Anchor_Tongs',
  anvil: 'Anchor_Anvil',
  bellows: 'Anchor_Bellows',
};
export const KORGATH_BROKEN_CHAIN_MESH: Readonly<Partial<Record<SealTool, string>>> = {
  hammer: 'Korgath_BrokenChain_Hammer',
  tongs: 'Korgath_BrokenChain_Tongs',
};

/** Where each anchor rides at Idle in the model's frame (yards; +x his left,
 *  +z ahead): the stand-in when the live rig is not drawn (the far bake). */
export const KORGATH_ANCHOR_REST: Readonly<Record<SealTool, { x: number; y: number; z: number }>> =
  {
    hammer: { x: -1.45, y: 5.78, z: 0.24 },
    tongs: { x: 1.79, y: 5.73, z: 0.21 },
    anvil: { x: -1.19, y: 1.09, z: -0.13 },
    bellows: { x: 0, y: 8.94, z: -0.5 },
  };

/** Velkhar's clip beats: the staff's blow lands on frame 18 of its 1.5 s
 *  Attack; the trench and the volley leave on their bars' ends (1x). */
export const VELKHAR_CLIP = {
  castRelease: 0.833,
  thawPull: 1.9,
  trenchLaunch: 2.0,
  volleyBurst: 1.5,
  attackLand: 0.567,
} as const;
/** The caged soul flame's centre over his feet at Idle. */
export const VELKHAR_FLAME_Y = 4.45;

/** Korzul's clip beats. */
export const KORZUL_CLIP = {
  breakFreeBurst: 1.4,
  breakFreeSlam: 2.9,
  breakFreeLength: 4.42,
  breathStart: 2.0,
  breathEnd: 3.4,
  tailHit: 1.05,
  galeGust: 1.1,
  takeOffLift: 1.1,
  breathAirStart: 1.0,
  breathAirEnd: 2.6,
  landImpact: 1.2,
  infernoPulses: [2, 4, 6, 8] as readonly number[],
  deathIceGives: 2.6,
} as const;
/** The breath leaves his jaws this far ahead and up at Idle (model yards). */
export const KORZUL_MOUTH_REST = { z: 23.2, y: 15.7 } as const;
/** The heart-shard in his chest at Idle. */
export const KORZUL_SHARD_REST = { z: 7.5, y: 8.15 } as const;
/** Every airborne clip carries its altitude: Root rides this high in the hover. */
export const KORZUL_CLIP_FLY_HEIGHT = 6;

/** Presentation gestures (the renderer's triggerAttack seam), never sim ids. */
export const KORGATH_BROKEN_GESTURE: Readonly<Record<SealTool, string>> = {
  hammer: 'sanctum_korgath_broken_hammer',
  tongs: 'sanctum_korgath_broken_tongs',
  anvil: 'sanctum_korgath_broken_anvil',
  bellows: 'sanctum_korgath_broken_bellows',
};
export const KORGATH_WHOLE_GESTURE: Readonly<Record<SealTool, string>> = {
  hammer: 'sanctum_korgath_whole_hammer',
  tongs: 'sanctum_korgath_whole_tongs',
  anvil: 'sanctum_korgath_whole_anvil',
  bellows: 'sanctum_korgath_whole_bellows',
};
/** Korzul's frozen stance (before his pull) and the takeoff one-shot. */
export const KORZUL_FROZEN_STANCE = 'sanctum_korzul_frozen';
export const KORZUL_TAKEOFF_GESTURE = 'sanctum_korzul_takeoff';
/** Before his pull the showpiece is the frozen Korzul inside the Calving Face
 *  (the environment's static GLB): the boss's own body hides until the face
 *  collapses (story step 8) or he is pulled, then shows for his BreakFree. */
export const KORZUL_HIDE_GESTURE = 'sanctum_korzul_hide';
export const KORZUL_SHOW_GESTURE = 'sanctum_korzul_show';

/** Whether Korzul's own body is hidden: still in the ice (the story below
 *  step 8, not in combat, not dead). */
export function korzulBodyHidden(storyStep: number, inCombat: boolean, dead: boolean): boolean {
  return storyStep < 8 && !inCombat && !dead;
}

/** The moment the ice bursts in Break Free's bar (seconds into it): the
 *  BreakFree clip's burst beat at the bar's play rate (its slam lands on the
 *  bar's end). The live body appears here, at the face's foot, the same frame
 *  the frozen Korzul in the face is gone (sanctum_face_core.ts). */
export const KORZUL_BURST_AT =
  (KORZUL_CLIP.breakFreeBurst * KORZUL_EMERGE.burst) / KORZUL_CLIP.breakFreeSlam;

/** Korzul's own body: `frozen` in the ice (hidden, the frozen stance), pulled
 *  but still `bursting` (hidden: the face's frozen wyrm is the one seen until
 *  the burst beat), or `shown`. `inIce`: this view was hidden in the ice when
 *  the pull came (a body already seen is never hidden again);
 *  `breakFreeElapsed`: seconds into Break Free's bar, null without it. */
export type KorzulBodyView = 'frozen' | 'bursting' | 'shown';
export function korzulBodyView(
  storyStep: number,
  inCombat: boolean,
  dead: boolean,
  inIce: boolean,
  breakFreeElapsed: number | null,
): KorzulBodyView {
  if (korzulBodyHidden(storyStep, inCombat, dead)) return 'frozen';
  if (inIce && !dead && breakFreeElapsed !== null && breakFreeElapsed < KORZUL_BURST_AT)
    return 'bursting';
  return 'shown';
}

/** Break Free's landing one-shot (the Land clip), its impact on the
 *  touchdown (korzul_emerge_plan.ts: the land beat). */
export const KORZUL_EMERGE_LAND_GESTURE = 'sanctum_korzul_emerge_land';
export const KORZUL_EMERGE_LAND_RATE = KORZUL_CLIP.landImpact / KORZUL_EMERGE.land;
/** Velkhar's thaw channel played off a pyre flare. */
export const VELKHAR_THAW_GESTURE = 'sanctum_velkhar_thaw_gesture';

/** Body glow gestures: Korzul's shard heartbeat (and its flare in the last
 *  phase), Korgath's runes burning as he Strains, Velkhar's soul flame
 *  roaring as he casts. */
export const KORZUL_HEARTBEAT_GESTURE = 'sanctum_korzul_heartbeat';
export const KORZUL_HEARTBEAT_FLARE_GESTURE = 'sanctum_korzul_heartbeat_flare';
export const KORGATH_RUNES_GESTURE = 'sanctum_korgath_runes';
export const VELKHAR_FLAME_GESTURE = 'sanctum_velkhar_flame';

/** Seconds between heartbeats: about 40 a minute, faster once the shard flares. */
export function heartbeatEvery(flaring: boolean): number {
  return flaring ? 0.95 : 1.5;
}
