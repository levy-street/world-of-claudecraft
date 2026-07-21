// Pure click-to-move math (#95), kept out of the render/main loop so it can be
// unit-tested. The client feeds the result into the normal movement input the
// server already understands: face the destination and walk forward until we
// arrive, then stop. Movement stays fully server-authoritative — this only
// decides facing + a forward flag.

export interface Point2 { x: number; z: number }

export interface ClickMoveStep {
  facing: number; // yaw to face the destination (same convention as Entity.facing)
  forward: boolean; // whether to keep walking this frame
  arrived: boolean; // true once within stopDistance (caller clears the target)
}

// facing convention matches the sim: atan2(dx, dz)
export function facingToward(from: Point2, to: Point2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function distance2d(a: Point2, b: Point2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function stepAngleToward(current: number, target: number, maxStep: number): number {
  const step = Math.max(0, maxStep);
  const d = angleDelta(current, target);
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

/**
 * Compute one frame of click-to-move toward `target`.
 * @param stopDistance how close counts as "arrived" (e.g. melee range for an
 *   enemy approach, ~0.5 for a ground move).
 */
export function clickMoveStep(player: Point2, target: Point2, stopDistance: number): ClickMoveStep {
  const d = distance2d(player, target);
  if (d <= stopDistance) {
    return { facing: facingToward(player, target), forward: false, arrived: true };
  }
  return { facing: facingToward(player, target), forward: true, arrived: false };
}

export function latencyAdjustedStopDistance(
  stopDistance: number,
  latencyMs: number,
  speedYardsPerSecond: number,
  maxExtraDistance: number,
): number {
  if (!Number.isFinite(latencyMs) || !Number.isFinite(speedYardsPerSecond) || !Number.isFinite(maxExtraDistance)) {
    return stopDistance;
  }
  const extra = Math.min(Math.max(0, maxExtraDistance), Math.max(0, speedYardsPerSecond) * Math.max(0, latencyMs) / 1000);
  return stopDistance + extra;
}

// Only walk forward while roughly aimed at the destination. Movement is
// applied along the player's (smoothed) facing at full speed, but facing turns
// at a capped rate. Close to the target the bearing swings faster than we can
// turn (the required angular rate is speed/distance), so walking forward while
// badly misaligned makes the player orbit the destination at a radius larger
// than the stop distance and never arrive. When the heading error exceeds this
// cone we hold position and turn in place first, which collapses the orbit.
export const CLICK_MOVE_FORWARD_CONE = Math.PI / 3; // 60° either side of the bearing

export function clickMoveShouldWalk(facing: number, bearing: number, cone = CLICK_MOVE_FORWARD_CONE): boolean {
  return Math.abs(angleDelta(facing, bearing)) <= cone;
}

// Any deliberate *directional* movement key cancels click-to-move, like every
// ARPG: the player took manual control. Jump is deliberately excluded — jumping
// is not a change of heading, so you keep travelling to the destination through
// the hop instead of stopping dead.
export function manualMovementOverrides(mi: {
  forward: boolean; back: boolean; turnLeft: boolean; turnRight: boolean;
  strafeLeft: boolean; strafeRight: boolean; jump: boolean;
}): boolean {
  return mi.forward || mi.back || mi.turnLeft || mi.turnRight || mi.strafeLeft || mi.strafeRight;
}

// How an active click-to-move run should resolve this frame:
// - 'cancel'  : a real interrupt (mouselook, death, feature disabled, or a manual
//               directional key). The destination is discarded.
// - 'pause'   : movement is suspended by an open game menu (or a load transition).
//               The destination is kept and the player simply holds still, so the
//               run resumes the moment the menu closes, the same way autorun
//               survives the menu instead of being cancelled by it.
// - 'continue': keep walking toward the destination.
// Cancel wins over pause: a genuine interrupt during a menu still ends the run.
export type ClickMoveAction = 'cancel' | 'pause' | 'continue';

export function resolveClickMoveAction(mi: {
  forward: boolean; back: boolean; turnLeft: boolean; turnRight: boolean;
  strafeLeft: boolean; strafeRight: boolean; jump: boolean;
}, state: {
  mouselook: boolean;
  movementSuspended: boolean;
  playerDead: boolean;
  enabled: boolean;
}): ClickMoveAction {
  if (state.mouselook || state.playerDead || !state.enabled || manualMovementOverrides(mi)) {
    return 'cancel';
  }
  if (state.movementSuspended) return 'pause';
  return 'continue';
}
