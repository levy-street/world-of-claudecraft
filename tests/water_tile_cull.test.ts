import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildWaterSurfaceIndex,
  buildWaterSurfaceTileIndex,
  WATER_TILE_KEEP_ABOVE,
  waterSheetTilePlan,
} from '../src/render/water_core';
import { expectDefined } from './helpers/defined';

// Dry-tile culling for the water sheets (water.ts): quads whose corners all
// sit above the waterline are buried under terrain and drop from the index;
// anything touching water (or straddling the contour) stays, with triangle
// order and winding matching THREE.PlaneGeometry exactly so the kept tiles
// render byte-identical to the full sheet.

const DRY = WATER_TILE_KEEP_ABOVE - 0.5; // clearly above the waterline: droppable
const WET = 1; // submerged

describe('buildWaterSurfaceIndex', () => {
  it('matches THREE.PlaneGeometry triangle order and winding for a fully wet sheet', () => {
    const segments = 3;
    const columns = segments + 1;
    const plane = new THREE.PlaneGeometry(1, 1, segments, segments);
    const reference = Array.from(expectDefined(plane.getIndex()).array);
    // one dropped quad forces a rebuilt index; make the corner quad dry but
    // compare only the SHARED quads' encoding
    const depth = new Float32Array(columns * columns).fill(WET);
    depth[0] = DRY;
    depth[1] = DRY;
    depth[columns] = DRY;
    depth[columns + 1] = DRY;
    const culled = buildWaterSurfaceIndex(depth, columns, columns);
    expect(culled).not.toBeNull();
    // the dropped quad is the first: the culled index must equal the
    // reference minus its first 6 entries
    expect(Array.from(expectDefined(culled))).toEqual(reference.slice(6));
  });

  it('keeps any quad with at least one submerged corner (contour straddlers stay)', () => {
    const columns = 4; // 9 quads
    const depth = new Float32Array(columns * columns).fill(DRY);
    depth[columns + 1] = WET; // vertex (1,1) touches exactly four quads
    const culled = buildWaterSurfaceIndex(depth, columns, columns);
    expect(culled).not.toBeNull();
    expect(expectDefined(culled).length).toBe(4 * 6); // its four quads kept, the other five drop
  });

  it('drops only fully-dry quads', () => {
    const columns = 3;
    const depth = new Float32Array(columns * columns).fill(DRY);
    depth[0] = WET; // only the first quad touches water
    const culled = buildWaterSurfaceIndex(depth, columns, columns);
    expect(culled).not.toBeNull();
    expect(expectDefined(culled).length).toBe(6);
  });

  it('returns null when nothing drops, so callers keep the geometry index', () => {
    const columns = 3;
    const depth = new Float32Array(columns * columns).fill(WET);
    expect(buildWaterSurfaceIndex(depth, columns, columns)).toBeNull();
  });

  it('uses 32-bit indices once the lattice outgrows 16 bits', () => {
    const columns = 300; // 90000 vertices > 65535
    const depth = new Float32Array(columns * columns).fill(DRY);
    depth[0] = WET;
    expect(buildWaterSurfaceIndex(depth, columns, columns)).toBeInstanceOf(Uint32Array);
    const small = new Float32Array(9).fill(DRY);
    small[0] = WET;
    expect(buildWaterSurfaceIndex(small, 3, 3)).toBeInstanceOf(Uint16Array);
  });
});

