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

// How far a feature group may sit and still cast into the sun shadow map.
//
// THE GEOMETRY, derived (pinned by tests/zone_feature_visibility.test.ts,
// which recomputes every number below from the shipped constants rather than
// restating them). The sun shadow camera is an orthographic box of half-extent
// S = 105 yd, but that box is square in the plane PERPENDICULAR to the light,
// not on the ground. Projected onto the ground it is a strip: S across the
// light's `right` axis, and S / sin(elevation) along its azimuth, because the
// light-space `up` axis only has sin(elevation) of horizontal length. The sun
// sits at SUN_ANCHOR (90, 62, 50), elevation 31.06 degrees, so the strip runs
// 105 yd across and 105 / sin(31.06) = 203.5 yd along the azimuth, and the
// furthest a ground caster can sit from the shadow TARGET and still land a
// texel is the strip's corner, hypot(105, 203.5) = 229.0 yd. (Not the 148 yd
// that S * sqrt(2) suggests: that is the box's own diagonal, which only
// applies to a light straight overhead.)
//
// This test measures from the CAMERA, not from the target: the box is centred
// on the player and the camera trails it by up to the 22 yd zoom cap
// (Input.camDist). With the 4 yd SHADOW_CASTER_MARGIN the other shadow culls
// use, "can never lose a legitimate caster" would be 229.0 + 22 + 4 = 255.0,
// and 275.0 once the +/-20 yd hysteresis band below is allowed for.
//
// 220 is therefore a DELIBERATE SHED about 55 yd inside that bound, not a
// loose over-approximation, and it is kept: the merged town/flora meshes
// disable frustum culling (their bounds are zone-sized), so without this
// decision the shadow pass redraws whole neighbour towns at ANY distance the
// fogless detail horizon reaches, and the far-tree LOD set the precedent that
// "the shadow pass deliberately does NOT follow the extended radius".
//
// WHERE THE REAL SLACK IS, measured and not taken here: the test is radial
// while the volume is a strip. A 220 yd disc is 152,053 yd2 against the
// strip's 210 x 407 = 85,470 yd2, so the radial rule keeps about 1.8x the
// ground area the box can use, and every bit of that excess is off the sun's
// azimuth. Closing it needs the light-space box test (shadowVolumeIntersectsBox
// in foliage_shadow_core.ts) rather than a smaller radius: shrinking the radius
// would cut along the azimuth, where casters are legitimate, and leave the
// off-axis excess untouched.
export const ZONE_FEATURE_SHADOW_RANGE = 220;
/** The full-quality outdoor sun-shadow half-extent that the range above was
 *  derived from. Kept local so this pure core has no renderer import. */
export const ZONE_FEATURE_SHADOW_BASE_HALF_EXTENT = 105;
/** Band width around the range inside which the prior state holds, so the
 *  per-mesh castShadow writes never become a per-frame flap at the edge. */
export const ZONE_FEATURE_SHADOW_HYSTERESIS = 20;

export function zoneFeatureShadowRangeForHalfExtent(shadowHalfExtent: number): number {
  if (!Number.isFinite(shadowHalfExtent) || shadowHalfExtent <= 0) return ZONE_FEATURE_SHADOW_RANGE;
  return Math.min(
    ZONE_FEATURE_SHADOW_RANGE,
    (ZONE_FEATURE_SHADOW_RANGE * shadowHalfExtent) / ZONE_FEATURE_SHADOW_BASE_HALF_EXTENT,
  );
}

/**
 * Whether a feature group should cast into the sun shadow map this frame.
 * A null footprint keeps casting, mirroring isZoneFeatureVisible's fail-open.
 */
