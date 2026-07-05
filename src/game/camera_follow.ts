export interface CameraFollowInput {
  camYaw: number;
  interpFacing: number;
  frameDt: number;
  lastInterpFacing: number | null;
  mouselook: boolean;
  moving: boolean;
  clickMoving?: boolean;
  orbiting: boolean;
  // True when the player's facing is being set *from* the camera yaw this frame
  // (mouselook, or mouse-camera-mode while a movement key is held). In that case
  // the camera owns the heading and must NOT auto-follow it — doing so chases a
  // value the camera itself just produced, which feeds back into a wobble. We
  // still advance lastInterpFacing so re-coupling later doesn't snap.
  cameraDriven?: boolean;
}

export interface CameraFollowResult {
  camYaw: number;
  lastInterpFacing: number;
}

export interface CameraFollowMoveInput {
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
}

const SETTLE_RATE = 6;
const MAX_SETTLE_STEP = 0.16;
const CLICK_MOVE_SETTLE_RATE = 1.8;
const CLICK_MOVE_MAX_SETTLE_STEP = 0.022;
const CLICK_MOVE_BIG_TURN_FLOOR = 0.18;
const CLICK_MOVE_SMALL_TURN = 0.35;
const MAX_AUTO_YAW_SPEED = 3.6; // rad/sec; caps all non-manual camera follow motion

// The follow/settle system below must be bypassed whenever the camera is under
// the player's direct manual control: classic right-mouse mouselook OR the
// always-on Mouse Camera mode. Both lock the character's facing to camYaw, so
// letting auto-follow run makes it chase a facing that IS the camera yaw and it
// fights the drag (~45° of drift). Mouse Camera mode reports mouselook=false on
// desktop (no touch-look, no pointer-lock), so it must be folded in here
// explicitly — otherwise it never takes the same smooth path right-mouse uses.
export function cameraIsManual(mouselookActive: boolean, mouseCameraMode: boolean): boolean {
  return mouselookActive || mouseCameraMode;
}

export function cameraFollowShouldSettle(mi: CameraFollowMoveInput, clickMoving: boolean): boolean {
  return clickMoving
    || mi.forward
    || mi.back
    || mi.turnLeft
    || mi.turnRight
    || mi.strafeLeft
    || mi.strafeRight;
}

export function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function maxAutoYawStep(frameDt: number): number {
  const dt = clamp(Math.max(0, frameDt), 0, 1 / 30);
  return MAX_AUTO_YAW_SPEED * dt;
}

function stepAngleToward(current: number, target: number, maxStep: number): number {
  const step = Math.max(0, maxStep);
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

function clickMoveSettleScale(absDelta: number): number {
  const span = Math.PI - CLICK_MOVE_SMALL_TURN;
  const t = span > 0 ? Math.max(0, Math.min(1, (Math.PI - absDelta) / span)) : 1;
  const eased = t * t * (3 - 2 * t);
  return CLICK_MOVE_BIG_TURN_FLOOR + (1 - CLICK_MOVE_BIG_TURN_FLOOR) * eased;
}

export function updateFollowCameraYaw(input: CameraFollowInput): CameraFollowResult {
  let camYaw = input.camYaw;
  if (!input.mouselook && !input.cameraDriven) {
    if (input.orbiting) return { camYaw, lastInterpFacing: input.interpFacing };
    let targetYaw = camYaw;
    if (input.lastInterpFacing !== null && !input.clickMoving) targetYaw += wrapAngle(input.interpFacing - input.lastInterpFacing);
    if (input.moving && !input.orbiting) {
      const delta = wrapAngle(input.interpFacing - targetYaw);
      const clickMoveScale = input.clickMoving ? clickMoveSettleScale(Math.abs(delta)) : 1;
      const rate = input.clickMoving ? CLICK_MOVE_SETTLE_RATE * clickMoveScale : SETTLE_RATE;
      const maxStep = input.clickMoving ? CLICK_MOVE_MAX_SETTLE_STEP * clickMoveScale : MAX_SETTLE_STEP;
      const step = delta * (1 - Math.exp(-Math.max(0, input.frameDt) * rate));
      targetYaw += clamp(step, -maxStep, maxStep);
    }
    camYaw = stepAngleToward(camYaw, targetYaw, maxAutoYawStep(input.frameDt));
  }
  return { camYaw, lastInterpFacing: input.interpFacing };
}
