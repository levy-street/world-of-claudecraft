// The blade-grass pool's INDEX GEOMETRY: the pure, Three-free decisions about
// the toroidal cluster grid that the near carpet (blade_grass.ts) and the
// mid-band (blade_grass_band.ts) both ride. Which world cell a slot owns, and
// which sector mesh that slot draws from.
//
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/blade_grass_pool_core.test.ts.

/**
 * The world cell, on one axis, that grid line `g` owns for the block starting
 * at `base`: the unique cell congruent to `g` modulo the grid width inside
 * [base, base + gridW). This is what makes the pool toroidal, so walking
 * re-places only the lines whose owned cell changed.
 */
export function toroidalCell(base: number, g: number, gridW: number): number {
  return base + ((((g - base) % gridW) + gridW) % gridW);
}

// ---------------------------------------------------------------------------
// Sector split
// ---------------------------------------------------------------------------
//
// The pool draws as ONE instanced mesh with frustum culling off, because it is
// centred on the player and something in it is always on screen. That submits
// every cluster to the vertex shader, and 70 to 80 percent of them sit behind
// or beside the camera. Splitting the pool into a grid of sectors, each its own
// mesh with its own bounding sphere, lets three drop the ones the camera is not
// looking at.
//
// The split is over SLOT LINES, not angles around the player. A wedge around
// the player rotates against the toroidal cell grid as the player walks, so
// every crossing would move hundreds of clusters from one wedge's buffer to
// another's, and those moves are scattered the length of each dense prefix:
// that is exactly the upload the banded ranges exist to avoid. A slot's LINE
// never changes, so a cluster is written once into one sector and stays there
// until its own cell changes, which the pool was re-placing anyway. The price
// is the toroidal seam: the one sector column and one sector row the wrap runs
// through own two runs of cells at opposite edges of the pool, so their bounds
// are wide and they rarely cull. The seam moves one line per crossing, so no
// sector is permanently the wide one.

/** Slot lines per sector when the pool's grid is split `axis` ways. */
export function poolSectorWidth(gridW: number, axis: number): number {
  return Math.ceil(gridW / Math.max(1, Math.min(axis | 0, gridW)));
}

/** Sectors per axis for a given sector width (the last one may be narrower). */
export function poolSectorAxisCount(gridW: number, width: number): number {
  return Math.ceil(gridW / width);
}

/** Slot lines the sector at index `a` owns on one axis. */
export function poolSectorLines(gridW: number, width: number, a: number): number {
  return Math.min(width, gridW - a * width);
}

/** The sector holding slot `gj * gridW + gi`. */
export function poolSectorOfSlot(
  slot: number,
  gridW: number,
  width: number,
  axisCount: number,
): number {
  const gi = slot % gridW;
  const gj = (slot / gridW) | 0;
  return ((gj / width) | 0) * axisCount + ((gi / width) | 0);
}
