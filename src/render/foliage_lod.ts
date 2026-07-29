// Distance windows for the instanced tree / rock / dressing buckets, kept apart
// from foliage.ts so the decision itself is pure: no Three, no DOM, no GFX
// singleton, unit-testable in Node (tests/foliage_lod.test.ts).
//
// THE IMPOSTOR IS A LOD, NOT A PLACEHOLDER. Past the tree-detail distance a real
// GLB tree is swapped for a cheap stand-in (a cone for pines, a blob for oaks;
// farTreeProxyGeo in foliage.ts). Nothing about it is meant to be legible: it
// only works while the zone's fog has already swallowed the swap, which is why
// the two windows are exact complements rather than a cross-fade.
//
// That held while every zone's fog closed at ~340u and the detail distance was a
// flat 300u: the impostor band sat inside the murk. Zones now open the view out
// to 470-560u, and a build-time constant cannot know that, so the cones ended up
// standing in clear air. Hence the rule below: the detail distance follows the
// FOG, and an impostor may only appear where fog has already blended it at least
// IMPOSTOR_MIN_FOG_BLEND of the way to solid.
//
// The short-fog realms (marsh, haunt, frost, volcano, cave) need the OPPOSITE
// guard. There the budgeted radius overshoots the foliage fog cull entirely
// (marsh: detail 216-300u against a cull at 129-165u), which both drew real
// trees past the line where they are dropped anyway and left the impostor
// window empty at every governor level. When the swap would land at or past the
// fog cull, it retreats to the fog floor instead: the deepest-in-the-murk point
// the blend law allows, which maximises the impostor band. If even the floor
// sits past the cull (very low model quality), there is simply no impostor
// band, real trees run to the cull line, and the blend law holds vacuously.

export interface LodDists {
  barkFar: number;
  treeDetailFar: number;
  dressFar: number;
  rockFar: number;
  treeFillFar: number;
}

export const LOD_HIGH: LodDists = {
  barkFar: 330,
  treeDetailFar: 300,
  dressFar: 200,
  rockFar: 360,
  treeFillFar: 310,
};

// low caps must clear the worst camera-to-bucket distance (~158u for a
// 2-column x 240u-band bucket) or nearby dressing vanishes and trunks pop at
// bucket boundaries
export const LOD_LOW: LodDists = {
  barkFar: 170,
  treeDetailFar: 250,
  dressFar: 185,
  rockFar: 190,
  treeFillFar: 245,
};

export function lodDistsFor(leanFoliage: boolean): LodDists {
  return leanFoliage ? LOD_LOW : LOD_HIGH;
}

/**
 * The adaptive budget's foliage lever (render_budget.ts pulls foliage down
 * first under load) mapped to the distance multiplier every build-time cap
 * uses. Lives here, next to treeDetailDistance, because the two are one
 * dial: tests that starve one must starve the other the same way.
 */
export function foliageDistanceScale(modelQuality: number, leanFoliage: boolean): number {
  return leanFoliage ? 0.56 + 0.44 * modelQuality : 0.72 + 0.28 * modelQuality;
}

/**
 * Buckets entirely past this line are pure overdraw: fog has swallowed them.
 * Model quality claws a little of the wall back before the preset distance.
 */
export function foliageFogLimit(fogFar: number, modelQuality: number): number {
  return fogFar * (0.78 + 0.22 * modelQuality);
}

/**
 * How far the fog must have swallowed a tree before it is allowed to become an
 * impostor. 0 would permit a cone in clear air; 1 would forbid impostors
 * entirely (and hand the far field back its full triangle cost).
 */
export const IMPOSTOR_MIN_FOG_BLEND = 0.7;

/** THREE.Fog is linear: 0 at `near`, fully fogged at `far`. */
export function fogBlendAt(dist: number, fogNear: number, fogFar: number): number {
  if (!(fogFar > fogNear)) return dist >= fogFar ? 1 : 0;
  return Math.min(1, Math.max(0, (dist - fogNear) / (fogFar - fogNear)));
}

/**
 * Distance at which a real tree gives way to its impostor.
 *
 * `distanceScale` is the adaptive frame budget's lever (render_budget.ts pulls
 * foliage down first under load). It may still shrink the detail radius, but
 * never past the point where fog stops hiding the swap: a transient dip while
 * assets decode and shaders compile used to drag the boundary in to ~216u and
 * park cones in plain view until the budget recovered, which read as "the trees
 * are still cones until they load".
 *
 * `fogLimit` (foliageFogLimit) caps it from the other side: a swap at or past
 * the foliage fog cull would draw real trees the cull is about to drop and
 * starve the impostor band to nothing, which is exactly what happened in every
 * short-fog realm. When the budgeted radius overshoots the cull, the swap
 * retreats to the fog floor (the nearest point the blend law allows), and the
 * band between floor and cull goes to impostors. The result always satisfies
 * detailFar <= fogLimit.
 *
 * INPUT CONTRACT: `fogNear`/`fogFar` are the ATMOSPHERIC fog, the authored
 * preset times the day-night scale, never the residency-clamped live values.
 * The streaming clamp can pin the live view at a 45u wall (and briefly leave
 * near above far while near eases after far snaps); fed those, the retreat
 * would park impostor cones a few strides from the camera for the length of
 * every streaming window. With atmospheric values the floor stays where the
 * realm's real murk is, and the min() against `fogLimit` (which IS live) is
 * what keeps the swap behind the wall meanwhile. The degenerate arm below is
 * defense in depth for a malformed preset, not the clamp transient.
 */
