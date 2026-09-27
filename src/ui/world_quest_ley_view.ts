import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestProgress } from '../sim/types';
import { leyBonusPending } from '../sim/world_quest_ley_bonus';
import { ownEntry } from './known_item';
import { buildWorldQuestPuzzleView, type WorldQuestPuzzleView } from './world_quest_puzzle_view';

export type WorldQuestLeyOutcome = 'playing' | 'won' | 'lost';
export interface WorldQuestLeyRotation {
  questId: string;
  tileIndex: number;
  rotation: number;
}
export interface WorldQuestLeyState {
  questId: string;
  sourceSignature: string;
  snapshot: WorldQuestProgress | null;
  board: WorldQuestPuzzleView | null;
  outcome: WorldQuestLeyOutcome;
  receiptsClosed: boolean;
  expiresAt: number | null;
  secondsRemaining: number;
  /** After a win: the bonus level now charged in the cache (1 or 2), if any. */
  bonusCharged?: number;
  /** After a win: how many bonus purses this offer has paid so far. */
  bonusPaid?: number;
}

/** A charged bonus board the cache has opened: the window plays it like the daily. */
function leyBonusBoardOpen(progress: WorldQuestProgress): boolean {
  return leyBonusPending(progress) && progress.puzzleRotations !== undefined;
}

/** Retain only observed presentation data when completion strips the live board. */
export function resolveWorldQuestLeyState(
  questId: string,
  progress: WorldQuestProgress | undefined,
  now: number,
  previous: WorldQuestLeyState | null,
): WorldQuestLeyState | null {
  if (ownEntry(WORLD_QUESTS_BY_ID, questId)?.objective.type !== 'puzzle' || !progress) return null;
  const prior = previous?.questId === questId ? previous : null;
  const sourceSignature = JSON.stringify(progress);
  const expiresAt =
    typeof progress.puzzleExpiresAt === 'number' && Number.isFinite(progress.puzzleExpiresAt)
      ? progress.puzzleExpiresAt
      : null;
  const secondsRemaining = expiresAt === null ? 0 : Math.max(0, expiresAt - now);
  const bonusOpen = leyBonusBoardOpen(progress);
  // Completion is permanent, except that a charged bonus board the cache has
  // opened plays on after the win. A loss reopens only after the server
  // publishes a new attempt.
  if (prior?.outcome === 'won' && !bonusOpen) return prior;
  if (
    prior?.outcome === 'lost' &&
    !(expiresAt !== null && expiresAt > now && expiresAt !== prior.expiresAt)
  )
    return prior;
  if (progress.state === 'completed' && !bonusOpen) {
    return {
      questId,
      sourceSignature,
      snapshot: prior?.snapshot ?? null,
      board: prior?.board ?? null,
      outcome: 'won',
      receiptsClosed: false,
      expiresAt: prior?.expiresAt ?? null,
      secondsRemaining: 0,
      ...(leyBonusPending(progress) ? { bonusCharged: progress.puzzleBonusLevel } : {}),
      bonusPaid: progress.puzzleBonusClaimed ?? 0,
    };
  }
  if (prior?.sourceSignature === sourceSignature) return prior;
  const board = buildWorldQuestPuzzleView(questId, progress);
  if (!board) return null;
  const snapshot: WorldQuestProgress = bonusOpen
    ? {
        questId,
        state: 'completed',
        count: progress.count,
        puzzleDay: progress.puzzleDay ?? 0,
        puzzleBonusLevel: progress.puzzleBonusLevel,
        puzzleBonusClaimed: progress.puzzleBonusClaimed ?? 0,
        puzzleRotations: board.tiles.map((tile) => tile.rotation),
        ...(expiresAt === null ? {} : { puzzleExpiresAt: expiresAt }),
      }
    : {
        questId,
        state: 'active',
        count: progress.count,
        puzzleVariant: board.level - 1,
        ...(progress.puzzleDay === undefined ? {} : { puzzleDay: progress.puzzleDay }),
        puzzleRotations: board.tiles.map((tile) => tile.rotation),
        ...(expiresAt === null ? {} : { puzzleExpiresAt: expiresAt }),
      };
  const outcome =
    expiresAt === 0 || (expiresAt !== null && secondsRemaining <= 0) ? 'lost' : 'playing';
  return {
    questId,
    sourceSignature,
    snapshot,
    board,
    outcome,
    receiptsClosed: outcome === 'lost',
    expiresAt,
    secondsRemaining,
  };
}

/** Absolute receipts preserve every accepted turn, including turns between paints. */
export function applyWorldQuestLeyRotation(
  state: WorldQuestLeyState | null,
  receipt: WorldQuestLeyRotation,
): WorldQuestLeyState | null {
  if (
    !state?.board ||
    !state.snapshot ||
    state.receiptsClosed ||
    state.outcome === 'lost' ||
    state.questId !== receipt.questId ||
    !Number.isInteger(receipt.tileIndex) ||
    receipt.tileIndex < 0 ||
    receipt.tileIndex >= state.board.tiles.length ||
    !Number.isInteger(receipt.rotation) ||
    receipt.rotation < 0 ||
    receipt.rotation > 3
  )
    return state;
  const rotations = state.board.tiles.map((tile) => tile.rotation);
  if (rotations[receipt.tileIndex] === receipt.rotation) return state;
  rotations[receipt.tileIndex] = receipt.rotation;
  const snapshot = { ...state.snapshot, puzzleRotations: rotations };
  return { ...state, snapshot, board: buildWorldQuestPuzzleView(state.questId, snapshot) };
}

/** Latch an authoritative terminal event until a distinct retry deadline arrives. */
export function setWorldQuestLeyOutcome(
  state: WorldQuestLeyState | null,
  outcome: 'won' | 'lost',
): WorldQuestLeyState | null {
  return state && !state.receiptsClosed ? { ...state, outcome, receiptsClosed: true } : state;
}
