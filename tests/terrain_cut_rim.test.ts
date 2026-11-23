import { describe, expect, it } from 'vitest';
import {
  beginChunkGeometry,
  buildChunkCutFine,
  buildChunkCutRim,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from '../src/render/terrain_chunk_build';
import { buildCutRim, type CutRimInput } from '../src/render/terrain_cut_rim_core';
import { meshTerrainHeight } from '../src/render/terrain_mesh_height';
import { cutsSdfAt, inTerrainCut } from '../src/sim/terrain_cuts';
import type { TerrainCut } from '../src/sim/types';

// The rim band: marching squares over a chunk grid, extruded into a sunken lip
// plus a vertical wall. Pure arithmetic, so this pins the geometry directly.

const FLAT_Y = 20;

/** A grid centred on the origin, 40 yards square at 2-yard cells. */
function gridOver(cuts: readonly TerrainCut[], extra: Partial<CutRimInput> = {}): CutRimInput {
  return {
    x0: -20,
    z0: -20,
    nx: 20,
    nz: 20,
    stepX: 2,
    stepZ: 2,
    depth: 6,
    heightAt: () => FLAT_Y,
    fieldAt: (x, z) => cutsSdfAt(cuts, x, FLAT_Y, z),
    ...extra,
  };
}

const sphere = (x: number, z: number, radius: number): TerrainCut => ({
  x,
  y: FLAT_Y,
  z,
  radius,
});

describe('cut rim band (render/terrain_cut_rim_core.ts)', () => {
  it('is null when the grid never crosses a contour', () => {
    // No cut at all.
    expect(buildCutRim(gridOver([]))).toBeNull();
    // A cut far away: every corner outside.
    expect(buildCutRim(gridOver([sphere(500, 500, 5)]))).toBeNull();
    // A cut swallowing the whole grid: every corner inside.
    expect(buildCutRim(gridOver([sphere(0, 0, 400)]))).toBeNull();
  });

  it('rings a circular opening with lip and wall quads', () => {
    const rim = buildCutRim(gridOver([sphere(0, 0, 8)]));
    expect(rim).not.toBeNull();
    if (!rim) return;
    const verts = rim.positions.length / 3;
    // Two quads (8 vertices, 12 indices) per contour segment.
    expect(verts % 8).toBe(0);
    expect(rim.indices.length).toBe((verts / 8) * 12);
    expect(rim.normals.length).toBe(rim.positions.length);
    expect(rim.uvs.length).toBe(verts * 2);
    // Every index addresses a real vertex.
    for (const i of rim.indices) expect(i).toBeLessThan(verts);
    // The contour is the circle: every wall vertex sits near radius 8.
    for (let v = 0; v < verts; v++) {
      const isLipOuter = v % 8 === 0 || v % 8 === 3;
      if (isLipOuter) continue;
      const r = Math.hypot(rim.positions[v * 3], rim.positions[v * 3 + 2]);
      expect(r).toBeGreaterThan(6.5);
      expect(r).toBeLessThan(9.5);
    }
  });

  it('the wall hangs exactly `depth` below the surface, the lip sits just under it', () => {
    const rim = buildCutRim(gridOver([sphere(0, 0, 8)], { depth: 5 }));
    if (!rim) throw new Error('expected a rim');
    const ys = Array.from({ length: rim.positions.length / 3 }, (_, v) => rim.positions[v * 3 + 1]);
    const top = Math.max(...ys);
    const bottom = Math.min(...ys);
    // Nothing pokes above the ground: the lip is sunk so it hides under any
    // ground quad that survived the cut instead of z-fighting with it.
    expect(top).toBeLessThan(FLAT_Y);
    expect(top).toBeGreaterThan(FLAT_Y - 0.2);
    expect(top - bottom).toBeCloseTo(5, 4); // Float32 storage
  });

  it('wall normals point INTO the opening, lip normals point up', () => {
    const rim = buildCutRim(gridOver([sphere(0, 0, 8)]));
    if (!rim) throw new Error('expected a rim');
    const verts = rim.positions.length / 3;
    for (let v = 0; v < verts; v++) {
      const nx = rim.normals[v * 3];
      const ny = rim.normals[v * 3 + 1];
      const nz = rim.normals[v * 3 + 2];
      if (v % 8 < 4) {
        expect(ny).toBe(1); // lip
        continue;
      }
      // Wall: horizontal, unit length, and aimed back at the opening's axis.
      expect(ny).toBe(0);
      expect(Math.hypot(nx, nz)).toBeCloseTo(1, 6);
      const px = rim.positions[v * 3];
      const pz = rim.positions[v * 3 + 2];
      const outward = Math.hypot(px, pz);
      if (outward < 1e-6) continue;
      // Dot with the outward radial direction must be negative.
      expect((nx * px + nz * pz) / outward).toBeLessThan(0);
    }
  });

  it('the lip flares outward far enough to cover a dropped quad', () => {
    const cell = 2;
    const rim = buildCutRim(gridOver([sphere(0, 0, 8)]));
    if (!rim) throw new Error('expected a rim');
    for (let seg = 0; seg * 8 < rim.positions.length / 3; seg++) {
      const base = seg * 8;
      const outer = base; // lip outer, p side
      const inner = base + 1; // lip inner, p side
      const rOuter = Math.hypot(rim.positions[outer * 3], rim.positions[outer * 3 + 2]);
      const rInner = Math.hypot(rim.positions[inner * 3], rim.positions[inner * 3 + 2]);
      // The lip reaches outward by one cell, which is twice the half-cell of
      // ragged edge the mesher's whole-quad drop test can leave behind.
      expect(rOuter - rInner).toBeGreaterThan(cell * 0.9);
    }
  });

  it('follows the surface: a sloped ground gives a sloped rim', () => {
    const slope = (x: number): number => FLAT_Y + x * 0.5;
    const rim = buildCutRim(
      gridOver([], {
        heightAt: (x) => slope(x),
        fieldAt: (x, z) => cutsSdfAt([{ x: 0, y: 0, z: 0, radius: 8 }], x, 0, z),
      }),
    );
    if (!rim) throw new Error('expected a rim');
    const verts = rim.positions.length / 3;
    for (let v = 0; v < verts; v++) {
      const px = rim.positions[v * 3];
      const py = rim.positions[v * 3 + 1];
      // Every vertex is either on the surface (minus the sink) or one depth
      // below it, never floating free of the ground it cuts.
      const onTop = Math.abs(py - slope(px)) < 0.2;
      const onBottom = Math.abs(py - (slope(px) - 6)) < 0.2;
      expect(onTop || onBottom).toBe(true);
    }
  });

  it('a rim per opening: two separate cuts each get their own band', () => {
    const one = buildCutRim(gridOver([sphere(-9, 0, 4)]));
    const two = buildCutRim(gridOver([sphere(-9, 0, 4), sphere(9, 0, 4)]));
    if (!one || !two) throw new Error('expected both rims');
    expect(two.positions.length).toBeGreaterThan(one.positions.length * 1.5);
  });
});

describe('the chunk mesher honours the same cuts', () => {
  const SEED = 20061;
  const X0 = 0;
  const Z0 = 40;
  const SIZE = 64;
  const SPACING = 4;

  function meshWith(cuts: readonly TerrainCut[] | null) {
    const state = beginChunkGeometry(
      X0,
      Z0,
      SIZE,
      SPACING,
      SEED,
      true,
      SPACING,
      false,
      cuts ? { cuts } : null,
    );
    for (let row = 0; row < state.gh; row++) fillChunkVertexRow(state, row);
    for (let row = 0; row < state.gh - 1; row++) fillChunkIndexRow(state, row);
    return state;
  }

  /** A quad whose six indices are all the same vertex is a dropped cell. */
  function droppedCells(indices: Uint16Array): number {
    let dropped = 0;
    for (let k = 0; k + 5 < indices.length; k += 6) {
      const a = indices[k];
      if (
        indices[k + 1] === a &&
        indices[k + 2] === a &&
        indices[k + 3] === a &&
        indices[k + 4] === a &&
        indices[k + 5] === a
      ) {
        dropped++;
      }
    }
    return dropped;
  }

  it('a map with no cuts meshes byte-identically to before', () => {
    const plain = meshWith(null);
    const empty = meshWith([]);
    expect(empty.cutSet).toBeNull();
    expect(Array.from(empty.indices)).toEqual(Array.from(plain.indices));
    expect(droppedCells(plain.indices)).toBe(0);
    expect(buildChunkCutRim(plain)).toBeNull();
  });

  it('drops the quads inside a cut and clips the contour cells fine', () => {
    const centre = { x: X0 + SIZE / 2, z: Z0 + SIZE / 2 };
    const cut: TerrainCut = {
      x: centre.x,
      y: meshTerrainHeight(centre.x, centre.z, SEED),
      z: centre.z,
      radius: 12,
    };
    const state = meshWith([cut]);
    expect(droppedCells(state.indices)).toBeGreaterThan(0);
    // The fine-clip contract: every interior cell whose centre is inside the
    // solid is dropped (fully-inside cells vanish, contour cells are dropped
    // here and re-tessellated clipped), and no cell far outside the cut's
    // reach ever drops.
    const quadsX = state.gw - 1;
    for (let k = 0; k + 5 < state.indices.length; k += 6) {
      const a = state.indices[k];
      const dropped = state.indices[k + 5] === a && state.indices[k + 1] === a;
      const gi = a % state.gw;
      const gj = Math.floor(a / state.gw);
      if (gi >= quadsX) continue;
      const d = a + state.gw + 1;
      if (d * 3 + 2 >= state.positions.length) continue;
      const cx = (state.positions[a * 3] + state.positions[d * 3]) / 2;
      const cz = (state.positions[a * 3 + 2] + state.positions[d * 3 + 2]) / 2;
      const cy =
        (state.positions[a * 3 + 1] +
          state.positions[(a + 1) * 3 + 1] +
          state.positions[(a + state.gw) * 3 + 1] +
          state.positions[d * 3 + 1]) /
        4;
      // Skip the skirt ring: its vertices carry a deliberate downward drop.
      if (gj === 0 || gj >= state.gh - 2) continue;
      if (inTerrainCut([cut], cx, cz, cy)) expect(dropped).toBe(true);
      // A cell whose centre is further from the solid than a whole cell
      // diagonal cannot touch the contour and must survive.
      const clear = Math.hypot(cx - cut.x, cz - cut.z) > cut.radius + Math.SQRT2 * SPACING;
      if (clear) expect(dropped).toBe(false);
    }
    const fine = buildChunkCutFine(state);
    expect(fine.rim).not.toBeNull();
    expect((fine.rim?.positions.length ?? 0) / 3).toBeGreaterThan(0);
    // The clipped patch exists and every vertex of it sits ON the chord
    // surface of its cell and OUTSIDE the solid (that is what "clipped to the
    // contour" means).
    expect(fine.clip).not.toBeNull();
    const clip = fine.clip;
    if (!clip) throw new Error('expected a clip patch');
    for (let v = 0; v < clip.positions.length / 3; v++) {
      const px = clip.positions[v * 3];
      const py = clip.positions[v * 3 + 1];
      const pz = clip.positions[v * 3 + 2];
      const dist = Math.hypot(px - cut.x, py - cut.y, pz - cut.z);
      // Crossings are solved on the linearized field between fine samples, so
      // a vertex can land a few millimetres inside the true sphere, against
      // the WHOLE-CELL (half of 4yd) raggedness this replaces.
      expect(dist).toBeGreaterThanOrEqual(cut.radius - 0.05);
    }
  });

  it('a patch puts the ground back, quads and rim alike', () => {
    const centre = { x: X0 + SIZE / 2, z: Z0 + SIZE / 2 };
    const y = meshTerrainHeight(centre.x, centre.z, SEED);
    const cut: TerrainCut = { x: centre.x, y, z: centre.z, radius: 12 };
    const patch: TerrainCut = { x: centre.x, y, z: centre.z, radius: 40 };
    const open = meshWith([cut]);
    const state = beginChunkGeometry(X0, Z0, SIZE, SPACING, SEED, true, SPACING, false, {
      cuts: [cut],
      patches: [patch],
    });
    for (let row = 0; row < state.gh; row++) fillChunkVertexRow(state, row);
    for (let row = 0; row < state.gh - 1; row++) fillChunkIndexRow(state, row);
    expect(droppedCells(open.indices)).toBeGreaterThan(0);
    expect(droppedCells(state.indices)).toBe(0);
    expect(buildChunkCutRim(state)).toBeNull();
    const fine = buildChunkCutFine(state);
    expect(fine.rim).toBeNull();
    expect(fine.clip).toBeNull();
  });
});
