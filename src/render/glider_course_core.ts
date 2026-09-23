import type { WorldQuestProgress } from '../sim/types';

/** Course guidance belongs only to the local player's live flight attempt. */
export function gliderCourseVisible(progress: WorldQuestProgress | undefined): boolean {
  return (
    progress?.state === 'active' &&
    (progress.glider?.phase === 'countdown' || progress.glider?.phase === 'flying')
  );
}
