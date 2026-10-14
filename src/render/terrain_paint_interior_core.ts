// The paint field's INTERIOR BIT: which painted cells are far enough from any
// boundary that the splat shader can take its one-tap fast path there and
// still land on exactly the colour (and tint) the full blend would.
//
// Pure array math, no THREE and no world state, so Vitest imports it directly
// (tests/paint_interior_bit.test.ts pins it against a brute-force box scan).
//
// The radius is NOT fixed at 1. It has to match how far the shader's lookup
// can reach, the blend kernel's own span plus whatever the boundary warp
// displaces it by (render/terrain_paint_layers.ts paintEdgeParams), or the
// fast path and the blended path disagree and draw a seam one kernel inside
// every painted region.

/**
 * Mark the interior bit on every cell whose whole (2R+1)^2 box carries the
 * same id. `out` is the RGBA field; `markBit` is OR'd into each qualifying
 * cell's R byte. Cells already holding the unpainted sentinel are skipped.
 *
 * O(cells) for any R, by splitting "this box is uniform" into two separable
 * run tests, the naive box scan is O(cells * R^2), which at the 4.1M-cell
 * grid ceiling is seconds per stroke:
 *   1. `hUni[i]`: the 2R+1 cells ACROSS row r centred on c are all equal.
 *   2. the box is uniform iff the 2R+1 cells DOWN column c are all equal
 *      (which is what fixes the shared value) AND hUni holds on every one of
 *      them.
 */
export function markPaintInterior(
  ids: readonly number[] | Int32Array,
  cols: number,
  rows: number,
  radius: number,
  out: Uint8Array,
  markBit: number,
  unpaintedByte = 255,
): void {
  const R = Math.max(1, Math.floor(radius));
  if (cols <= 2 * R || rows <= 2 * R) return; // no cell can be interior
  const hUni = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const row = r * cols;
    let c = 0;
    while (c < cols) {
      let end = c;
      while (end + 1 < cols && ids[row + end + 1] === ids[row + c]) end++;
      // Inside one run of equal ids, a cell is row-uniform when it has R
      // cells of that run on both sides of it.
      for (let k = c + R; k <= end - R; k++) hUni[row + k] = 1;
      c = end + 1;
    }
  }
  // Column pass. `sameUp` counts consecutive equal ids ending at row r,
  // `hUp` consecutive hUni=1 ending at r; both >= 2R+1 at row r means the box
  // centred R rows above is uniform.
  for (let c = 0; c < cols; c++) {
    let sameUp = 1;
    let hUp = 0;
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      sameUp = r > 0 && ids[i] === ids[i - cols] ? sameUp + 1 : 1;
      hUp = hUni[i] ? hUp + 1 : 0;
      const rc = r - R;
      if (rc < R) continue;
      const o = (rc * cols + c) * 4;
      if (out[o] === unpaintedByte) continue;
      if (sameUp >= 2 * R + 1 && hUp >= 2 * R + 1) out[o] |= markBit;
    }
  }
}
