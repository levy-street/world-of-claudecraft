import { describe, expect, it } from 'vitest';
import {
  eraseVoxelBounds,
  eraseVoxelBox,
  makeVoxelCut,
  stampVoxel,
  voxelIsEmpty,
} from '../src/editor/carve_voxel_core';
import { carveFieldAt } from '../src/sim/terrain_cuts';
import type { TerrainCut } from '../src/sim/types';

// FORK: the Fill tool's erase box: every dug cell inside the oriented box
// goes back to rock; cells outside it keep their air.

describe('eraseVoxelBox (editor/carve_voxel_core.ts)', () => {
  it('puts the rock back inside the box only, and empties a record it covers whole', () => {
    const cut = makeVoxelCut(1, { minX: -20, maxX: 20, minY: -10, maxY: 4, minZ: -8, maxZ: 8 });
    cut.carve = true;
    // a 40 yd trench of 6 yd stamps along x at y -2
    for (let x = -16; x <= 16; x += 3) {
      stampVoxel(
        cut,
        'dig',
        { x, y: -2, z: 0 },
        5,
        { kind: 'round', noise: 0 },
        { x: 0, y: -1, z: 0 },
      );
    }
    expect(carveFieldAt([cut], undefined, -12, -2, 0)).toBeLessThan(0);
    expect(carveFieldAt([cut], undefined, 12, -2, 0)).toBeLessThan(0);
    // erase the east half with a box centred at x 10, 12 x 12 x 24 yd
    const box: TerrainCut = {
      x: 10,
      y: -2,
      z: 0,
      radius: 12,
      shape: 'box',
      halfX: 12,
      halfY: 12,
      halfZ: 12,
    };
    const vb = eraseVoxelBounds(cut, box);
    expect(vb).not.toBeNull();
    expect(eraseVoxelBox(cut, box, vb!)).toBe(true);
    expect(carveFieldAt([cut], undefined, 12, -2, 0)).toBeGreaterThan(0);
    expect(carveFieldAt([cut], undefined, 4, -2, 0)).toBeGreaterThan(0);
    expect(carveFieldAt([cut], undefined, -12, -2, 0)).toBeLessThan(0);
    expect(voxelIsEmpty(cut)).toBe(false);
    // a second pass over the same box changes nothing
    expect(eraseVoxelBox(cut, box, vb!)).toBe(false);
    // a box over the whole trench empties the record
    const all: TerrainCut = {
      x: 0,
      y: -2,
      z: 0,
      radius: 30,
      shape: 'box',
      halfX: 30,
      halfY: 20,
      halfZ: 30,
    };
    expect(eraseVoxelBox(cut, all, eraseVoxelBounds(cut, all)!)).toBe(true);
    expect(voxelIsEmpty(cut)).toBe(true);
  });
  it('honours the box yaw: a turned box misses cells its axis-aligned rect would cover', () => {
    const cut = makeVoxelCut(1, { minX: -20, maxX: 20, minY: -10, maxY: 4, minZ: -20, maxZ: 20 });
    stampVoxel(
      cut,
      'dig',
      { x: 0, y: -2, z: 0 },
      12,
      { kind: 'round', noise: 0 },
      { x: 0, y: -1, z: 0 },
    );
    // a long thin box turned 45 degrees: covers the diagonal, not the axis
    const box: TerrainCut = {
      x: 0,
      y: -2,
      z: 0,
      radius: 2,
      shape: 'box',
      halfX: 14,
      halfY: 8,
      halfZ: 2,
      rotY: Math.PI / 4,
    };
    expect(eraseVoxelBox(cut, box, eraseVoxelBounds(cut, box)!)).toBe(true);
    expect(carveFieldAt([cut], undefined, 6, -2, 6)).toBeGreaterThan(0); // on the diagonal: rock
    expect(carveFieldAt([cut], undefined, 6, -2, -6)).toBeLessThan(0); // off it: still air
    expect(carveFieldAt([cut], undefined, 8, -2, 0)).toBeLessThan(0); // on the x axis: still air
  });
});
