/** Renderer-derived animation inputs (same facts the old pose machine used). */
export interface AnimState {
  /** horizontal speed, world units/sec */
  speed: number;
  moving: boolean;
  /** run-vs-walk gait, hysteresis-picked in locomotion.ts (never a raw
   *  speed-threshold compare: that flips on every noisy frame under load) */
  running: boolean;
  airborne: boolean;
  /** Airborne AND genuinely falling (past any hop's landing speed, see
   *  isFallingAtSpeed): the base pose flails instead of holding the jump
   *  loop. Renderer-derived from displayed vertical speed, so peers flail
   *  identically with no wire traffic. */
  falling?: boolean;
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
  /** Swimming with the head UNDER the waterline: the stroke switches from the
   *  surface crawl to the submerged breaststroke, and the body stops splashing. */
  submerged: boolean;
  /** Radians the swimming body noses DOWN (negative = up), from how fast it is
   *  actually descending or climbing. Derived from displayed motion rather than
   *  from the local camera so peers pitch too, and so the pose can never
   *  disagree with the travel it is drawn against. */
  swimPitch: number;
  /** Feet under water but the ground still under them — the band between a dry
   *  stride and a swim. Walking here plays the wade cycle and the sim slows the
   *  body down (player_motion.wadeSpeedMult). */
  wading: boolean;
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
  | 'swimSurface'
  | 'swimIdle'
  | 'wade'
  | 'sit'
  | 'jump'
  | 'fall';

const DEFAULT_WALK_REF = 2.2;
const DEFAULT_RUN_REF = 7;
/** Swim speed the authored strokes were timed against (yd/s). */
const DEFAULT_SWIM_REF = 3.2;
/** ...and the pace the wade cycle was timed against (yd/s). */
const DEFAULT_WADE_REF = 4.2;

export const SWIM_ENTER_FEET_DEPTH = 0.5;
export const SWIM_EXIT_FEET_DEPTH = 0.25;
const SWIM_ENTER_FLOOR_DEPTH = 0.8;
const SWIM_EXIT_FLOOR_DEPTH = 0.6;

/**
 * How far the top of a SWIMMING body sits above its pivot, as a fraction of
 * stand height. A swimmer is prone, not upright: the authored strokes lay the
 * body flat about the hips, so its top is the back at roughly hip height
 * (0.41 of the ~1.6-unit source rig, scaled to the 2.6 stand height, plus the
 * surface lift) — about 0.42 of stand height, NOT the ~0.86 an upright head
 * would sit at. Using the standing figure here would mean the waterline could
 * never close over a swimmer at all, and the submerged stroke would never play.
 */
export const SUBMERGED_HEAD_FRACTION = 0.42;

/**
 * Is a swimming body's head under water? Hysteresis mirrors the swim latch: the
 * head must clear the line by a margin to count as surfaced again, so bobbing on
 * a wave cannot flip the stroke back and forth every frame.
 */
export function isSubmergedAtDepth(
  previous: boolean,
  swimming: boolean,
  feetDepth: number,
  standHeight: number,
): boolean {
  if (!swimming || !Number.isFinite(feetDepth)) return false;
  const headDepth = feetDepth - standHeight * SUBMERGED_HEAD_FRACTION;
  return headDepth >= (previous ? -0.22 : 0.02);
}

/**
 * Is this body walking through water rather than over ground?
 *
 * The band is everything between a dry stride and a swim: the swim latch takes
 * over once the bed drops ~0.8 yd under the line (about mid-thigh on these
 * bodies), so wading tops out below the waist by construction. Hysteresis for
 * the same reason as the swim latch — a shoreline is exactly where a body
 * hovers on the threshold, and a flickering gait reads as a stutter.
 */
export function isWadingAtDepth(
  previous: boolean,
  swimming: boolean,
  dead: boolean,
  feetDepth: number,
): boolean {
  if (swimming || dead || !Number.isFinite(feetDepth)) return false;
  return feetDepth >= (previous ? WADE_EXIT_FEET_DEPTH : WADE_ENTER_FEET_DEPTH);
}

/** Ankle deep: below this the water is a puddle and the dry walk still reads. */
export const WADE_ENTER_FEET_DEPTH = 0.22;
export const WADE_EXIT_FEET_DEPTH = 0.12;

/** Downward speed (yd/s) past which an airborne body reads as FALLING and the
 *  base pose flails (Fall_Flail) instead of holding the jump loop. The enter
 *  threshold sits well past the fastest flat-jump landing speed (the sim's
 *  JUMP_VELOCITY is 6), so a normal hop never flails; ~9.5 is half a second
 *  of genuine drop. Exit has hysteresis so a bounce along a steep slope
 *  cannot strobe the pose, and landing/swimming clears it via `airborne`. */
export const FALL_FLAIL_ENTER_SPEED = 9.5;
export const FALL_FLAIL_EXIT_SPEED = 7;

/** Stable falling latch over the DISPLAYED vertical speed (negative = down). */
export function isFallingAtSpeed(previous: boolean, airborne: boolean, vy: number): boolean {
  if (!airborne || !Number.isFinite(vy)) return false;
  return vy <= -(previous ? FALL_FLAIL_EXIT_SPEED : FALL_FLAIL_ENTER_SPEED);
}

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

/**
 * Ease into and out of the TREAD posture, 0..1.
 *
 * Separate from the swim blend because it crosses between two poses that are
 * both in the water: a prone stroke floats the body at hip height, an upright
 * tread has to sink most of a third of a yard, and the renderer applies that
 * difference as one offset. Switching it on the state edge would throw the
 * model that whole distance in a single frame, so it rides this instead — and
 * deliberately a little slower than the clip crossfade under it, which reads as
 * the body settling into the water after the stroke stops.
 */
export function advanceTreadBlend(current: number, treading: boolean, dt: number): number {
  const safeCurrent = clamp(Number.isFinite(current) ? current : 0, 0, 1);
  const target = treading ? 1 : 0;
  return target + (safeCurrent - target) * Math.exp(-TREAD_BLEND_RATE * Math.max(0, dt));
}

const TREAD_BLEND_RATE = 6;

/** How steeply a swimmer noses over at full descent / climb (radians). Enough
 *  that the stroke visibly aims where it is going; short of the near-vertical a
 *  literal reading of the travel angle would give when diving from a standstill,
 *  which reads as a faceplant rather than a dive. */
export const SWIM_PITCH_MAX = 0.62;
/** Vertical speed (yd/s) that reaches that full pitch — the sim's dive rate. */
export const SWIM_PITCH_FULL_SPEED = 3.2;
/** Exponential response of the pitch follow, per second. Slow enough that the
 *  net's jitter on a peer's Y cannot flutter the body, fast enough that your
 *  own dive answers the camera. */
const SWIM_PITCH_RESPONSE = 5;

/**
 * Ease the drawn body pitch toward the one its vertical travel implies.
 *
 * `verticalSpeed` is yards/second, positive UP. The result is positive
 * NOSE-DOWN, matching the renderer's prone pitch convention, and eases out to
 * level whenever the body is not swimming — so wading ashore mid-dive unwinds
 * instead of snapping.
 */
export function advanceSwimPitch(
  current: number,
  verticalSpeed: number,
  swimming: boolean,
  dt: number,
): number {
  const target = swimming
    ? clamp(-verticalSpeed / SWIM_PITCH_FULL_SPEED, -1, 1) * SWIM_PITCH_MAX
    : 0;
  const safeCurrent = Number.isFinite(current) ? current : 0;
  return target + (safeCurrent - target) * Math.exp(-SWIM_PITCH_RESPONSE * Math.max(0, dt));
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

/**
 * `hasWadeClip` defaults TRUE so the state machine's own rule (wading beats the
 * dry gait) is what a caller gets by default. A rig with no wade cycle passes
 * false: it must not enter the state at all, because `baseAction` would cover
 * the POSE with the dry walk while `locomotionTimeScale` still ran it at the
 * wade tempo. It is a parameter rather than a doctored `AnimState` because the
 * caller is a per-entity per-frame path, and cloning the state to override one
 * flag allocated a fresh object every frame for every rig standing in a ford.
 */
export function desiredBaseState(
  s: AnimState,
  hasWalkBackClip: boolean,
  hasWadeClip = true,
): BaseState {
  if (s.swimming) {
    // A swimmer who stops treads water rather than stroking on the spot; a
    // swimmer who moves picks the stroke for their depth — surface crawl above
    // the waterline, breaststroke below it. Rigs with one swim clip and no
    // tread resolve all three to whatever they have (baseAction falls back).
    if (!s.moving) return 'swimIdle';
    return s.submerged ? 'swim' : 'swimSurface';
  }
  if (s.airborne) return s.falling ? 'fall' : 'jump';
  if (s.spinning) return 'spin';
  if (s.casting) return 'cast';
  if (s.sitting) return 'sit';
  if (s.moving) {
    // Shallow water is still walking, just against resistance: one cycle covers
    // both gaits, because nobody sprints through knee-deep water.
    if (s.wading && hasWadeClip) return 'wade';
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
  if (baseState === 'swim' || baseState === 'swimSurface') {
    // Stroke rate follows swim speed: the slow opening strokes of a dive read as
    // deliberate and the cruise reads as purposeful, off ONE authored clip each.
    // Never reversed — there is no backwards stroke, a backpedaling swimmer just
    // pulls more slowly.
    return clamp(s.speed / DEFAULT_SWIM_REF, 0.55, 1.4);
  }
  // Treading is an idle: it holds its own tempo whatever the body drifts at.
  if (baseState === 'swimIdle') return null;
  let timeScale: number;
  if (baseState === 'walk' || baseState === 'walkBack') {
    timeScale = clamp(s.speed / walkRef, 0.6, 1.8);
  } else if (baseState === 'wade') {
    // One cycle covers the whole wade band, and the band is slow by
    // construction (the sim drags the body down to ~0.7 run) — so the clip is
    // timed against a wading pace, not a dry one, and clamped tighter: a stride
    // through water reads wrong the moment it starts to sprint.
    timeScale = clamp(s.speed / DEFAULT_WADE_REF, 0.65, 1.45);
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
