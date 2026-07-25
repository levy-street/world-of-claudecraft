// The Drowned Court's cosmetic flood (src/render/arena_water_band_core.ts):
// pins the module's geometric claims against the real layout: the aisles
// flood wall-to-colonnade with exact abutment (no overlap, no gap), the
// processional nave and every spawn stay dry, the colonnades and reliquaries
// stand IN the water (that is the look: kelp at their feet), and a degenerate
// nave width collapses instead of going negative.
import { describe, expect, it } from 'vitest';
import {
  ARENA_WATER_END_DEPTH,
  ARENA_WATER_NAVE_HALF_X,
  type ArenaWaterBand,
  arenaWaterBands,
} from '../src/render/arena_water_band_core';
import {
  arenaMapForSlot,
  DROWNED_COURT_LAYOUT,
  DUNGEON_WALL_HW,
  DUNGEON_WALL_X,
} from '../src/sim/dungeon_layout';

const rect = (b: ArenaWaterBand) => ({
  x0: b.x - b.width / 2,
  x1: b.x + b.width / 2,
  z0: b.z - b.depth / 2,
  z1: b.z + b.depth / 2,
});
const inside = (r: ReturnType<typeof rect>, x: number, z: number) =>
  x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

describe('arena water (Drowned Court flooded aisles)', () => {
  const bands = arenaWaterBands(DROWNED_COURT_LAYOUT);
  const innerX = DUNGEON_WALL_X - DUNGEON_WALL_HW;

  it('floods both aisles wall-to-nave for the full pit length', () => {
    expect(bands).toHaveLength(4);
    const [west, east] = bands.map(rect);
    expect(west.x0).toBeCloseTo(-innerX, 10);
    expect(west.x1).toBeCloseTo(-ARENA_WATER_NAVE_HALF_X, 10);
    expect(east.x0).toBeCloseTo(ARENA_WATER_NAVE_HALF_X, 10);
    expect(east.x1).toBeCloseTo(innerX, 10);
    expect(west.z0).toBeCloseTo(DROWNED_COURT_LAYOUT.zMin + DUNGEON_WALL_HW, 10);
    expect(west.z1).toBeCloseTo(DROWNED_COURT_LAYOUT.zMax - DUNGEON_WALL_HW, 10);
  });

  it('end pools abut the aisles and close the nave behind each spawn line', () => {
    const [west, east, front, back] = bands.map(rect);
    for (const end of [front, back]) {
      expect(end.x0).toBeCloseTo(west.x1, 10);
      expect(end.x1).toBeCloseTo(east.x0, 10);
    }
    expect(front.z1 - front.z0).toBeCloseTo(ARENA_WATER_END_DEPTH, 10);
    expect(back.z1 - back.z0).toBeCloseTo(ARENA_WATER_END_DEPTH, 10);
    // the end pools stay behind the spawn lines: spawns remain on dry stone
    const map = arenaMapForSlot(1);
    expect(front.z1).toBeLessThan(map.spawnA.z);
    expect(back.z0).toBeGreaterThan(map.spawnB.z);
  });

  it('keeps the nave, the dais, and every spawn dry; cover stands IN water', () => {
    const map = arenaMapForSlot(1);
    expect(map.layout).toBe(DROWNED_COURT_LAYOUT);
    const spawns = [map.spawnA, map.spawnB, ...map.spawnsA2v2, ...map.spawnsB2v2];
    const dryPoints = [
      ...spawns,
      DROWNED_COURT_LAYOUT.dais,
      { x: 0, z: -10 },
      { x: 0, z: 14 }, // mid-nave control points
    ];
    for (const b of bands.map(rect)) {
      for (const p of dryPoints) expect(inside(b, p.x, p.z)).toBe(false);
    }
    // the colonnades and reliquaries rise OUT of the flood (kelp at their
    // feet), so every cover piece sits inside exactly one aisle sheet
    const cover = [...DROWNED_COURT_LAYOUT.pillars, ...DROWNED_COURT_LAYOUT.tombs];
    for (const c of cover) {
      expect(bands.map(rect).filter((b) => inside(b, c.x, c.z))).toHaveLength(1);
    }
  });

  it('collapses instead of inverting for a degenerate nave width', () => {
    const degenerate = arenaWaterBands(DROWNED_COURT_LAYOUT, innerX + 5);
    for (const b of degenerate) expect(b.width).toBeGreaterThanOrEqual(0);
  });
});
