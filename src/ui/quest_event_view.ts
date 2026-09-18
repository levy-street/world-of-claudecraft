// Pure presentation model for ordinary and world-quest SimEvents. Hud applies
// the returned effects through its existing banner/log/sound ports; keeping the
// event-family switch here prevents the coordinator monolith from growing.

import { WEEKLY_QUESTS_BY_ID } from '../sim/content/weekly_quests';
import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { SimEvent } from '../sim/types';
import { questTitle } from './entity_display_core';
import { cannonResultText } from './hud/vehicle/cannon_tactics_view';
import { formatNumber, t } from './i18n';
import { ownEntry } from './known_item';
import { questProgressEventText } from './quest_progress_text';
import type { WorldQuestLeyRotation } from './world_quest_ley_view';
import { worldQuestTraceScoreText } from './world_quest_trace_view';
import { worldQuestDisplayName, worldQuestObjectiveLabel } from './world_quest_view';

function weeklyKind(questId: string): 'dungeons' | 'raid' | 'battlegrounds' | 'worldboss' {
  return WEEKLY_QUESTS_BY_ID[questId]?.kind ?? 'dungeons';
}

function weeklyCategory(questId: string): string {
  return t(`hudChrome.weekly.kinds.${weeklyKind(questId)}.category`);
}

export interface QuestEventPresentation {
  bannerText?: string;
  logText?: string;
  flashText?: string;
  sound?: 'quest_accept' | 'quest_ready' | 'quest_complete';
  refreshQuestDialog?: boolean;
  mountOwnedPrompt?: boolean;
  openWorldQuestPuzzle?: string;
  closeWorldQuestPuzzle?: string;
  completeWorldQuestPuzzle?: string;
  updateWorldQuestPuzzle?: WorldQuestLeyRotation;
  /** Design-ready hook; current Ley rules have no authoritative loss signal. */
  failWorldQuestPuzzle?: string;
}

export function questEventPresentation(event: SimEvent): QuestEventPresentation | null {
  switch (event.type) {
    case 'cannonResult': {
      const text = cannonResultText(event);
      return text ? { bannerText: text, logText: text, sound: 'quest_complete' } : null;
    }
    case 'questAccepted':
      return { sound: 'quest_accept', refreshQuestDialog: true };
    case 'questProgress': {
      // The classic yellow top-center flash ("Forest Wolf slain: 3/8"); the
      // log line stays the durable, announced copy.
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
    case 'worldQuestBanner': {
      const text = t(`questUi.worldQuest.banner.${event.banner}` as const);
      return {
        bannerText: text,
        logText: text,
        sound: event.banner === 'championFallen' ? 'quest_complete' : 'quest_ready',
      };
    }
    case 'worldQuestWeeklyChosen': {
      const text = t('hudChrome.weekly.chosen', { category: weeklyCategory(event.questId) });
      return { bannerText: text, logText: text, sound: 'quest_accept' };
    }
    case 'worldQuestWeeklyProgress': {
      const text = t('hudChrome.weekly.progress', {
        label: t(`hudChrome.weekly.kinds.${weeklyKind(event.questId)}.goalLabel`),
        count: formatNumber(event.count, { maximumFractionDigits: 0 }),
        required: formatNumber(event.required, { maximumFractionDigits: 0 }),
      });
      return { logText: text, flashText: text };
    }
    case 'worldQuestWeeklyDone': {
      const text = t('hudChrome.weekly.done', { category: weeklyCategory(event.questId) });
      return { bannerText: text, logText: text, sound: 'quest_complete' };
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
      return {
        updateWorldQuestPuzzle: {
          questId: event.questId,
          tileIndex: event.tileIndex,
          rotation: event.rotation,
        },
      };
    case 'worldQuestPuzzleFailed':
      return { failWorldQuestPuzzle: event.questId };
    case 'worldQuestMatch3Updated':
      return {};
    case 'worldQuestDone': {
      const text = t('questUi.logs.completed', {
        name: worldQuestDisplayName(event.questId),
      });
      return {
        bannerText: text,
        logText: event.traceResult
          ? t('questUi.worldQuest.traceCompletionLog', {
              completion: text,
              result: worldQuestTraceScoreText(event.traceResult),
            })
          : text,
        sound: 'quest_complete',
        ...(['match3', 'puzzle'].includes(
          ownEntry(WORLD_QUESTS_BY_ID, event.questId)?.objective.type ?? '',
        )
          ? { completeWorldQuestPuzzle: event.questId }
          : { closeWorldQuestPuzzle: event.questId }),
      };
    }
    default:
      return null;
  }
}
