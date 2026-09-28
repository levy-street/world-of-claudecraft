// The indoor chase camera on screen: the registry of walk-in interiors and the per-frame
// clamp the renderer's updateCamera calls once (the decisions are interior_camera_core.ts).
//
// A building registers its air when it is built (registerCameraInterior) and drops it when
// torn down. Each frame, when the player's eye stands in a registered interior (past its
// front door's threshold), the drawn camera is pulled in along the chase ray to stay in that air,
// gliding both ways on a critically damped spring (a quick pull-in that never lags a wall by
// more than INTERIOR_BOOM_MAX_LAG, a gentle release), and the look point is brought back to
// the eye when the lagged pivot would sit across a wall.
//
// Walking in, the camera follows through the door: past its threshold the lens comes
// down, keeping its distance behind the player, until it is no higher over the eye than
// the door's head allows (interiorEntryCap), so its sight line threads the doorway while it
// is still outside; a ray out through the door runs on past it (the `through` hold), so the
// lens keeps its distance and nothing between it and the player needs cutting away; a ray
// over a lintel or under a ceiling flattens by the least that clears it, at once, never
// lagging into a pull-in. Once the player stops just inside (or a few seconds on) the hold
// eases out and the lens comes in to the room. A pull-in that a wall asks for (a camera at an
// angle to the door, its ray cut by a jamb) blends in over the first yards past the door
// (interiorEntryWeight). While the lens stands outside the air interiorLensInAir says so, and
// the building treats the sight line as it does a camera outdoors (it threads the doorway,
// so nothing is cut; at an angle only the piece of wall between lens and player ghosts).
// Where the ray is cramped (a player backed against a wall or into a room's corner), the
// camera glides to the nearest comfortable framing, up over the obstruction or round it along the
// wall, rather than sitting in the player's head, and glides back as the view clears.
// Interiors opting into preserve-angle instead keep the requested ray once inside, shorten
// only its distance, and hide a close body without jumping the lens to the eyes.
// Walking out releases the last shortened boom over at most INTERIOR_RELEASE_MAX_SEC;
// outdoors with no release pending nothing here touches the camera. The requested yaw,
// pitch and distance stay owned by the camera stack: only the drawn position moves (the
// pinned exception in tests/graphics_overhaul_integration.test.ts).
//
// Draw-time shake (the Fiesta trauma jitter and the warrior's impact kick) is applied after
// updateCamera, so the renderer re-checks the shaken pose just before the draw
// (constrainInteriorCameraDraw) and puts the unclamped shaken pose back after it
// (restoreInteriorCameraDraw), so the shake's own subtraction undoes exactly its offset.
//
// A dead-end corner no framing escapes (the camera within SELF_HIDE_BOOM of the eye, a last
// resort the comfortable framings make rare) cuts to the player's eyes, looking out the way
// the requested camera looks, and hides the player's own body for the frame
// (hideSelfInCloseCamera), the classic MMO first-person cut.
//
// Nameplates: while the player is indoors, a plate on a body outside the interior draws
// only when the camera sees it through an opening (interiorHidesNameplate, the nameplate
// painter's gate), so the plates of the mobs outside never float through the walls.
//
// Per frame: a few slab tests, no allocation.

import type * as THREE from 'three';
import { BOOM_SNAP_DIST } from './camera_boom_core';
import {
  type CameraInterior,
  chooseInteriorFraming,
  frameBoomInto,
  INTERIOR_ENTRY_CAP_RATE,
  INTERIOR_LOOK_BLEND,
  INTERIOR_RELEASE_MAX_SEC,
  INTERIOR_THROUGH_HOLD_SEC,
  INTERIOR_THROUGH_MAX_SEC,
  INTERIOR_THROUGH_WALK_IN_DEPTH,
  type InteriorBoomSpring,
  interiorCameraPadding,
  interiorContains,
  interiorEntryCap,
  interiorEntryHold,
  interiorEntrySettle,
  interiorEntryWeight,
  interiorHoldsEye,
  interiorNearestOpening,
  interiorOpeningDepth,
  interiorSeesOut,
  interiorSegmentFraction,
  interiorSegmentTouches,
  stepInteriorBoom,
  stepInteriorFraming,
  stepInteriorLift,
} from './interior_camera_core';

