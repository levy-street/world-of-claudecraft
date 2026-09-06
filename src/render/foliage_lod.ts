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

import type { GfxTier } from './gfx';

export interface LodDists {
  barkFar: number;
  treeDetailFar: number;
  dressFar: number;
  rockFar: number;
  treeFillFar: number;
}

/**
 * The full-detail table: ultra and insane. Every non-lean tier shares every
 * row of it EXCEPT `treeDetailFar`, which the per-tier table below spreads
 * (see TREE_DETAIL_FAR_BY_TIER).
 */
export const LOD_HIGH: LodDists = {
  barkFar: 330,
  treeDetailFar: 300,
  dressFar: 200,
  rockFar: 360,
  treeFillFar: 310,
};

// Low caps: the tree rows still measure from the bucket CENTER, so these must
// clear the worst camera-to-bucket-center distance a tree row can see (~158u
// for a 2-column x 240u-band bucket) or trunks pop at bucket boundaries. The
// rock and dressing rows measure from the near edge (maxNearEdge, below) and
// no longer depend on this margin.
export const LOD_LOW: LodDists = {
  barkFar: 170,
  treeDetailFar: 250,
  dressFar: 185,
  rockFar: 190,
  treeFillFar: 245,
};

/**
 * The authored real-model radius per tier: how far real tree geometry is
 * allowed to reach before the baked sprite takes over.
 *
 * THIS IS THE TIER LADDER'S ONE FOLIAGE-DISTANCE LEVER, and it used to be a
 * constant. Every non-lean tier read LOD_HIGH's 300, and the only thing that
 * moved between them was the bucket baseline feeding foliageDistanceScale
 * (0.74 medium, 0.9 high, 1.0 ultra) and the shared SPRITE_SWAP_BUDGET: that
 * put the clear-air handoff at 217 / 227 / 234 yards, an 8 percent span
 * across four tiers, while real-model cost grows with the SQUARE of the
 * radius. So medium and high paid very nearly ultra's outer ring, which is
 * the most expensive part of the whole layer.
 *
 * Spreading the base is safe precisely because the sprite arm carries
 * everything past the handoff (foliage_impostor_core.ts): the tree is still
 * drawn, at the same base, height, tint and sway, as a baked picture of
 * itself. What a nearer handoff costs is stated in SPRITE_SWAP_BUDGET's own
 * header and it is the same cost here, one tier earlier: canopy
 * self-parallax under camera translation, and a silhouette that stops
 * changing with pitch. SPRITE_SWAP_MIN (150) is untouched and still binds
 * first, so no tier can push a card into the near field; on medium it is now
 * the binding term rather than the budget.
 *
 * A SESSION WITH NO IMPOSTORS IS NOT THE SAME SET AS THE LEAN TIERS, and the
 * table does not try to be. The sprite verdict is
 * `standardMaterials && !leanFoliage && !constrainedMemory`
 * (far_terrain_core.ts farFieldPolicy, read through
 * foliage_impostor.ts impostorsActive), so an ordinary constrained-memory
 * phone or tablet resolving to medium or high is NOT leanFoliage and still
 * has no sprites: it takes a row of this table and then runs the LEAN law.
 * That is safe because the safety lives in the law, not in the table.
 * treeDetailDistance floors its answer at the fog blend line
 * (IMPOSTOR_MIN_FOG_BLEND), so however small a base it is handed, its trees
 * still end at least that far into the murk; a smaller base can only trim
 * inside a boundary the blend law already owns, and where the floor itself
 * overshoots the cull it retreats to the cull. Only the SPRITE arm spends the
 * base directly. The lean TIERS are absent for a different reason: they run
 * the lean model set and their own decimation, so they keep LOD_LOW whole.
 */
export const TREE_DETAIL_FAR_BY_TIER: Record<GfxTier, number> = {
  low: LOD_LOW.treeDetailFar,
  medium: 190,
  high: 230,
  ultra: LOD_HIGH.treeDetailFar,
  insane: LOD_HIGH.treeDetailFar,
};

/** The non-lean tables: LOD_HIGH with that tier's own real-model radius. */
export const LOD_BY_TIER: Record<GfxTier, LodDists> = {
  low: LOD_LOW,
  medium: { ...LOD_HIGH, treeDetailFar: TREE_DETAIL_FAR_BY_TIER.medium },
  high: { ...LOD_HIGH, treeDetailFar: TREE_DETAIL_FAR_BY_TIER.high },
  ultra: LOD_HIGH,
  insane: LOD_HIGH,
};

export function lodDistsFor(leanFoliage: boolean, tier: GfxTier): LodDists {
  return leanFoliage ? LOD_LOW : LOD_BY_TIER[tier];
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
  /**
   * Measure the numeric max cap from the bucket's NEAR edge instead of its
   * center. Only for rows whose vertex shader collapses every instance past
   * that same cap (foliage_collapse.ts binds the cap as the row's window):
   * the slab then survives until its nearest instance crosses the cap, and
   * the instances beyond it cost a vertex-shader early-out each, never a
   * rasterized triangle. Without that per-instance window a near-edge cap
   * keeps a half-bucket of live triangles past the cull.
   */
  maxNearEdge?: boolean;
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
 * The lean-arm rock and dressing rows are the one exception (maxNearEdge). A
 * shipped slab is half the world wide (bounding radius ~270-310u) against a
 * lean rock cap of ~106-190u, so keyed on the center the whole slab, boulders a
 * stride from the player included, dropped out whenever the CAMERA orbited its
 * center past the cap: rocks and bushes popping in and out with the view angle
 * on Low, while the rock's collider still blocked movement. Those rows now
 * measure from the near edge, and their vertex shader collapses each instance
 * past the very same cap, so the extra kept instances are vertex early-outs,
 * not the half-bucket of triangles the center rule exists to prevent.
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
 *
 * The shadow-only clones do NOT come through here at all. They are the one row
 * with no fallback once the bucket drops (no impostor takes over, and the
 * per-instance collapse cannot reach three's shadow depth material), which
 * briefly made the numeric cap measure from their near edge: that inflated
 * their kept radius by a bucket bounding radius, ~290u on the shipped
 * ~500x240u slabs, and roughly tripled the shadow pass. The right axis for that
 * row was never distance from the camera, it is the key light's own shadow
 * volume, so it lives in foliage_shadow_core.ts now.
 */
export function bucketVisible(w: BucketWindowInput): boolean {
  const nearEdge = w.centerDist - w.radius;

  const minCap = (w.minDist ?? 0) * w.distanceScale;
  const maxCap =
    w.maxDist === undefined
      ? Number.POSITIVE_INFINITY
      : w.maxDist * w.distanceScale * w.revealScale;
  // The cap probe: the center, or the near edge for the rows whose shader
  // owns the per-instance boundary (see maxNearEdge). Camera-keyed either
  // way, so an orbit of the camera moves it by the camera's own offset.
  const maxProbe = w.maxNearEdge ? nearEdge : w.centerDist;
  if (w.centerDist < minCap || maxProbe >= maxCap) return false;

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
