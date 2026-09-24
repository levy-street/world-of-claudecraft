import { ITEMS, WORLD_QUESTS_BY_ID } from '../sim/data';
import {
  type FactionId,
  worldQuestFaction,
  worldQuestFactionCurrencyReward,
  worldQuestStandingReward,
} from '../sim/factions';
import type { WorldQuestDef } from '../sim/types';
import { worldQuestRewardAmount } from '../sim/world_quests';
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
  return t('hudChrome.worldQuestTooltip.factionLine', { faction: worldQuestFactionName(quest) });
}

export function worldQuestStandingRewardText(quest: WorldQuestDef, level: number): string {
  return t('hudChrome.worldQuestTooltip.standingReward', {
    amount: whole(worldQuestStandingReward(quest, level)),
    faction: worldQuestFactionName(quest),
  });
}

export function worldQuestFactionCurrencyRewardText(quest: WorldQuestDef, level: number): string {
  return t('hudChrome.worldQuestTooltip.currencyReward', {
    amount: whole(worldQuestFactionCurrencyReward(quest, level)),
    currency: factionCurrencyNameText(worldQuestFaction(quest)),
  });
}

export function worldQuestRewardLine(quest: WorldQuestDef, level: number): string {
  const baseReward = worldQuestRewardText(quest, level);
  const standingReward = worldQuestStandingRewardText(quest, level);
  const currencyReward = worldQuestFactionCurrencyRewardText(quest, level);
  const parts = [baseReward, standingReward, currencyReward].filter(Boolean);
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
