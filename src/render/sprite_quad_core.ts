// Point sprite to instanced quad: the size math, host-agnostic.
//
// Every particle cloud in this renderer used to be a THREE.Points draw sized
// by gl_PointSize. ANGLE's Direct3D 11 backend (every Windows Chrome and Edge
// player) has no point-sprite primitive: it emits a generated geometry shader
// that expands each point into a quad, one more D3D compile per program and a
// per-draw expansion pass, while the Metal and GL backends rasterize the point
// natively. An instanced camera-facing quad is what D3D11 would have built
// anyway, minus the generated stage. The quad must cover exactly the pixels
// the point sprite covered, so this core owns the conversion:
//
//   pointSize      = the formula the point shader wrote to gl_PointSize
//   rasterized     = clamp(pointSize, ALIASED_POINT_SIZE_RANGE)  (the driver)
//   halfExtent     = rasterized * viewDepth / (2 * viewportScale)
//
// where viewportScale is the "device pixels per world unit at view depth 1"
// factor every cloud already carries as its uScale uniform. A view-space
// square of that half extent, centred on the point and parallel to the image
// plane, projects to the same axis-aligned window square as the point sprite
// (all four corners share the centre's depth, so the projection is linear
// and the depth test sees the same z). The GLSL twin of this arithmetic lives
// in sprite_quad_cloud.ts; the constants below are what both read.

export interface PointSizeRange {
  readonly min: number;
  readonly max: number;
}

/** ALIASED_POINT_SIZE_RANGE before the live context answers: the D3D11 range,
 *  the backend this conversion exists for. */
export const POINT_SIZE_RANGE_FALLBACK: PointSizeRange = { min: 1, max: 1024 };

/** The pooled cloud (vfx.ts) stops growing points nearer than 1 world unit
 *  and caps them at 110 px. */
export const POOLED_CLOUD_DEPTH_FLOOR = 1;
export const POOLED_CLOUD_MAX_POINT_PX = 110;
/** The weapon-skin clouds (weapon_vfx.ts) only floor the depth. */
export const WEAPON_CLOUD_DEPTH_FLOOR = 0.15;

/** Quad corners in the [-1, 1] square, counter-clockwise from bottom-left,
 *  and the two triangles over them. */
export const SPRITE_QUAD_CORNERS: readonly number[] = [-1, -1, 1, -1, 1, 1, -1, 1];
export const SPRITE_QUAD_INDEX: readonly number[] = [0, 1, 2, 0, 2, 3];

/** Device pixels per world unit at view depth 1 for a vertical field of view:
 *  the uScale uniform. */
export function viewportPointScale(heightPx: number, fovDeg: number): number {
  return heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/** gl_PointSize of the pooled cloud: attenuated by depth, floored at one unit
 *  of depth, capped at POOLED_CLOUD_MAX_POINT_PX. */
export function pooledCloudPointSize(
  size: number,
  viewportScale: number,
  viewDepth: number,
): number {
  const px = (size * viewportScale) / Math.max(POOLED_CLOUD_DEPTH_FLOOR, viewDepth);
  return Math.min(POOLED_CLOUD_MAX_POINT_PX, Math.max(0, px));
}

/** gl_PointSize of a weapon-skin cloud: attenuated by depth, floored at
 *  WEAPON_CLOUD_DEPTH_FLOOR, otherwise unbounded (the driver range bounds it). */
export function weaponCloudPointSize(
  size: number,
  viewportScale: number,
  viewDepth: number,
): number {
  return (size * viewportScale) / Math.max(WEAPON_CLOUD_DEPTH_FLOOR, viewDepth);
}

/** The size the driver actually rasterizes: gl_PointSize clamped into
 *  ALIASED_POINT_SIZE_RANGE. A sub-pixel point still lights one pixel. */
export function rasterizedPointSize(pointSize: number, range: PointSizeRange): number {
  return Math.min(range.max, Math.max(range.min, pointSize));
}

/** View-space half extent of the camera-facing quad that covers the same
 *  window pixels as a point of `pixelSize` at `viewDepth`. */
export function spriteQuadHalfExtent(
  pixelSize: number,
  viewDepth: number,
  viewportScale: number,
): number {
  if (!(viewportScale > 0)) return 0;
  return (pixelSize * viewDepth) / (2 * viewportScale);
}

/** Window pixels a quad of that half extent spans at that depth: the inverse
 *  of spriteQuadHalfExtent, what a readback of the projected corners gives. */
export function spriteQuadPixelSize(
  halfExtent: number,
  viewDepth: number,
  viewportScale: number,
): number {
  if (!(viewDepth > 0)) return 0;
  return (2 * halfExtent * viewportScale) / viewDepth;
}

/** gl_PointCoord for a quad corner: s grows to the right, t grows DOWNWARD
 *  (window origin upper-left), so the bottom-left corner reads (0, 1). */
export function spriteQuadPointCoord(cornerX: number, cornerY: number): [number, number] {
  return [0.5 + 0.5 * cornerX, 0.5 - 0.5 * cornerY];
}
