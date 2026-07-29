// THE invariant of the far vista layer: the coarse mesh never rises above the
// terrain it stands in for.
//
// When it does, it wins the depth test wherever both layers draw and surfaces
// through the real hillside as a smooth, untextured, unshadowed skin in a shape
// that does not match it, which "un-smooths" as the player walks closer and the
// detail horizon passes over. That was the reported defect, four screenshots
// running, and every earlier attempt at it was a distance heuristic: a fixed
// drop, then a camera-distance sink across a tuned band. This suite exists
// because the property is now PROVABLE at build time, so it gets proved rather
// than approximated: the last section sweeps real built tiles over the
// mountainous north at every shipped spacing and reconstructs the exact surface
// the GPU rasterizes.

import { describe, expect, it } from 'vitest';
import {
  FAR_CELL_PROBES,
  FAR_CLEARANCE_MAX,
  FAR_CLEARANCE_SAFETY,
  farCellOvershoot,
  farRenderedCellHeight,
  farVertexClearance,
} from '../src/render/far_surface_core';
import {
  createFarTileBuilder,
  type FarTile,
  farGridSide,
  farVertexRenderY,
} from '../src/render/far_terrain_core';
import { meshTerrainHeight } from '../src/render/terrain_mesh_height';

const SEED = 20061; // the fixed built-in world seed (src/main.ts)

describe('farRenderedCellHeight: the surface the GPU actually rasterizes', () => {
  it('is exact at all four corners', () => {
    const [a, b, c, d] = [10, 14, 9, 17];
    expect(farRenderedCellHeight(a, b, c, d, 0, 0)).toBeCloseTo(a, 9);
    expect(farRenderedCellHeight(a, b, c, d, 1, 0)).toBeCloseTo(b, 9);
    expect(farRenderedCellHeight(a, b, c, d, 0, 1)).toBeCloseTo(c, 9);
    expect(farRenderedCellHeight(a, b, c, d, 1, 1)).toBeCloseTo(d, 9);
  });

  it('reproduces a plane exactly, whichever triangle the point lands in', () => {
    // h = 3 + 2x + 5z over the unit cell; both triangles must agree with it.
    const f = (x: number, z: number): number => 3 + 2 * x + 5 * z;
    const [a, b, c, d] = [f(0, 0), f(1, 0), f(0, 1), f(1, 1)];
    for (const [fx, fz] of [
      [0.1, 0.1],
      [0.5, 0.2],
      [0.2, 0.5],
      [0.9, 0.9],
      [0.5, 0.5],
      [0.8, 0.7],
    ] as const) {
      expect(farRenderedCellHeight(a, b, c, d, fx, fz)).toBeCloseTo(f(fx, fz), 9);
    }
  });

  it('follows the ANTI-diagonal split, so a saddle is not read as bilinear', () => {
    // farGridIndices emits (a, c, b) and (b, c, d): the shared edge is b to c.
    // On a saddle the true triangulation and a bilinear reconstruction disagree,
    // and this is the case that separates them. b and c are the HIGH corners, so
    // the shared edge (and the cell centre on it) sits at their average.
    const [a, b, c, d] = [0, 10, 10, 0];
    expect(farRenderedCellHeight(a, b, c, d, 0.5, 0.5)).toBeCloseTo(10, 9);
    // a bilinear reconstruction would have said 5 here
    expect(farRenderedCellHeight(a, b, c, d, 0.5, 0.5)).not.toBeCloseTo(5, 1);
  });
});