/** The eye (the look point) stands this high over the feet (renderer.ts eyeY). */
const EYE_OVER_FEET = 2.0;
/** A body's plate test point stands this high over its feet (the chest, not the plate). */
const BODY_OVER_FEET = 1.0;
/** Closer than this to the look point after every framing (a corner no framing escapes),
 *  the camera cuts to the player's eyes and the player's own body hides; it draws back out
 *  past SELF_SHOW_BOOM (hysteresis: no flicker at the edge). */
export const SELF_HIDE_BOOM = 1.2;
export const SELF_SHOW_BOOM = 1.6;
/** In the cut to the eyes, the aim point stands this far ahead of the eye. */
const FIRST_PERSON_AIM = 4;
/** Farther than this from the pose updateCamera left, the drawn camera is not the chase
 *  camera (the editor's free camera): the draw-time re-check leaves it alone. */
const DRAW_SHIFT_MAX = 2.5;
/** The avatar moving slower than this (yards a second) is standing still: the lens held
 *  outside a door starts to come in. */
const STILL_SPEED = 0.6;
/** Standing still this long (seconds) starts the through-door hold's ease out. */
const STILL_SEC = 0.25;
/** Restore the entrance height gently when distance, rather than a new angle, must
 *  clear the ceiling. A fast height release and boom pull-in otherwise compound. */
const STABLE_ENTRY_RELEASE_RATE = 2;

const interiors: CameraInterior[] = [];
/** Scratch for a lifted boom (no allocation per frame). */
const scratch = { x: 0, y: 0, z: 0 };

/** Register (or replace, by id) a building's interior; the returned function drops it. */
export function registerCameraInterior(vol: CameraInterior): () => void {
  unregisterCameraInterior(vol.id);
  interiors.push(vol);
  return () => unregisterCameraInterior(vol.id);
}

export function unregisterCameraInterior(id: string): void {
  const i = interiors.findIndex((v) => v.id === id);
  if (i >= 0) interiors.splice(i, 1);
  if (state.active?.id === id) state.active = null;
}

const state = {
  /** The interior the player's eye stands in this frame. */
  active: null as CameraInterior | null,
  /** The drawn boom along the chase ray from `start`: its length and its glide. */
  boom: { dist: 0, vel: 0, target: 0, drop: 0 } as InteriorBoomSpring,
  /** The drawn lens stands in the air (false while it follows through a doorway, or for a
   *  pull-in's last frames past a wall: the building's cutaway covers those). */
  lensInside: false,
  /** The eased framing of a cramped spot: the lift (radians over the requested elevation)
   *  and the swing (radians of yaw round the look point). */
  lift: 0,
  swing: 0,
  /** Seconds of release left after walking out (0: free). */
  release: 0,
  /** Seconds since the eye stepped inside (the threshold blend's clock). */
  inside: 0,
  /** How far a ray out through the front door may run on past it (1 whole, 0 none): set on
   *  walking in, eased out once the player stands still or a few seconds on. */
  through: 1,
  /** Seconds the avatar has stood still. */
  still: 0,
  /** The entry cap's weight, walked toward its target (interiorEntryCap). */
  cap: 0,
  /** The camera has cut to the player's eyes (a corner no framing escapes). */
  firstPerson: false,
  pad: 0.3,
  startX: 0,
  startY: 0,
  startZ: 0,
  lastSelfX: Number.NaN,
  lastSelfY: 0,
  lastSelfZ: 0,
  /** The pose updateCamera left (the draw-time re-check's anchor). */
  poseX: 0,
  poseY: 0,
  poseZ: 0,
  /** The shaken pose before the draw-time re-check moved it. */
  drawnX: 0,
  drawnY: 0,
  drawnZ: 0,
  drawnSaved: false,
};

