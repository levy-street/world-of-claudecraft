/** Renderer-derived animation inputs (same facts the old pose machine used). */
export interface AnimState {
  /** horizontal speed, world units/sec */
  speed: number;
  moving: boolean;
  /** run-vs-walk gait, hysteresis-picked in locomotion.ts (never a raw
   *  speed-threshold compare: that flips on every noisy frame under load) */
  running: boolean;
  airborne: boolean;
  /** moving against facing (players backpedaling) */
  backwards: boolean;
  /** use reversed forward locomotion instead of an authored walkBack clip */
  reverseBackpedal?: boolean;
  dead: boolean;
  casting: boolean;
  /** The ability id driving `casting`, or null. Presentation that must tell a
   *  drawn SHOT apart from any other cast-time ability needs this: `casting`
   *  alone is true for a hunter's tame_beast (6s) and revive_pet (3s) as well
   *  as Long Draw. Display-only; never gates gameplay. */
  castingAbility?: string | null;
  /** Channeling a self-centered whirl such as Bladestorm. This wins over the
   *  generic cast and locomotion poses. */
  spinning?: boolean;
  swimming: boolean;
  sitting: boolean;
}

export type BaseState =
  | 'idle'
  | 'walk'
  | 'walkBack'
  | 'run'
  | 'cast'
  | 'spin'
  | 'swim'
  | 'sit'
  | 'jump';

const DEFAULT_WALK_REF = 2.2;
const DEFAULT_RUN_REF = 7;

export const SWIM_ENTER_FEET_DEPTH = 0.5;
export const SWIM_EXIT_FEET_DEPTH = 0.25;
const SWIM_ENTER_FLOOR_DEPTH = 0.8;
const SWIM_EXIT_FLOOR_DEPTH = 0.6;

/** Stable waterline latch. Separate enter/exit depths prevent pose flicker. */
export function isSwimmingAtDepth(
  previous: boolean,
  dead: boolean,
  feetDepth: number,
  floorDepth: number,
): boolean {
  if (dead || !Number.isFinite(feetDepth) || !Number.isFinite(floorDepth)) return false;
  const minFeetDepth = previous ? SWIM_EXIT_FEET_DEPTH : SWIM_ENTER_FEET_DEPTH;
  const minFloorDepth = previous ? SWIM_EXIT_FLOOR_DEPTH : SWIM_ENTER_FLOOR_DEPTH;
  return feetDepth >= minFeetDepth && floorDepth >= minFloorDepth;
}

/**
 * Frame-rate-independent swim transition. Both pitch and vertical lift consume
 * this blend so entering or leaving water cannot pop the model by a full unit.
 */
export function advanceSwimBlend(current: number, swimming: boolean, dt: number): number {
  const safeCurrent = clamp(current, 0, 1);
  const target = swimming ? 1 : 0;
  const response = swimming ? 8 : 6;
  return target + (safeCurrent - target) * Math.exp(-response * Math.max(0, dt));
}

/** One impact for a fresh contact, a landing, or the wade-to-swim transition. */
export function shouldTriggerWaterImpact(
  contactActive: boolean,
  wasAirborne: boolean,
  airborne: boolean,
  wasSwimming: boolean,
  swimming: boolean,
): boolean {
  return !contactActive || (wasAirborne && !airborne) || (!wasSwimming && swimming);
}

export type WaterContactFrameMode = 'forget' | 'seed' | 'track';

/**
 * Culling is presentation state, not a physical water exit. Hidden contacts
 * are forgotten and seeded silently when they become visible again, avoiding
 * both off-screen solver work and a synthetic re-entry splash.
 */
export function waterContactFrameMode(
  editorCamera: boolean,
  visible: boolean,
  contactSeen: boolean,
): WaterContactFrameMode {
  if (editorCamera || !visible) return 'forget';
  return contactSeen ? 'track' : 'seed';
}

// ---------------------------------------------------------------------------
// Zero-weight watchdog
//
// A three.js SkinnedMesh renders BIND POSE (arms out: the T-pose) whenever the
// summed effective weight of the mixer's scheduled actions drops below 1, since
// the PropertyMixer blends the deficit back toward the bind transform. The
// state machine in visual.ts only re-drives the rig on a base-state EDGE, so a
// transient that leaves NOTHING driving it (a partner-less fade-in, an action
// stopped out from under `current`, a one-shot whose `finished` never arrived)
// sticks for as long as the state is held, and strafing, casting and walking
// are all held states. These helpers decide, from the live mixer weights alone,
// when the rig must be re-driven.
// ---------------------------------------------------------------------------

/** One action's live contribution to the accumulated pose. */
export interface AnimActionWeight {
  /** The mixer still schedules this action, so its weight reaches the pose
   *  (three's `AnimationAction.isScheduled()`, NOT `isRunning()`: a clamped
   *  one-shot is paused, hence not running, yet still holds the rig at full
   *  weight; and a stopped action keeps a stale non-zero effective weight). */
  scheduled: boolean;
  /** Weight after fades and `enabled` (three's `getEffectiveWeight()`). */
  effectiveWeight: number;
}

