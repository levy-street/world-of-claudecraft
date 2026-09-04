// Pure presentation model for ordinary and world-quest SimEvents. Hud applies
// the returned effects through its existing banner/log/sound ports; keeping the
// event-family switch here prevents the coordinator monolith from growing.

import type { SimEvent } from '../sim/types';
import { questTitle } from './entity_display_labels';
import { formatNumber, t } from './i18n';
import { questProgressEventText } from './quest_progress_text';
import { worldQuestDisplayName, worldQuestObjectiveLabel } from './world_quest_view';

export interface QuestEventPresentation {
  bannerText?: string;
  logText?: string;
  flashText?: string;
  sound?: 'quest_accept' | 'quest_ready' | 'quest_complete';
  refreshQuestDialog?: boolean;
  mountOwnedPrompt?: boolean;
  openWorldQuestPuzzle?: string;
  closeWorldQuestPuzzle?: string;
}

export function questEventPresentation(event: SimEvent): QuestEventPresentation | null {
  switch (event.type) {
    case 'questAccepted':
      return { sound: 'quest_accept', refreshQuestDialog: true };
    case 'questProgress': {
      const text = questProgressEventText(event);
      return { logText: text, flashText: text, refreshQuestDialog: true };
    }
    case 'questReady':
      return {
        bannerText: t('questUi.logs.ready', {
          name: questTitle(event.questId),
          status: t('questUi.log.readyStatus'),
        }),
        sound: 'quest_ready',
        refreshQuestDialog: true,
      };
    case 'questDone':
      return {
        sound: 'quest_complete',
        refreshQuestDialog: true,
        mountOwnedPrompt: event.questId === 'q_riding_lessons',
      };
    case 'worldQuestStarted': {
      const text = t('questUi.logs.worldQuestStarted', {
        name: worldQuestDisplayName(event.questId),
      });
      return { bannerText: text, logText: text, sound: 'quest_accept' };
    }
    case 'worldQuestProgress': {
      const text = t('questUi.detail.objectiveProgress', {
        label: worldQuestObjectiveLabel(event.questId),
        current: formatNumber(event.count, { maximumFractionDigits: 0 }),
        total: formatNumber(event.required, { maximumFractionDigits: 0 }),
      });
      return { logText: text, flashText: text };
    }
    case 'worldQuestPuzzleOpened':
      return { openWorldQuestPuzzle: event.questId };
    case 'worldQuestPuzzleClosed':
      return { closeWorldQuestPuzzle: event.questId };
    case 'worldQuestPuzzleUpdated':
    case 'worldQuestMatch3Updated':
      return {};
    case 'worldQuestDone': {
      const text = t('questUi.logs.completed', {
        name: worldQuestDisplayName(event.questId),
      });
      return {
        bannerText: text,
        logText: text,
        sound: 'quest_complete',
        closeWorldQuestPuzzle: event.questId,
      };
    }
    default:
      return null;
  }
}
