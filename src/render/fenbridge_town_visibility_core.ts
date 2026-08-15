// Pure per-frame visibility core for the Fenbridge town renderer. The Three
// side owns scene nodes and material writes; this module decides fog culling
// and eye-to-camera building occlusion into one caller-owned plan.

export interface FenbridgeBuildingVisibilityTarget {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  cosine: number;
  sine: number;
  topY: number;
  cullRadius: number;
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
  if (
    (eyeY < target.topY && pointInsideFootprint(target, eyeX, eyeZ)) ||
    (camY < target.topY && pointInsideFootprint(target, camX, camZ))
  ) {
    return true;
  }
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