function interiorAt(x: number, y: number, z: number): CameraInterior | null {
  for (const vol of interiors) if (interiorHoldsEye(vol, x, y, z)) return vol;
  return null;
}

/**
 * Keep the chase camera inside the interior the player stands in. `camera.position` is the
 * desired camera (updateCamera's one pose) and `look` its look point, both adjusted in
 * place; `self` is the avatar's display position (its feet).
 */
export function clampChaseCameraToInterior(
  camera: THREE.PerspectiveCamera,
  look: THREE.Vector3,
  self: THREE.Vector3,
  dt: number,
  reducedMotion: boolean,
): void {
  const pos = camera.position;
  const moved = Number.isNaN(state.lastSelfX)
    ? Infinity
    : Math.hypot(self.x - state.lastSelfX, self.y - state.lastSelfY, self.z - state.lastSelfZ);
  const teleported = moved > BOOM_SNAP_DIST;
  state.lastSelfX = self.x;
  state.lastSelfY = self.y;
  state.lastSelfZ = self.z;
  const eyeX = self.x;
  const eyeY = self.y + EYE_OVER_FEET;
  const eyeZ = self.z;
  const was = state.active;
  const vol = interiorAt(eyeX, eyeY, eyeZ);
  state.active = vol;
  if (!vol) {
    state.firstPerson = false;
    state.lensInside = false;
    state.through = 1;
    state.still = 0;
    // walked out: ease the last shortened boom back to the requested one, briefly
    if (was) state.release = INTERIOR_RELEASE_MAX_SEC;
    if (reducedMotion || teleported) state.release = 0;
    state.inside = 0;
    if (state.release <= 0) {
      // free: no framing left over for the next walk in
      state.lift = 0;
      state.swing = 0;
      return;
    }
    state.release = Math.max(0, state.release - Math.max(0, dt));
    const len = pos.distanceTo(look);
    stepInteriorBoom(state.boom, len, dt, state.release === 0);
    state.lift = stepInteriorFraming(state.lift, 0, dt, state.release === 0, state.boom.dist);
    state.swing = stepInteriorFraming(state.swing, 0, dt, state.release === 0, state.boom.dist);
    if (
      len < 1e-9 ||
      (Math.abs(len - state.boom.dist) < 1e-3 &&
        Math.abs(state.lift) < 1e-3 &&
        Math.abs(state.swing) < 1e-3)
    ) {
      state.release = 0;
      state.lift = 0;
      state.swing = 0;
      return;
    }
    const d = frameBoomInto(
      scratch,
      pos.x - look.x,
      pos.y - look.y,
      pos.z - look.z,
      state.lift,
      state.swing,
    );
    const f = Math.min(1, state.boom.dist / len);
    pos.set(look.x + d.x * f, look.y + d.y * f, look.z + d.z * f);
    return;
  }
  // walked in from outdoors (no release still running): the boom starts where the free
  // camera stands, so the clamp glides in rather than snapping
  const fresh = !was && state.release <= 0;
  state.release = 0;
  state.inside += Math.max(0, dt);
  state.pad = interiorCameraPadding(camera.near, camera.fov, camera.aspect);
  // the through-door hold: whole on walking in over the threshold (never on a teleport or a
  // login inside), easing out once the player stands still (or a few seconds on), never back
  // up until the next walk in
  if (!was) {
    const w0 = interiorEntryWeight(vol, eyeX, eyeY, eyeZ);
    const walkedIn = !teleported && interiorNearestOpening.depth <= INTERIOR_THROUGH_WALK_IN_DEPTH;
    state.through = walkedIn && w0 < 1 ? 1 : 0;
  }
  const speed = dt > 1e-6 && Number.isFinite(moved) ? moved / dt : 0;
  state.still = speed < STILL_SPEED ? state.still + Math.max(0, dt) : 0;
  if (reducedMotion) state.through = 0;
  else if (state.still > STILL_SEC || state.inside > INTERIOR_THROUGH_MAX_SEC) {
    state.through = Math.max(0, state.through - Math.max(0, dt) / INTERIOR_THROUGH_HOLD_SEC);
  }
  // the lagged (or shoulder-shifted, or led) look point must stand in the air on the eye's
  // side of every wall; otherwise the ray starts at the eye, the whole boom shifted with it.
  // Near a doorway's threshold (where a ray from the look point would leave by a jamb at
  // once) the start hands over from the eye to the look point smoothly as it comes in
  let sx = look.x;
  let sy = look.y;
  let sz = look.z;
  let k = 0;
  if (
    !interiorContains(vol, sx, sy, sz) ||
    interiorSegmentFraction(vol, eyeX, eyeY, eyeZ, sx, sy, sz, 0) < 1
  ) {
    k = 1;
  } else if (vol.openings.length > 0) {
    const t = Math.min(1, interiorOpeningDepth(vol, sx, sy, sz) / INTERIOR_LOOK_BLEND);
    k = 1 - t * t * (3 - 2 * t);
  }
  if (k > 0) {
    const ox = (eyeX - sx) * k;
    const oy = (eyeY - sy) * k;
    const oz = (eyeZ - sz) * k;
    pos.set(pos.x + ox, pos.y + oy, pos.z + oz);
    look.set(sx + ox, sy + oy, sz + oz);
    sx += ox;
    sy += oy;
    sz += oz;
  }
  state.startX = sx;
  state.startY = sy;
  state.startZ = sz;
  let dx = pos.x - sx;
  let dy = pos.y - sy;
  let dz = pos.z - sz;
  const pad = state.pad;
  // the requested view's direction (the cut to the eyes looks out along it)
  const reqLen = Math.hypot(dx, dy, dz);
  const aimX = reqLen > 1e-9 ? -dx / reqLen : 0;
  const aimY = reqLen > 1e-9 ? -dy / reqLen : 0;
  const aimZ = reqLen > 1e-9 ? -dz / reqLen : 0;
  // near the front door, for a player who walked in, the lens comes down to thread the
  // doorway, keeping its distance; the cap's weight walks in and out, never a jump
  interiorEntryCap(vol, sx, sy, sz, dx, dy, dz, pad);
  const capTarget = interiorEntryHold.weight * state.through;
  const capRate =
    vol.framing === 'preserve-angle' && capTarget < state.cap
      ? STABLE_ENTRY_RELEASE_RATE
      : INTERIOR_ENTRY_CAP_RATE;
  if (!was || reducedMotion || teleported) state.cap = !was && !teleported ? 0 : capTarget;
  else state.cap += (capTarget - state.cap) * (1 - Math.exp(-capRate * Math.max(0, dt)));
  if (dy > interiorEntryHold.rise) dy -= state.cap * (dy - interiorEntryHold.rise);
  const len = Math.hypot(dx, dy, dz);
  // cramped (a player backed against a wall or into a corner): the
  // least departure from the requested view that frames the player comfortably, a lift over
  // what cramps it or a swing along the wall, eased in and out
  // the threshold: the clamp (and any framing) blends in over the first yards past a door
  const w = Math.max(interiorEntryWeight(vol, eyeX, eyeY, eyeZ), interiorEntrySettle(state.inside));
  // the through-door hold lets go once the requested lens has come in through the door
  const through = state.through * interiorEntryHold.value;
  const choice = chooseInteriorFraming(vol, sx, sy, sz, dx, dy, dz, pad, state.swing, through);
  let clamped = choice.boom;
  const immediate = reducedMotion || teleported || (was !== null && was !== vol);
  if (fresh && !immediate) {
    state.boom.dist = len;
    state.boom.vel = 0;
    state.boom.target = len;
    state.boom.drop = 0;
    state.lift = 0;
    state.swing = 0;
  }
  const drawn = state.boom.dist;
  // a flattening under a lintel or a ceiling is taken whole and at once (never blended in, so
  // the ray never lags into a pull-in); a framing of a cramped spot blends in with the clamp
  const liftTarget = choice.flatten ? choice.lift : choice.lift * w;
  state.lift = stepInteriorLift(state.lift, liftTarget, dt, immediate, drawn);
  state.swing = stepInteriorFraming(state.swing, choice.swing * w, dt, immediate, drawn);
  if (Math.abs(state.lift) > 1e-4 || Math.abs(state.swing) > 1e-4) {
    frameBoomInto(scratch, dx, dy, dz, state.lift, state.swing);
    dx = scratch.x;
    dy = scratch.y;
    dz = scratch.z;
    clamped =
      len * interiorSegmentFraction(vol, sx, sy, sz, sx + dx, sy + dy, sz + dz, pad, through);
  }
  const allowed = clamped + (len - clamped) * (1 - w);
  // a steady shrink is followed within 90% of the pad: the lens stays in the room's air
  stepInteriorBoom(state.boom, allowed, dt, immediate, pad * 0.9);
  const f = len > 1e-9 ? Math.min(1, state.boom.dist / len) : 0;
  // a corner no framing escapes: the classic cut to the player's eyes, looking out the way
  // the requested camera looks (never a screen filled with the back of a head)
  const boom = f * len;
  state.firstPerson = state.firstPerson ? boom < SELF_SHOW_BOOM : boom < SELF_HIDE_BOOM;
  if (state.firstPerson && len > 1e-9) {
    // A stable view hides the close body without jumping the lens to the eyes. Keep
    // following the collision spring right through the hide/show hysteresis band.
    const k = FIRST_PERSON_AIM;
    if (vol.framing === 'preserve-angle') {
      pos.set(sx + dx * f, sy + dy * f, sz + dz * f);
      // Keep any temporary doorway flattening too: hiding the body must not
      // suddenly restore pitch while the entrance is still settling.
      look.set(pos.x - (dx / len) * k, pos.y - (dy / len) * k, pos.z - (dz / len) * k);
    } else {
      pos.set(sx, sy, sz);
      look.set(pos.x + aimX * k, pos.y + aimY * k, pos.z + aimZ * k);
    }
  } else {
    pos.set(sx + dx * f, sy + dy * f, sz + dz * f);
  }
  state.lensInside = state.firstPerson || interiorContains(vol, pos.x, pos.y, pos.z);
  state.poseX = pos.x;
  state.poseY = pos.y;
  state.poseZ = pos.z;
}

