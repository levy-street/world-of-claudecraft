import type { CameraAxisView } from './editor_camera';

export interface CameraAxisProjection {
  axis: CameraAxisView;
  x: number;
  y: number;
  depth: number;
  projectedLength: number;
  scale: number;
  opacity: number;
}

export type CameraPlane = 'x' | 'y' | 'z';

export interface DominantCameraPlane {
  axis: CameraAxisView;
  plane: CameraPlane;
}

const WORLD_AXES: readonly [CameraAxisView, number, number, number][] = [
  ['positiveX', 1, 0, 0],
  ['negativeX', -1, 0, 0],
  ['positiveY', 0, 1, 0],
  ['negativeY', 0, -1, 0],
  ['positiveZ', 0, 0, 1],
  ['negativeZ', 0, 0, -1],
];

/**
 * Project the six world axes into the camera's view plane. Depth is positive
 * toward the viewer, allowing the DOM renderer to layer front handles over the
 * center joint and tuck rear handles behind it.
 */
export function projectCameraAxes(
  yaw: number,
  pitch: number,
  radius: number,
): CameraAxisProjection[] {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);

  // Matches EditorCamera's world-space screen-right, screen-up, and forward
  // basis. CSS y increases downward, hence the negated screen-up projection.
  const right = { x: -cy, y: 0, z: sy };
  const up = { x: sy * sp, y: cp, z: cy * sp };
  const forward = { x: sy * cp, y: -sp, z: cy * cp };

  return WORLD_AXES.map(([axis, vx, vy, vz]) => {
    const screenX = vx * right.x + vy * right.y + vz * right.z;
    const screenY = -(vx * up.x + vy * up.y + vz * up.z);
    const depth = -(vx * forward.x + vy * forward.y + vz * forward.z);
    const projectedLength = Math.hypot(screenX, screenY);
    const depthUnit = (depth + 1) * 0.5;

    return {
      axis,
      x: screenX * radius,
      y: screenY * radius,
      depth,
      projectedLength,
      scale: 0.78 + depthUnit * 0.28,
      opacity: 0.42 + depthUnit * 0.58,
    };
  });
}

/** The signed world axis nearest the viewer and its perpendicular view plane. */
export function dominantCameraPlane(
  projections: readonly CameraAxisProjection[],
): DominantCameraPlane {
  const nearest = projections.reduce((best, candidate) =>
    candidate.depth > best.depth ? candidate : best,
  );
  const plane = nearest.axis.endsWith('X') ? 'x' : nearest.axis.endsWith('Y') ? 'y' : 'z';
  return { axis: nearest.axis, plane };
}
