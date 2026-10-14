// Pure geometry helper for the 3D target selection ring.
//
// The selection reticle is a flat ring drawn at a targeted unit's feet. On
// sloped ground a flat horizontal disc sinks into the uphill side of the
// terrain and only its downhill arc survives depth testing, so the reticle
// reads as a stray red streak instead of a ring. To keep it legible at any
// elevation we "drape" the ring over the terrain: every vertex rides its own
// ground height.
//
// This module is host-agnostic (no Three.js, no DOM) so the draping math can be
// unit-tested directly. The renderer is a thin consumer that feeds in the ring
// geometry's center-relative XZ positions and a `groundHeight` sampler, honoring
// the "terrain height = sim height" invariant (see src/render/CLAUDE.md).

/** A terrain height sampler: world (x, z) -> ground height on the up axis. */
export type HeightSampler = (x: number, z: number) => number;

// The body height (world units, unscaled) the base ring geometry (radius
// 0.9-1.15, renderer.ts) was tuned to look right against: a typical
// humanoid/creature target reads correctly at entity.scale alone, with no
// height term at all. A cosmetic buddy follower (src/sim/content/
// buddy_mobs.ts) is authored far shorter than that (0.35-0.9) on top of its
// own scale multiplier — tuned purely for relative buddy-to-buddy sizing,
// never for ring proportion, and reaching as high as 2.7 for the rarity-tier
// buddies — so feeding entity.scale alone into the ring ballooned it to
// several times the buddy's actual silhouette (2026-08-28 owner report).
const RING_REFERENCE_HEIGHT = 1.8;

/**
 * The uniform scale to apply to the selection ring (both the mesh transform
 * and drapeRingLocalY's own `scale` argument, which must always agree with
 * it) for a target whose authored visual height is `viewHeight` and whose
 * entity scale is `entityScale`.
 *
 * Every ordinary target (viewHeight at or above the reference) is completely
 * unchanged from before this existed: the height factor clamps to 1, so the
 * result is exactly `entityScale`. Only a target authored shorter than the
 * reference — buddies, and incidentally a few small critters (a wild fox,
 * a dragonkin whelp) — additionally shrinks the ring so it hugs that
 * target's real footprint instead of the reference creature's.
 */
export function selectionRingScale(entityScale: number, viewHeight: number): number {
  const heightFactor = Math.min(1, viewHeight / RING_REFERENCE_HEIGHT);
  return entityScale * heightFactor;
}

/**
 * Compute the local Y for each ring vertex so the ring drapes over the terrain.
 *
 * The ring mesh is positioned at world (cx, baseY, cz) and uniformly scaled by
 * `scale`. A vertex at center-relative local (lx, lz) therefore lands at world
 * XZ (cx + scale*lx, cz + scale*lz). We want its world Y to be the ground height
 * sampled there plus a small `lift`, so its local Y must be:
 *
 *     localY = (sample(worldX, worldZ) + lift - baseY) / scale
 *
 * @param localXZ flat [x0,z0, x1,z1, ...] center-relative ring vertices (unscaled)
 * @param cx      ring center world X
 * @param cz      ring center world Z
 * @param baseY   world Y the mesh is positioned at (the center's ground height)
 * @param scale   uniform mesh scale (creature size)
 * @param lift    constant height above terrain, in world units
 * @param sample  terrain height sampler in world space
 * @param outY    destination, length = localXZ.length / 2 (reused across frames)
 * @returns       outY
 */
export function drapeRingLocalY(
  localXZ: ArrayLike<number>,
  cx: number,
  cz: number,
  baseY: number,
  scale: number,
  lift: number,
  sample: HeightSampler,
  outY: Float32Array,
): Float32Array {
  const n = outY.length;
  const invScale = scale !== 0 ? 1 / scale : 1;
  for (let i = 0; i < n; i++) {
    const lx = localXZ[i * 2];
    const lz = localXZ[i * 2 + 1];
    const h = sample(cx + scale * lx, cz + scale * lz);
    outY[i] = (h + lift - baseY) * invScale;
  }
  return outY;
}
