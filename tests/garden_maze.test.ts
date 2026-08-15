// The Great Maze's modeled-hedge plan (src/render/garden_maze_core.ts): the
// piece transforms the renderer draws must agree exactly with the sim's
// wall grid and its movement-blocking piece boxes, the arches must stand
// over the entrance and exit and nowhere else, and the model scales must
// keep the visual hedge just inside the collide depth.

import { describe, expect, it } from 'vitest';
import {
  GARDEN_MAZE_GRID,
  gardenMazeCameraLift,
  MAZE_ARCH_SCALE,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_ROWS,
  MAZE_WALL_DEPTH,
  MAZE_WALL_HEIGHT,
  MAZE_WALL_OVERLAP,
  MAZE_WALL_SCALE,
  MAZE_X0,
  MAZE_Z1,
  planGardenMazePieces,
} from '../src/render/garden_maze_core';
import { gardenMazeCellPieces, inGardenMazeWall } from '../src/sim/world';

const cellCenter = (c: number, r: number) => ({
  x: MAZE_X0 + (c + 0.5) * MAZE_CELL,
  z: MAZE_Z1 - (r + 0.5) * MAZE_CELL,
});

// rot 0 / PI both run east-west (the parity flip that breaks joint tiling)
const runsEastWest = (rot: number) => Math.abs(Math.sin(rot)) < 1e-9;

describe('the modeled-hedge plan', () => {
  it('places exactly the pieces the sim grid carries', () => {
    const plan = planGardenMazePieces();
    let expected = 0;
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        const p = gardenMazeCellPieces(c, r);
        if (!p) continue;
        expected += (p.h ? 1 : 0) + (p.v ? 1 : 0);
        const center = cellCenter(c, r);
        const here = plan.walls.filter(
          (w) => Math.abs(w.x - center.x) < 0.01 && Math.abs(w.z - center.z) < 0.01,
        );
        expect(here.length, `pieces at ${c},${r}`).toBe((p.h ? 1 : 0) + (p.v ? 1 : 0));
        if (p.h)
          expect(
            here.some((w) => runsEastWest(w.rot)),
            `h piece at ${c},${r}`,
          ).toBe(true);
        if (p.v) {
          expect(
            here.some((w) => !runsEastWest(w.rot)),
            `v piece at ${c},${r}`,
          ).toBe(true);
        }
      }
    }
    expect(plan.walls.length).toBe(expected);
  });

  it('stands an arch over the entrance and the exit, and nowhere else', () => {
    const plan = planGardenMazePieces();
    expect(plan.arches.length).toBe(2);
    const entranceCol = GARDEN_MAZE_GRID[MAZE_ROWS - 1].indexOf('.');
    const exitCol = GARDEN_MAZE_GRID[0].indexOf('.');
    const entrance = cellCenter(entranceCol, MAZE_ROWS - 1);
    const exit = cellCenter(exitCol, 0);
    for (const spot of [entrance, exit]) {
      const arch = plan.arches.filter(
        (a) => Math.abs(a.x - spot.x) < 0.01 && Math.abs(a.z - spot.z) < 0.01,
      );
      expect(arch.length, `arch at ${spot.x},${spot.z}`).toBe(1);
      // the passage runs north-south through the maze's top and bottom rows
      expect(arch[0].rot).toBe(0);
      // an arch marks an OPENING: the ground under it stays walkable
      expect(inGardenMazeWall(spot.x, spot.z)).toBe(false);
    }
  });

  it('overlaps each piece past its cell with leaves just inside the collide box', () => {
    // the source models are 0.98 wide x 0.38 deep at unit scale; each piece
    // reaches MAZE_WALL_OVERLAP into both neighbors so runs read seamless
    expect(MAZE_WALL_SCALE * 0.98).toBeCloseTo(MAZE_CELL + 2 * MAZE_WALL_OVERLAP, 5);
    expect(MAZE_WALL_OVERLAP).toBeGreaterThan(0.4); // enough for the leafy ends to interlock
    const visualDepth = MAZE_WALL_SCALE * 0.38;
    expect(visualDepth).toBeLessThanOrEqual(MAZE_WALL_DEPTH);
    expect(visualDepth).toBeGreaterThan(MAZE_WALL_DEPTH - 0.5);
    expect(MAZE_ARCH_SCALE * 0.98).toBeCloseTo(MAZE_CELL, 5);
  });

  it('is deterministic', () => {
    expect(planGardenMazePieces()).toEqual(planGardenMazePieces());
  });

  it('lifts the camera over hedges and leaves corridor centers untouched', () => {
    // full hedge height standing inside any wall piece...
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        const center = cellCenter(c, r);
        if (GARDEN_MAZE_GRID[r][c] === '#') {
          expect(gardenMazeCameraLift(center.x, center.z), `lift in wall ${c},${r}`).toBeCloseTo(
            MAZE_WALL_HEIGHT,
            5,
          );
        } else {
          // ...zero at corridor centers (6.9yd from the nearest face, far
          // outside the ramp) so the maze floor camera stays low
          expect(gardenMazeCameraLift(center.x, center.z), `lift in corridor ${c},${r}`).toBe(0);
        }
      }
    }
    // the ramp eases: partway up 1yd outside a piece face, gone far away
    const wall = cellCenter(8, 15); // a wall cell with a north-south piece
    expect(gardenMazeCellPieces(8, 15)?.v).toBe(true);
    const nearFace = gardenMazeCameraLift(wall.x - MAZE_WALL_DEPTH / 2 - 1, wall.z);
    expect(nearFace).toBeGreaterThan(0);
    expect(nearFace).toBeLessThan(MAZE_WALL_HEIGHT);
    expect(gardenMazeCameraLift(MAZE_X0 - 30, MAZE_Z1 + 30)).toBe(0);
  });

  it('agrees with the movement blocker along every piece centerline', () => {
    const plan = planGardenMazePieces();
    for (const w of plan.walls) {
      for (const t of [-0.45, 0, 0.45]) {
        const x = w.x + (runsEastWest(w.rot) ? t * MAZE_CELL : 0);
        const z = w.z + (runsEastWest(w.rot) ? 0 : t * MAZE_CELL);
        expect(inGardenMazeWall(x, z), `piece at ${w.x},${w.z} rot ${w.rot} t ${t}`).toBe(true);
      }
    }
  });
});
