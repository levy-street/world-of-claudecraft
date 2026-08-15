const RGBA_COMPONENTS = 4;
// 26 is the first 8-bit sRGB value whose linear value reaches 0.01.
const EARLY_REJECT_SRGB_BYTE = 26;
const SPRITE_CLAMP_INSET = 0.01;
const FULL_POINT_RADIUS_SQ = 0.5;

/** Insert one physical pool slot into a sorted unique active prefix. */
export function insertActiveParticleSlot(slots: Int32Array, count: number, slot: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (slots[middle] < slot) low = middle + 1;
    else high = middle;
  }
  if (low < count && slots[low] === slot) return count;
  slots.copyWithin(low + 1, low, count);
  slots[low] = slot;
  return count + 1;
}

/**
 * World-space sphere radius enclosing a camera-facing point sprite.
 *
 * The shader's point scale may have been configured for a different FOV from
 * the live camera. Correct for that ratio so frustum rejection still contains
 * all four corners of the rendered square.
 */
export function pointSpriteBoundingRadius(
  size: number,
  pointProjectionScale: number,
  cameraProjectionScale: number,
): number {
  const projectionRatio =
    pointProjectionScale > 0 &&
    Number.isFinite(pointProjectionScale) &&
    cameraProjectionScale > 0 &&
    Number.isFinite(cameraProjectionScale)
      ? pointProjectionScale / cameraProjectionScale
      : 1;
  return Math.max(0, size) * Math.SQRT1_2 * Math.max(0, projectionRatio);
}

/**
 * Return a rotation-independent point-coordinate radius containing every
 * atlas texel that could survive the particle shader's luminosity discard.
 *
 * The lower early threshold and one-texel bilinear halo make this a strict
 * outer bound. A bright texel within the shader's clamp support disables the
 * optimization because clamping can extend that edge value across the point.
 */
export function spriteEarlyRejectRadiusSq(
  atlas: ArrayLike<number>,
  atlasWidth: number,
  cellX: number,
  cellY: number,
  cellSize: number,
): number {
  if (atlasWidth <= 0 || cellSize <= 0) return FULL_POINT_RADIUS_SQ;

  const filterSupport = 1 / cellSize;
  const clampSupport = SPRITE_CLAMP_INSET + filterSupport;
  let maxRadiusSq = -1;

  for (let y = 0; y < cellSize; y++) {
    const v = (y + 0.5) / cellSize;
    for (let x = 0; x < cellSize; x++) {
      const offset = ((cellY + y) * atlasWidth + cellX + x) * RGBA_COMPONENTS;
      const maxSrgbByte = Math.max(
        atlas[offset] ?? 0,
        atlas[offset + 1] ?? 0,
        atlas[offset + 2] ?? 0,
      );
      if (maxSrgbByte < EARLY_REJECT_SRGB_BYTE) continue;

      const u = (x + 0.5) / cellSize;
      if (
        u <= clampSupport ||
        u >= 1 - clampSupport ||
        v <= clampSupport ||
        v >= 1 - clampSupport
      ) {
        return FULL_POINT_RADIUS_SQ;
      }

      const px = u - 0.5;
      const py = v - 0.5;
      maxRadiusSq = Math.max(maxRadiusSq, px * px + py * py);
    }
  }

  if (maxRadiusSq < 0) return 0;
  const radius = Math.sqrt(maxRadiusSq) + Math.SQRT2 * filterSupport + 0.0001;
  return Math.min(FULL_POINT_RADIUS_SQ, radius * radius);
}