/** Hide the player's own body (its view group) while the indoor camera has cut to the
 *  player's eyes. Called once a frame after the camera update; the view's own visibility
 *  pass shows it again next frame, so outdoors (or once the camera draws back) nothing
 *  stays hidden. The camera argument is the drawn one (unused: the cut is decided in the
 *  clamp), kept so the call reads at the renderer's one site. */
export function hideSelfInCloseCamera(
  group: THREE.Object3D | undefined,
  _camera: THREE.PerspectiveCamera,
): void {
  if (state.active && state.firstPerson && group) group.visible = false;
}

/** Re-check the shaken camera just before the draw (after every draw-time shake). */
export function constrainInteriorCameraDraw(camera: THREE.PerspectiveCamera): void {
  state.drawnSaved = false;
  const vol = state.active;
  // a lens following through the doorway (or gliding in) is the shell cutaway's to cover
  if (!vol || !state.lensInside) return;
  const pos = camera.position;
  const sx = pos.x - state.poseX;
  const sy = pos.y - state.poseY;
  const sz = pos.z - state.poseZ;
  const shift = sx * sx + sy * sy + sz * sz;
  // no shake this frame: the pose is the clamp's own, drawn as it is
  if (shift < 1e-12 || shift > DRAW_SHIFT_MAX * DRAW_SHIFT_MAX) return;
  const f = interiorSegmentFraction(
    vol,
    state.startX,
    state.startY,
    state.startZ,
    pos.x,
    pos.y,
    pos.z,
    state.pad,
  );
  if (f >= 1) return;
  state.drawnX = pos.x;
  state.drawnY = pos.y;
  state.drawnZ = pos.z;
  state.drawnSaved = true;
  pos.set(
    state.startX + (pos.x - state.startX) * f,
    state.startY + (pos.y - state.startY) * f,
    state.startZ + (pos.z - state.startZ) * f,
  );
}

