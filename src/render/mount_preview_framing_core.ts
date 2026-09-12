// The mount preview's camera framing (src/render/mount_preview.ts): Three-free
// so a Vitest pins it without a GL context (RENDER_PURE_CORES).

export interface MountPreviewFraming {
  /** Camera height and distance, and the height of the point it looks at. */
  y: number;
  z: number;
  lookY: number;
}

export const MOUNT_PREVIEW_FOV = 35;

/**
 * Frame the staged rig from its bounding size (world units) so the whole
 * mount, and the rider on top of it, stays in view at the preview fov. The
 * footprint's larger side sets the distance (the turntable spins the long
 * side toward the camera); the height sets where the camera looks. Sizes at
 * or below zero (an empty stage) read as the half-metre floor rather than a
 * camera at the origin.
 */
export function mountPreviewFraming(
  size: { width: number; height: number; depth: number },
  fovDeg: number = MOUNT_PREVIEW_FOV,
): MountPreviewFraming {
  const height = Math.max(0.5, size.height);
  const footprint = Math.max(0.5, size.width, size.depth);
  const halfFov = (fovDeg * Math.PI) / 360;
  // Fit the taller of the height and the footprint into the frustum with a
  // little margin, measured from the rig's centre.
  const extent = Math.max(height, footprint) * 0.62;
  const distance = extent / Math.tan(halfFov) + footprint * 0.5;
  return {
    y: height * 0.58,
    z: distance,
    lookY: height * 0.46,
  };
}
