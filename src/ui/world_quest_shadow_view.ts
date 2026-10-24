import { SHADOW_QUEST_ID } from '../sim/content/world_quest_shadow';
import type { WorldQuestProgress } from '../sim/types';
import {
  type ShadowTargetWorld,
  shadowNearbyCarrier,
  shadowPickpocketTarget,
} from '../sim/world_quest_shadow_target';
import { type ActionBarState, makeSlotState } from './hud/action_bar/action_bar_view';
import { formatNumber, t } from './i18n';

export function shadowInstructionLines(progress: WorldQuestProgress): string[] {
  if (progress.state === 'completed') return [t('questUi.worldQuest.shadow.complete')];
  if (progress.shadow?.phase === 'caught') return [t('questUi.worldQuest.shadow.caught')];
  if (!progress.shadow) return [t('questUi.worldQuest.shadow.start')];
  return [
    t('questUi.worldQuest.shadow.documents', { count: formatNumber(progress.count) }),
    t('questUi.worldQuest.shadow.safe'),
  ];
}
export function createShadowActionBarView() {
  const state: ActionBarState = { slots: [makeSlotState(), makeSlotState()], manySpells: false };
  return {
    tick(world: ShadowTargetWorld, keyLabel: (slot: number) => string) {
      const shadow = world.worldQuestLog.get(SHADOW_QUEST_ID)?.shadow;
      for (let i = 0; i < 2; i++) {
        const slot = state.slots[i];
        slot.kind = 'ability';
        slot.iconKey = i === 0 ? 'sap' : 'stealth';
        slot.abilityId = i === 0 ? 'pickpocket' : 'leave';
        slot.ariaLabel = t(
          i === 0 ? 'questUi.worldQuest.shadow.pickpocket' : 'questUi.worldQuest.shadow.leave',
        );
        slot.ariaDescription = t(
          i === 0 ? 'questUi.worldQuest.shadow.stealTip' : 'questUi.worldQuest.shadow.leaveTip',
        );
        slot.keybindLabel = keyLabel(i);
        slot.cooldownRemaining = i === 0 ? (shadow?.cooldown ?? 0) : 0;
        slot.cooldownTotal = Math.max(1, slot.cooldownRemaining);
        slot.cooldownPercent = slot.cooldownRemaining > 0 ? 100 : 0;
        slot.cdText =
          slot.cooldownRemaining > 0 ? formatNumber(Math.ceil(slot.cooldownRemaining)) : '';
        slot.usable =
          !world.player.dead &&
          shadow?.phase === 'cloaked' &&
          (i === 1 ||
            (!shadow.stealing &&
              shadow.suspicion <= 0 &&
              shadow.cooldown <= 0 &&
              shadowPickpocketTarget(world) !== undefined));
      }
      return state;
    },
  };
}

export function shadowActionHint(world: ShadowTargetWorld): string {
  const shadow = world.worldQuestLog.get(SHADOW_QUEST_ID)?.shadow;
  if (shadow?.stealing)
    return t('questUi.worldQuest.shadow.channel', {
      seconds: formatNumber(shadow.stealing.remaining, { maximumFractionDigits: 1 }),
    });
  if (shadow && shadow.suspicion > 0) return t('questUi.worldQuest.shadow.danger');
  if (shadowPickpocketTarget(world) !== undefined) return t('questUi.worldQuest.shadow.stealTip');
  if (shadowNearbyCarrier(world) !== undefined) return t('questUi.worldQuest.shadow.behind');
  return t('questUi.worldQuest.shadow.noTarget');
}
