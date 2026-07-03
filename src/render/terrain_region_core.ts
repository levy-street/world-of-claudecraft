// PURE (unit-tested, Three-free): region selection math for the map editor's
// partial terrain rebuilds. terrain.ts stores each chunk's build inputs
// (x0, z0, size, spacing) and uses these helpers to decide which chunk
// geometries a sculpt region invalidates and which texel rows of the baked
// macro normal DataTexture go stale. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts): no three/game/net/i18n imports, no DOM, no
// nondeterminism.

// Does the chunk footprint [x0, x0+size] x [z0, z0+size] intersect the edit
// region? INCLUSIVE on borders: a chunk whose edge merely touches the region
// shares border vertices (and skirt verts) with the sculpted area, so it must
// rebuild too or the seam shows a crack. Works for regular 60u chunks and the
// merged 2x2 far super-chunks alike (pass size = 120).
export function chunkIntersectsRegion(
  chunkX0: number,
  chunkZ0: number,
  chunkSize: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): boolean {
  return (
    chunkX0 <= maxX && chunkX0 + chunkSize >= minX && chunkZ0 <= maxZ && chunkZ0 + chunkSize >= minZ
  );
}

export interface TexelBounds {
  i0: number; // inclusive column range
  i1: number;
  j0: number; // inclusive row range
  j1: number;
}

// Map a world-space edit region onto the inclusive texel bounds of a
// texW x texH texture covering [worldMinX, worldMinX+worldWidth] x
// [worldMinZ, worldMinZ+worldDepth] (texel i samples the height at
// worldMinX + (i + 0.5) * step). `margin` expands the bounds by whole texels:
// the normal bake reads a 1-texel derivative stencil, so pass at least 1 so
// texels just OUTSIDE the sculpted region (whose stencil reaches inside it)
// rebake too. The floor/ceil mapping over-covers by up to one extra texel per
// side, which is safe (a rebake of an unchanged texel is a no-op). Returns
// null when the region misses the texture entirely or is empty.
export function normalTexelBounds(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  worldMinX: number,
  worldMinZ: number,
  worldWidth: number,
  worldDepth: number,
  texW: number,
  texH: number,
  margin: number,
): TexelBounds | null {
  if (maxX < minX || maxZ < minZ) return null;
  if (maxX < worldMinX || minX > worldMinX + worldWidth) return null;
  if (maxZ < worldMinZ || minZ > worldMinZ + worldDepth) return null;
  const stepX = worldWidth / texW;
  const stepZ = worldDepth / texH;
  const i0 = Math.max(0, Math.floor((minX - worldMinX) / stepX) - margin);
  const i1 = Math.min(texW - 1, Math.ceil((maxX - worldMinX) / stepX) + margin);
  const j0 = Math.max(0, Math.floor((minZ - worldMinZ) / stepZ) - margin);
  const j1 = Math.min(texH - 1, Math.ceil((maxZ - worldMinZ) / stepZ) + margin);
  if (i1 < i0 || j1 < j0) return null;
  return { i0, i1, j0, j1 };
}
