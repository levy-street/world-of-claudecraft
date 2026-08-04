import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildWaterSurfaceIndex, WATER_TILE_KEEP_ABOVE } from '../src/render/water_core';

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
    const reference = Array.from(plane.getIndex()!.array);
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
    expect(Array.from(culled!)).toEqual(reference.slice(6));
  });

  it('keeps any quad with at least one submerged corner (contour straddlers stay)', () => {
    const columns = 4; // 9 quads
    const depth = new Float32Array(columns * columns).fill(DRY);
    depth[columns + 1] = WET; // vertex (1,1) touches exactly four quads
    const culled = buildWaterSurfaceIndex(depth, columns, columns);
    expect(culled).not.toBeNull();
    expect(culled!.length).toBe(4 * 6); // its four quads kept, the other five drop
  });

  it('drops only fully-dry quads', () => {
    const columns = 3;
    const depth = new Float32Array(columns * columns).fill(DRY);
    depth[0] = WET; // only the first quad touches water
    const culled = buildWaterSurfaceIndex(depth, columns, columns);
    expect(culled).not.toBeNull();
    expect(culled!.length).toBe(6);
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
