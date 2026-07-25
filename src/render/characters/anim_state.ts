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