export function isZoneFeatureShadowCasting(
  footprint: FeatureFootprint | null,
  camX: number,
  camZ: number,
  wasCasting: boolean,
  shadowHalfExtent = ZONE_FEATURE_SHADOW_BASE_HALF_EXTENT,
): boolean {
  if (!footprint) return true;
  const edge = featureEdgeDistance(footprint, camX, camZ);
  const range = zoneFeatureShadowRangeForHalfExtent(shadowHalfExtent);
  return wasCasting
    ? edge <= range + ZONE_FEATURE_SHADOW_HYSTERESIS
    : edge < range - ZONE_FEATURE_SHADOW_HYSTERESIS;
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

// The apparent-size reach: how far a feature cull group may sit before its
// LARGEST instance is too small on screen to be worth its draw.
//
// WHY THIS EXISTS. A zone feature is culled against the session's cull
// distance, and on several profiles that distance is far enough to draw
// clutter nobody can resolve: the far-vista arm culls at the detail horizon
// (700 to 850 yd) with the scene fog parked past 924, and the constrained
// memory profiles run the classic arm with a fog that eases out to 700. On
// both, a 6,000-triangle lily raft five yards across is drawn at 500 yd as a
// 6-pixel blob, and the Willowfen's four clutter families were 1.67M of the
// 2.34M fen triangles submitted from Eastbrook at medium. The props layer
// draws a far bake at that distance and foliage draws impostors; the bespoke
// dressing had no far representation at all. The rule below is size-driven,
// never a
// per-family table: a group's reach is the distance at which its largest
// instance spans ZONE_FEATURE_MIN_APPARENT_PX at a fixed reference view (720
// px tall, the 60 degree base FOV), so a giant one-off model pulls its whole
// group out to the horizon with nothing to write anywhere, and a small clump
// fades where it is a few pixels. The reference is a constant on purpose: a
// live viewport or FOV would make what is drawn depend on the window, and
// the shed must be as static as any other tier knob.
//
// Cosmetic by construction: everything hidden is below the pixel threshold.
// Modules apply it to dressing only; a family whose placements are the sim's
// colliders keeps the distance rule alone (docs/design/graphics-settings-
// fairness.md).

/** The reference view the pixel threshold is measured at. */
export const ZONE_FEATURE_REF_VIEWPORT_HEIGHT_PX = 720;
export const ZONE_FEATURE_REF_FOV_DEG = 60;
/** Pixels per radian at the reference view (the focal length in pixels). */
export const ZONE_FEATURE_REF_PX_PER_RAD =
  ZONE_FEATURE_REF_VIEWPORT_HEIGHT_PX / 2 / Math.tan((ZONE_FEATURE_REF_FOV_DEG * Math.PI) / 360);
/**
 * Below this apparent size (px) at the reference view a group is shed. 8 is
 * the art decision: a 5 yd lily raft then sheds at about 390 yd (429 with
 * the band), a 3 yd mushroom clump at 235, both unfogged on the vista arm,
 * where a raft at that distance is a blob a few pixels wide; a 12 yd willow
 * or any one-off giant reaches past every cull horizon and is never shed.
 * Two consequences of the fixed reference: a 1440p or 2160p client sees the
 * object at 16 or 24 px when it goes (a visible pop, which the band keeps
 * from flapping but does not hide), and a smaller window sees it go earlier
 * than its own pixels would say. Retune here, never per family.
 */
export const ZONE_FEATURE_MIN_APPARENT_PX = 8;
/** Relative band above the reach inside which a shown group stays shown. */
export const ZONE_FEATURE_REACH_HYSTERESIS = 0.1;

/**
 * The reach (yd) for a group whose largest instance spans `extentYd`. A
 * non-positive or non-finite extent means no reach (Infinity): fail open,
 * the distance rule alone decides.
 */
export function zoneFeatureReach(
  extentYd: number,
  minApparentPx = ZONE_FEATURE_MIN_APPARENT_PX,
): number {
  if (!Number.isFinite(extentYd) || extentYd <= 0) return Number.POSITIVE_INFINITY;
  return (extentYd * ZONE_FEATURE_REF_PX_PER_RAD) / minApparentPx;
}

/**
 * Whether a group is inside its reach this frame, with hysteresis: a shown
 * group stays shown until its footprint edge passes the reach by the band,
 * a hidden one comes back once inside the reach. A null footprint or an
 * infinite reach keeps the group in reach.
 */
export function isZoneFeatureInReach(
  footprint: FeatureFootprint | null,
  camX: number,
  camZ: number,
  reach: number,
  wasInReach: boolean,
): boolean {
  if (!footprint || !Number.isFinite(reach)) return true;
  const edge = featureEdgeDistance(footprint, camX, camZ);
  return wasInReach ? edge <= reach * (1 + ZONE_FEATURE_REACH_HYSTERESIS) : edge < reach;
}
