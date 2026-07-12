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
  return (
    clickMoving ||
    mi.forward ||
    mi.back ||
    mi.turnLeft ||
    mi.turnRight ||
    mi.strafeLeft ||
    mi.strafeRight
  );
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

// --- Camera release hold -----------------------------------------------------
// While mouselook (right-mouse drag, touch swipe-look, the camera joystick) or
// Mouse Camera movement is live, the camera owns the player's heading: follow
// is bypassed and every facing commit is an echo of camYaw. Those echoes are
// only VISIBLE through the render-interpolated facing, which lags the commit
// by up to one sim tick offline and a full round trip online. The instant the
// drag releases, follow re-engages, and its rigid term replays that catch-up
// sweep into camYaw: the camera runs PAST the heading the player chose, and
// the settle term then drags it back. That overshoot-and-return is the "camera
// briefly shakes before stabilizing" bug. The hold below keeps follow
// disengaged (cameraDriven) from the release until the interpolated facing
// converges onto the released yaw, so the echo of the camera's own writes is
// never fed back into the camera.

// Converged once the interpolated facing is within this of the released yaw.
// Sized to cover the wire's 0.01 rad facing rounding (see keyboard_turn_facing
// HANDOFF_EPS): the mirror can legitimately sit half a rounding step away.
export const CAMERA_RELEASE_HOLD_EPS = 0.02; // rad (~1.1 degrees)
// Backstop for a facing the server refuses (stun/corpse) or that another
// system takes over: give up and let the settle ease whatever remains. Matches
// keyboard_turn_facing's release-grace floor; scaled up by the measured input
// echo online so a slow link gets its full round trip before follow re-engages.
export const CAMERA_RELEASE_HOLD_MAX_MS = 350;

export interface CameraReleaseHoldState {
  /** The camYaw latched on the release edge; null = no hold in progress. */
  facing: number | null;
  /** Time spent holding since the release edge (ms). */
  heldMs: number;
  /** Previous frame's cameraOwned, for the falling-edge latch. */
  wasOwned: boolean;
}

export function newCameraReleaseHold(): CameraReleaseHoldState {
  return { facing: null, heldMs: 0, wasOwned: false };
}

export interface CameraReleaseHoldArgs {
  /** True while the camera owns the heading (mouselook active, or Mouse Camera
   *  mode with a movement key held): the drag itself, not the release. */
  cameraOwned: boolean;
  camYaw: number;
  /** The same render-interpolated facing the follow camera runs on. */
  interpFacing: number;
  frameDt: number;
  /** Measured input echo (ms), online only; scales the give-up grace. */
  echoMs?: number;
  /** True while keyboard turn keys are held: a manual turn owns the heading
   *  next, so the hold must break instead of freezing the follow camera. */
  manualTurn?: boolean;
}

/**
 * Advance the release hold one frame. Returns true while auto-follow must stay
 * disengaged (pass it into updateFollowCameraYaw's cameraDriven, which still
 * advances lastInterpFacing so re-coupling never snaps). The frame that ends
 * the hold (convergence, manual turn, or timeout) still suppresses, so its
 * interp step never leaks into the rigid follow term.
 */
export function stepCameraReleaseHold(
  state: CameraReleaseHoldState,
  args: CameraReleaseHoldArgs,
): boolean {
  if (args.cameraOwned) {
    // Live drag: follow is already bypassed by the mouselook/cameraDriven
    // flags. Arm the edge detection; the latch happens on the release frame,
    // when camYaw holds the final yaw including the last flick's deltas.
    state.wasOwned = true;
    state.facing = null;
    state.heldMs = 0;
    return false;
  }
  if (state.wasOwned) {
    state.wasOwned = false;
    state.facing = args.camYaw;
    state.heldMs = 0;
  }
  if (state.facing === null) return false;
  state.heldMs += Math.max(0, args.frameDt) * 1000;
  const gap = Math.abs(wrapAngle(args.interpFacing - state.facing));
  const graceMs = Math.max(CAMERA_RELEASE_HOLD_MAX_MS, (args.echoMs ?? 0) * 1.5 + 120);
  if (args.manualTurn || gap <= CAMERA_RELEASE_HOLD_EPS || state.heldMs >= graceMs) {
    state.facing = null;
  }
  return true;
}

export function updateFollowCameraYaw(input: CameraFollowInput): CameraFollowResult {
  let camYaw = input.camYaw;
  if (!input.mouselook && !input.cameraDriven) {
    if (input.orbiting) return { camYaw, lastInterpFacing: input.interpFacing };
    let targetYaw = camYaw;
    if (input.lastInterpFacing !== null && !input.clickMoving)
      targetYaw += wrapAngle(input.interpFacing - input.lastInterpFacing);
    if (input.moving && !input.orbiting) {
      const delta = wrapAngle(input.interpFacing - targetYaw);
      const clickMoveScale = input.clickMoving ? clickMoveSettleScale(Math.abs(delta)) : 1;
      const rate = input.clickMoving ? CLICK_MOVE_SETTLE_RATE * clickMoveScale : SETTLE_RATE;
      const maxStep = input.clickMoving
        ? CLICK_MOVE_MAX_SETTLE_STEP * clickMoveScale
        : MAX_SETTLE_STEP;
      const step = delta * (1 - Math.exp(-Math.max(0, input.frameDt) * rate));
      targetYaw += clamp(step, -maxStep, maxStep);
    }
    camYaw = stepAngleToward(camYaw, targetYaw, maxAutoYawStep(input.frameDt));
  }
  return { camYaw, lastInterpFacing: input.interpFacing };
}
