// Pure, host-agnostic view model for the quest-log window.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference arena_window_view.ts / market_view.ts). It models the two
// things the quest log decides that are worth testing without a DOM: the list of
// quest entries (ready vs active, which is selected) and, for the selected quest,
// the detail panel's structure (objectives with progress, rewards, the turn-in
// target). The DOM/i18n side lives in questlog_window.ts.
//
// This is the in-game quest LOG window, not the always-on quest TRACKER (that is
// quest_tracker.ts, a separate pure core); the two share only the underlying
// IWorld.questLog, so there are no tracker rows to re-derive here.
//
// DOM-free and i18n-free: entries carry raw quest / npc / item ids + raw numbers;
// the painter localizes titles, objective labels, narrative, and reward names. The
// questLog/questsDone shape is identical for the offline Sim and the online
// ClientWorld mirror, so the two produce identical models.

import { QUESTS, questRewardItem } from '../../../sim/data';
import type { PlayerClass, QuestProgress } from '../../../sim/types';
import { questObjectiveRequired } from '../../../sim/types';

/** One row in the quest list column. */
export interface QuestLogItem {
  questId: string;
  /** state === 'ready' (objectives complete, ready to turn in). */
  ready: boolean;
  selected: boolean;
}

/** One objective row in the selected quest's detail panel. */
export interface QuestObjectiveModel {
  index: number;
  count: number;
  required: number;
  done: boolean;
}

/** The selected quest's detail panel structure (ids + raw numbers only). */
export interface QuestDetailModel {
  questId: string;
  /** Group-quest "suggested players" hint, when set on the quest def. */
  suggestedPlayers: number | undefined;
  objectives: QuestObjectiveModel[];
  xpReward: number;
  copperReward: number;
  /** The class-appropriate reward item id, or null when the quest grants none. */
  rewardItemId: string | null;
  turnInNpcId: string;
}

/** The full quest-log view-model. */
export interface QuestLogView {
  /** The title summary counts (active = open quests, completed = turned in). */
  summary: { active: number; completed: number };
  items: QuestLogItem[];
  /** The resolved selection (falls back to the first quest when stale / unset). */
  selectedQuestId: string | null;
  detail: QuestDetailModel | null;
  /** No quests in the log. */
  empty: boolean;
}

/** Inputs the painter feeds the builder each render, all IWorld-mirrored. */
export interface QuestLogInput {
  /** The active quest log entries (sim.questLog.values()). */
  quests: readonly QuestProgress[];
  /** The painter-owned current selection (Hud state, like the inline window). */
  selectedQuestId: string | null;
  playerClass: PlayerClass;
  /** sim.questsDone.size, for the title summary. */
  completedCount: number;
}

/**
 * Build the quest-log view-model. Resolves the selection (a stale or unset id
 * falls back to the first quest), maps the list rows, and derives the selected
 * quest's detail structure (objectives with progress, rewards, the class reward
 * item, the turn-in npc). Reads only IWorld-mirrored data, so the offline Sim and
 * the online ClientWorld mirror produce identical models.
 */
export function buildQuestLogView(input: QuestLogInput): QuestLogView {
  const { quests, playerClass } = input;
  const summary = { active: quests.length, completed: input.completedCount };
  const hasSelection =
    input.selectedQuestId !== null && quests.some((q) => q.questId === input.selectedQuestId);
  const selectedQuestId = hasSelection ? input.selectedQuestId : (quests[0]?.questId ?? null);

  const items: QuestLogItem[] = quests.map((qp) => ({
    questId: qp.questId,
    ready: qp.state === 'ready',
    selected: qp.questId === selectedQuestId,
  }));

  let detail: QuestDetailModel | null = null;
  if (selectedQuestId) {
    const qp = quests.find((q) => q.questId === selectedQuestId);
    const quest = QUESTS[selectedQuestId];
    if (qp && quest) {
      detail = {
        questId: selectedQuestId,
        suggestedPlayers: quest.suggestedPlayers,
        objectives: quest.objectives.map((_o, i) => {
          const required = questObjectiveRequired(quest, qp, i);
          return {
            index: i,
            count: qp.counts[i],
            required,
            done: qp.counts[i] >= required,
          };
        }),
        xpReward: quest.xpReward,
        copperReward: quest.copperReward,
        rewardItemId: questRewardItem(quest, playerClass) ?? null,
        turnInNpcId: quest.turnInNpcId,
      };
    }
  }

  return {
    summary,
    items,
    selectedQuestId,
    detail,
    empty: quests.length === 0,
  };
}
