// Pure WebXR comfort helpers: snap-turn edge detection and yaw math.
// No DOM or Three.js imports so Vitest can exercise the state machine directly.

export const VR_SNAP_TURN_RAD = (45 * Math.PI) / 180;
export const VR_SNAP_STICK_DEADZONE = 0.2;
export const VR_SNAP_TURN_THRESHOLD = 0.65;
export const VR_SNAP_COOLDOWN_S = 0.25;

export interface SnapTurnState {
  /** True once the stick has returned to neutral and another snap may fire. */
  armed: boolean;
  cooldown: number;
}

export function initialSnapTurnState(): SnapTurnState {
  return { armed: true, cooldown: 0 };
}

export function tickSnapTurnCooldown(state: SnapTurnState, dt: number): void {
  state.cooldown = Math.max(0, state.cooldown - dt);
}

/**
 * Poll the right-stick X axis for a comfort snap turn. Matches gamepad look
 * convention: stick right yields a negative yaw delta (turn right).
 */
export function pollSnapTurn(stickX: number, state: SnapTurnState): number {
  const abs = Math.abs(stickX);
  if (abs < VR_SNAP_STICK_DEADZONE) {
    state.armed = true;
    return 0;
  }
  if (!state.armed || state.cooldown > 0 || abs < VR_SNAP_TURN_THRESHOLD) return 0;
  state.armed = false;
  state.cooldown = VR_SNAP_COOLDOWN_S;
  return stickX > 0 ? -VR_SNAP_TURN_RAD : VR_SNAP_TURN_RAD;
}

/** Horizontal yaw (radians) from a unit quaternion. */
export function quatToYaw(x: number, y: number, z: number, w: number): number {
  const siny = 2 * (w * y + z * x);
  const cosy = 1 - 2 * (x * x + y * y);
  return Math.atan2(siny, cosy);
}

/** Body locomotion facing: headset yaw plus any accumulated snap-turn offset. */
export function vrLocomotionFacing(headYaw: number, snapYaw: number): number {
  return wrapAngle(headYaw + snapYaw);
}

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
