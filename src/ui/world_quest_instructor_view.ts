// Pure presentation model for World Quest instructors and escort starters.
// Resolves dialogue briefings and explicit start options for QuestDialogController.

import { WISP_MAZE_PROFILES } from '../sim/content/wisp_maze_layouts';
import { GLIDER_APPRENTICE_NPC_DEF, GLIDER_QUEST_ID } from '../sim/content/world_quest_glider';
import { ESCORTS, NPCS, WORLD_QUESTS, WORLD_QUESTS_BY_ID } from '../sim/data';
import type { Entity } from '../sim/types';
import {
  WORLD_QUEST_DIFFICULTIES,
  type WorldQuestDifficulty,
  worldQuestOffersDifficulty,
} from '../sim/world_quest_activity';
import { isReplayableWorldQuest } from '../sim/world_quest_practice';
import type { IWorld } from '../world_api';
import { tEntity } from './entity_i18n';
import { formatNumber, t } from './i18n';
import { worldQuestDisplayName, worldQuestObjectiveLabel } from './world_quest_view';

export interface WorldQuestInstructorDialogView {
  speakerName: string;
  speakerTitle: string;
  greeting: string;
  questTitle: string;
  objectiveText: string;
  canStart: boolean;
  active: boolean;
  completed: boolean;
  buttonLabel: string;
  hint?: string;
  /** Present when the activity offers a difficulty pick: one start button per
   *  entry replaces the single start button. Order is the display order. */
  difficulties?: readonly { difficulty: WorldQuestDifficulty; label: string }[];
  questId?: string;
}

function difficultyChoices(
  questId: string,
): WorldQuestInstructorDialogView['difficulties'] | undefined {
  if (!worldQuestOffersDifficulty(questId)) return undefined;
  return WORLD_QUEST_DIFFICULTIES.map((difficulty) => ({
    difficulty,
    label: t(
      difficulty === 'hard'
        ? 'questUi.worldQuest.wispMaze.startHard'
        : 'questUi.worldQuest.wispMaze.startNormal',
      {
        shadows: formatNumber(WISP_MAZE_PROFILES[difficulty].enemyCount),
      },
    ),
  }));
}

function instructorQuestId(templateId: string): string | null {
  if (templateId === GLIDER_APPRENTICE_NPC_DEF.id) return GLIDER_QUEST_ID;
  for (const quest of WORLD_QUESTS) {
    if ('instructorNpcId' in quest.objective && quest.objective.instructorNpcId === templateId) {
      return quest.id;
    }
  }
  return null;
}

export function isWorldQuestInstructorOrEscort(target: Entity): boolean {
  if (target.kind === 'npc') {
    return instructorQuestId(target.templateId) !== null;
  }
  if (target.kind === 'mob' && !target.dead) {
    return Object.values(ESCORTS).some(
      (escort) => escort.npcMobId === target.templateId && escort.worldQuestId !== undefined,
    );
  }
  return false;
}

export function worldQuestInstructorDialog(
  world: Pick<IWorld, 'worldQuestLog' | 'player'>,
  target: Entity,
): WorldQuestInstructorDialogView | null {
  if (!isWorldQuestInstructorOrEscort(target)) return null;

  let questId: string | null = null;
  let speakerName = '';
  let speakerTitle = '';
  let greeting = '';
  let buttonLabel = t('questUi.worldQuest.startQuest');

  if (target.kind === 'npc') {
    const def = NPCS[target.templateId];
    speakerName = def
      ? tEntity({ kind: 'npc', id: target.templateId, field: 'name' })
      : target.templateId;
    speakerTitle = def ? tEntity({ kind: 'npc', id: target.templateId, field: 'title' }) : '';
    greeting = def ? tEntity({ kind: 'npc', id: target.templateId, field: 'greeting' }) : '';

    questId = instructorQuestId(target.templateId);
  } else if (target.kind === 'mob' && !target.dead) {
    const escort = Object.values(ESCORTS).find(
      (entry) => entry.npcMobId === target.templateId && entry.worldQuestId !== undefined,
    );
    if (!escort || !escort.worldQuestId) return null;
    questId = escort.worldQuestId;
    speakerName =
      escort.story?.speaker ?? tEntity({ kind: 'mob', id: target.templateId, field: 'name' });
    speakerTitle = t('questUi.worldQuest.escortTitle');
    greeting = escort.startText ?? '';
    buttonLabel = t('questUi.worldQuest.startEscort');
  }

  if (!questId) return null;
  const quest = WORLD_QUESTS_BY_ID[questId];
  if (!quest) return null;

  const progress = world.worldQuestLog.get(questId);
  const completed = progress?.state === 'completed';
  const active = progress?.state === 'active';

  let canStart = false;
  let hint: string | undefined;

  if (world.player.dead || world.player.level < quest.minLevel) {
    canStart = false;
  } else if (completed) {
    if (isReplayableWorldQuest(quest)) {
      canStart = true;
      if (target.templateId !== GLIDER_APPRENTICE_NPC_DEF.id) {
        buttonLabel = t(
          quest.objective.type === 'glider'
            ? 'questUi.worldQuest.glider.replay'
            : 'questUi.worldQuest.replay',
        );
        hint = t('questUi.worldQuest.practiceRewards');
      }
    } else {
      canStart = false;
      hint = t('questUi.worldQuest.alreadyCompleted');
    }
  } else if (!active || world.player.dead || world.player.level < quest.minLevel) {
    canStart = false;
  } else if (progress?.state === 'active') {
    if (
      quest.objective.type === 'wisp_maze' &&
      !progress.wispMaze?.paused &&
      (progress.wispMaze?.phase === 'countdown' || progress.wispMaze?.phase === 'active')
    ) {
      canStart = false;
    } else if (
      quest.objective.type === 'forging' &&
      (progress.forging?.phase === 'countdown' || progress.forging?.phase === 'working')
    ) {
      canStart = false;
      hint = t('questUi.worldQuest.inProgress');
    } else {
      canStart = true;
    }
  }

  if (
    canStart &&
    (progress?.forging?.phase === 'countdown' ||
      progress?.forging?.phase === 'working' ||
      (progress?.wispMaze && !progress.wispMaze.paused && progress.wispMaze.phase !== 'won'))
  )
    canStart = false;
  const difficulties = canStart ? difficultyChoices(questId) : undefined;
  return {
    speakerName,
    speakerTitle,
    greeting,
    questTitle: worldQuestDisplayName(questId),
    objectiveText: worldQuestObjectiveLabel(questId),
    canStart,
    active,
    completed,
    buttonLabel,
    hint,
    questId,
    ...(difficulties ? { difficulties } : {}),
  };
}
