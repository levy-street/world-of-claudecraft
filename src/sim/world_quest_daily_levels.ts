import type { WorldQuestDef, WorldQuestProgress } from './types';
import {
  generateBonusLeyPuzzle,
  generateDailyLeyPuzzle,
  generateDailyMatch3Level,
  WORLD_QUEST_DAILY_GENERATION_CYCLE,
} from './world_quest_daily_generation';
import { isLeyBonusLevel } from './world_quest_ley_bonus';

export function worldQuestDisplayedLevel(
  progress: WorldQuestProgress,
  authoredCount: number,
): number {
  return (
    1 +
    (Number.isSafeInteger(progress.puzzleDay)
      ? worldQuestLevelVariant(
          { ...progress, puzzleVariant: progress.puzzleDay },
          WORLD_QUEST_DAILY_GENERATION_CYCLE,
        )
      : worldQuestLevelVariant(progress, authoredCount))
  );
}

/** Missing markers retain authored saves and explicit developer-selected levels. */
export function worldQuestLevelVariant(progress: WorldQuestProgress, count: number): number {
  if (count <= 0) return 0;
  const raw = Number.isSafeInteger(progress.puzzleVariant) ? (progress.puzzleVariant as number) : 0;
  return ((raw % count) + count) % count;
}

export function resolveWorldQuestLeyPuzzle(quest: WorldQuestDef, progress: WorldQuestProgress) {
  if (quest.objective.type !== 'puzzle') return null;
  // A charged bonus board on a completed quest: the larger generated board for
  // this offer's day (sim/world_quest_ley_bonus.ts owns the state).
  if (progress.state === 'completed' && isLeyBonusLevel(progress.puzzleBonusLevel))
    return generateBonusLeyPuzzle(
      Number.isSafeInteger(progress.puzzleDay) ? (progress.puzzleDay as number) : 0,
      progress.puzzleBonusLevel,
    );
  return Number.isSafeInteger(progress.puzzleDay)
    ? generateDailyLeyPuzzle(progress.puzzleDay as number)
    : (quest.objective.puzzles[worldQuestLevelVariant(progress, quest.objective.puzzles.length)] ??
        null);
}

export function resolveWorldQuestMatch3Level(quest: WorldQuestDef, progress: WorldQuestProgress) {
  if (quest.objective.type !== 'match3') return null;
  return Number.isSafeInteger(progress.puzzleDay)
    ? generateDailyMatch3Level(progress.puzzleDay as number)
    : (quest.objective.levels[worldQuestLevelVariant(progress, quest.objective.levels.length)] ??
        null);
}
