// Bonus levels for the Galecrest ley puzzle.
//
// Solving the daily board completes the world quest and pays its reward as
// before. It also charges the cache with two harder boards (5x5, then 6x6) on
// the same 90 second clock; each one cleared pays a coin purse
// (world_quest_bonus.ts) on top. The bonus is optional: nothing about the base
// quest waits on it, and a player who walks away keeps the completion.
//
// State lives on the persisted WorldQuestProgress row of a COMPLETED quest:
//   puzzleBonusLevel   the level currently charged (1 or 2); absent when none
//   puzzleBonusClaimed how many bonus levels this offer already paid (0..2)
//   puzzleDay          kept past completion so the bonus boards stay this offer's
//   puzzleRotations / puzzleExpiresAt   the open board, exactly as on the daily
// The same sanitizer that guards the daily fields guards these, for the wire
// and for saves (sanitizeLeyBonusProgress below).

import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { WorldQuestDef, WorldQuestProgress } from './types';
import { awardWorldQuestBonusCopper, worldQuestBonusCopper } from './world_quest_bonus';
import { WORLD_QUEST_LEY_BONUS_LEVELS } from './world_quest_daily_generation';

/** Purse per cleared bonus level (index = level - 1), scaled by character level. */
export const LEY_BONUS_PURSES = Object.freeze([
  Object.freeze({ base: 2_000, perLevel: 150 }),
  Object.freeze({ base: 3_500, perLevel: 250 }),
]);

export function isLeyBonusLevel(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= WORLD_QUEST_LEY_BONUS_LEVELS
  );
}

/** A completed ley quest with a bonus board charged: the cache still answers. */
export function leyBonusPending(
  progress: WorldQuestProgress | undefined,
): progress is WorldQuestProgress {
  return progress?.state === 'completed' && isLeyBonusLevel(progress.puzzleBonusLevel);
}

/** Right after the daily solve: keep the day, charge bonus level 1. */
export function unlockLeyBonus(progress: WorldQuestProgress, day: number | undefined): void {
  progress.puzzleDay = Number.isSafeInteger(day) ? (day as number) : 0;
  progress.puzzleBonusLevel = 1;
  progress.puzzleBonusClaimed = 0;
}

/** A solved bonus board: pay its purse, drop the board, charge the next level or finish. */
export function claimLeyBonus(
  ctx: SimContext,
  meta: PlayerMeta,
  progress: WorldQuestProgress,
): void {
  const level = progress.puzzleBonusLevel;
  if (!isLeyBonusLevel(level)) return;
  const player = ctx.entities.get(meta.entityId);
  const purse = LEY_BONUS_PURSES[level - 1];
  awardWorldQuestBonusCopper(
    ctx,
    meta,
    worldQuestBonusCopper(purse.base, purse.perLevel, player?.level ?? 1),
  );
  progress.puzzleBonusClaimed = level;
  delete progress.puzzleRotations;
  delete progress.puzzleExpiresAt;
  if (level < WORLD_QUEST_LEY_BONUS_LEVELS) progress.puzzleBonusLevel = level + 1;
  else delete progress.puzzleBonusLevel;
}

/** The completed-row arm of the world quest sanitizer: accept only a consistent
 *  bonus (a valid charged level, a claimed count below it, the offer's day), and
 *  let the caller resolve the board rotations against the bonus puzzle. */
export function sanitizeLeyBonusProgress(
  raw: Partial<WorldQuestProgress>,
  normalized: WorldQuestProgress,
  quest: WorldQuestDef,
  day: number | undefined,
): boolean {
  if (quest.objective.type !== 'puzzle' || normalized.state !== 'completed') return false;
  if (!isLeyBonusLevel(raw.puzzleBonusLevel)) {
    if (Number.isSafeInteger(raw.puzzleBonusClaimed) && (raw.puzzleBonusClaimed as number) > 0)
      normalized.puzzleBonusClaimed = Math.min(
        WORLD_QUEST_LEY_BONUS_LEVELS,
        raw.puzzleBonusClaimed as number,
      );
    return false;
  }
  const claimed = Number.isSafeInteger(raw.puzzleBonusClaimed)
    ? Math.max(0, Math.min(raw.puzzleBonusLevel - 1, raw.puzzleBonusClaimed as number))
    : 0;
  normalized.puzzleBonusLevel = raw.puzzleBonusLevel;
  normalized.puzzleBonusClaimed = claimed;
  normalized.puzzleDay = Number.isSafeInteger(day) ? (day as number) : 0;
  return true;
}
