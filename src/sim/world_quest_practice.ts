import type { WorldQuestDef, WorldQuestProgress } from './types';

/** A practice run is active only for the minigame; its daily reward is already claimed. */
export function worldQuestCompletedForBoard(progress: WorldQuestProgress | undefined): boolean {
  return (
    !!progress &&
    (progress.state === 'completed' ||
      progress.practiceOnly === true ||
      progress.glider?.practiceOnly === true)
  );
}

export function isReplayableWorldQuest(quest: WorldQuestDef): boolean {
  return [
    'glider',
    'vehicle',
    'forging',
    'wisp_maze',
    'tracing',
    'shadow',
    'puzzle',
    'match3',
  ].includes(quest.objective.type);
}

/** Call only after validating the activity's physical start. */
export function beginWorldQuestPractice(progress: WorldQuestProgress): void {
  if (progress.state !== 'completed') return;
  progress.practiceOnly = true;
  progress.practiceTraceScores = progress.traceScores?.map((score) => ({ ...score }));
  progress.state = 'active';
  progress.count = 0;
  delete progress.creditedObjects;
  delete progress.traceScores;
  delete progress.tracing;
  delete progress.match3Board;
  delete progress.match3Moves;
  delete progress.match3RefillIndex;
}
