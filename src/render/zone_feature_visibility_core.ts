// Distance visibility for the bespoke per-zone feature groups (towns, hedge
// mazes, castles, realm flora, the water flora bands).
//
// WHY THIS EXISTS. Terrain culls per chunk against the live fog far, and
// foliage culls per bucket against its own fog limit. Zone features did
// neither: they set frustumCulled = true and stopped there. Frustum culling
// only removes what is outside the view CONE, so a feature group a kilometre
// ahead of you, entirely buried in fog, was still submitted every frame.
//
// Measured in the Evergarden and in Mirefen, standing in neither zone, both
// readings byte-identical because nothing about them depended on the camera:
//
//   fen-features    17,214,888 triangles
//   water-flora     10,959,942
//   jungle-features 10,007,361
//   garden-features  1,237,904
//
// About 40M triangles of scenery for zones the player cannot see, against a
// renderBudget targetTriangles of 1,800,000. Terrain over the same two spots
// moved 173,158 -> 994,292, which is what a correctly culled system looks like
// and is why terrain was never the problem.
//
// The test mirrors terrain's exactly: distance from the camera to the group's
// XZ footprint, compared against the same live fog far. Anything past that is
// fully fogged, so hiding it removes no pixel the player could have seen.

/** A feature group's world-space XZ footprint, measured once at attach time
 *  (these groups are static and matrix-frozen, so it never changes). */
export interface FeatureFootprint {
  centerX: number;
  centerZ: number;
  halfX: number;
  halfZ: number;
}

/**
 * Distance from (camX, camZ) to the footprint's edge, 0 when inside it.
 *
 * Edge distance, not centre distance: a zone-spanning feature group can be
 * hundreds of yards across, and measuring from its centre would hide a hedge
 * maze the player is standing at the corner of.
 */
export function featureEdgeDistance(
  footprint: FeatureFootprint,
  camX: number,
  camZ: number,
): number {
  const dx = Math.max(Math.abs(camX - footprint.centerX) - footprint.halfX, 0);
  const dz = Math.max(Math.abs(camZ - footprint.centerZ) - footprint.halfZ, 0);
  return Math.hypot(dx, dz);
}

/**
 * True while any part of the group is nearer than `drawDistance` (the live fog
 * far). A null footprint means the group had no measurable geometry at attach
 * time, in which case it stays visible: better to draw something cheap than to
 * blank a feature because its bounds could not be computed.
 */
export function isZoneFeatureVisible(
  footprint: FeatureFootprint | null,
  camX: number,
  camZ: number,
  drawDistance: number,
): boolean {
  if (!footprint) return true;
  return featureEdgeDistance(footprint, camX, camZ) < drawDistance;
}

// The sun shadow camera is a 105 yd half-extent orthographic box around the
// player, and the 31 degree sun throws a caster's shadow at most ~1.7x its
// height sunward: a feature group farther than this range cannot land one
// texel inside the volume. The merged town/flora meshes disable frustum
// culling (their bounds are zone-sized), so without this decision the shadow
// pass redraws them at ANY distance the fogless detail horizon reaches. The
// far-tree LOD set the precedent: "the shadow pass deliberately does NOT
// follow the extended radius".
export const ZONE_FEATURE_SHADOW_RANGE = 220;
/** Band width around the range inside which the prior state holds, so the
 *  per-mesh castShadow writes never become a per-frame flap at the edge. */
export const ZONE_FEATURE_SHADOW_HYSTERESIS = 20;

/**
 * Whether a feature group should cast into the sun shadow map this frame.
 * A null footprint keeps casting, mirroring isZoneFeatureVisible's fail-open.
 */
export function isZoneFeatureShadowCasting(
  footprint: FeatureFootprint | null,
  camX: number,
  camZ: number,
  wasCasting: boolean,
): boolean {
  if (!footprint) return true;
  const edge = featureEdgeDistance(footprint, camX, camZ);
  return wasCasting
    ? edge <= ZONE_FEATURE_SHADOW_RANGE + ZONE_FEATURE_SHADOW_HYSTERESIS
    : edge < ZONE_FEATURE_SHADOW_RANGE - ZONE_FEATURE_SHADOW_HYSTERESIS;
}

/**
 * True when an InstancedMesh buffer still holds a factory all-zero matrix.
 * Footprints are measured ONCE at attach, so one unseeded instance silently
 * poisons the measurement: the realm-flora seabird flock (placed only by its
 * per-frame update) parked its group's bounds at the world origin and
 * stretched the cull footprint to 374x1442 exactly this way. An all-zero 4x4
 * is never a legitimate placement, which makes it a precise tell.
 */
export function hasUnseededInstanceMatrix(array: ArrayLike<number>, count: number): boolean {
  for (let i = 0; i < count; i++) {
    const base = i * 16;
    let allZero = true;
    for (let k = 0; k < 16 && allZero; k++) {
      if (array[base + k] !== 0) allZero = false;
    }
    if (allZero) return true;
  }
  return false;
}
