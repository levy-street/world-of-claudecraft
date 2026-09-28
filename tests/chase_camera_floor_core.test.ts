import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHASE_CAMERA_GROUND_CLEARANCE,
  chaseCameraFloorY,
} from '../src/render/chase_camera_floor_core';
import {
  GARDEN_MAZE_GRID,
  MAZE_CELL,
  MAZE_WALL_HEIGHT,
  MAZE_X0,
  MAZE_Z1,
} from '../src/render/garden_maze_core';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The chase camera's floor (src/render/chase_camera_floor_core.ts), moved out of renderer.ts
// updateCamera unchanged: the ground a hand over, lifted over the Great Maze's hedges (and a
// raised Rift tier), and the renderer lifting its one pose to it.

describe('chase camera floor', () => {
  it('stands a hand over the ground in the open world', () => {
    for (const [x, z] of [
      [0, 0],
      [-17, 408],
      [250, -120],
    ]) {
      expect(chaseCameraFloorY(x, z, WORLD_SEED, null)).toBeCloseTo(
        groundHeight(x, z, WORLD_SEED) + CHASE_CAMERA_GROUND_CLEARANCE,
        9,
      );
    }
  });

  it('rides over a maze hedge the way the old terrain walls lifted it', () => {
    let r = 0;
    let c = 0;
    outer: for (r = 0; r < GARDEN_MAZE_GRID.length; r++) {
      for (c = 0; c < GARDEN_MAZE_GRID[r].length; c++)
        if (GARDEN_MAZE_GRID[r][c] === '#') break outer;
    }
    const x = MAZE_X0 + (c + 0.5) * MAZE_CELL;
    const z = MAZE_Z1 - (r + 0.5) * MAZE_CELL;
    const ground = groundHeight(x, z, WORLD_SEED) + CHASE_CAMERA_GROUND_CLEARANCE;
    expect(chaseCameraFloorY(x, z, WORLD_SEED, null)).toBeCloseTo(ground + MAZE_WALL_HEIGHT, 5);
  });

  it('is the floor the renderer lifts its one chase pose to', () => {
    const renderer = readFileSync(path.join(__dirname, '..', 'src/render/renderer.ts'), 'utf8');
    expect(renderer).toContain(
      'const groundY = chaseCameraFloorY(cx, cz, seed, this.sim.riftFloor);',
    );
    expect(renderer).toContain('this.camera.position.set(cx, Math.max(cy, groundY), cz);');
  });
});
