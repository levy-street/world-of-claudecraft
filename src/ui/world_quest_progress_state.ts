import type { WorldQuestProgress } from '../sim/types';

export function worldQuestReadsCompleted(progress: WorldQuestProgress | undefined): boolean {
  return (
    progress?.state === 'completed' ||
    progress?.practiceOnly === true ||
    progress?.glider?.practiceOnly === true
  );
}

export function worldQuestReadsActive(progress: WorldQuestProgress | undefined): boolean {
  return progress?.state === 'active' && !worldQuestReadsCompleted(progress);
}
