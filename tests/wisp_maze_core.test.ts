import { expect, it } from 'vitest';
import {
  WISP_MAZE_WALL_CELLS,
  WISP_MAZE_WORLD_CELLS,
  wispGuardianVisible,
  wispMazeVisible,
} from '../src/render/wisp_maze_core';
import { WISP_MAZE_SITE } from '../src/sim/content/world_quest_wisp_maze';
import { createWispMaze, WISP_MAZE_LAYOUT, wispMazeWalkable } from '../src/sim/minigames/wisp_maze';

it('projects every solid collision cell exactly once, and never places a wall in a walkable passage', () => {
  expect(WISP_MAZE_WALL_CELLS.length + WISP_MAZE_LAYOUT.openCells.length).toBe(121);
  expect(new Set(WISP_MAZE_WALL_CELLS).size).toBe(WISP_MAZE_WALL_CELLS.length);
  for (let cell = 0; cell < 121; cell++) {
    const pos = WISP_MAZE_WORLD_CELLS[cell];
    expect(wispMazeWalkable(pos.x - WISP_MAZE_SITE.x, pos.z - WISP_MAZE_SITE.z)).toBe(
      !WISP_MAZE_WALL_CELLS.includes(cell),
    );
  }
});

it('shows only the owner trial and restores banished guardians at the authoritative tick boundary', () => {
  const state = Object.assign(createWispMaze(1), { paused: false });
  expect(wispMazeVisible(undefined)).toBe(false);
  expect(wispMazeVisible(state)).toBe(true);
  state.paused = true;
  expect(wispMazeVisible(state)).toBe(false);
  state.paused = false;
  state.phase = 'active';
  expect(wispMazeVisible(state, true)).toBe(false);
  state.enemies[0].banishedUntilTick = 100;
  expect(wispGuardianVisible(state.enemies[0], 99)).toBe(false);
  expect(wispGuardianVisible(state.enemies[0], 100)).toBe(true);
  state.phase = 'won';
  expect(wispMazeVisible(state)).toBe(false);
});
