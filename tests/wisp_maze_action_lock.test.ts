import { describe, expect, it } from 'vitest';
import { resolveGliderMove, scriptedMovementActive } from '../src/game/glider_controls';
import { WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { createWispMaze } from '../src/sim/minigames/wisp_maze';
import { emptyMoveInput, type WorldQuestProgress } from '../src/sim/types';
import { wispMazeActionsLocked } from '../src/sim/wisp_maze_action_lock';

describe('personal maze action and prediction ownership', () => {
  function fixture() {
    const progress = {
      state: 'active',
      count: 0,
      wispMaze: createWispMaze(42),
    } as WorldQuestProgress;
    const worldQuestLog = new Map([[WISP_MAZE_QUEST_ID, progress]]);
    return { progress, worldQuestLog };
  }

  it.each(['countdown', 'active'] as const)(
    'locks combat and ordinary prediction during %s',
    (phase) => {
      const { progress, worldQuestLog } = fixture();
      progress.wispMaze!.phase = phase;
      expect(wispMazeActionsLocked(worldQuestLog)).toBe(true);
      expect(scriptedMovementActive({ worldQuestLog })).toBe(true);
    },
  );

  it('unlocks paused, won and missing sessions without trapping the player', () => {
    const { progress, worldQuestLog } = fixture();
    progress.wispMaze!.paused = true;
    expect(wispMazeActionsLocked(worldQuestLog)).toBe(false);
    expect(scriptedMovementActive({ worldQuestLog })).toBe(false);
    progress.wispMaze!.paused = false;
    progress.wispMaze!.phase = 'won';
    expect(wispMazeActionsLocked(worldQuestLog)).toBe(false);
    expect(scriptedMovementActive({ worldQuestLog })).toBe(false);
    worldQuestLog.clear();
    expect(wispMazeActionsLocked(worldQuestLog)).toBe(false);
  });

  it('also owns a live practice session after daily credit was already earned', () => {
    const { progress, worldQuestLog } = fixture();
    progress.state = 'completed';
    expect(wispMazeActionsLocked(worldQuestLog)).toBe(true);
    expect(scriptedMovementActive({ worldQuestLog })).toBe(true);
  });

  it('clears navigation through private walls but preserves normal camera and manual movement', () => {
    const { progress, worldQuestLog } = fixture();
    let cleared = 0;
    const mi = { ...emptyMoveInput(), forward: true, turnLeft: true };
    const input = {
      rightDown: false,
      camYaw: 1.2,
      isMouselookActive: () => true,
      readMoveInput: () => mi,
      clearClickMove: () => {
        cleared++;
      },
    };
    expect(resolveGliderMove({ worldQuestLog }, input)).toEqual({ mi, facing: 1.2 });
    expect(cleared).toBe(1);
    input.isMouselookActive = () => false;
    expect(resolveGliderMove({ worldQuestLog }, input)).toEqual({ mi, facing: null });
    progress.wispMaze!.paused = true;
    expect(resolveGliderMove({ worldQuestLog }, input)).toBeNull();
    expect(cleared).toBe(2);
  });
});