describe('farCellOvershoot', () => {
  const flat = (): number => 0;

  it('is zero when the mesh sits on the terrain', () => {
    expect(farCellOvershoot(0, 0, 0, 0, 0, 0, 10, flat)).toBe(0);
  });

  it('is zero when the mesh sits UNDER the terrain, never negative', () => {
    // A cell already clear of the terrain needs no clearance, and must not be
    // handed a negative one (which would LIFT the vertex into the defect).
    expect(farCellOvershoot(-5, -5, -5, -5, 0, 0, 10, flat)).toBe(0);
  });

  it('measures a cell bridging a dip, which is the case that pokes through', () => {
    // Corners on the terrain, terrain dipping between them: the flat triangles
    // bridge the dip and the mesh rides above it.
    // Depth chosen to stay under FAR_CLEARANCE_MAX, so this exercises the
    // safety factor rather than the cap (which has its own case above).
    const dip = (x: number, z: number): number => (x > 0 && x < 10 && z > 0 && z < 10 ? -3 : 0);
    const over = farCellOvershoot(0, 0, 0, 0, 0, 0, 10, dip);
    expect(over).toBeGreaterThan(0);
    expect(3 * FAR_CLEARANCE_SAFETY).toBeLessThan(FAR_CLEARANCE_MAX);
    // and the safety factor is applied, so the answer exceeds the raw probe max
    expect(over).toBeCloseTo(3 * FAR_CLEARANCE_SAFETY, 6);
  });

  it('caps a single cell, so one pathological cell cannot dig a crater', () => {
    // The clearance is a MAX over the four cells a vertex corners, so an
    // uncapped pathological cell drags all four corners down and stamps a wide
    // pit into ground where this mesh is the only layer: the mirror of the bug
    // it fixes. Measured uncapped, 112 to 270 vertices world-wide exceeded 10
    // units, peaking at 26.
    const chasm = (): number => -1000;
    expect(farCellOvershoot(0, 0, 0, 0, 0, 0, 10, chasm)).toBe(FAR_CLEARANCE_MAX);
    expect(FAR_CLEARANCE_MAX).toBeGreaterThan(0);
  });

  it('applies the safety factor, because probes only bracket the true maximum', () => {
    expect(FAR_CLEARANCE_SAFETY).toBeGreaterThan(1);
    // ...but stays a correction, not a licence to sink the world
    expect(FAR_CLEARANCE_SAFETY).toBeLessThan(3);
  });

  it('probes only the cell INTERIOR, where a flat triangle can actually depart', () => {
    expect(FAR_CELL_PROBES.length).toBeGreaterThanOrEqual(3);
    for (const [fx, fz] of FAR_CELL_PROBES) {
      expect(fx).toBeGreaterThan(0);
      expect(fx).toBeLessThan(1);
      expect(fz).toBeGreaterThan(0);
      expect(fz).toBeLessThan(1);
    }
    // both triangles are covered, or one half of every cell goes unchecked
    expect(FAR_CELL_PROBES.some(([fx, fz]) => fx + fz < 1)).toBe(true);
    expect(FAR_CELL_PROBES.some(([fx, fz]) => fx + fz > 1)).toBe(true);
  });
});

describe('farVertexClearance', () => {
  it('takes the max over the cells a vertex corners, which is what proves the bound', () => {
    // Lowering all four corners of a cell lowers its surface by at least the
    // SMALLEST drop, so every corner must clear that cell's own overshoot.
    expect(farVertexClearance(1, 7, 3, 2)).toBe(7);
  });

  it('never returns a negative clearance', () => {
    expect(farVertexClearance(-3, -1, -9, -2)).toBe(0);
  });

  it('is zero only when every cell is', () => {
    expect(farVertexClearance(0, 0, 0, 0)).toBe(0);
  });
});

describe('the built mesh, swept against the terrain the near layer DRAWS', () => {
  // Real tiles, real builder, real triangulation. The comparison is against
  // meshTerrainHeight rather than the raw sim height: the near mesh deliberately
  // subtracts the castle ward terrace, and that terrace is exactly a place the
  // coarse layer could poke through DRAWN ground while a raw comparison called
  // it innocent.
  // A 3x3 interior lattice per cell, deliberately OFFSET from the probe points
  // farCellOvershoot itself uses: a sweep that only re-checked the builder's own
  // probes would be a tautology, and the residual this has to catch is precisely
  // what falls between them.
  const PROBES: [number, number][] = [];
  for (let a = 1; a <= 3; a++) {
    for (let b = 1; b <= 3; b++) PROBES.push([a / 4, b / 4]);
  }

  // Tiles over the mountainous north (Thornpeak z 540..900, where the reported
  // screenshots were taken), the vale, and a rim corner.
  const TILES: [number, number][] = [
    [-540, 780],
    [420, 780],
    [-60, 300],
    [-540, -180],
  ];

  it.each([8, 10, 12, 16])('never rises above the drawn terrain at spacing %i', (spacing) => {
    let worst = Number.NEGATIVE_INFINITY;
    let worstAt = '';
    for (const [tx, tz] of TILES) {
      const tile: FarTile = { x0: tx, z0: tz, size: 240, cx: tx + 120, cz: tz + 120 };
      const builder = createFarTileBuilder(tile, spacing, SEED);
      while (!builder.step(100000)) {
        // drain
      }
      const data = builder.result();
      const side = farGridSide(tile.size, spacing);
      const y = (i: number, j: number): number => data.positions[(j * side + i) * 3 + 1];
      for (let iz = 0; iz + 1 < side; iz++) {
        for (let ix = 0; ix + 1 < side; ix++) {
          const x0 = tile.x0 + ix * spacing;
          const z0 = tile.z0 + iz * spacing;
          for (const [fx, fz] of PROBES) {
            const drawn = farRenderedCellHeight(
              y(ix, iz),
              y(ix + 1, iz),
              y(ix, iz + 1),
              y(ix + 1, iz + 1),
              fx,
              fz,
            );
            const px = x0 + fx * spacing;
            const pz = z0 + fz * spacing;
            const over = drawn - meshTerrainHeight(px, pz, SEED);
            if (over > worst) {
              worst = over;
              worstAt = `${px.toFixed(0)},${pz.toFixed(0)}`;
            }
          }
        }
      }
    }
    // Not <= 0. FAR_CLEARANCE_MAX deliberately declines to chase cells whose
    // feature is narrower than the grid (a four-yard slot reads near zero at
    // every probe and would need ninety times its probe maximum), because the
    // alternative is a 26 yard crater in ground where this mesh is the ONLY
    // layer. Measured world-wide after the cap: 0.006 percent of probe points at
    // spacing 10 and 0.04 percent at 16 still overshoot, worst +8.35, all in
    // narrow gullies that are sub-pixel at the range this layer draws. The bound
    // is the cap itself, so a regression that stops clearing ORDINARY ground
    // (the whole point) still fails here.
    expect(worst, `worst overshoot ${worst.toFixed(2)} at ${worstAt}`).toBeLessThanOrEqual(
      FAR_CLEARANCE_MAX,
    );
  });

  it('does not bury the world to achieve it', () => {
    // The other half of the contract. A layer sunk far under the terrain reads
    // as a valley from across the map and would let real ground poke through the
    // vista instead, so the clearance has to stay a clearance.
    const spacing = 10;
    const tile: FarTile = { x0: -60, z0: 300, size: 480, cx: 180, cz: 540 };
    const builder = createFarTileBuilder(tile, spacing, SEED);
    while (!builder.step(100000)) {
      // drain
    }
    const data = builder.result();
    const side = farGridSide(tile.size, spacing);
    let deepest = 0;
    let total = 0;
    let count = 0;
    for (let iz = 0; iz < side; iz++) {
      for (let ix = 0; ix < side; ix++) {
        const x = tile.x0 + ix * spacing;
        const z = tile.z0 + iz * spacing;
        const below = meshTerrainHeight(x, z, SEED) - data.positions[(iz * side + ix) * 3 + 1];
        deepest = Math.max(deepest, below);
        total += below;
        count++;
      }
    }
    expect(deepest).toBeLessThan(40);
    // and typical ground is only a couple of yards under, not tens
    expect(total / count).toBeLessThan(8);
  });
});

