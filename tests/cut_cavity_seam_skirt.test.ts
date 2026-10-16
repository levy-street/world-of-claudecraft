// The tile-seam skirt (render/cut_cavity_core.ts SEAM_SKIRT): a wall that
// crosses a tile face drags a flange back into the rock, in the face plane, so
// a neighbour standing at another LOD for a few frames never opens a slot of
// daylight between the two border polylines (SPACEY, 2026-09-19: "make sure the
// cave has no gaps when moving through").

import { describe, expect, it } from 'vitest';
import { buildCavityMesh } from '../src/render/cut_cavity_core';
import { carveFieldAt } from '../src/sim/terrain_cuts';
import type { TerrainCut } from '../src/sim/types';

// A buried tunnel-sized sphere cut in half by the tile's +x face.
const BORE: TerrainCut = { x: 8, y: -20, z: 4, radius: 3, carve: true };
const input = (x0: number) => ({
  x0,
  y0: -24,
  z0: 0,
  cell: 0.5,
  nx: 16,
  ny: 16,
  nz: 16,
  fieldAt: (x: number, y: number, z: number): number => carveFieldAt([BORE], undefined, x, y, z),
  heightAt: () => 0,
});

describe('tile-seam skirt', () => {
  it('extends every border edge into the rock inside the face plane', () => {
    const m = buildCavityMesh(input(0));
    expect(m).not.toBeNull();
    const mesh = m!;
    const start = mesh.collarVertexStart ?? mesh.positions.length / 3;
    const total = mesh.positions.length / 3;
    expect(total).toBeGreaterThan(start);
    let onFace = 0;
    for (let v = start; v < total; v++) {
      const x = mesh.positions[v * 3];
      const y = mesh.positions[v * 3 + 1];
      const z = mesh.positions[v * 3 + 2];
      expect(x).toBeCloseTo(8, 4); // stays in the +x face plane
      // ...and sits in the rock: outside the bore
      expect(Math.hypot(y + 20, z - 4)).toBeGreaterThan(3);
      onFace++;
    }
    expect(onFace).toBeGreaterThan(8);
  });

  it('adds nothing to a cavity that stays inside its tile', () => {
    const inner: TerrainCut = { x: 4, y: -20, z: 4, radius: 2, carve: true };
    const mesh = buildCavityMesh({
      ...input(0),
      fieldAt: (x, y, z) => carveFieldAt([inner], undefined, x, y, z),
    })!;
    expect(mesh.collarVertexStart ?? mesh.positions.length / 3).toBe(mesh.positions.length / 3);
  });
});
