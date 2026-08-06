// Pure, host-agnostic model for the quest-item story tooltip.
// Hovering a quest stack should answer three questions in under a second: which
// quest, how far along, and whether it can be sold / banked / traded. Quest
// treatment is a PURPOSE class (kind === 'quest'), not a quality tier, so the
// title and kind line use quest gold and never a "Common Quest Item" double
// line.
//
// Hierarchy:
//   1. Title in quest gold
//   2. Kind line: "Quest Item" in quest gold (showQuality false)
//   3. Related quest title when questId resolves
//   4. Live collect / gather-with-item progress when the player holds that quest
//   5. Quiet rules footer (cannot sell / bank / trade)
//   6. Orphaned line when not needed for an active quest
//
// Progress resolution takes plain inputs (log entry + objectives + itemId) so
// pure-core tests never need a full Sim. The host localizes quest titles and
// objective labels via tEntity, escapes, and renders HTML.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { TranslationKey } from './i18n';
import { QUEST_ITEM_NAME_COLOR } from './item_name_color';

/** One objective row the host projects from QuestDef.objectives. */
export interface QuestItemObjectiveInput {
  type: string;
  itemId?: string;
  count: number;
}

/** Quest-log progress for the item's questId, or absent when not held. */
export interface QuestItemLogInput {
  counts: readonly number[];
  /** active | ready still need the item; done does not. */
  state: string;
  /** Optional resolved required counts (questObjectiveRequired arm). */
  resolvedCounts?: readonly number[];
}

export interface QuestItemTooltipInput {
  kind: string;
  itemId: string;
  questId?: string;
  /** False when QUESTS[questId] is missing on this client. */
  questKnown?: boolean;
  log?: QuestItemLogInput | null;
  objectives?: readonly QuestItemObjectiveInput[];
}

export interface QuestItemProgressModel {
  objectiveIndex: number;
  current: number;
  required: number;
}

export interface QuestItemTooltipModel {
  /** Title uses quest gold, not quality color. */
  titleColorMode: 'quest';
  /** Always false: never pair a quality word with "Quest Item". */
  showQuality: false;
  /** Kind line is the quest-kind key alone ("Quest Item"). */
  kindLineKey: 'itemUi.kind.quest';
  /** Present when questId is set and the quest def resolves. */
  relatedQuestId?: string;
  /** Live collect / gather progress when the player holds the quest. */
  progress?: QuestItemProgressModel;
  rulesKey: 'itemUi.tooltip.questRules';
  /** True when the item is not needed for an active or ready quest. */
  orphaned: boolean;
  orphanedKey: 'itemUi.tooltip.questOrphaned';
}

/** CSS color token for quest-gold title / kind lines. Same source as chat links
 *  and loot names (`itemNameColor` / `QUEST_ITEM_NAME_COLOR`). */
export const QUEST_ITEM_TOOLTIP_COLOR = QUEST_ITEM_NAME_COLOR;

const RULES_KEY = 'itemUi.tooltip.questRules' as const;
const ORPHANED_KEY = 'itemUi.tooltip.questOrphaned' as const;
const KIND_KEY = 'itemUi.kind.quest' as const;

function isCollectOrGatherWithItem(objective: QuestItemObjectiveInput, itemId: string): boolean {
  if (objective.itemId !== itemId) return false;
  return objective.type === 'collect' || objective.type === 'gather';
}

function holdsActiveQuest(log: QuestItemLogInput | null | undefined): boolean {
  if (!log) return false;
  return log.state === 'active' || log.state === 'ready';
}

function resolveProgress(
  input: QuestItemTooltipInput,
  log: QuestItemLogInput,
): QuestItemProgressModel | undefined {
  const objectives = input.objectives;
  if (!objectives) return undefined;
  for (let i = 0; i < objectives.length; i++) {
    const objective = objectives[i];
    if (!isCollectOrGatherWithItem(objective, input.itemId)) continue;
    const required = log.resolvedCounts?.[i] ?? objective.count;
    const current = log.counts[i] ?? 0;
    return { objectiveIndex: i, current, required };
  }
  return undefined;
}

/** Build the quest-item tooltip model, or null for every non-quest kind. */
export function questItemTooltipModel(input: QuestItemTooltipInput): QuestItemTooltipModel | null {
  if (input.kind !== 'quest') return null;

  const questId = input.questId;
  const log = input.log ?? null;
  const active = !!questId && holdsActiveQuest(log);
  const questKnown = input.questKnown !== false && !!questId;

  return {
    titleColorMode: 'quest',
    showQuality: false,
    kindLineKey: KIND_KEY,
    relatedQuestId: questKnown ? questId : undefined,
    progress: active && log ? resolveProgress(input, log) : undefined,
    rulesKey: RULES_KEY,
    // Not needed for an active quest: missing questId, abandoned, completed
    // (done), or never accepted. Ready still needs the item for turn-in.
    orphaned: !active,
    orphanedKey: ORPHANED_KEY,
  };
}

/** Keys the host must render for the story block under the kind line. */
export function questItemTooltipRelatedKey(): TranslationKey {
  return 'itemUi.tooltip.questRelated';
}
