// Pure per-frame visibility core for the Fenbridge town renderer. The Three
// side owns scene nodes and material writes; this module decides fog culling
// and eye-to-camera building occlusion into one caller-owned plan.

import { occluderFadesDisabled } from './occluder_fade_core';

export interface FenbridgeBuildingVisibilityTarget {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  cosine: number;
  sine: number;
  topY: number;
  cullRadius: number;
  /** A building with an open doorway the player walks into
   *  (fenbridge_layout.ts `walkIn`). */
  walkIn?: boolean;
  /** A walk-in building's doorways as boxes [x0, x1, y0, y1, z0, z1] (its camera interior's
   *  openings, placed_town_interior_core.ts), in the world's axes or in `doorwayFrame`. A
   *  player stepping in with the camera still outside sees in through the door: the building
   *  stays solid while the line from the eye to the camera leaves the walls through one of
   *  these. */
  doorways?: readonly (readonly [number, number, number, number, number, number])[];
  /** The frame the doorways are authored in, the camera interior's own (a building at any
   *  turn but a quarter, interior_camera_core.ts InteriorFrame): its origin and the cosine
   *  and sine of its turn. Absent: the doorways are world boxes. */
  doorwayFrame?: {
    readonly x: number;
    readonly z: number;
    readonly cos: number;
    readonly sin: number;
  };
}

export interface FenbridgeBuildingVisibilityPlan {
  visible: boolean;
  hidden: boolean;
  hiddenChanged: boolean;
}

/** A reusable plan for one painter instance. */
export function newFenbridgeBuildingVisibilityPlan(): FenbridgeBuildingVisibilityPlan {
  return { visible: false, hidden: false, hiddenChanged: false };
}

/** The exact fog boundary is excluded, matching the static-town batches. */
export function fenbridgeFogVisible(
  camX: number,
  camZ: number,
  targetX: number,
  targetZ: number,
  fogFar: number,
  targetRadius: number,
): boolean {
  const dx = camX - targetX;
  const dz = camZ - targetZ;
  const cullDistance = fogFar + targetRadius;
  return dx * dx + dz * dz < cullDistance * cullDistance;
}

function pointInsideFootprint(
  target: FenbridgeBuildingVisibilityTarget,
  x: number,
  z: number,
): boolean {
  const dx = x - target.x;
  const dz = z - target.z;
  const localX = dx * target.cosine - dz * target.sine;
  const localZ = dx * target.sine + dz * target.cosine;
  return Math.abs(localX) < target.halfWidth && Math.abs(localZ) < target.halfDepth;
}

function segmentFootprintEntry(
  target: FenbridgeBuildingVisibilityTarget,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const startDx = startX - target.x;
  const startDz = startZ - target.z;
  const endDx = endX - target.x;
  const endDz = endZ - target.z;
  const localStartX = startDx * target.cosine - startDz * target.sine;
  const localStartZ = startDx * target.sine + startDz * target.cosine;
  const localEndX = endDx * target.cosine - endDz * target.sine;
  const localEndZ = endDx * target.sine + endDz * target.cosine;
  if (Math.abs(localStartX) < target.halfWidth && Math.abs(localStartZ) < target.halfDepth) {
    return 0;
  }

  const dx = localEndX - localStartX;
  const dz = localEndZ - localStartZ;
  let minimum = -Infinity;
  let maximum = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (localStartX < -target.halfWidth || localStartX > target.halfWidth) return Infinity;
  } else {
    let first = (-target.halfWidth - localStartX) / dx;
    let second = (target.halfWidth - localStartX) / dx;
    if (first > second) {
      const swap = first;
      first = second;
      second = swap;
    }
    minimum = Math.max(minimum, first);
    maximum = Math.min(maximum, second);
  }
  if (Math.abs(dz) < 1e-9) {
    if (localStartZ < -target.halfDepth || localStartZ > target.halfDepth) return Infinity;
  } else {
    let first = (-target.halfDepth - localStartZ) / dz;
    let second = (target.halfDepth - localStartZ) / dz;
    if (first > second) {
      const swap = first;
      first = second;
      second = swap;
    }
    minimum = Math.max(minimum, first);
    maximum = Math.min(maximum, second);
  }
  return maximum < minimum || maximum < 0 ? Infinity : minimum;
}

/** Whether the line from an eye inside the footprint to a camera outside it crosses the
 *  footprint's edge inside one of the target's doorways. */
function exitsThroughDoorway(
  target: FenbridgeBuildingVisibilityTarget,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  const doorways = target.doorways;
  if (!doorways || doorways.length === 0) return false;
  // where the segment, walked from the camera, enters the footprint
  const t = segmentFootprintEntry(target, camX, camZ, eyeX, eyeZ);
  if (!Number.isFinite(t) || t < 0 || t > 1) return false;
  let x = camX + (eyeX - camX) * t;
  const y = camY + (eyeY - camY) * t;
  let z = camZ + (eyeZ - camZ) * t;
  // a turned building's doorways are square to its own frame: read the point there
  const frame = target.doorwayFrame;
  if (frame) {
    const dx = x - frame.x;
    const dz = z - frame.z;
    x = dx * frame.cos - dz * frame.sin;
    z = dx * frame.sin + dz * frame.cos;
  }
  const margin = 0.05;
  for (const [x0, x1, y0, y1, z0, z1] of doorways) {
    if (
      x >= x0 - margin &&
      x <= x1 + margin &&
      z >= z0 - margin &&
      z <= z1 + margin &&
      y >= y0 &&
      y <= y1
    ) {
      return true;
    }
  }
  return false;
}

/** Whether the eye-to-camera segment enters the footprint below the roof. */
export function fenbridgeCameraSegmentHitsBuilding(
  target: FenbridgeBuildingVisibilityTarget,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (occluderFadesDisabled()) return false;
  const eyeInside = eyeY < target.topY && pointInsideFootprint(target, eyeX, eyeZ);
  const cameraInside = camY < target.topY && pointInsideFootprint(target, camX, camZ);
  // A walk-in building is a room the player stands in: while the camera is in
  // there too, nothing of the building stands between them, so it stays solid
  // (the same model placed in Studio never fades). A camera that ends up
  // outside its walls or over its roof line still fades it, so the player is
  // never lost behind a wall.
  if (target.walkIn && eyeInside) {
    if (cameraInside) return false;
    return !exitsThroughDoorway(target, eyeX, eyeY, eyeZ, camX, camY, camZ);
  }
  if (eyeInside || cameraInside) return true;
  const entry = segmentFootprintEntry(target, eyeX, eyeZ, camX, camZ);
  return entry >= 0 && entry <= 1 && eyeY + (camY - eyeY) * entry < target.topY;
}

/** Resolve one building without allocating a per-frame plan. */
export function fenbridgeBuildingVisibilityPlanInto(
  out: FenbridgeBuildingVisibilityPlan,
  target: FenbridgeBuildingVisibilityTarget,
  wasHidden: boolean,
  camX: number,
  camY: number,
  camZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  fogFar: number,
): FenbridgeBuildingVisibilityPlan {
  out.visible = fenbridgeFogVisible(camX, camZ, target.x, target.z, fogFar, target.cullRadius);
  if (!out.visible) {
    out.hidden = wasHidden;
    out.hiddenChanged = false;
    return out;
  }

  out.hidden = fenbridgeCameraSegmentHitsBuilding(target, eyeX, eyeY, eyeZ, camX, camY, camZ);
  out.hiddenChanged = out.hidden !== wasHidden;
  return out;
}
