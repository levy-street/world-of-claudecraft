import { WISP_MAZE_SITE } from '../sim/content/world_quest_wisp_maze';
import {
  WISP_MAZE_LAYOUT,
  type WispMazeEnemy,
  type WispMazeState,
  wispMazeCellCenter,
} from '../sim/minigames/wisp_maze';

export const WISP_MAZE_WALL_HEIGHT = 1.15;
export const WISP_MAZE_WALL_CELLS: readonly number[] = Object.freeze(
  Array.from({ length: WISP_MAZE_LAYOUT.cols * WISP_MAZE_LAYOUT.rows }, (_, cell) => cell).filter(
    (cell) =>
      WISP_MAZE_LAYOUT.grid[Math.floor(cell / WISP_MAZE_LAYOUT.cols)][
        cell % WISP_MAZE_LAYOUT.cols
      ] === '#',
  ),
);
export const WISP_MAZE_WORLD_CELLS = Object.freeze(
  Array.from({ length: WISP_MAZE_LAYOUT.cols * WISP_MAZE_LAYOUT.rows }, (_, cell) => {
    const local = wispMazeCellCenter(cell);
    return Object.freeze({ x: WISP_MAZE_SITE.x + local.x, z: WISP_MAZE_SITE.z + local.z });
  }),
);

export function wispMazeVisible(
  state: (WispMazeState & { paused?: boolean }) | undefined,
  dead = false,
): boolean {
  return (
    !dead && !!state && !state.paused && (state.phase === 'countdown' || state.phase === 'active')
  );
}

export function wispGuardianVisible(enemy: WispMazeEnemy, tick: number): boolean {
  return enemy.banishedUntilTick <= tick;
}

export function wispGuardianFacing(enemy: WispMazeEnemy): number {
  const target = WISP_MAZE_WORLD_CELLS[enemy.targetCell];
  return target
    ? Math.atan2(target.x - WISP_MAZE_SITE.x - enemy.x, target.z - WISP_MAZE_SITE.z - enemy.z)
    : 0;
}
