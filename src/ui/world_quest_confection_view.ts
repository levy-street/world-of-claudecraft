import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestProgress } from '../sim/types';
import { resolveWorldQuestMatch3Level } from '../sim/world_quest_daily_levels';
import {
  sanitizeWorldQuestMatch3Board,
  traceWorldQuestMatch3Move,
} from '../sim/world_quest_match3';
import { ownEntry } from './known_item';
import type { WorldQuestMatch3PresentationProgress } from './world_quest_match3_view';

/** Completed wire rows omit the puzzle. Retain only previously observed world data. */
export function resolveWorldQuestConfectionProgress(
  questId: string,
  progress: WorldQuestProgress | undefined,
  retained: WorldQuestMatch3PresentationProgress | undefined,
  completedEvent: boolean,
): WorldQuestMatch3PresentationProgress | undefined {
  const quest = ownEntry(WORLD_QUESTS_BY_ID, questId);
  if (quest?.objective.type !== 'match3') return undefined;
  const current = progress?.questId === questId ? progress : undefined;
  const previous = retained?.questId === questId ? retained : undefined;
  const completed =
    completedEvent || current?.state === 'completed' || previous?.state === 'completed';
  if (!current && !completed) return undefined;
  const observed = current ?? previous;
  if (!observed) return undefined;
  // A late active row cannot roll back an already observed completed board.
  const source =
    previous?.state === 'completed' &&
    current?.state !== 'completed' &&
    (current?.count ?? 0) < quest.count
      ? previous
      : completed
        ? { ...previous, ...observed }
        : observed;
  const hasFinalMoves = (row: WorldQuestMatch3PresentationProgress | undefined) =>
    !!row &&
    (row.state === 'completed' || row.count >= quest.count) &&
    row.match3Moves !== undefined &&
    row.movesKnown !== false;
  return {
    ...source,
    questId,
    state: completed ? 'completed' : source.state,
    count: completed ? quest.count : source.count,
    movesKnown: !completed || hasFinalMoves(current) || hasFinalMoves(previous),
    ...(source.match3Board ? { match3Board: [...source.match3Board] } : {}),
  };
}

export interface WorldQuestConfectionMove {
  before: WorldQuestProgress;
  expectedCount: number;
  trace: ReturnType<typeof traceWorldQuestMatch3Move>;
}

/** A detached visual receipt. The world still decides whether the move happened. */
export function prepareWorldQuestConfectionMove(
  questId: string,
  progress: WorldQuestProgress | undefined,
  fromIndex: number,
  toIndex: number,
): WorldQuestConfectionMove | null {
  const quest = ownEntry(WORLD_QUESTS_BY_ID, questId);
  if (!quest || quest.objective.type !== 'match3' || progress?.state !== 'active') return null;
  const level = resolveWorldQuestMatch3Level(quest, progress);
  if (!level || (progress.match3Moves ?? 0) >= level.maxMoves) return null;
  const board = sanitizeWorldQuestMatch3Board(progress.match3Board, level);
  const trace = traceWorldQuestMatch3Move(
    level,
    board,
    fromIndex,
    toIndex,
    progress.match3RefillIndex ?? 0,
  );
  if (!trace.result.accepted) return null;
  return {
    before: { ...progress, match3Board: board },
    expectedCount: Math.min(quest.count, progress.count + trace.result.cleared),
    trace,
  };
}

export function worldQuestConfectionMoveState(
  move: WorldQuestConfectionMove,
  progress: WorldQuestProgress | undefined,
): 'waiting' | 'confirmed' | 'discarded' {
  const before = move.before;
  if (
    progress?.state !== 'active' ||
    progress.questId !== before.questId ||
    (progress.puzzleVariant ?? 0) !== (before.puzzleVariant ?? 0) ||
    progress.puzzleDay !== before.puzzleDay
  )
    return 'discarded';
  const sameBoard = (board: readonly number[] | undefined) =>
    !!board &&
    progress.match3Board?.length === board.length &&
    board.every((candy, index) => progress.match3Board?.[index] === candy);
  if (
    (progress.match3Moves ?? 0) === (before.match3Moves ?? 0) &&
    progress.count === before.count &&
    (progress.match3RefillIndex ?? 0) === (before.match3RefillIndex ?? 0) &&
    sameBoard(before.match3Board)
  )
    return 'waiting';
  const result = move.trace.result;
  return (progress.match3Moves ?? 0) === (before.match3Moves ?? 0) + 1 &&
    progress.count === move.expectedCount &&
    progress.match3RefillIndex === result.refillIndex &&
    sameBoard(result.board)
    ? 'confirmed'
    : 'discarded';
}
