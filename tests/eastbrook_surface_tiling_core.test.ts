// The Eastbrook surface atlas's world-scale tiling core
// (src/render/eastbrook_surface_tiling_core.ts). Pinned here:
//  - the cell layout (the usable square inside each cell's 4px padding) and
//    its inverse, so the old bounding-box synthesis and the tiling agree;
//  - the per-cell repeat sizes, and that they are denser than the old
//    one-cell-per-mesh mapping on the shipped placements;
//  - every clipped piece lies inside ONE repeat: its UVs stay in the cell's
//    usable square, the clip conserves area and winding, and the UV rate is
//    exactly the repeat size (yards per repeat), across grid lines;
//  - the three mappings (grid, island with its per-axis fallback, fit), the
//    quad merge, the grime-band height split, and determinism.
import { describe, expect, it } from 'vitest';
import { EASTBROOK_SURFACE_CELLS } from '../src/render/eastbrook_surface_atlas';
import {
  EASTBROOK_ATLAS_CELL_USABLE_UV,
  EASTBROOK_SURFACE_REPEAT_YARDS,
  eastbrookAtlasCellOfUv,
  eastbrookAtlasCellRect,
  eastbrookFaceFrame,
  HEIGHT_SPLIT_MIN_SPAN,
  ISLAND_SQUEEZE_LIMIT,
  type SurfaceTileMode,
  tileEastbrookSurface,
} from '../src/render/eastbrook_surface_tiling_core';

/** A flat quad as two triangles (a box face's winding), with a normal. */
function quad(
  origin: [number, number, number],
  along: [number, number, number],
  up: [number, number, number],
): { positions: number[]; normals: number[] } {
  const p = (u: number, v: number) => [
    origin[0] + along[0] * u + up[0] * v,
    origin[1] + along[1] * u + up[1] * v,
    origin[2] + along[2] * u + up[2] * v,
  ];
  const a = p(0, 0);
  const b = p(1, 0);
  const c = p(1, 1);
  const d = p(0, 1);
  const nx = along[1] * up[2] - along[2] * up[1];
  const ny = along[2] * up[0] - along[0] * up[2];
  const nz = along[0] * up[1] - along[1] * up[0];
  const length = Math.hypot(nx, ny, nz);
  const n = [nx / length, ny / length, nz / length];
  return {
    positions: [...a, ...b, ...d, ...b, ...c, ...d],
    normals: [...n, ...n, ...n, ...n, ...n, ...n],
  };
}

function triangleArea(positions: ArrayLike<number>, triangle: number): number {
  const o = triangle * 9;
  const e1 = [
    positions[o + 3] - positions[o],
    positions[o + 4] - positions[o + 1],
    positions[o + 5] - positions[o + 2],
  ];
  const e2 = [
    positions[o + 6] - positions[o],
    positions[o + 7] - positions[o + 1],
    positions[o + 8] - positions[o + 2],
  ];
  return (
    0.5 *
    Math.hypot(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    )
  );
}

function totalArea(positions: ArrayLike<number>): number {
  let area = 0;
  for (let triangle = 0; triangle < positions.length / 9; triangle++) {
    area += triangleArea(positions, triangle);
  }
  return area;
}

function tile(
  shape: { positions: number[]; normals: number[] },
  cell: number,
  mode: SurfaceTileMode = 'grid',
  heightSplits: number[] = [],
) {
  return tileEastbrookSurface({
    positions: shape.positions,
    normals: shape.normals,
    colors: null,
    cellOfTriangle: () => cell,
    modeOfTriangle: () => mode,
    heightSplits,
  });
}

