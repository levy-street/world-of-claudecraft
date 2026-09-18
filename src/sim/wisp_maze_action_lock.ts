import { WISP_MAZE_QUEST_ID } from './content/world_quest_wisp_maze';
import type { WorldQuestProgress } from './types';

/** The personal maze owns movement and combat only during a live, unpaused trial. */
export function wispMazeActionsLocked(log: ReadonlyMap<string, WorldQuestProgress>): boolean {
  const state = log.get(WISP_MAZE_QUEST_ID)?.wispMaze;
  return !!state && !state.paused && (state.phase === 'countdown' || state.phase === 'active');
}
