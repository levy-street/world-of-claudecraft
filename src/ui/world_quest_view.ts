import { ITEMS, WORLD_QUESTS_BY_ID } from '../sim/data';
import {
  type FactionId,
  factionDisplayName,
  worldQuestFaction,
  worldQuestFactionCurrencyReward,
  worldQuestStandingReward,
} from '../sim/factions';
import { itemLevel } from '../sim/item_level';
import { requiredLevelFor } from '../sim/item_level_req';
import type { PlayerClass, WorldQuestDef } from '../sim/types';
import { worldQuestHonorRewardForQuest } from '../sim/world_quest_honor_slots';
import { worldQuestItemRewardForQuest } from '../sim/world_quest_item_slots';
import { worldQuestCopperReward, worldQuestXpReward } from '../sim/world_quests';
import { mobDisplayName, vehicleStationDisplayName } from './entity_display_core';
import { itemDisplayName, zoneDisplayName } from './entity_i18n';
import { formatList, formatMoney, formatNumber, type TranslationKey, t } from './i18n';
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

// The sim's factionDisplayName / factionCurrencyName are English data labels;
// every player-facing faction and currency name renders from these catalog keys.
const FACTION_NAME_KEY: Readonly<Record<FactionId, TranslationKey>> = {
  rift_watch: 'hudChrome.reputation.faction.rift_watch',
  church_order: 'hudChrome.reputation.faction.church_order',
  automatons: 'hudChrome.reputation.faction.automatons',
};

const FACTION_CURRENCY_NAME_KEY: Readonly<Record<FactionId, TranslationKey>> = {
  rift_watch: 'hudChrome.currencies.riftWatchMark',
  church_order: 'hudChrome.currencies.churchOrderCrest',
  automatons: 'hudChrome.currencies.automatonCog',
};

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** The localized faction name (the Reputation tab's own key). */
export function factionNameText(factionId: FactionId): string {
  return t(FACTION_NAME_KEY[factionId]);
}

/** The localized name of a faction's currency (the Currencies tab's own key). */
export function factionCurrencyNameText(factionId: FactionId): string {
  return t(FACTION_CURRENCY_NAME_KEY[factionId]);
}

export function worldQuestFactionName(quest: WorldQuestDef): string {
  return factionNameText(worldQuestFaction(quest));
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

export function worldQuestFactionCurrencyRewardText(quest: WorldQuestDef, level: number): string {
  return t('hudChrome.worldQuestTooltip.currencyReward', {
    amount: formatNumber(worldQuestFactionCurrencyReward(quest, level), {
      maximumFractionDigits: 0,
    }),
    currency: factionCurrencyNameText(worldQuestFaction(quest)),
  });
}

/** The day's Honor bonus ("+150 Honor"), or null when this quest carries none
 *  this cycle. Realm-wide, so it reads only the cycle, never the viewer's class. */
export function worldQuestHonorRewardText(quest: WorldQuestDef, cycle: string): string | null {
  const honor = worldQuestHonorRewardForQuest(cycle, quest);
  if (honor <= 0) return null;
  return t('hudChrome.worldQuestTooltip.currencyReward', {
    amount: whole(honor),
    currency: t('hudChrome.currencies.honor'),
  });
}

/** One line for the map hover and the screen-reader summary: the bundle, the
 *  day's item when the viewer has one coming from this quest, the day's Honor
 *  bonus, and the standing. */
export function worldQuestRewardLine(quest: WorldQuestDef, viewer: WorldQuestRewardViewer): string {
  const parts = [worldQuestRewardText(quest, viewer.level)];
  const item = worldQuestItemRewardText(quest, viewer);
  if (item) parts.push(item);
  const honor = worldQuestHonorRewardText(quest, viewer.cycle);
  if (honor) parts.push(honor);
  parts.push(worldQuestStandingRewardText(quest, viewer.level));
  const currency = worldQuestFactionCurrencyRewardText(quest, viewer.level);
  if (currency) parts.push(currency);
  return t('questUi.worldQuest.rewardLine', { reward: parts.join(' · ') });
}

function durationUnit(value: number, unit: 'day' | 'hour' | 'minute'): string {
  return formatNumber(value, { style: 'unit', unit, unitDisplay: 'long' });
}

/** Localized multi-part duration ("2 days, 14 hours, and 16 minutes") until the
 *  host-authoritative rotation deadline; empty when there is no deadline. */
export function worldQuestDurationText(expiresAtMs: number, nowMs: number): string {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0 || !Number.isFinite(nowMs)) return '';
  const totalMinutes = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(durationUnit(days, 'day'));
  if (hours > 0) parts.push(durationUnit(hours, 'hour'));
  if (minutes > 0 || parts.length === 0) parts.push(durationUnit(minutes, 'minute'));
  return formatList(parts);
}

/** Localized multi-part countdown for the host-authoritative rotation deadline. */
export function worldQuestTimeRemainingText(expiresAtMs: number, nowMs: number): string {
  const time = worldQuestDurationText(expiresAtMs, nowMs);
  return time ? t('questUi.worldQuest.expiresIn', { time }) : '';
}
