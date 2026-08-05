// Pure visibility policy for static resident scenery.
//
// The color renderer already frustum-culls individual meshes. Two narrower
// policies are useful above that level:
//
// 1. A whole resident scene may skip traversal when its bounding sphere is
//    outside enclosing spheres for both the color and shadow view volumes.
// 2. A caster wholly behind the camera cannot affect a visible receiver when
//    its directional shadow ray travels farther behind the camera.
//
// Both tests are conservative. A true result means "keep the work"; only a
// geometrically impossible contribution returns false.

export interface ScenerySphere {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraHalfSpace {
  readonly position: Point3;
  /** Normalized direction from the camera into the visible half-space. */
  readonly forward: Point3;
  readonly near: number;
}

/**
 * One yard covers the widest possible filter footprint in the current shadow
 * ladder, including the 2.25-radius PCF kernel on a 210-yard, 1024-texel map.
 * It also covers the stadium cloth shader's 0.24-yard vertex sway.
 */
export const SHADOW_VISIBILITY_MARGIN = 1;

function distanceSq(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function sphereIntersectsRange(
  bounds: ScenerySphere,
  origin: Point3,
  range: number,
): boolean {
  const reach = Math.max(0, range) + bounds.radius;
  return distanceSq(bounds, origin) <= reach * reach;
}

/**
 * Keep a resident scene when it can intersect either render volume.
 *
 * `colorRange` and `shadowRange` are radii of spheres enclosing the respective
 * camera frusta. The test can retain extra scenery, but cannot reject geometry
 * that either pass could submit.
 */
export function residentSceneMayReachRenderVolumes(
  bounds: ScenerySphere,
  colorOrigin: Point3,
  colorRange: number,
  shadowsEnabled: boolean,
  shadowOrigin: Point3,
  shadowRange: number,
): boolean {
  return (
    sphereIntersectsRange(bounds, colorOrigin, colorRange) ||
    (shadowsEnabled && sphereIntersectsRange(bounds, shadowOrigin, shadowRange))
  );
}

/**
 * Whether a directional caster can affect any point in the camera's visible
 * half-space.
 *
 * `lightDirection` points from a receiver toward the directional light, so a
 * cast shadow travels along its negation. A caster that overlaps or lies in
 * front of the near plane must be kept. A caster wholly behind it must also be
 * kept when the shadow ray advances toward the visible half-space. The only
 * rejected case is a complete caster and its infinite shadow extrusion staying
 * behind the near plane.
 */
export function casterShadowMayReachCamera(
  bounds: ScenerySphere,
  camera: CameraHalfSpace,
  lightDirection: Point3,
  margin = SHADOW_VISIBILITY_MARGIN,
): boolean {
  const dx = bounds.x - camera.position.x;
  const dy = bounds.y - camera.position.y;
  const dz = bounds.z - camera.position.z;
  const centerDepth = dx * camera.forward.x + dy * camera.forward.y + dz * camera.forward.z;
  const furthestCasterDepth = centerDepth + bounds.radius + Math.max(0, margin);
  if (furthestCasterDepth >= camera.near) return true;

  const lightDepth =
    lightDirection.x * camera.forward.x +
    lightDirection.y * camera.forward.y +
    lightDirection.z * camera.forward.z;
  return lightDepth < 0;
}
