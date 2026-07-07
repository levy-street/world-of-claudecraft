/** Renderer-derived animation inputs (same facts the old pose machine used). */
export interface AnimState {
  /** horizontal speed, world units/sec */
  speed: number;
  moving: boolean;
  airborne: boolean;
  /** moving against facing (players backpedaling) */
  backwards: boolean;
  /** use reversed forward locomotion instead of an authored walkBack clip */
  reverseBackpedal?: boolean;
  dead: boolean;
  casting: boolean;
  swimming: boolean;
  sitting: boolean;
}

export type BaseState = 'idle' | 'walk' | 'walkBack' | 'run' | 'cast' | 'swim' | 'sit' | 'jump';

const RUN_SPEED_THRESHOLD = 4.5; // u/s — sim walk/wander sits well below
const DEFAULT_WALK_REF = 2.2;
const DEFAULT_RUN_REF = 7;

export function desiredBaseState(s: AnimState, hasWalkBackClip: boolean): BaseState {
  if (s.swimming) return 'swim';
  if (s.airborne) return 'jump';
  if (s.casting) return 'cast';
  if (s.sitting) return 'sit';
  if (s.moving) {
    if (s.backwards && hasWalkBackClip && !s.reverseBackpedal) return 'walkBack';
    return s.speed >= RUN_SPEED_THRESHOLD ? 'run' : 'walk';
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
