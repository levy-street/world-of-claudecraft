/** Pure projection for the guard investigation, shared by dialogue and tracker. */
import {
  INVESTIGATION_CLUES,
  INVESTIGATION_NPC_IDS,
  INVESTIGATION_NPCS,
  INVESTIGATION_QUEST_ID,
  INVESTIGATION_VARIANTS,
} from '../sim/content/world_quest_investigation';
import type { WorldQuestProgress } from '../sim/types';
import { worldQuestPuzzleVariantForCycle } from '../sim/world_quest_rotation';
import type { IWorld } from '../world_api';
import { formatNumber, t } from './i18n';

type InvestigationWorld = Pick<IWorld, 'worldQuestCycle' | 'worldQuestLog'>;
type VariantIndex = 0 | 1 | 2 | 3 | 4 | 5;
type GuardIndex = 0 | 1 | 2 | 3;

/** One guard the sergeant can be told to arrest. */
export interface InvestigationSuspect {
  npcId: number;
  templateId: string;
}

export interface InvestigationDialogueView {
  title: string;
  text: string;
  hint: string;
  /** True on the sergeant's dialog once every story and record is in hand. */
  accuse: boolean;
  /** The guards not yet cleared, in post order; empty everywhere but the sergeant. */
  suspects: InvestigationSuspect[];
  finished: boolean;
}

export function isInvestigationTarget(id: number): boolean {
  return (
    (INVESTIGATION_NPC_IDS as readonly number[]).includes(id) ||
    INVESTIGATION_CLUES.some((clue) => clue.entityId === id)
  );
}
export function investigationSignature(world: InvestigationWorld): string {
  const progress = world.worldQuestLog.get(INVESTIGATION_QUEST_ID);
  return JSON.stringify([world.worldQuestCycle, progress?.state, progress?.investigation]);
}
export function investigationDialogue(
  world: InvestigationWorld,
  targetId: number,
): InvestigationDialogueView | null {
  if (!isInvestigationTarget(targetId)) return null;
  const progress = world.worldQuestLog.get(INVESTIGATION_QUEST_ID);
  const state = progress?.investigation;
  const variant = worldQuestPuzzleVariantForCycle(
    world.worldQuestCycle,
    INVESTIGATION_VARIANTS.length,
  ) as VariantIndex;
  const clue = INVESTIGATION_CLUES.findIndex((entry) => entry.entityId === targetId);
  const guard = (INVESTIGATION_NPC_IDS as readonly number[]).indexOf(targetId) - 1;
  const captain = targetId === INVESTIGATION_NPC_IDS[0];
  const ready = state?.heard === 15 && state.clues === 3;
  const clearedMask = state?.cleared ?? 0;
  const cleared = guard >= 0 && !!(clearedMask & (1 << guard));
  const finished = progress?.state === 'completed' || state?.mobId !== undefined;
  const accuse = progress?.state === 'active' && ready && captain && !finished;
  const suspects: InvestigationSuspect[] = accuse
    ? INVESTIGATION_NPCS.slice(1)
        .map((npc, index) => ({ npcId: INVESTIGATION_NPC_IDS[index + 1], templateId: npc.id }))
        .filter((_, index) => !(clearedMask & (1 << index)))
    : [];
  return {
    title:
      clue >= 0
        ? t(`questUi.worldQuest.investigation.clueNames.c${clue as 0 | 1}`)
        : t('questUi.worldQuest.investigation.title'),
    text: finished
      ? t('questUi.worldQuest.investigation.revealed')
      : clue >= 0
        ? t(`questUi.worldQuest.investigation.variants.v${variant}.clue${clue as 0 | 1}`)
        : guard >= 0
          ? t(`questUi.worldQuest.investigation.variants.v${variant}.guard${guard as GuardIndex}`)
          : t('questUi.worldQuest.investigation.briefing'),
    hint: captain
      ? clearedMask !== 0 && accuse
        ? t('questUi.worldQuest.investigation.cleared')
        : accuse
          ? t('questUi.worldQuest.investigation.name')
          : t('questUi.worldQuest.investigation.instructions')
      : cleared
        ? t('questUi.worldQuest.investigation.guardCleared')
        : ready
          ? t('questUi.worldQuest.investigation.confront')
          : t('questUi.worldQuest.investigation.instructions'),
    accuse,
    suspects,
    finished,
  };
}
export function investigationInstructionLines(progress: WorldQuestProgress): string[] {
  const state = progress.investigation;
  if (state?.mobId !== undefined) return [t('questUi.worldQuest.investigation.defeat')];
  if (state?.heard === 15 && state.clues === 3)
    return [t('questUi.worldQuest.investigation.confront')];
  const count = (mask: number) => formatNumber(mask.toString(2).replaceAll('0', '').length);
  return [
    t('questUi.worldQuest.investigation.heard', { count: count(state?.heard ?? 0) }),
    t('questUi.worldQuest.investigation.clues', { count: count(state?.clues ?? 0) }),
  ];
}