/** Put the shaken pose back after the draw (before the shakes subtract their offsets). */
export function restoreInteriorCameraDraw(camera: THREE.PerspectiveCamera): void {
  if (!state.drawnSaved) return;
  state.drawnSaved = false;
  camera.position.set(state.drawnX, state.drawnY, state.drawnZ);
}

/**
 * Whether the plate of a body whose feet stand at (x, y, z), its plate at `plateY`, hides
 * this frame: the player is indoors, the body is not, and the camera does not see it
 * through an opening onto the world. While the lens follows through the door from outside,
 * the player's eye decides instead: a body it sees out of the door keeps its plate, one
 * behind the walls does not.
 */
export function interiorHidesNameplate(
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  plateY: number,
): boolean {
  const vol = state.active;
  // outdoors (or on the threshold, in the doorway's thickness): the world is in view, but a
  // body inside a building keeps its plate only where the camera sees it through an opening
  // (the door), so the people inside never print their names across a closed wall
  if (!vol) {
    const c = camera.position;
    for (const inner of interiors) {
      if (!interiorContains(inner, x, y + BODY_OVER_FEET, z)) continue;
      if (interiorContains(inner, c.x, c.y, c.z)) return false;
      return !interiorSeesOut(inner, x, plateY, z, c.x, c.y, c.z);
    }
    return false;
  }
  if (interiorContains(vol, x, y + BODY_OVER_FEET, z)) return false;
  if (!state.lensInside) {
    // the lens follows through the door from outside: a body it sees past the building (on
    // the porch, beside the door) keeps its plate; one the building stands between is the
    // eye's to see, out of the door or not at all
    const c = camera.position;
    if (!interiorSegmentTouches(vol, c.x, c.y, c.z, x, plateY, z)) return false;
    return !interiorSeesOut(vol, state.startX, state.startY, state.startZ, x, plateY, z);
  }
  const c = camera.position;
  return !interiorSeesOut(vol, c.x, c.y, c.z, x, plateY, z);
}

