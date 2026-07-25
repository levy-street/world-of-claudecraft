// The Drowned Court's cosmetic water bands (src/render/arena_water_band_core.ts):
// pins the module's three geometric claims against the real layout: the strips
// hug the walls without overlapping each other, they stay off the spawns and
// the fighting lanes, and a degenerate band width collapses instead of going
// negative.
import { describe, expect, it } from 'vitest';
import {
  ARENA_WATER_BAND_WIDTH,
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

describe('arena water bands (Drowned Court)', () => {
  const bands = arenaWaterBands(DROWNED_COURT_LAYOUT);
  const innerX = DUNGEON_WALL_X - DUNGEON_WALL_HW;

  it('lays four wall-hugging strips flush to the inner wall faces', () => {
    expect(bands).toHaveLength(4);
    const [west, east, front, back] = bands.map(rect);
    expect(west.x0).toBeCloseTo(-innerX, 10);
    expect(east.x1).toBeCloseTo(innerX, 10);
    expect(front.z0).toBeCloseTo(DROWNED_COURT_LAYOUT.zMin + DUNGEON_WALL_HW, 10);
    expect(back.z1).toBeCloseTo(DROWNED_COURT_LAYOUT.zMax - DUNGEON_WALL_HW, 10);
    // side strips run the full pit length
    expect(west.z0).toBeCloseTo(DROWNED_COURT_LAYOUT.zMin + DUNGEON_WALL_HW, 10);
    expect(west.z1).toBeCloseTo(DROWNED_COURT_LAYOUT.zMax - DUNGEON_WALL_HW, 10);
  });

  it('end strips abut the side strips exactly: no overlap, no gap', () => {
    const [west, east, front, back] = bands.map(rect);
    for (const end of [front, back]) {
      expect(end.x0).toBeCloseTo(west.x1, 10);
      expect(end.x1).toBeCloseTo(east.x0, 10);
    }
  });

  it('keeps every spawn and the cover lanes dry', () => {
    const map = arenaMapForSlot(1);
    expect(map.layout).toBe(DROWNED_COURT_LAYOUT);
    const spawns = [map.spawnA, map.spawnB, ...map.spawnsA2v2, ...map.spawnsB2v2];
    const inside = (r: ReturnType<typeof rect>, x: number, z: number) =>
      x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    const cover = [...DROWNED_COURT_LAYOUT.pillars, ...DROWNED_COURT_LAYOUT.tombs];
    for (const b of bands.map(rect)) {
      for (const s of spawns) expect(inside(b, s.x, s.z)).toBe(false);
      // no colonnade pillar or reliquary stands in the water
      for (const c of cover) expect(inside(b, c.x, c.z)).toBe(false);
    }
    // and the wet edge starts at the documented offset from the wall face
    expect(innerX - ARENA_WATER_BAND_WIDTH).toBe(19);
  });

  it('collapses instead of inverting for a degenerate band width', () => {
    const degenerate = arenaWaterBands(DROWNED_COURT_LAYOUT, innerX + 5);
    for (const b of degenerate) expect(b.width).toBeGreaterThanOrEqual(0);
  });
});
