// Pure decisions for the opt-in first-person camera (the firstPersonMode
// setting): whether first person is engaged this frame, which parts of the
// local player's own model hide, and where the eye sits and looks. Three-,
// DOM- and i18n-free so a plain Vitest drives it (tests/first_person_core.test.ts);
// first_person_camera.ts is the thin consumer the renderer calls.
//
// First person engages only at the CLOSEST zoom, so the mouse wheel is the
// switch: scroll all the way in to enter it, scroll out one notch to leave.
// Display-only: the sim never sees the camera, so it changes nothing a player
// reacts to beyond the framing itself.

/** 0 off (the shipped chase camera), 1 first person showing the body below the
 *  head, 2 first person with the whole model hidden. */
export type FirstPersonMode = 0 | 1 | 2;

export const FIRST_PERSON_OFF: FirstPersonMode = 0;
export const FIRST_PERSON_BODY: FirstPersonMode = 1;
export const FIRST_PERSON_NO_BODY: FirstPersonMode = 2;

/** The closest zoom the wheel reaches (SETTING_RANGES.cameraZoom.min, pinned
 *  equal by the test): first person engages at or inside it. */
export const FIRST_PERSON_ENGAGE_DIST = 3;

/** Eye height as a fraction of the model's unscaled height. */
export const FIRST_PERSON_EYE_FRACTION = 0.92;

/** Yards the eye sits ahead of the head pivot, so the near plane clears the
 *  collar and shoulders the body mode keeps drawing. */
export const FIRST_PERSON_FORWARD = 0.14;

/** The chase camera's pitch rests looking down at the avatar (positive is
 *  down); first person subtracts this so the resting view looks near level
 *  while a look down still reaches the player's own legs. */
export const FIRST_PERSON_PITCH_BIAS = 0.2;

/** Distance of the look target ahead of the eye. Short on purpose: the
 *  occluder fade and the audio listener read this point as the avatar eye, so
 *  a short segment keeps walls ahead of the player solid. */
export const FIRST_PERSON_LOOK_DIST = 0.5;

/** Eye height used before the local model has been built. */
export const FIRST_PERSON_FALLBACK_EYE = 1.7;

/** Clamp a stored setting value to a mode (anything unknown is off). */
export function firstPersonModeFromSetting(value: number): FirstPersonMode {
  if (!Number.isFinite(value)) return FIRST_PERSON_OFF;
  const rounded = Math.round(value);
  return rounded === 1 || rounded === 2 ? rounded : FIRST_PERSON_OFF;
}

export interface FirstPersonGate {
  mode: FirstPersonMode;
  /** The player's requested zoom (Input.camDist mirrored on the renderer). */
  camDist: number;
  /** A dead body, a directed camera move or a vehicle seat keep the chase
   *  camera: each one frames something the player must see from outside. */
  blocked: boolean;
}

/** True when first person owns the camera this frame. */
export function firstPersonActive(gate: FirstPersonGate): boolean {
  return (
    gate.mode !== FIRST_PERSON_OFF &&
    !gate.blocked &&
    gate.camDist <= FIRST_PERSON_ENGAGE_DIST + 1e-3
  );
}

export interface FirstPersonHiding {
  readonly head: boolean;
  readonly body: boolean;
}

const SHOW_ALL: FirstPersonHiding = Object.freeze({ head: false, body: false });
const HIDE_HEAD: FirstPersonHiding = Object.freeze({ head: true, body: false });
const HIDE_ALL: FirstPersonHiding = Object.freeze({ head: true, body: true });

/** Which parts of the local model hide. Reused frozen records, no per-frame
 *  allocation. Outside first person nothing hides, whatever the mode. */
export function firstPersonHiding(mode: FirstPersonMode, active: boolean): FirstPersonHiding {
  if (!active || mode === FIRST_PERSON_OFF) return SHOW_ALL;
  return mode === FIRST_PERSON_BODY ? HIDE_HEAD : HIDE_ALL;
}

/** World eye height above the feet for a view of the given unscaled height,
 *  saddle lift and entity scale. */
export function firstPersonEyeHeight(height: number, mountLift: number, scale: number): number {
  if (!(height > 0)) return FIRST_PERSON_FALLBACK_EYE;
  const s = scale > 0 ? scale : 1;
  return (height * FIRST_PERSON_EYE_FRACTION + Math.max(0, mountLift)) * s;
}

export interface FirstPersonPose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

export function createFirstPersonPose(): FirstPersonPose {
  return { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 1 };
}

/**
 * The eye and its look target for feet at (footX, footY, footZ), the camera
 * yaw (the chase camera's: 0 looks down +z) and its pitch (positive looks
 * down). Fills and returns `out`.
 */
export function firstPersonPoseInto(
  out: FirstPersonPose,
  footX: number,
  footY: number,
  footZ: number,
  yaw: number,
  camPitch: number,
  eyeHeight: number,
): FirstPersonPose {
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const pitch = camPitch - FIRST_PERSON_PITCH_BIAS;
  const level = Math.cos(pitch);
  out.x = footX + sinYaw * FIRST_PERSON_FORWARD;
  out.y = footY + eyeHeight;
  out.z = footZ + cosYaw * FIRST_PERSON_FORWARD;
  out.lookX = out.x + sinYaw * level * FIRST_PERSON_LOOK_DIST;
  out.lookY = out.y - Math.sin(pitch) * FIRST_PERSON_LOOK_DIST;
  out.lookZ = out.z + cosYaw * level * FIRST_PERSON_LOOK_DIST;
  return out;
}
