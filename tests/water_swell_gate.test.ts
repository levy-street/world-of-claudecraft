import { describe, expect, it } from 'vitest';
import { bakeSwellGate } from '../src/render/water_core';

// The swell displacement gate (water.ts aSwellGate, baked by bakeSwellGate).
//
// The defect it fixes: gating the lift on each vertex's OWN shore depth is
// correct at every vertex and wrong everywhere between them, because the GPU
// interpolates the lift linearly across a quad. One wet corner therefore drags
// the displaced sheet across the whole cell, and the horizon apron's cells are
// 29 by 38 yards. Measured at the shipped HEAD: 600 apron quads and 7892 square
// yards of dry beach with water standing up to 0.44 yards proud of the sand,
// drawn as near-opaque shredded foam (over dry ground the interpolated depth
// collapses, the surf band saturates, and alpha goes to the foam accent).
//
// The gate is a 3x3 minimum, and the diagonals are the load-bearing part: the
// corner of a quad diagonally opposite a dry vertex is not a 4-neighbour of it,
// which is exactly the case a plus-shaped window leaves standing.

/** Every corner lift of every quad, as the vertex stage would compute it. */
function quadCornerGates(
  gate: ArrayLike<number>,
  columns: number,
  rows: number,
): { r: number; c: number; corners: number[] }[] {
  const quads: { r: number; c: number; corners: number[] }[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      quads.push({
        r,
        c,
        corners: [
          gate[r * columns + c],
          gate[r * columns + c + 1],
          gate[(r + 1) * columns + c],
          gate[(r + 1) * columns + c + 1],
        ],
      });
    }
  }
  return quads;
}

describe('bakeSwellGate', () => {
  it('stills every quad that touches dry ground, diagonals included', () => {
    // A 5x5 sheet of deep water with one dry vertex in the middle. Lift inside
    // a triangle is a convex combination of its corner lifts, so all four
    // corners at zero is the whole condition: the cell then lies flat at the
    // water level for every wave phase, whatever the terrain does between the
    // vertices. The four quads around the dry vertex include the ones reaching
    // it only diagonally.
    const columns = 5;
    const rows = 5;
    const depth = new Float32Array(columns * rows).fill(6);
    depth[2 * columns + 2] = -0.4; // dry
    const gate = bakeSwellGate(depth, columns, rows, 0);

    for (const quad of quadCornerGates(gate, columns, rows)) {
      const touchesDry = quad.r <= 2 && quad.r >= 1 && quad.c <= 2 && quad.c >= 1;
      const lift = Math.max(...quad.corners);
      if (touchesDry) expect(lift, `quad ${quad.r},${quad.c}`).toBe(0);
      else expect(lift, `quad ${quad.r},${quad.c}`).toBeGreaterThan(0);
    }
  });

  it('leaves open water on the exact ramp the shader used to apply', () => {
    // Away from any shore the gate must be a no-op, or the swell loses
    // amplitude across the open sea for nothing.
    const columns = 7;
    const rows = 7;
    const depth = new Float32Array(columns * rows).fill(0.9);
    const gate = bakeSwellGate(depth, columns, rows, 0);
    for (const value of gate) expect(value).toBeCloseTo(0.9 * 0.8, 6);

    const deep = new Float32Array(columns * rows).fill(6);
    for (const value of bakeSwellGate(deep, columns, rows, 0)) expect(value).toBe(1);
  });

  it('takes the neighbourhood minimum, not the vertex, on a depth ramp', () => {
    // One row per depth, shallowing north to south: every vertex reports its
    // own SOUTHERN neighbour's depth, one cell seaward of where the old ramp
    // sat. A morphological erosion cannot add a discontinuity the depth field
    // did not already have, so the ramp keeps its shape and simply shifts.
    const columns = 3;
    const rows = 4;
    const depths = [1.25, 0.75, 0.25, -0.25];
    const depth = new Float32Array(columns * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) depth[r * columns + c] = depths[r];
    }
    const gate = bakeSwellGate(depth, columns, rows, 0);
    expect(gate[0]).toBeCloseTo(0.75 * 0.8, 6); // row 0 sees row 1
    expect(gate[columns]).toBeCloseTo(0.25 * 0.8, 6); // row 1 sees row 2
    expect(gate[2 * columns]).toBe(0); // row 2 sees the dry row 3
    expect(gate[3 * columns]).toBe(0);
  });

  it('subtracts the margin, which is what covers land between vertices', () => {
    // A sandbar smaller than an apron cell leaves no vertex dry at all, so no
    // grid minimum can see it; the margin is the only thing that closes it.
    const columns = 4;
    const rows = 4;
    const depth = new Float32Array(columns * rows).fill(1.2);
    expect(bakeSwellGate(depth, columns, rows, 0)[0]).toBeCloseTo(1.2 * 0.8, 6);
    expect(bakeSwellGate(depth, columns, rows, 1)[0]).toBeCloseTo(0.2 * 0.8, 6);
    expect(bakeSwellGate(depth, columns, rows, 1.5)[0]).toBe(0);
    expect(bakeSwellGate(depth, columns, rows, 3)[0]).toBe(0);
  });

  it('clamps its window at the grid border instead of reading across it', () => {
    // A sheet's edge vertices have no neighbours outside it. Wrapping or
    // reading out of range there would gate the far side of the sheet on a
    // depth from the opposite coast.
    const columns = 3;
    const rows = 3;
    const depth = new Float32Array([6, 6, 6, 6, 6, 6, 6, 6, -1]);
    const gate = bakeSwellGate(depth, columns, rows, 0);
    expect(gate[0]).toBe(1); // opposite corner, no window overlap
    expect(gate[columns * rows - 1]).toBe(0);
    expect(gate.length).toBe(columns * rows);
  });
});
