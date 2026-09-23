import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { WorldQuestProgress } from '../src/sim/types';
import { applyWorldQuestMatch3Move } from '../src/sim/world_quest_match3';
import {
  prepareWorldQuestConfectionMove,
  resolveWorldQuestConfectionProgress,
  worldQuestConfectionMoveState,
} from '../src/ui/world_quest_confection_view';

const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
const level = quest.objective.levels[0];
const initial = (): WorldQuestProgress => ({
  questId: quest.id,
  state: 'active',
  count: 0,
  puzzleVariant: 0,
  match3Board: [...level.board],
  match3Moves: 0,
  match3RefillIndex: 0,
});

describe('Confection Cascade visual receipts', () => {
  it('only exposes a terminal move count when the world supplied it with terminal progress', () => {
    const before = { ...initial(), count: 69, match3Moves: 19 };
    const stripped: WorldQuestProgress = { questId: quest.id, count: 72, state: 'completed' };
    const eventOnly = resolveWorldQuestConfectionProgress(quest.id, before, before, true);
    expect(eventOnly?.movesKnown).toBe(false);
    expect(resolveWorldQuestConfectionProgress(quest.id, stripped, before, false)?.movesKnown).toBe(
      false,
    );
    expect(
      resolveWorldQuestConfectionProgress(quest.id, stripped, eventOnly, true)?.movesKnown,
    ).toBe(false);
    const explicit = resolveWorldQuestConfectionProgress(
      quest.id,
      { ...stripped, match3Moves: 20 },
      eventOnly,
      false,
    );
    expect(explicit).toMatchObject({ movesKnown: true, match3Moves: 20 });
    expect(resolveWorldQuestConfectionProgress(quest.id, stripped, explicit, true)).toMatchObject({
      movesKnown: true,
      match3Moves: 20,
    });
    expect(
      resolveWorldQuestConfectionProgress(
        quest.id,
        { ...before, count: 72, match3Moves: 20 },
        eventOnly,
        false,
      ),
    ).toMatchObject({ movesKnown: true, match3Moves: 20 });
    expect(
      resolveWorldQuestConfectionProgress(
        quest.id,
        stripped,
        { ...before, count: 72, match3Moves: 20 },
        false,
      ),
    ).toMatchObject({ movesKnown: true, match3Moves: 20 });
  });

  it('retains observed board and level metadata after completed snapshots strip them', () => {
    const before = { ...initial(), count: 69, match3Moves: 19, puzzleVariant: 2 };
    const resolved = resolveWorldQuestConfectionProgress(
      quest.id,
      { questId: quest.id, count: 72, state: 'completed' },
      before,
      false,
    );
    expect(resolved).toMatchObject({
      state: 'completed',
      count: 72,
      match3Moves: 19,
      puzzleVariant: 2,
      match3Board: level.board,
    });
    expect(resolved?.match3Board).not.toBe(before.match3Board);
    expect(before.state).toBe('active');
    const completedBoard = [...level.board].reverse();
    expect(
      resolveWorldQuestConfectionProgress(
        quest.id,
        {
          ...initial(),
          count: 72,
          state: 'completed',
          match3Moves: 20,
          match3Board: completedBoard,
        },
        before,
        false,
      ),
    ).toMatchObject({ match3Moves: 20, match3Board: completedBoard });
  });

  it('latches an authoritative completion while waiting for its snapshot and only retains the matching quest', () => {
    const before = { ...initial(), count: 69, match3Moves: 19 };
    const completed = resolveWorldQuestConfectionProgress(quest.id, before, before, true);
    expect(completed).toMatchObject({ state: 'completed', count: 72, match3Moves: 19 });
    expect(resolveWorldQuestConfectionProgress(quest.id, before, completed, false)?.state).toBe(
      'completed',
    );
    const finalBoard = [...level.board].reverse();
    expect(
      resolveWorldQuestConfectionProgress(
        quest.id,
        before,
        {
          ...before,
          state: 'completed',
          match3Board: finalBoard,
          match3Moves: 20,
        },
        false,
      ),
    ).toMatchObject({ state: 'completed', match3Board: finalBoard, match3Moves: 20 });
    expect(
      resolveWorldQuestConfectionProgress('wq_galecrest_wisps', before, completed, true),
    ).toBeUndefined();
    expect(
      resolveWorldQuestConfectionProgress(
        quest.id,
        undefined,
        { ...before, questId: 'other' },
        true,
      ),
    ).toBeUndefined();
    expect(resolveWorldQuestConfectionProgress(quest.id, undefined, before, false)).toBeUndefined();
  });

  it('waits for a world result and confirms the exact board, count, move and refill receipt', () => {
    const before = initial();
    const receipt = prepareWorldQuestConfectionMove(quest.id, before, 2, 3)!;
    expect(receipt).not.toBeNull();
    expect(worldQuestConfectionMoveState(receipt, before)).toBe('waiting');
    const result = applyWorldQuestMatch3Move(level, level.board, 2, 3, 0);
    const after = {
      ...before,
      count: result.cleared,
      match3Moves: 1,
      match3Board: result.board,
      match3RefillIndex: result.refillIndex,
    };
    expect(worldQuestConfectionMoveState(receipt, after)).toBe('confirmed');
    for (const change of [
      { count: after.count + 1 },
      { match3Moves: 2 },
      { match3RefillIndex: 0 },
      { match3Board: [...level.board] },
      { questId: 'wq_galecrest_wisps' },
      { puzzleVariant: 1 },
      { state: 'completed' as const },
    ])
      expect(worldQuestConfectionMoveState(receipt, { ...after, ...change })).toBe('discarded');
  });

  it('only keeps waiting while every receipt field still matches the before state', () => {
    const before = initial();
    const receipt = prepareWorldQuestConfectionMove(quest.id, before, 2, 3)!;
    const changedBoard = [...level.board];
    changedBoard[0] = changedBoard[0] === 0 ? 1 : 0;
    const changes: Array<Partial<WorldQuestProgress>> = [
      { questId: 'wq_galecrest_wisps' },
      { count: before.count + 1 },
      { match3Moves: 1 },
      { match3RefillIndex: 1 },
      { match3Board: changedBoard },
      { match3Board: level.board.slice(1) },
      { puzzleVariant: 1 },
      { state: 'completed' },
    ];
    expect(worldQuestConfectionMoveState(receipt, before)).toBe('waiting');
    for (const change of changes) {
      expect(
        worldQuestConfectionMoveState(receipt, { ...before, ...change }),
        Object.keys(change).join(),
      ).toBe('discarded');
    }
  });

  it('detaches the before state from an in-place IWorld update and uses a nonzero refill cursor', () => {
    const progress = { ...initial(), match3RefillIndex: 7 };
    const receipt = prepareWorldQuestConfectionMove(quest.id, progress, 2, 3)!;
    const result = applyWorldQuestMatch3Move(level, level.board, 2, 3, 7);
    progress.match3Board!.splice(0, progress.match3Board!.length, ...result.board);
    progress.match3RefillIndex = result.refillIndex;
    progress.match3Moves = 1;
    progress.count = result.cleared;
    expect(receipt.before.match3RefillIndex).toBe(7);
    expect(receipt.before.match3Board).toEqual(level.board);
    expect(worldQuestConfectionMoveState(receipt, progress)).toBe('confirmed');
  });

  it('produces no receipt for invalid moves, exhausted levels, or another quest family', () => {
    expect(prepareWorldQuestConfectionMove(quest.id, initial(), 0, 35)).toBeNull();
    expect(
      prepareWorldQuestConfectionMove(
        quest.id,
        { ...initial(), match3Moves: level.maxMoves },
        2,
        3,
      ),
    ).toBeNull();
    expect(prepareWorldQuestConfectionMove('wq_galecrest_wisps', initial(), 2, 3)).toBeNull();
  });
});
