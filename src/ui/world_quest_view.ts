import { ITEMS, WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestDef } from '../sim/types';
import { worldQuestRewardAmount } from '../sim/world_quests';
import { mobDisplayName } from './entity_display_labels';
import { itemDisplayName, zoneDisplayName } from './entity_i18n';
import { formatList, formatMoney, formatNumber, t } from './i18n';
import { ownEntry } from './known_item';

export function worldQuestDef(questId: string): WorldQuestDef | null {
  return ownEntry(WORLD_QUESTS_BY_ID, questId) ?? null;
}

export function worldQuestDisplayName(questId: string): string {
  const quest = worldQuestDef(questId);
  if (!quest) return t('questUi.worldQuest.unknown', { id: questId });
  return t('questUi.worldQuest.title', {
    zone: zoneDisplayName(quest.zoneId),
    target: worldQuestObjectiveLabel(questId),
  });
}

export function worldQuestObjectiveLabel(questId: string): string {
  const quest = worldQuestDef(questId);
  if (!quest) return t('questUi.worldQuest.unknown', { id: questId });
  if (quest.objective.type === 'kill') return mobDisplayName(quest.objective.targetMobId);
  if (quest.objective.type === 'escort') {
    return t('questUi.worldQuest.escortCaravan', { zone: zoneDisplayName(quest.zoneId) });
  }
  if (quest.objective.type === 'gather') return t('questUi.worldQuest.mineOre');
  if (quest.objective.type === 'puzzle') return t('questUi.worldQuest.redirectLeyBeam');
  if (quest.objective.type === 'match3') return t('questUi.worldQuest.matchConfections');
  if (quest.objective.type === 'delivery') return t('questUi.worldQuest.loadFreight');
  if (quest.objective.type === 'salvage') return t('questUi.worldQuest.salvageWreckage');
  const item = ownEntry(ITEMS, quest.objective.targetObjectItemId);
  return t('questUi.worldQuest.recoverObject', {
    name: item ? itemDisplayName(item) : quest.objective.targetObjectItemId,
  });
}

export function worldQuestStatusText(state: 'available' | 'active'): string {
  return t(
    state === 'active' ? 'questUi.worldQuest.activeStatus' : 'questUi.worldQuest.availableStatus',
  );
}

export function worldQuestRewardText(quest: WorldQuestDef, level: number): string {
  if (quest.reward.type === 'xp') {
    const amount = worldQuestRewardAmount(quest.reward, level);
    return t('questUi.detail.xpReward', {
      xp: formatNumber(amount, { maximumFractionDigits: 0 }),
    });
  }
  if (quest.reward.type === 'copper') {
    return formatMoney(worldQuestRewardAmount(quest.reward, level));
  }
  const item = ownEntry(ITEMS, quest.reward.itemId);
  const name = item ? itemDisplayName(item) : quest.reward.itemId;
  return t('questUi.worldQuest.itemReward', { name });
}

export function worldQuestRewardLine(quest: WorldQuestDef, level: number): string {
  return t('questUi.worldQuest.rewardLine', { reward: worldQuestRewardText(quest, level) });
}

function durationUnit(value: number, unit: 'day' | 'hour' | 'minute'): string {
  return formatNumber(value, { style: 'unit', unit, unitDisplay: 'long' });
}

/** Localized multi-part countdown for the host-authoritative rotation deadline. */
export function worldQuestTimeRemainingText(expiresAtMs: number, nowMs: number): string {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0 || !Number.isFinite(nowMs)) return '';
  const totalMinutes = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(durationUnit(days, 'day'));
  if (hours > 0) parts.push(durationUnit(hours, 'hour'));
  if (minutes > 0 || parts.length === 0) parts.push(durationUnit(minutes, 'minute'));
  return t('questUi.worldQuest.expiresIn', { time: formatList(parts) });
}
