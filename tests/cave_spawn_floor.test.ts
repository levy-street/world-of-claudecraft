// A camp authored INSIDE a cave spawns on the tube floor, not on the surface
// above it (sim/cave_ground_core.ts caveSpawnFloor, consulted by
// Sim.groundPos). Deepglass mines: kobolds in a gallery two hundred yards
// under the summit used to spawn ON the summit.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAVE_SPAWN_MIN_DEPTH, carveSpawnFloor, caveSpawnFloor } from '../src/sim/cave_ground_core';
import type { CaveDef } from '../src/sim/types';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

/** A straight 60-yard bore along +x at floor y 20, radius 4. */
const TUBE: CaveDef = {
  id: 'gallery',
  radius: 4,
  nodes: [
    { x: 0, y: 20, z: 0, radius: 4 },
    { x: 30, y: 20, z: 0, radius: 4 },
    { x: 60, y: 20, z: 0, radius: 4 },
  ],
};

describe('cave spawn floor', () => {
  it('lands a spawn inside a buried bore on the tube floor', () => {
    // the summit is 180 yards up: the tube wins
    expect(caveSpawnFloor([TUBE], 30, 0, 200)).toBeCloseTo(20, 6);
    expect(caveSpawnFloor([TUBE], 30, 2.5, 200)).toBeCloseTo(20, 6);
  });

  it('keeps the surface outside the bore, at a flush mouth, and in the mouth apron', () => {
    expect(caveSpawnFloor([TUBE], 30, 9, 200)).toBeNull(); // beside the bore
    expect(caveSpawnFloor([TUBE], 30, 0, 20 + CAVE_SPAWN_MIN_DEPTH - 0.5)).toBeNull(); // flush
    expect(caveSpawnFloor([TUBE], 66, 0, 200)).toBeNull(); // the open mouth's apron
    expect(caveSpawnFloor(undefined, 30, 0, 200)).toBeNull();
    expect(caveSpawnFloor([], 30, 0, 200)).toBeNull();
  });

  it('is what the sim grounds authored spawns with', () => {
    const sim = codeWithoutLineComments(
      readFileSync(new URL('../src/sim/sim.ts', import.meta.url), 'utf8'),
    );
    const start = sim.indexOf('  groundPos(x: number, z: number): Vec3 {');
    expect(start).toBeGreaterThan(-1);
    const body = sim.slice(start, sim.indexOf('\n  }\n', start));
    expect(body).toContain('caveSpawnFloor(getActiveWorldContent().caves, x, z, surface)');
    expect(body).toContain('carveSpawnFloor(content.holes, content.holePatches, x, z, surface)');
    expect(body).toContain('y: tube ?? surface');
  });

  it('grounds a spawn on a carved cavity floor, and keeps the surface outside or in a shallow pit', () => {
    // a 10 yd carved sphere buried 30 yd under a flat 100 yd surface
    const room = { x: 0, y: 70, z: 0, radius: 10, carve: true, shape: undefined };
    const floor = carveSpawnFloor([room], undefined, 0, 0, 100);
    expect(floor).not.toBeNull();
    expect(floor as number).toBeGreaterThan(59);
    expect(floor as number).toBeLessThan(62);
    expect(carveSpawnFloor([room], undefined, 30, 0, 100)).toBeNull(); // beside the room
    expect(carveSpawnFloor([room], undefined, 0, 0, 61)).toBeNull(); // a walk-in pit at the surface
    expect(carveSpawnFloor(undefined, undefined, 0, 0, 100)).toBeNull();
    expect(carveSpawnFloor([], undefined, 0, 0, 100)).toBeNull();
  });
});