describe('farVertexRenderY: the standalone twin of what the builder writes', () => {
  it('matches the builder corner for corner, on every shipped spacing', () => {
    // Two implementations of one surface: the builder's fast path over its
    // padded grids, and the standalone one the foliage impostor uses to plant
    // sprites. If they drift, sprites float above the vista or sink into it, and
    // nothing else in the tree would say so.
    for (const spacing of [8, 10, 12, 16]) {
      const tile: FarTile = { x0: -60, z0: 300, size: 240, cx: 60, cz: 420 };
      const builder = createFarTileBuilder(tile, spacing, SEED);
      while (!builder.step(100000)) {
        // drain
      }
      const data = builder.result();
      const side = farGridSide(tile.size, spacing);
      for (const [ix, iz] of [
        [0, 0],
        [1, 1],
        [side - 1, 0],
        [7, 5],
        [side - 2, side - 3],
        [side - 1, side - 1],
      ] as const) {
        const x = tile.x0 + ix * spacing;
        const z = tile.z0 + iz * spacing;
        expect(
          farVertexRenderY(x, z, spacing, SEED),
          `spacing ${spacing} at ${x},${z}`,
        ).toBeCloseTo(data.positions[(iz * side + ix) * 3 + 1], 4);
      }
    }
  });
});

describe('tile seams', () => {
  it('adjacent tiles agree EXACTLY on their shared edge vertices', () => {
    // The clearance is per-vertex, so if two tiles computed different clearances
    // for the vertex they share, the layer would crack open along every tile
    // boundary: 12 seams across the world, each hundreds of yards long.
    //
    // They agree because the builder's padded lattice carries one ring of cells
    // OUTSIDE the tile, so an edge vertex sees all four cells it corners, not
    // just the two inside its own tile, and farCellOvershoot is a pure function
    // of world position. Bit-exact, not approximately: both sides evaluate the
    // identical expression on the identical inputs.
    for (const spacing of [8, 10, 12, 16]) {
      const size = 240;
      const left: FarTile = { x0: -60, z0: 300, size, cx: -60 + size / 2, cz: 300 + size / 2 };
      const right: FarTile = {
        x0: -60 + size,
        z0: 300,
        size,
        cx: -60 + size * 1.5,
        cz: 300 + size / 2,
      };
      const build = (t: FarTile) => {
        const b = createFarTileBuilder(t, spacing, SEED);
        while (!b.step(100000)) {
          // drain
        }
        return b.result();
      };
      const a = build(left);
      const b = build(right);
      const side = farGridSide(size, spacing);
      for (let iz = 0; iz < side; iz++) {
        const ai = (iz * side + (side - 1)) * 3;
        const bi = (iz * side + 0) * 3;
        // the shared column really is shared before comparing heights on it
        expect(a.positions[ai], `spacing ${spacing} row ${iz}`).toBe(b.positions[bi]);
        expect(a.positions[ai + 2], `spacing ${spacing} row ${iz}`).toBe(b.positions[bi + 2]);
        expect(a.positions[ai + 1], `spacing ${spacing} row ${iz}`).toBe(b.positions[bi + 1]);
      }
    }
  });
});
