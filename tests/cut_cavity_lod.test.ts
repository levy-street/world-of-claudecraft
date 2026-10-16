import { describe, expect, it } from 'vitest';
import { CAVITY_LOD_CULL, CAVITY_LOD_RINGS, cavityLodCell } from '../src/render/cut_cavity_mesh';

// FORK: the camera-distance rings for carve interiors (SPACEY, 2026-09-12:
// "make the lod at 100 yds super low, 20x less polys at 100 yds; at 500 yds
// don't even render it"). A surface mesh's triangle count falls with the
// square of its cell, so x4 at 100 yd is about 16x fewer triangles and the
// 2-yd floor makes sure a finely dug cave gets there too.

describe('cavityLodCell (render/cut_cavity_mesh.ts)', () => {
  it('keeps the requested cell inside the first ring', () => {
    expect(cavityLodCell(1, 0)).toBe(1);
    expect(cavityLodCell(0.25, 39.9)).toBe(0.25);
  });
  it('doubles to 100 yd, quadruples with a 2 yd floor to 200, x8 with a 4 yd floor to 500', () => {
    expect(cavityLodCell(1, 40)).toBe(2);
    expect(cavityLodCell(1, 99.9)).toBe(2);
    expect(cavityLodCell(1, 100)).toBe(4);
    expect(cavityLodCell(1, 199.9)).toBe(4);
    expect(cavityLodCell(1, 200)).toBe(8);
    expect(cavityLodCell(1, 499.9)).toBe(8);
    // a quarter-yard dig still reaches the floors
    expect(cavityLodCell(0.25, 100)).toBe(2);
    expect(cavityLodCell(0.25, 300)).toBe(4);
    expect(cavityLodCell(0.5, 150)).toBe(2);
    // the coarsest step caps the far ring
    expect(cavityLodCell(4, 300)).toBe(8);
  });
  it('is not meshed at all past the last ring', () => {
    expect(CAVITY_LOD_CULL).toBe(500);
    expect(cavityLodCell(1, 500)).toBeNull();
    expect(cavityLodCell(0.25, 5000)).toBeNull();
  });
  it('rings are ordered and every ring cell divides a 16 yd tile', () => {
    let prev = 0;
    for (const r of CAVITY_LOD_RINGS) {
      expect(r.dist).toBeGreaterThan(prev);
      prev = r.dist;
      for (const base of [0.25, 0.5, 1, 2]) {
        const c = cavityLodCell(base, r.dist - 0.01);
        expect(c).not.toBeNull();
        expect(16 / (c as number)).toBe(Math.round(16 / (c as number)));
      }
    }
  });
});
