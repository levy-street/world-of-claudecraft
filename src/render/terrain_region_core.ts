// PURE (unit-tested, Three-free): region selection math for terrain chunk
// ownership and the map editor's partial terrain rebuilds. terrain.ts stores
// each chunk's build inputs (x0, z0, size, spacing) and uses these helpers to
// decide which zone builds a given chunk cell, which chunk geometries a sculpt
// region invalidates, and which texel rows of the baked macro normal
// DataTexture go stale. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts): no three/game/net/i18n imports, no DOM, no
// nondeterminism.

/** An axis-aligned world-space footprint (a zone rectangle, a chunk cell). */
export interface WorldRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Axis-aligned XZ distance from a point to a rect. 0 when the point is inside. */
export function rectDistance(x: number, z: number, rect: WorldRect): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

// Which rect owns the point (x, z)? The CONTAINING rect wins, half-open on the
// max edges so two abutting rects never both claim a shared border. When no
// rect contains it (the zone rectangles do not tile the world box: nothing
// sits west of Eastbrook Vale, nothing north of Frostveil in the centre
// column, and the chunk grid overhangs WORLD_MAX_Z by a row) ownership falls
// back to the geometrically NEAREST rect, ties resolved to the lowest index.
//
// Nearest-rect, not a z-band clamp like zoneAt's: a z-band fallback would hand
// a whole empty column to whichever zone merely shares its latitude, while the
// nearest rect is always one the gap actually abuts. Exactly one rect wins
// either way, so a caller enumerating cells per rect covers the whole grid and
// never builds a cell twice. Returns -1 only for an empty rect list.
export function owningRectIndex(x: number, z: number, rects: readonly WorldRect[]): number {
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ) return i;
    const distance = rectDistance(x, z, rect);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = i;
    }
  }
  return nearest;
}

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
