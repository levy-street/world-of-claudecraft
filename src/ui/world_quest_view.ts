import { ITEMS, WORLD_QUESTS_BY_ID } from '../sim/data';
import { factionDisplayName, worldQuestFaction, worldQuestStandingReward } from '../sim/factions';
import { itemLevel } from '../sim/item_level';
import { requiredLevelFor } from '../sim/item_level_req';
import type { PlayerClass, WorldQuestDef } from '../sim/types';
import { worldQuestItemRewardForQuest } from '../sim/world_quest_item_slots';
import { worldQuestCopperReward, worldQuestXpReward } from '../sim/world_quests';
import { mobDisplayName, vehicleStationDisplayName } from './entity_display_core';
import { itemDisplayName, zoneDisplayName } from './entity_i18n';
import { formatList, formatMoney, formatNumber, t } from './i18n';
import { ownEntry } from './known_item';

export function worldQuestDef(questId: string): WorldQuestDef | null {
  return ownEntry(WORLD_QUESTS_BY_ID, questId) ?? null;
}

export function worldQuestDisplayName(questId: string): string {
  const quest = worldQuestDef(questId);
  if (!quest) return t('questUi.worldQuest.unknown', { id: questId });
  if (quest.objective.type === 'vehicle')
    return vehicleStationDisplayName(quest.objective.stationId);
  if (quest.objective.type === 'shadow') return t('questUi.worldQuest.shadow.title');
  if (quest.objective.type === 'forging') return t('questUi.worldQuest.forge.title');
  if (quest.objective.type === 'wisp_maze') return t('questUi.worldQuest.wispMaze.title');
  if (quest.objective.type === 'glider') return t('questUi.worldQuest.glider.title');
  if (quest.objective.type === 'investigation') return t('questUi.worldQuest.investigation.title');
  if (quest.objective.type === 'tracing') return t('questUi.worldQuest.calligraphyTitle');
  return t('questUi.worldQuest.title', {
    zone: zoneDisplayName(quest.zoneId),
    target: worldQuestObjectiveLabel(questId),
  });
}

export function worldQuestObjectiveLabel(questId: string): string {
  const quest = worldQuestDef(questId);
  if (!quest) return t('questUi.worldQuest.unknown', { id: questId });
  if (quest.objective.type === 'kill') return mobDisplayName(quest.objective.targetMobId);
  if (quest.objective.type === 'vehicle') {
    return t(
      quest.objective.stationId === 'last_keep_cannon'
        ? 'hudChrome.vehicle.lastKeepObjective'
        : 'hudChrome.vehicle.objective',
    );
  }
  if (quest.objective.type === 'shadow') return t('questUi.worldQuest.shadow.objective');
  if (quest.objective.type === 'forging') return t('questUi.worldQuest.forge.objective');
  if (quest.objective.type === 'wisp_maze') return t('questUi.worldQuest.wispMaze.objective');
  if (quest.objective.type === 'glider') return t('questUi.worldQuest.glider.objective');
  if (quest.objective.type === 'investigation')
    return t('questUi.worldQuest.investigation.objective');
  if (quest.objective.type === 'tracing') return t('questUi.worldQuest.traceOutline');
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

/** The bundle every world quest pays at this level: XP, then copper, then any
 *  authored extra item. The day's gear is a separate line (worldQuestItemRewardText). */
export function worldQuestRewardText(quest: WorldQuestDef, level: number): string {
  const parts = [
    t('questUi.detail.xpReward', {
      xp: formatNumber(worldQuestXpReward(quest, level), { maximumFractionDigits: 0 }),
    }),
  ];
  const copper = worldQuestCopperReward(quest, level);
  if (copper > 0) parts.push(formatMoney(copper));
  const extra = quest.reward?.extraItem;
  if (extra) {
    const item = ownEntry(ITEMS, extra.itemId);
    parts.push(
      t('questUi.worldQuest.itemReward', { name: item ? itemDisplayName(item) : extra.itemId }),
    );
  }
  return parts.join(' · ');
}

/** The viewer's context for the day's item: who is looking and which cycle. */
export interface WorldQuestRewardViewer {
  level: number;
  cls: PlayerClass;
  cycle: string;
}

/** The exact piece this class receives from this quest today, with both levels
 *  the scope doc asks for, or null when the quest carries no item for this viewer. */
export function worldQuestItemRewardText(
  quest: WorldQuestDef,
  viewer: WorldQuestRewardViewer,
): string | null {
  const itemId = worldQuestItemRewardForQuest(viewer.cycle, quest, viewer.cls, viewer.level);
  const item = itemId ? ownEntry(ITEMS, itemId) : undefined;
  if (!item) return null;
  return t('questUi.worldQuest.itemRewardWithLevels', {
    name: itemDisplayName(item),
    itemLevel: formatNumber(itemLevel(item) ?? 0, { maximumFractionDigits: 0 }),
    requiredLevel: formatNumber(requiredLevelFor(item), { maximumFractionDigits: 0 }),
  });
}

export function worldQuestFactionName(quest: WorldQuestDef): string {
  return factionDisplayName(worldQuestFaction(quest));
}

export function worldQuestFactionLine(quest: WorldQuestDef): string {
  return t('questUi.worldQuest.factionLine', { faction: worldQuestFactionName(quest) });
}

export function worldQuestStandingRewardText(quest: WorldQuestDef, level: number): string {
  return t('questUi.worldQuest.standingReward', {
    amount: formatNumber(worldQuestStandingReward(quest, level), { maximumFractionDigits: 0 }),
    faction: worldQuestFactionName(quest),
  });
}

/** One line for the map hover and the screen-reader summary: the bundle, the
 *  standing, and the day's item when the viewer has one coming from this quest. */
export function worldQuestRewardLine(quest: WorldQuestDef, viewer: WorldQuestRewardViewer): string {
  const parts = [worldQuestRewardText(quest, viewer.level)];
  const item = worldQuestItemRewardText(quest, viewer);
  if (item) parts.push(item);
  parts.push(worldQuestStandingRewardText(quest, viewer.level));
  return t('questUi.worldQuest.rewardLine', { reward: parts.join(' · ') });
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
