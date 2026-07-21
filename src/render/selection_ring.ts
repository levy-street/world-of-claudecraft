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
