// What the far vista mesh ACTUALLY renders, and how far each vertex has to drop
// so that surface can never rise above the terrain it stands in for.
//
// The invariant, restated: the coarse mesh is a stand-in. Wherever the detailed
// terrain also draws, the coarse one must lose the depth test. When it does not,
// it surfaces through the real hillside as a smooth, untextured, unshadowed skin
// in a shape that does not match it, and walking closer "un-smooths" it as the
// detail horizon passes over. That was the defect, four screenshots running.
//
// Why a BUILD-TIME clearance rather than a runtime one. The first fix was a
// camera-distance sink applied in the vertex shader across the overlap band.
// That has to guess: it is 4 to 10 times overkill at the discard radius, falls
// under the real overshoot past about 30 units out, and is zero over the outer
// stretch of the band where near chunks legitimately still draw (their
// visibility keys off the NEAREST point of a 60 unit footprint, so their
// geometry runs well past the horizon). None of that guessing is necessary: the
// overshoot is a property of the built mesh, knowable exactly when it is built,
// and once baked it costs nothing per frame and holds at every distance.
//
// Why the vertices can sink without recolouring anything. `farGroundColor` takes
// the height as an ARGUMENT and never reads the vertex position, so the builder
// can pass the true sampled height for colour while writing a lowered position.
// That is what makes this safe where a MIN over the neighbourhood was not: that
// creased the sampled field at every ridge, and the colour recipe read the
// doubled step as a threshold crossing and painted a hard band.
//
// Everything here is host-agnostic math (no Three, no DOM), so a Vitest sweeps
// the whole world directly; the consumer is createFarTileBuilder.

/**
 * Where the rendered surface is sampled inside one cell, in cell-local
 * coordinates. A flat triangle is EXACT at its corners and can only depart from
 * the smooth terrain between them, so every probe sits in the interior: the two
 * triangle centroids, the shared-edge midpoint, and four points pushed out
 * toward the middle of each edge, which is where a cell straddling a ridge
 * departs worst.
 *
 * Seven taps per cell is what this costs, roughly quadrupling the builder's
 * terrainHeight sampling (about 150ms to 600ms for the whole world). Still once
 * per session, still spread across idle slots, and the far vista is the politest
 * consumer of that time (it defers to near-terrain streaming twice before
 * forcing progress). A one-off build cost in exchange for deleting a per-frame
 * vertex uniform read and a hand-tuned constant is the right trade.
 */
export const FAR_CELL_PROBES: readonly (readonly [number, number])[] = [
  [1 / 3, 1 / 3],
  [2 / 3, 2 / 3],
  [0.5, 0.5],
  [1 / 6, 1 / 2],
  [1 / 2, 1 / 6],
  [5 / 6, 1 / 2],
  [1 / 2, 5 / 6],
];

/**
 * Multiplier on the probed overshoot, covering the gap between the worst value
 * the probes SEE and the worst the cell actually has.
 *
 * Scoped honestly: this covers probe BRACKETING on terrain the grid can resolve,
 * where the surface between probes is close to what they read. Measured on that
 * terrain the worst cell needs about 1.11x its probe maximum, so 1.6 has real
 * headroom. It is NOT a general bound and cannot be. Where the heightfield
 * carries a feature narrower than the grid, the probes can read near zero while
 * the true departure is large: the worst case found in the shipped world is a
 * four-yard, ten-yard-deep slot at (-230, 591) whose probe maximum is 0.11
 * against a true 10.27, a ratio of ninety. No multiplier fixes that, and raising
 * this one toward ninety would sink the whole world. The clearance cap below is
 * the answer to those cells instead.
 */
export const FAR_CLEARANCE_SAFETY = 1.6;

