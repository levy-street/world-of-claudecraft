// Pure presentation model for ordinary and world-quest SimEvents. Hud applies
// the returned effects through its existing banner/log/sound ports; keeping the
// event-family switch here prevents the coordinator monolith from growing.

import { CLUE_HUNTS_BY_ID } from '../sim/content/clue_hunts';
import { ITEMS, WORLD_QUESTS_BY_ID } from '../sim/data';
import type { SimEvent } from '../sim/types';
import { questTitle } from './entity_display_core';
import { itemDisplayName } from './entity_i18n';
import { cannonResultText } from './hud/vehicle/cannon_tactics_view';
import { formatList, formatMoney, formatNumber, type TranslationKey, t } from './i18n';
import { ownEntry } from './known_item';
import { questProgressEventText } from './quest_progress_text';
import type { WorldQuestLeyRotation } from './world_quest_ley_view';
import { worldQuestTraceScoreText } from './world_quest_trace_view';
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
    // Clue Scrolls (world quests, Stage 3): the sim emits ids and step indices,
    // the prose is the clues.* catalog (src/ui/i18n.catalog/clues.ts).
    case 'clueScrollEarned':
      return { logText: t('questUi.logs.clueScrollEarned'), sound: 'quest_ready' };
    case 'clueScrollLost':
      return { logText: t('questUi.logs.clueScrollLost') };
    case 'clueHuntStarted': {
      const text = t('questUi.logs.clueHuntStarted', { title: clueHuntTitle(event.huntId) });
      return { bannerText: text, logText: text, sound: 'quest_accept' };
    }
    case 'clueHuntStep':
      return {
        logText: t('questUi.logs.clueHuntStep', {
          title: clueHuntTitle(event.huntId),
          step: formatNumber(event.step + 1, { maximumFractionDigits: 0 }),
          total: formatNumber(event.total, { maximumFractionDigits: 0 }),
        }),
        sound: 'quest_ready',
      };
    case 'clueHuntDone': {
      const text = t('questUi.logs.clueHuntDone', { title: clueHuntTitle(event.huntId) });
      return { bannerText: text, logText: text, sound: 'quest_complete' };
    }
    case 'clueHuntAbandoned':
      return {
        logText: t('questUi.logs.clueHuntAbandoned', { title: clueHuntTitle(event.huntId) }),
      };
    case 'clueCasketOpened':
      return {
        logText: t('questUi.logs.clueCasketOpened', {
          money: formatMoney(event.copper),
          items: formatList(
            event.itemIds.map((itemId) => {
              const def = ownEntry(ITEMS, itemId);
              return def ? itemDisplayName(def) : itemId;
            }),
          ),
        }),
        sound: 'quest_complete',
      };
    default:
      return null;
  }
}

/** The hunt's title from the clue catalog; a retired id reads as its raw id. */
export function clueHuntTitle(huntId: string): string {
  return CLUE_HUNTS_BY_ID[huntId] ? t(`clues.${huntId}.title` as TranslationKey) : huntId;
}

/** The clue prose for one step of a hunt. */
export function clueStepText(huntId: string, step: number): string {
  return t(`clues.${huntId}.${step}` as TranslationKey);
}