describe('atlas cell layout', () => {
  it('addresses the usable square inside each 128px cell, row-major from the top-left', () => {
    expect(EASTBROOK_ATLAS_CELL_USABLE_UV).toBeCloseTo(120 / 512, 12);
    expect(eastbrookAtlasCellRect(0)).toEqual({ u0: 4 / 512, v0: 0.75 + 4 / 512, size: 120 / 512 });
    expect(eastbrookAtlasCellRect(15)).toEqual({
      u0: 0.75 + 4 / 512,
      v0: 4 / 512,
      size: 120 / 512,
    });
    for (let cell = 0; cell < 16; cell++) {
      const rect = eastbrookAtlasCellRect(cell);
      // every corner and the centre map back to the same cell
      for (const [fu, fv] of [
        [0, 0],
        [1, 1],
        [0.5, 0.5],
        [0, 1],
      ]) {
        expect(eastbrookAtlasCellOfUv(rect.u0 + fu * rect.size, rect.v0 + fv * rect.size)).toBe(
          cell,
        );
      }
    }
  });

  it('sizes a repeat per cell so features read at a believable size', () => {
    expect(EASTBROOK_SURFACE_REPEAT_YARDS).toHaveLength(
      Object.keys(EASTBROOK_SURFACE_CELLS).length,
    );
    const repeat = (name: keyof typeof EASTBROOK_SURFACE_CELLS) =>
      EASTBROOK_SURFACE_REPEAT_YARDS[EASTBROOK_SURFACE_CELLS[name]];
    expect(repeat('darkStoneBlocks')).toEqual([1.6, 1.6]);
    expect(repeat('lightStoneBlocks')).toEqual([1.8, 1.8]);
    expect(repeat('warmPlaster')).toEqual([2.0, 2.0]);
    expect(repeat('verticalDarkTimber')).toEqual([1.25, 2.0]);
    expect(repeat('cobaltRoofShingles')).toEqual([1.5, 1.5]);
    expect(repeat('darkForgedMetal')).toEqual([1.0, 1.0]);
    expect(repeat('warmGoldMetal')).toEqual([1.0, 1.0]);
    expect(repeat('horizontalWarmTimber')).toEqual([2.0, 1.25]);
    expect(repeat('blueCreamCanvas')).toEqual([1.2, 1.2]);
    expect(repeat('redCreamCanvas')).toEqual([1.4, 1.4]);
    expect(repeat('darkBrownLeather')).toEqual([1.2, 1.2]);
    expect(repeat('irregularDarkStone')).toEqual([1.6, 1.6]);
    expect(repeat('cyanCrystal')).toEqual([1.2, 1.2]);
    expect(repeat('cobaltPaintedPlanks')).toEqual([2.0, 1.2]);
    expect(repeat('lightGrayStone')).toEqual([2.0, 2.0]);
    expect(repeat('mediumGrayStone')).toEqual([2.0, 2.0]);
    // The old mapping put ONE repeat across a whole mesh: 2.8 yd across the
    // market stall, 1.8 to 9.4 yd along a fence. Every cell the stall wears
    // (canvas, timber, metal) now repeats at least 1.4x as often on it, its
    // canvas stripes 2.3x.
    for (const name of [
      'blueCreamCanvas',
      'redCreamCanvas',
      'verticalDarkTimber',
      'horizontalWarmTimber',
      'darkForgedMetal',
    ] as const) {
      expect(2.8 / Math.max(...repeat(name)), name).toBeGreaterThanOrEqual(1.4);
    }
    expect(2.8 / repeat('blueCreamCanvas')[0]).toBeGreaterThan(2.3);
  });
});

describe('face frames', () => {
  it('reads every face from outside: right x up is the face normal, v runs up walls and roofs', () => {
    const normals: [number, number, number][] = [
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, Math.SQRT1_2, Math.SQRT1_2],
      [-0.5, Math.sqrt(0.75), 0],
      [0.3, 0.2, Math.sqrt(1 - 0.13)],
    ];
    for (const n of normals) {
      const { right, up } = eastbrookFaceFrame(...n);
      expect(Math.hypot(...right), `${n}`).toBeCloseTo(1, 12);
      expect(Math.hypot(...up), `${n}`).toBeCloseTo(1, 12);
      const cross = [
        right[1] * up[2] - right[2] * up[1],
        right[2] * up[0] - right[0] * up[2],
        right[0] * up[1] - right[1] * up[0],
      ];
      // the frame faces out of the face (never a mirrored projection)
      expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2], `${n}`).toBeGreaterThan(0.9);
    }
    // walls: v is world up exactly; a roof slope: v climbs the slope
    expect(eastbrookFaceFrame(0, 0, 1).up).toEqual([0, 1, 0]);
    expect(eastbrookFaceFrame(1, 0, 0).up).toEqual([0, 1, 0]);
    expect(eastbrookFaceFrame(0, Math.SQRT1_2, Math.SQRT1_2).up[1]).toBeGreaterThan(0.7);
    expect(eastbrookFaceFrame(0, Math.SQRT1_2, Math.SQRT1_2).right[1]).toBe(0);
  });
});