/**
 * Ceiling on any one cell's clearance, in world units.
 *
 * Without it the fix acquires the mirror of the bug it cures. The clearance is a
 * MAX over the four cells a vertex corners, so a single pathological cell drags
 * all four of its corners down and stamps a roughly 32-yard-wide, 10-to-26-yard
 * pit into the surface. Past the detail horizon this mesh is the only ground
 * there, so those read as pockmarks on the vista: punching down instead of
 * poking up, but just as wrong. Measured before the cap: 112 to 270 vertices
 * world-wide exceeded 10 units, peaking at 26.
 *
 * 8 removes every deep pit while still clearing the overshoot in all but about
 * 0.1 percent of cells, and those are the narrow gullies where the residual is
 * sub-pixel at the distances this layer draws. It is also the principled
 * response: a cell demanding 26 yards is a cliff the grid cannot represent at
 * all, and sinking its corners into a crater is not a repair for that.
 */
export const FAR_CLEARANCE_MAX = 8;

/**
 * Height of the RENDERED surface at a point inside one cell, given the cell's
 * four corner heights. `fx` and `fz` are cell-local in [0, 1].
 *
 * This reproduces the exact triangulation farGridIndices emits: corners
 * a (0,0), b (1,0), c (0,1), d (1,1), split into (a, c, b) and (b, c, d). The
 * shared edge is b to c, the ANTI-diagonal, so the split is `fx + fz <= 1`, and
 * a plain bilinear reconstruction is wrong on a saddle. Getting this wrong is
 * invisible on gentle ground and off by units on the ridges that matter.
 */
export function farRenderedCellHeight(
  h00: number,
  h10: number,
  h01: number,
  h11: number,
  fx: number,
  fz: number,
): number {
  if (fx + fz <= 1) {
    // triangle (a, c, b): a + (b - a) * fx + (c - a) * fz
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  }
  // triangle (b, c, d), parameterized from d back along its two edges
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/**
 * How far this cell's rendered surface rises above the real terrain, at the
 * probe points. Zero when the mesh is at or under the terrain everywhere it was
 * checked (the common case: gentle ground, and every convex rise).
 *
 * `sample(x, z)` is injected rather than imported so the caller passes the
 * height the near mesh actually DRAWS (meshTerrainHeight, which subtracts the
 * castle ward terrace that terrainHeight keeps). Comparing against the raw sim
 * height would call the far mesh innocent in exactly the place it can poke
 * through the drawn ground.
 */
export function farCellOvershoot(
  h00: number,
  h10: number,
  h01: number,
  h11: number,
  x0: number,
  z0: number,
  spacing: number,
  sample: (x: number, z: number) => number,
): number {
  let worst = 0;
  for (const [fx, fz] of FAR_CELL_PROBES) {
    const drawn = farRenderedCellHeight(h00, h10, h01, h11, fx, fz);
    const real = sample(x0 + fx * spacing, z0 + fz * spacing);
    const over = drawn - real;
    if (over > worst) worst = over;
  }
  return Math.min(FAR_CLEARANCE_MAX, worst * FAR_CLEARANCE_SAFETY);
}

/**
 * The clearance for ONE vertex, from the overshoot of the (up to four) cells it
 * is a corner of.
 *
 * Taking the MAX is what makes the guarantee hold. Lowering all four corners of
 * a cell lowers its interpolated surface at any interior point by at least the
 * SMALLEST of the four drops, so a cell is only cleared if every one of its
 * corners drops by at least that cell's overshoot. Giving each vertex the max
 * over its own cells satisfies that for all of them at once.
 *
 * Tile seams hold because callers DO supply all four cells, including the ones
 * beyond their own tile. The builder samples a padded lattice one ring wider
 * than the tile, so an edge vertex reads its real outside cells rather than a
 * zero, and two adjacent tiles resolve the same world cells for the vertex they
 * share. Every coordinate involved is an exact integer, so the two evaluations
 * are bit-identical and the shared edge cannot crack. Trimming that padding as
 * an "optimization" is what would break it: see the seam test.
 */
export function farVertexClearance(
  cellNW: number,
  cellNE: number,
  cellSW: number,
  cellSE: number,
): number {
  return Math.max(0, cellNW, cellNE, cellSW, cellSE);
}
