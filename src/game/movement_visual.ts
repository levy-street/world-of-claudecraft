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
  let mx = 0;
  let mz = 0;
  if (mi.forward) mz += 1;
  if (mi.back) mz -= 1;
  if (mi.strafeLeft) mx -= 1;
  if (mi.strafeRight) mx += 1;

  // Preserve classic pure strafe/backpedal presentation; only combined diagonal
  // travel gets a visual yaw override.
  if (mx === 0 || mz === 0) return null;
  return normAngle(baseFacing - Math.atan2(mx, mz));
}
