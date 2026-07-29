// Pure per-frame visibility core for Eastbrook's town painter. The Three side
// owns scene nodes and material writes; this module decides fog visibility,
// camera-to-eye roof intersection, and whether the cached hide state changed.
// It is Three/DOM/i18n-free and writes into a caller-owned plan so the painter
// can reuse one object across every building and frame.

export interface EastbrookRoofVisibilityTarget {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  cosine: number;
  sine: number;
  topY: number;
  cullRadius: number;
}

export interface EastbrookRoofVisibilityPlan {
  visible: boolean;
  hidden: boolean;
  hiddenChanged: boolean;
}

/** A reusable plan for one painter instance. */
export function newEastbrookRoofVisibilityPlan(): EastbrookRoofVisibilityPlan {
  return { visible: false, hidden: false, hiddenChanged: false };
}

/**
 * Whether a circular target remains inside the camera's fog-expanded range.
 * The exact outer boundary is excluded, matching Three's town batch policy.
 */
export function eastbrookFogVisible(
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

function pointInsideRoof(target: EastbrookRoofVisibilityTarget, x: number, z: number): boolean {
  const dx = x - target.x;
  const dz = z - target.z;
  const localX = dx * target.cosine - dz * target.sine;
  const localZ = dx * target.sine + dz * target.cosine;
  return Math.abs(localX) < target.halfWidth && Math.abs(localZ) < target.halfDepth;
}

function segmentRoofEntry(
  target: EastbrookRoofVisibilityTarget,
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

/** Whether the eye-to-camera segment enters the roof footprint below its top. */
export function eastbrookCameraSegmentHitsRoof(
  target: EastbrookRoofVisibilityTarget,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (
    (eyeY < target.topY && pointInsideRoof(target, eyeX, eyeZ)) ||
    (camY < target.topY && pointInsideRoof(target, camX, camZ))
  ) {
    return true;
  }
  const entry = segmentRoofEntry(target, eyeX, eyeZ, camX, camZ);
  return entry >= 0 && entry <= 1 && eyeY + (camY - eyeY) * entry < target.topY;
}

/**
 * Resolve one building's per-frame visibility and roof-hide transition. A
 * fog-culled building preserves its cached hidden state because its materials
 * are not touched until it becomes visible again.
 */
export function eastbrookRoofVisibilityPlanInto(
  out: EastbrookRoofVisibilityPlan,
  target: EastbrookRoofVisibilityTarget,
  wasHidden: boolean,
  camX: number,
  camY: number,
  camZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  fogFar: number,
): EastbrookRoofVisibilityPlan {
  out.visible = eastbrookFogVisible(camX, camZ, target.x, target.z, fogFar, target.cullRadius);
  if (!out.visible) {
    out.hidden = wasHidden;
    out.hiddenChanged = false;
    return out;
  }

  out.hidden = eastbrookCameraSegmentHitsRoof(target, eyeX, eyeY, eyeZ, camX, camY, camZ);
  out.hiddenChanged = out.hidden !== wasHidden;
  return out;
}