/** The interior the player's eye stood in at the last camera update (null outdoors). */
export function activeCameraInterior(): CameraInterior | null {
  return state.active;
}

/** Whether the drawn lens stands in the air of the interior the player is in (false outdoors,
 *  and while the lens follows through a doorway or glides in past a wall: then a building
 *  cuts its shell away on the sight line as it does for a camera outside). */
export function interiorLensInAir(): boolean {
  return state.active !== null && state.lensInside;
}

/** Whether the camera update has run (a building's own cutaway may follow the clamp's
 *  indoor verdict from then on; before it, as in a test, the building decides alone). */
export function interiorCameraRunning(): boolean {
  return !Number.isNaN(state.lastSelfX);
}

export const interiorCameraInternalsForTest = {
  reset(): void {
    interiors.length = 0;
    state.active = null;
    state.boom.dist = 0;
    state.boom.vel = 0;
    state.boom.target = 0;
    state.boom.drop = 0;
    state.lensInside = false;
    state.lift = 0;
    state.swing = 0;
    state.release = 0;
    state.inside = 0;
    state.through = 1;
    state.still = 0;
    state.cap = 0;
    state.lastSelfX = Number.NaN;
    state.drawnSaved = false;
    state.firstPerson = false;
  },
  interiors: (): readonly CameraInterior[] => interiors,
  state: () => state,
};
