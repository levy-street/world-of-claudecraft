// Visual-only facing for local diagonal movement. Gameplay/combat facing stays
// authoritative; this only lets the rendered character point into the direction
// their feet are actually travelling when forward/back is combined with strafe.

export interface MovementVisualInput {
  forward: boolean;
  back: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
}

function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function diagonalMovementVisualFacing(
  mi: MovementVisualInput,
  baseFacing: number,
): number | null {
  const offset = diagonalMovementVisualOffset(mi);
  return offset === null ? null : normAngle(baseFacing + offset);
}

/**
 * The visual yaw offset the travel direction asks for, in radians, or null for
 * "no override" (a pure strafe or a straight run keeps the classic
 * presentation).
 *
 * Split out of {@link diagonalMovementVisualFacing} so the offset can be EASED.
 * Applied raw it is a step function — 0 running forward, -45 degrees the instant
 * a strafe joins it, 0 again the instant the forward key lifts — so a player
 * rolling across A and D spun the model between three fixed headings with
 * nothing in between. It read as the character snapping rather than turning,
 * which is exactly what it was.
 */
export function diagonalMovementVisualOffset(mi: MovementVisualInput): number | null {
  let mx = 0;
  let mz = 0;
  if (mi.forward) mz += 1;
  if (mi.back) mz -= 1;
  if (mi.strafeLeft) mx -= 1;
  if (mi.strafeRight) mx += 1;

  // Preserve classic pure strafe/backpedal presentation; only combined diagonal
  // travel gets a visual yaw override.
  if (mx === 0 || mz === 0) return null;
  return -Math.atan2(mx, mz);
}

/** Seconds for the eased offset to cover most of the gap to its target. Short
 *  enough that the body still reads as answering the key immediately, long
 *  enough that the 45-degree steps become a turn. */
const VISUAL_TURN_TAU = 0.11;

/**
 * Ease the visual offset toward its target along the SHORT way round.
 *
 * Wrap-aware on purpose: the offset lives in [-pi, pi], and a body going from
 * +170 to -170 degrees is a 20-degree flick, not a 340-degree spin the long way
 * round — which is what a plain lerp of the two numbers would animate.
 */
export function easeMovementVisualOffset(current: number, target: number, dt: number): number {
  const delta = normAngle(target - current);
  const k = 1 - Math.exp(-Math.max(0, dt) / VISUAL_TURN_TAU);
  return normAngle(current + delta * k);
}
