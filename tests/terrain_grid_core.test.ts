import { describe, expect, it } from 'vitest';
import {
  AUTHORED_OUTSKIRTS_YARDS,
  AUTHORED_STAMP_REACH_YARDS,
  SHIPPED_GRID_BOX,
  terrainGridBox,
} from '../src/render/terrain_grid_core';

// The terrain chunk grid's world box (src/render/terrain_grid_core.ts). The
// grid used to be pinned to the shipped world's box for every map, so an
// authored map's ground was clipped wherever its own rect or its sculpting
// reached past that box: SPACEY's Deepglass (z -250..1120, peaks sculpted to
// x -631) lost everything south of z -180 and west of x -540 (2026-09-15).

const DEEPGLASS_RECT = { minX: -460, maxX: 460, minZ: -250, maxZ: 1120 };

describe('terrain grid box', () => {
  it('keeps the shipped world on its own box, exactly', () => {
    expect(terrainGridBox({ authored: false, rects: [DEEPGLASS_RECT], cell: 60 })).toBe(
      SHIPPED_GRID_BOX,
    );
    expect(terrainGridBox({ authored: true, rects: [], cell: 60 })).toBe(SHIPPED_GRID_BOX);
  });

  it("covers an authored map's own rect plus outskirts, snapped to the super-chunk lattice", () => {
    const box = terrainGridBox({ authored: true, rects: [DEEPGLASS_RECT], cell: 60 });
    expect(box.minX).toBeLessThanOrEqual(DEEPGLASS_RECT.minX - AUTHORED_OUTSKIRTS_YARDS);
    expect(box.maxX).toBeGreaterThanOrEqual(DEEPGLASS_RECT.maxX + AUTHORED_OUTSKIRTS_YARDS);
    expect(box.minZ).toBeLessThanOrEqual(DEEPGLASS_RECT.minZ - AUTHORED_OUTSKIRTS_YARDS);
    expect(box.maxZ).toBeGreaterThanOrEqual(DEEPGLASS_RECT.maxZ + AUTHORED_OUTSKIRTS_YARDS);
    for (const edge of [box.minX, box.maxX, box.minZ, box.maxZ]) {
      expect(Math.abs(edge % 120)).toBe(0); // abs: -720 % 120 is -0
    }
    // The reported cut: the map's own south edge now has ground under it.
    expect(box.minZ).toBeLessThan(-250);
  });

  it('widens to every sculpt stamp, but only within a bounded reach', () => {
    const peak = { x: -631, z: 200, radius: 90 }; // SPACEY's westmost peak
    const hostile = { x: 1e7, z: -1e7, radius: 5 };
    const box = terrainGridBox({
      authored: true,
      rects: [DEEPGLASS_RECT],
      stamps: [peak, hostile],
      cell: 60,
    });
    expect(box.minX).toBeLessThanOrEqual(peak.x - peak.radius);
    expect(box.maxX).toBeLessThanOrEqual(DEEPGLASS_RECT.maxX + AUTHORED_STAMP_REACH_YARDS + 120);
    expect(box.minZ).toBeGreaterThanOrEqual(DEEPGLASS_RECT.minZ - AUTHORED_STAMP_REACH_YARDS - 120);
  });
});
