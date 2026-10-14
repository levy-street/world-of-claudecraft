// The chase camera's boom and ground clamps for authored (Studio) maps, pure:
// no Three, no DOM. renderer.ts updateCamera is the
// thin consumer. On the BUILT-IN world none of this runs: the boom keeps the
// requested distance and the ground clamp is the height-blind groundHeight,
// exactly as the shipped renderer always did (the caller passes
// `authored: false` and skips the solve).

import { cameraBoomMaxDist } from '../../sim/colliders';
import {
  cameraSheetMaxDist,
  groundHeightAtBody,
  groundHeightNear,
  onUnderSheet,
} from '../../sim/world';

/** How much of the boom is pulled in at FULL look-up. The extra look-up range
 *  is useless on its own: swinging the boom under the player just drives it
 *  into the ground behind them, the terrain clamp shoves it back up, and the
 *  view never tilts. Pulling the camera toward the player as it swings under
 *  is what buys the steep angle, the WoW feel SPACEY asked for, "the camera
 *  gets a bit closer to the player model and the camera pivots up at a
 *  steeper angle". Squared so it stays out of the way near level. */
export const LOOKUP_DOLLY = 0.5;
/** Yards a second the boom eases back out after an asset stopped it. */
export const BOOM_SOLID_RELEASE = 14;

/** The look-up dolly: only bites on NEGATIVE pitch, so ordinary play and
 *  every look-down angle keep the boom they had. `pitchUp` is the input
 *  layer's look-up clamp (negative). */
export function lookUpDollyDist(dist: number, pitch: number, pitchUp: number): number {
  if (pitch >= 0) return dist;
  const lookUp = Math.min(1, pitch / pitchUp);
  return dist * (1 - LOOKUP_DOLLY * lookUp * lookUp);
}

/** A placed asset stops the boom the way rock does. It snaps IN at once and
 *  eases back OUT, so rounding a wall's corner does not fling the view. */
export function easeBoomSolidLimit(prev: number, solidMax: number, dt: number): number {
  return solidMax < prev ? solidMax : Math.min(solidMax, prev + dt * BOOM_SOLID_RELEASE);
}

export interface ChaseBoomInput {
  seed: number;
  /** Pivot (look-at) position and the eye height above it. */
  px: number;
  pz: number;
  eyeY: number;
  yaw: number;
  pitch: number;
  /** The requested boom length. */
  dist: number;
  /** Highest the camera may sit (the underwater ceiling). */
  ceilingY: number;
  dt: number;
  /** The input layer's look-up clamp (CAM_PITCH_UP). */
  pitchUp: number;
}

/** The solved camera seat. `solidLimit` is the eased asset-collider limit the
 *  caller carries to the next frame. */
export interface ChaseBoomOut {
  x: number;
  y: number;
  z: number;
  dist: number;
  solidLimit: number;
}

/** One allocation-free in/out pair for a host to keep across frames. */
export function createChaseBoomScratch(pitchUp: number): {
  input: ChaseBoomInput;
  out: ChaseBoomOut;
} {
  return {
    input: {
      seed: 0,
      px: 0,
      pz: 0,
      eyeY: 0,
      yaw: 0,
      pitch: 0,
      dist: 0,
      ceilingY: 0,
      dt: 0,
      pitchUp,
    },
    out: { x: 0, y: 0, z: 0, dist: 0, solidLimit: Number.POSITIVE_INFINITY },
  };
}

function seat(i: ChaseBoomInput, dist: number, out: ChaseBoomOut): void {
  out.dist = dist;
  out.x = i.px - Math.sin(i.yaw) * Math.cos(i.pitch) * dist;
  out.y = Math.min(i.eyeY + Math.sin(i.pitch) * dist, i.ceilingY);
  out.z = i.pz - Math.cos(i.yaw) * Math.cos(i.pitch) * dist;
}

/**
 * Seat the boom on an authored map. Inside a buried cave tube or carve
 * cavity the boom must not pull back through the rock: clamp the distance to
 * the last point still inside the air (Infinity everywhere else, including at
 * open mouths). A placed asset's collider stops it the way rock does (SPACEY,
 * 2026-09-19: "make the camera work with our assets colliion just like the
 * terrain"), eased back out by easeBoomSolidLimit.
 */
export function solveChaseBoom(
  i: ChaseBoomInput,
  prevSolidLimit: number,
  out: ChaseBoomOut,
): ChaseBoomOut {
  const camDist = lookUpDollyDist(i.dist, i.pitch, i.pitchUp);
  seat(i, camDist, out);
  const sheetMax = cameraSheetMaxDist(i.seed, i.px, i.eyeY, i.pz, out.x, out.y, out.z, 0.35);
  const solidMax = cameraBoomMaxDist(i.seed, i.px, i.eyeY, i.pz, out.x, out.y, out.z, 0.3);
  out.solidLimit = easeBoomSolidLimit(prevSolidLimit, solidMax, i.dt);
  const boomMax = Math.min(sheetMax, out.solidLimit);
  if (boomMax < camDist) seat(i, Math.max(0.9, boomMax), out);
  return out;
}

/**
 * The ground clamp under the seated camera on an authored map. BODY-AWARE, not
 * the blind groundHeight: that answers with the highest walkable surface in the
 * camera's column, so standing under any upper storey (a gallery, a
 * bridge) the clamp read the deck over the player's
 * HEAD as the floor and shoved the camera up onto it. The pivot's own height
 * picks the sheet. A player standing on an under-sheet (tube/carve floor)
 * needs the clamp to read THAT sheet, not the hillside overhead, and a void
 * column (the wall-rise sentinel) must never catapult the camera skyward.
 * Returns the clamp height (0.6 yd of clearance included) before any rift or
 * maze lift the caller adds.
 */
export function authoredChaseGroundY(
  seed: number,
  cx: number,
  cz: number,
  px: number,
  py: number,
  pz: number,
  eyeY: number,
): number {
  const groundY = groundHeightAtBody(cx, cz, seed, py) + 0.6;
  if (!onUnderSheet(px, pz, seed, py)) return groundY;
  const sheetRef = groundHeightNear(cx, cz, seed, eyeY - 2.0);
  return sheetRef > groundY + 500 ? Number.NEGATIVE_INFINITY : sheetRef + 0.6;
}