// The horizon apron is drawn as a grid of blocks over ONE vertex buffer so
// three.js can frustum-cull the sheet it is not looking at. The blocks must
// together be exactly the whole-sheet draw: a quad in two blocks double-draws
// a transparent sheet, and a quad in none is a hole in the ocean.
describe('waterSheetTilePlan', () => {
  const columns = 13; // 12 quads per axis
  const quadsIn = (n: number) => n * n;

  it('partitions every quad exactly once', () => {
    for (const tilesPerSide of [1, 2, 3, 4, 5, 7]) {
      const plan = waterSheetTilePlan(columns, columns, tilesPerSide);
      const seen = new Set<string>();
      let total = 0;
      for (const region of plan) {
        for (let r = region.row0; r < region.row1; r++) {
          for (let c = region.col0; c < region.col1; c++) {
            expect(seen.has(`${c},${r}`), `quad ${c},${r} is in two blocks`).toBe(false);
            seen.add(`${c},${r}`);
            total++;
          }
        }
      }
      expect(total, `tilesPerSide=${tilesPerSide}`).toBe(quadsIn(columns - 1));
      expect(seen.size).toBe(quadsIn(columns - 1));
    }
  });

  it('spreads the remainder so no block is more than one quad wider', () => {
    // 12 quads over 5 blocks is 3,3,2,2,2: an uneven split is fine, a block
    // two quads wider than its neighbour is a lopsided cull footprint.
    const plan = waterSheetTilePlan(columns, columns, 5);
    const widths = plan.map((r) => r.col1 - r.col0);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(plan).toHaveLength(25);
  });

  it('never asks for more blocks than there are quads, and handles degenerate sheets', () => {
    expect(waterSheetTilePlan(3, 3, 99)).toHaveLength(4); // 2x2 quads, one block each
    expect(waterSheetTilePlan(1, 1, 4)).toEqual([]); // no quads at all
    expect(waterSheetTilePlan(columns, columns, 0)).toHaveLength(1); // clamped to one block
  });
});

describe('buildWaterSurfaceTileIndex', () => {
  it('reproduces the whole-sheet triangle set across a plan', () => {
    const columns = 9;
    const depth = new Float32Array(columns * columns).fill(WET);
    // a dry patch so the whole-sheet index is a culled one, not the identity
    for (const i of [0, 1, 2, columns, columns + 1, columns + 2]) depth[i] = DRY;
    const whole = buildWaterSurfaceIndex(depth, columns, columns);
    expect(whole).not.toBeNull();
    const tiled: number[] = [];
    for (const region of waterSheetTilePlan(columns, columns, 3)) {
      tiled.push(...buildWaterSurfaceTileIndex(depth, columns, region));
    }
    // Same triangles, in block order rather than row order: a transparent
    // sheet with depthWrite off does not care which of its own quads paints
    // first (they do not overlap), only that the set is identical.
    const triples = (xs: number[]) =>
      Array.from({ length: xs.length / 3 }, (_, i) => xs.slice(i * 3, i * 3 + 3).join(','))
        .slice()
        .sort();
    expect(triples(tiled)).toEqual(triples(Array.from(expectDefined(whole))));
  });

  it('returns an empty index for a block with no wet quad, so it draws nothing', () => {
    const columns = 9;
    const depth = new Float32Array(columns * columns).fill(DRY);
    depth[0] = WET; // only the very first quad is wet
    const plan = waterSheetTilePlan(columns, columns, 4);
    const lengths = plan.map((r) => buildWaterSurfaceTileIndex(depth, columns, r).length);
    expect(lengths.filter((n) => n > 0)).toEqual([6]);
    expect(lengths.filter((n) => n === 0)).toHaveLength(plan.length - 1);
  });

  it('sizes the index against the SHARED vertex buffer, not the block', () => {
    // Every block indexes into the whole sheet's vertices, so a small block on
    // a big sheet still needs 32-bit indices. Sizing on the block's own quad
    // count would silently truncate them.
    const columns = 300; // 90000 vertices
    const depth = new Float32Array(columns * columns).fill(WET);
    const plan = waterSheetTilePlan(columns, columns, 4);
    const last = plan[plan.length - 1];
    expect(buildWaterSurfaceTileIndex(depth, columns, last)).toBeInstanceOf(Uint32Array);
    const small = new Float32Array(9).fill(WET);
    const smallPlan = waterSheetTilePlan(3, 3, 2);
    expect(buildWaterSurfaceTileIndex(small, 3, smallPlan[0])).toBeInstanceOf(Uint16Array);
  });
});