/** Below this summed weight the rig is visibly blending toward bind pose. */
export const POSE_DRIVE_MIN_WEIGHT = 0.05;

/** Consecutive starved frames tolerated before the repair fires. Rides out the
 *  frames a legitimate crossfade can spend near zero without letting a real
 *  latch persist longer than a blink. */
export const ANIM_REPAIR_FRAMES = 3;

export interface AnimRepairScan {
  /** consecutive starved frames after this one (0 once driven, or once repaired) */
  starvedFrames: number;
  /** re-drive the base pose on this frame */
  repair: boolean;
}

/** Does this one action still hold the rig off bind pose? */
export function drivesPose(action: AnimActionWeight | null | undefined): boolean {
  return !!action && action.scheduled && action.effectiveWeight >= POSE_DRIVE_MIN_WEIGHT;
}

/**
 * Is the rig blending toward bind pose with nothing left to bring it back?
 * A crossfade sums to ~1 and a clamped one-shot holds ~1, so neither trips it;
 * a rig with no actions at all (the clip-less prop rigs) has no pose to repair.
 */
export function needsAnimRepair(
  actions: readonly AnimActionWeight[],
  deadLocked: boolean,
): boolean {
  if (deadLocked || actions.length === 0) return false;
  let total = 0;
  for (const action of actions) {
    if (action.scheduled) total += action.effectiveWeight;
    if (total >= POSE_DRIVE_MIN_WEIGHT) return false;
  }
  return true;
}

/** One frame of the watchdog: the debounce counter folded with the decision. */
export function scanAnimRepair(
  starvedFrames: number,
  actions: readonly AnimActionWeight[],
  deadLocked: boolean,
): AnimRepairScan {
  if (!needsAnimRepair(actions, deadLocked)) return { starvedFrames: 0, repair: false };
  const starved = starvedFrames + 1;
  if (starved < ANIM_REPAIR_FRAMES) return { starvedFrames: starved, repair: false };
  // Re-arm: a repair that did not take (a rig with no base action to drive)
  // must be retried rather than latch the counter above the threshold.
  return { starvedFrames: 0, repair: true };
}

/**
 * Should the touchdown one-shot fire this frame?
 *
 * Rigs that ship a landing clip hold their jump pose for the whole airborne
 * stretch (visual.ts clamps it, since a fall off a ledge outlasts any authored
 * clip) and play the landing on the grounded edge instead. Death wins: a body
 * that dies mid-air collapses rather than sticking a landing, and letting the
 * one-shot through would fight the clamped death clip for the rig.
 */
export function shouldPlayLanding(
  wasAirborne: boolean,
  airborne: boolean,
  dead: boolean,
  hasLandClip: boolean,
): boolean {
  return hasLandClip && wasAirborne && !airborne && !dead;
}

export function desiredBaseState(s: AnimState, hasWalkBackClip: boolean): BaseState {
  if (s.swimming) return 'swim';
  if (s.airborne) return 'jump';
  if (s.spinning) return 'spin';
  if (s.casting) return 'cast';
  if (s.sitting) return 'sit';
  if (s.moving) {
    if (s.backwards && hasWalkBackClip && !s.reverseBackpedal) return 'walkBack';
    return s.running ? 'run' : 'walk';
  }
  return 'idle';
}

export function locomotionTimeScale(
  baseState: BaseState,
  s: Pick<AnimState, 'speed' | 'backwards' | 'reverseBackpedal'>,
  walkRef = DEFAULT_WALK_REF,
  runRef = DEFAULT_RUN_REF,
): number | null {
  let timeScale: number;
  if (baseState === 'walk' || baseState === 'walkBack') {
    timeScale = clamp(s.speed / walkRef, 0.6, 1.8);
  } else if (baseState === 'run') {
    timeScale = clamp(s.speed / runRef, 0.6, 1.6);
  } else {
    return null;
  }
  return s.reverseBackpedal && s.backwards && baseState !== 'walkBack' ? -timeScale : timeScale;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The vertical extent (scale.y) for an entity's click/pick proxy. The proxy is a
 *  unit cylinder scaled to (radius*2, standHeight, radius*2) and rooted at the feet.
 *  A living entity uses its full standing height; a dead (lying) one collapses to a
 *  low, ground-hugging profile (roughly its own body width tall) so a near-eye click
 *  behind or above the flat corpse no longer intersects an invisible upright column
 *  (issue 1486), while the ground-level footprint stays clickable for looting. */
export function pickProxyHeight(standHeight: number, radius: number, dead: boolean): number {
  if (!dead) return standHeight;
  return Math.min(standHeight, radius * 2);
}