describe('grid tiling', () => {
  const shingles = EASTBROOK_SURFACE_CELLS.cobaltRoofShingles;
  const [repeatU, repeatV] = EASTBROOK_SURFACE_REPEAT_YARDS[shingles];

  it('clips a wall into pieces that each lie inside one repeat of its cell', () => {
    // a 5 x 3.2 yard wall facing +z, starting off the grid
    const wall = quad([0.3, 0.1, 2], [5, 0, 0], [0, 3.2, 0]);
    const out = tile(wall, shingles);
    const rect = eastbrookAtlasCellRect(shingles);
    expect(out.triangleCount).toBeGreaterThan(2);
    // area conserved by the clip
    expect(totalArea(out.positions)).toBeCloseTo(5 * 3.2, 6);
    for (let index = 0; index < out.uvs.length / 2; index++) {
      expect(out.uvs[index * 2]).toBeGreaterThanOrEqual(rect.u0 - 1e-9);
      expect(out.uvs[index * 2]).toBeLessThanOrEqual(rect.u0 + rect.size + 1e-9);
      expect(out.uvs[index * 2 + 1]).toBeGreaterThanOrEqual(rect.v0 - 1e-9);
      expect(out.uvs[index * 2 + 1]).toBeLessThanOrEqual(rect.v0 + rect.size + 1e-9);
    }
    // the UV rate is the repeat size: one cell width per repeatU yards along
    // x, one cell height per repeatV yards up y, inside every piece
    for (let triangle = 0; triangle < out.triangleCount; triangle++) {
      const o = triangle * 3;
      const x0 = out.positions[o * 3];
      const y0 = out.positions[o * 3 + 1];
      for (const k of [1, 2]) {
        const dx = out.positions[(o + k) * 3] - x0;
        const dy = out.positions[(o + k) * 3 + 1] - y0;
        const du = out.uvs[(o + k) * 2] - out.uvs[o * 2];
        const dv = out.uvs[(o + k) * 2 + 1] - out.uvs[o * 2 + 1];
        // float32 outputs: six places is the attribute's own precision here
        expect(du).toBeCloseTo((dx / repeatU) * rect.size, 6);
        expect(dv).toBeCloseTo((dy / repeatV) * rect.size, 6);
      }
    }
  });

  it('keeps the winding and the face plane of every piece', () => {
    const wall = quad([0, 0, 0], [4, 0, 0], [0, 4, 0]);
    const out = tile(wall, shingles);
    for (let triangle = 0; triangle < out.triangleCount; triangle++) {
      const o = triangle * 9;
      const p = out.positions;
      const nz =
        (p[o + 3] - p[o]) * (p[o + 7] - p[o + 1]) - (p[o + 4] - p[o + 1]) * (p[o + 6] - p[o]);
      expect(nz).toBeGreaterThan(0);
      expect(p[o + 2]).toBe(0);
    }
  });

  it('clips the two halves of a quad as one polygon', () => {
    // 3 x 3 repeats exactly on the grid: nine cells, two triangles each
    const wall = quad([0, 0, 0], [3 * repeatU, 0, 0], [0, 3 * repeatV, 0]);
    expect(tile(wall, shingles).triangleCount).toBe(18);
  });

  it('meets on the world grid, so a pattern runs on across neighbouring faces', () => {
    // two coplanar walls side by side: the shared edge maps to one UV
    const left = quad([0, 0, 0], [2.2, 0, 0], [0, 1, 0]);
    const right = quad([2.2, 0, 0], [2.2, 0, 0], [0, 1, 0]);
    const out = tile(
      {
        positions: [...left.positions, ...right.positions],
        normals: [...left.normals, ...right.normals],
      },
      shingles,
    );
    const uvAt = new Map<string, string>();
    for (let index = 0; index < out.positions.length / 3; index++) {
      const key = `${out.positions[index * 3].toFixed(5)},${out.positions[index * 3 + 1].toFixed(5)}`;
      const uv = `${out.uvs[index * 2].toFixed(6)},${out.uvs[index * 2 + 1].toFixed(6)}`;
      if (Math.abs(out.positions[index * 3] - 2.2) > 1e-6) continue;
      expect(uvAt.get(key) ?? uv).toBe(uv);
      uvAt.set(key, uv);
    }
    expect(uvAt.size).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const wall = quad([0.37, 0.2, 1], [3.3, 0.4, 0], [0, 2.9, 0.2]);
    const a = tile(wall, shingles);
    const b = tile(wall, shingles);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.uvs)).toEqual(Array.from(b.uvs));
  });
});