export function treeDetailDistance(
  base: number,
  fogNear: number,
  fogFar: number,
  distanceScale: number,
  fogLimit: number,
): number {
  const budgeted = base * distanceScale;
  if (!(fogFar > fogNear)) return Math.min(budgeted, fogLimit);
  const fogFloor = fogNear + IMPOSTOR_MIN_FOG_BLEND * (fogFar - fogNear);
  const detail = Math.max(budgeted, fogFloor);
  if (detail < fogLimit) return detail;
  return Math.min(fogFloor, fogLimit);
}

/**
 * Per-instance collapse windows for the foliage vertex shaders
 * (foliage_collapse.ts). Buckets are ~540x240u slabs, so the bucket tests
 * below can only ever be a coarse pre-filter: a "visible" slab still holds
 * trees hundreds of units past the fog wall, which is exactly the floating
 * silhouettes players report in the murky realms. The shader collapses each
 * INSTANCE against these windows instead, so the bucket tests only need to
 * answer "could any instance of this mesh be alive", never "are all of them".
 *
 * Real tree parts live in [0, treeMax); impostors in [impostorMin, fogCull).
 * treeMax and impostorMin are the same number by construction: the windows
 * stay exact complements per instance, never drawn together, never both
 * dropped, which is the same contract the old bucket-level swap had.
 */
export interface InstanceCullWindows {
  treeMax: number;
  impostorMin: number;
  fogCull: number;
}

export function instanceCullWindows(detailFar: number, fogLimit: number): InstanceCullWindows {
  return instanceCullWindowsInto(detailFar, fogLimit, { treeMax: 0, impostorMin: 0, fogCull: 0 });
}

/** Allocation-free variant for the per-frame caller (the nameplatePlanInto idiom). */
export function instanceCullWindowsInto(
  detailFar: number,
  fogLimit: number,
  out: InstanceCullWindows,
): InstanceCullWindows {
  const fogCull = Math.max(0, fogLimit);
  const treeMax = Math.min(detailFar, fogCull);
  out.treeMax = treeMax;
  out.impostorMin = treeMax;
  out.fogCull = fogCull;
  return out;
}

export interface BucketWindowInput {
  /** distance from the camera to the bucket's CENTER */
  centerDist: number;
  /** bucket bounding radius */
  radius: number;
  /** build-time bounds, scaled by the adaptive budget at draw time */
  minDist?: number;
  maxDist?: number;
  /**
   * Bounds that additionally track the runtime tree-detail swap: the impostor
   * starts there (minAtDetail), the real model ends there (maxAtDetail). It is
   * the one edge that cannot be known at build time, because it follows the
   * zone's fog. A bucket can carry BOTH a numeric cap and the detail cap (the
   * near-fill half of a species culls at treeFillFar OR at the swap, whichever
   * comes first), so these compose rather than replace.
   */
  minAtDetail?: boolean;
  maxAtDetail?: boolean;
  /** adaptive budget scale applied to the build-time bounds */
  distanceScale: number;
  /** runtime tree-detail boundary (see treeDetailDistance) */
  detailFar: number;
  /** per-bucket jitter that staggers the low-tier reveal; 1 elsewhere */
  revealScale: number;
  /** buckets entirely behind the fog wall are pure overdraw */
  fogLimit: number;
}

/**
 * The build-time caps (the near-fill density cull, rocks, dressing, the early bark
 * cull) are measured against the bucket's CENTER, as they always have been. They
 * are cost controls and a bucket is ~240u deep, so measuring them from the near
 * edge would keep every bucket alive for another half-bucket past its cap and
 * quietly multiply the triangles they exist to cut.
 *
 * The tree-detail swap is the exception: its two arms are COVERAGE tests, not a
 * partition. The real model draws while any part of the bucket is inside the
 * swap (near edge), the impostor while any part is outside it (far edge), so a
 * bucket straddling the boundary draws both meshes and the per-instance windows
 * (instanceCullWindows, enforced in the vertex shader) split the trees exactly.
 * Keyed on the center, a bucket you are standing at the edge of could already
 * have flipped to impostors, putting cones a few strides away; keyed near-edge
 * only, as this was before the shader owned the boundary, every tree in a
 * 540x240u slab drew at full detail until the whole slab left the swap.
 */
export function bucketVisible(w: BucketWindowInput): boolean {
  const nearEdge = w.centerDist - w.radius;

  const minCap = (w.minDist ?? 0) * w.distanceScale;
  const maxCap =
    w.maxDist === undefined
      ? Number.POSITIVE_INFINITY
      : w.maxDist * w.distanceScale * w.revealScale;
  if (w.centerDist < minCap || w.centerDist >= maxCap) return false;

  if (w.minAtDetail && w.centerDist + w.radius < w.detailFar) return false;
  if (w.maxAtDetail && nearEdge >= w.detailFar) return false;

  return nearEdge < w.fogLimit;
}
