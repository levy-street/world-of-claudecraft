// Distance windows for the instanced tree / rock / dressing buckets, kept apart
// from foliage.ts so the decision itself is pure: no Three, no DOM, no GFX
// singleton, unit-testable in Node (tests/foliage_lod.test.ts).
//
// TWO ARMS, TWO LAWS. On the sprite arm (GFX.standardMaterials and not
// leanFoliage) the far field belongs to baked sprite impostors of the real
// models (foliage_impostor.ts), which are legible in clear air, so the
// real-model handoff follows the BUDGET: spriteSwapDistance in
// foliage_impostor_core.ts. This module keeps the shared plumbing (the
// distance tables, the governor scales, the fog cull, bucketVisible) plus the
// LEAN arm's law below.
//
// THE LEAN ARM HAS NO IMPOSTORS AT ALL: past the tree-detail distance its
// trees simply end. That is why treeDetailDistance still follows the FOG: the
// forest may only end where fog has already blended it at least
// IMPOSTOR_MIN_FOG_BLEND of the way to solid, else the world visibly runs out
// of trees in clear air. The short-fog realms need the OPPOSITE guard: their
// budgeted radius overshoots the foliage fog cull entirely (marsh: detail
// 216-300u against a cull at 129-165u), so the boundary retreats to the fog
// floor, the deepest-in-the-murk point the blend law allows. If even the
// floor sits past the cull (very low model quality), trees run to the cull
// line and the blend law holds vacuously.

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
 * The LEAN arm's blend law: how far the fog must have swallowed a tree before
 * the forest is allowed to END there (the lean tier has no impostors, so past
 * the boundary there is simply nothing). 0 would let the treeline stop in
 * clear air; 1 would hand the far field back its full triangle cost. The
 * sprite arm retired this law: a baked sprite is legible anywhere, so its
 * handoff follows the budget (foliage_impostor_core.ts spriteSwapDistance).
 */
export const IMPOSTOR_MIN_FOG_BLEND = 0.7;

/** THREE.Fog is linear: 0 at `near`, fully fogged at `far`. */
export function fogBlendAt(dist: number, fogNear: number, fogFar: number): number {
  if (!(fogFar > fogNear)) return dist >= fogFar ? 1 : 0;
  return Math.min(1, Math.max(0, (dist - fogNear) / (fogFar - fogNear)));
}

/**
 * Distance at which the LEAN arm's real trees end (the sprite arm hands off
 * to sprites at foliage_impostor_core.ts spriteSwapDistance instead).
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

export interface BucketWindowInput {
  /** distance from the camera to the bucket's CENTER */
  centerDist: number;
  /** bucket bounding radius */
  radius: number;
  /** build-time bounds, scaled by the adaptive budget at draw time */
  minDist?: number;
  maxDist?: number;
  /**
   * Bounds that additionally track the runtime handoff: the sprite starts
   * there (minAtDetail), the real model ends there (maxAtDetail). It is the
   * one edge that cannot be known at build time, because it follows the
   * governor and the zone's fog. A bucket can carry BOTH a numeric cap and
   * the detail cap, and the per-instance shader windows
   * (foliage_collapse.ts) resolve whatever the coarse slab tests let
   * through, so these compose rather than replace.
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
  /**
   * Sprite rows (the merged per-bucket impostor meshes). Their instances
   * begin at each one's own jittered handoff (detailFar carries the row's
   * category swap), and they die at the LIVE fog wall (spriteFar) rather
   * than the model-quality-trimmed foliage cull: a sprite is ~2 triangles,
   * so trimming it before the fog swallows it saves nothing and pops the
   * picture.
   */
  spriteRow?: boolean;
  /** per-instance handoff jitter span (defaults to 0) */
  swapFade?: number;
  /** live fog wall for sprite rows (defaults to fogLimit) */
  spriteFar?: number;
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

  if (w.minAtDetail) {
    // Sprite rows come alive at the earliest per-instance handoff their
    // instances can take (jitter pulls each swap in by up to the fade span);
    // legacy rows key on the detail boundary alone.
    const minBase = w.spriteRow ? w.detailFar - (w.swapFade ?? 0) : w.detailFar;
    if (w.centerDist + w.radius < minBase) return false;
  }
  if (w.maxAtDetail && nearEdge >= w.detailFar) return false;

  return nearEdge < (w.spriteRow ? (w.spriteFar ?? w.fogLimit) : w.fogLimit);
}