describe('island and fit mappings', () => {
  const granite = EASTBROOK_SURFACE_CELLS.mediumGrayStone;
  const repeat = EASTBROOK_SURFACE_REPEAT_YARDS[granite][0];

  it('keeps a block smaller than a repeat whole, on its own patch of the cell', () => {
    const blockA = quad([0, 0, 0], [0.9, 0, 0], [0, 0.6, 0]);
    const blockB = quad([4, 3, 0], [0.9, 0, 0], [0, 0.6, 0]);
    const a = tile(blockA, granite, 'island');
    const b = tile(blockB, granite, 'island');
    expect(a.triangleCount).toBe(2);
    expect(b.triangleCount).toBe(2);
    const rect = eastbrookAtlasCellRect(granite);
    for (const out of [a, b]) {
      for (const value of out.uvs) expect(value).toBeGreaterThan(0);
      for (let index = 0; index < out.uvs.length / 2; index++) {
        expect(out.uvs[index * 2]).toBeGreaterThanOrEqual(rect.u0 - 1e-9);
        expect(out.uvs[index * 2]).toBeLessThanOrEqual(rect.u0 + rect.size + 1e-9);
      }
    }
    // two blocks in different places take different patches
    expect(Array.from(a.uvs)).not.toEqual(Array.from(b.uvs));
  });

  it('squeezes a face a little over one repeat instead of clipping it', () => {
    const block = quad([0, 0, 0], [repeat * 1.2, 0, 0], [0, 0.7, 0]);
    expect(tile(block, granite, 'island').triangleCount).toBe(2);
    const long = quad([0, 0, 0], [repeat * (ISLAND_SQUEEZE_LIMIT + 0.5), 0, 0], [0, 0.7, 0]);
    expect(tile(long, granite, 'island').triangleCount).toBeGreaterThan(2);
  });

  it('grids only the axis that runs past the squeeze limit', () => {
    // a narrow tall face: one column of the cell, tiled up its height
    const column = quad([0.1, 0, 0], [0.6, 0, 0], [0, 5 * repeat, 0]);
    const out = tile(column, granite, 'island');
    expect(out.triangleCount).toBeGreaterThanOrEqual(10);
    expect(out.triangleCount).toBeLessThanOrEqual(14);
    // every u is the column's own island patch (no vertical cut)
    const us = new Set<string>();
    for (let index = 0; index < out.uvs.length / 2; index++) us.add(out.uvs[index * 2].toFixed(6));
    expect(us.size).toBe(2);
  });

  it('fits one stretched repeat over a hidden face, with no clip', () => {
    const core = quad([0, 0, 0], [13.5, 0, 0], [0, 7.8, 0]);
    const out = tile(core, granite, 'fit');
    expect(out.triangleCount).toBe(2);
    const rect = eastbrookAtlasCellRect(granite);
    const us = Array.from({ length: out.uvs.length / 2 }, (_, index) => out.uvs[index * 2]);
    expect(Math.min(...us)).toBeCloseTo(rect.u0, 9);
    expect(Math.max(...us)).toBeCloseTo(rect.u0 + rect.size, 9);
  });

  it('shades each island block by a bounded seeded value, the same on both halves', () => {
    const block = quad([2, 1, 0], [0.9, 0, 0], [0, 0.6, 0]);
    const out = tileEastbrookSurface({
      positions: block.positions,
      normals: block.normals,
      colors: new Array(18).fill(0.5),
      cellOfTriangle: () => granite,
      modeOfTriangle: () => 'island',
      islandValueSpread: 0.06,
    });
    const colors = out.colors ?? new Float32Array();
    const first = colors[0];
    expect(first).toBeGreaterThanOrEqual(0.5 * 0.94 - 1e-6);
    expect(first).toBeLessThanOrEqual(0.5 * 1.06 + 1e-6);
    for (const value of colors) expect(value).toBeCloseTo(first, 6);
  });
});

describe('grime band split', () => {
  const granite = EASTBROOK_SURFACE_CELLS.mediumGrayStone;

  it('gives a tall face a vertex row at the split height, and leaves a short one alone', () => {
    const tall = quad([0, 0, 0], [0.8, 0, 0], [0, 1.5, 0]);
    const out = tile(tall, granite, 'island', [0.8]);
    const ys = new Set<string>();
    for (let index = 0; index < out.positions.length / 3; index++) {
      ys.add(out.positions[index * 3 + 1].toFixed(6));
    }
    expect(ys.has('0.800000')).toBe(true);
    const short = quad([0, 0.5, 0], [0.8, 0, 0], [0, HEIGHT_SPLIT_MIN_SPAN - 0.1, 0]);
    expect(tile(short, granite, 'island', [0.8]).triangleCount).toBe(2);
  });
});
