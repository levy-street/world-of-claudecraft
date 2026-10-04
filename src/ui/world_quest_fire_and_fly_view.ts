// Fire and Fly's world quest tracker line. Master Gunner Alder's trials and missions
// live on his Gunnery Board (src/ui/hud/quest/gunnery_board_view.ts). Pure.

import type { WorldQuestProgress } from '../sim/types';
import { t } from './i18n';

/** The tracker's instruction line while the player is at the gate. */
export function fireAndFlyInstructionLines(progress: Pick<WorldQuestProgress, 'state'>): string[] {
  return [
    t(
      progress.state === 'completed'
        ? 'questUi.worldQuest.fireAndFly.complete'
        : 'questUi.worldQuest.fireAndFly.ready',
    ),
  ];
}
