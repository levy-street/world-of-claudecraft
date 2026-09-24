// The world quest hover card, pure: the model the map marker tooltip paints
// (world_quest_tooltip_html.ts). Title, faction, time left, the one objective
// with live progress, then the Rewards block: faction standing and faction
// currency (each with its icon URL), the quest's base reward as money parts,
// experience, or an item id the painter expands into the shared item card.
// DOM-free and clock-free: the caller hands in the quest, progress, level, the
// host deadline, and `nowMs`, so every surface and both hosts read one model.

import { ITEMS } from '../../../sim/data';
import {
  FACTION_CURRENCY_IDS,
  type FactionId,
  worldQuestFaction,
  worldQuestFactionCurrencyReward,
  worldQuestStandingReward,
} from '../../../sim/factions';
import { isItemLevelEligible, itemInstanceLevel } from '../../../sim/item_level';
import type { ItemDef, WorldQuestDef } from '../../../sim/types';
import { worldQuestRewardAmount } from '../../../sim/world_quests';
import { currencyImageUrl, factionEmblemImageUrl } from '../../currency_art';
import { itemDisplayName } from '../../entity_i18n';
import { formatMoney, formatNumber, type MoneyParts, moneyParts, t } from '../../i18n';
import { ownEntry } from '../../known_item';
import {
  factionCurrencyNameText,
  factionNameText,
  worldQuestDisplayName,
  worldQuestDurationText,
  worldQuestObjectiveLabel,
} from '../../world_quest_view';

export interface WorldQuestTooltipStandingReward {
  readonly kind: 'standing';
  readonly factionId: FactionId;
  readonly amount: number;
  /** "80 Rift Watch": the amount beside the faction name. */
  readonly text: string;
  /** The faction's emblem art (`factionEmblemImageUrl`, the same art the
   *  Reputation tab sets in its crest), which the painter frames as a crest. */
  readonly iconUrl: string | null;
}

export interface WorldQuestTooltipCurrencyReward {
  readonly kind: 'currency';
  readonly currencyId: string;
  readonly amount: number;
  /** "10 Rift Watch Mark". */
  readonly text: string;
  readonly iconUrl: string | null;
}

export interface WorldQuestTooltipMoneyReward {
  readonly kind: 'money';
  readonly copper: number;
  /** The gold / silver / copper split the painter lays beside the coin icons. */
  readonly parts: MoneyParts;
  /** The long spoken form ("2 gold 51 silver 75 copper"). */
  readonly text: string;
}

export interface WorldQuestTooltipXpReward {
  readonly kind: 'xp';
  readonly amount: number;
  readonly text: string;
}

export interface WorldQuestTooltipItemReward {
  readonly kind: 'item';
  readonly itemId: string;
  readonly count: number;
  /** Null when this bundle has no def for the id (a newer server's item). */
  readonly item: ItemDef | null;
  readonly name: string;
  readonly quality: string;
  /** The combat-gear item level, null for items that have none. */
  readonly itemLevel: number | null;
  /** The localized "Item Level N" line, null with the level. */
  readonly itemLevelText: string | null;
}

export type WorldQuestTooltipReward =
  | WorldQuestTooltipStandingReward
  | WorldQuestTooltipCurrencyReward
  | WorldQuestTooltipMoneyReward
  | WorldQuestTooltipXpReward
  | WorldQuestTooltipItemReward;

export interface WorldQuestTooltipModel {
  readonly questId: string;
  readonly title: string;
  readonly factionId: FactionId;
  readonly factionName: string;
  /** The localized duration left in the rotation; empty with no deadline. */
  readonly timeRemaining: string;
  readonly objective: {
    readonly label: string;
    readonly current: number;
    readonly total: number;
    /** "Label: 2/10". */
    readonly text: string;
  };
  /** In paint order: standing, currency, then the base reward. */
  readonly rewards: readonly WorldQuestTooltipReward[];
}

export interface WorldQuestTooltipInput {
  readonly quest: WorldQuestDef;
  /** Credited progress this cycle (0 before the quest starts). */
  readonly progressCount: number;
  readonly playerLevel: number;
  readonly expiresAtMs: number;
  readonly nowMs: number;
}

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

function baseReward(quest: WorldQuestDef, level: number): WorldQuestTooltipReward {
  const reward = quest.reward;
  if (reward.type === 'xp') {
    const amount = worldQuestRewardAmount(reward, level);
    return { kind: 'xp', amount, text: t('questUi.detail.xpReward', { xp: whole(amount) }) };
  }
  if (reward.type === 'copper') {
    const copper = worldQuestRewardAmount(reward, level);
    return { kind: 'money', copper, parts: moneyParts(copper), text: formatMoney(copper, 'long') };
  }
  const item = ownEntry(ITEMS, reward.itemId) ?? null;
  const ilvl = item && isItemLevelEligible(item) ? (itemInstanceLevel(item) ?? null) : null;
  return {
    kind: 'item',
    itemId: reward.itemId,
    count: reward.count,
    item,
    name: item ? itemDisplayName(item) : reward.itemId,
    quality: item?.quality ?? 'common',
    itemLevel: ilvl,
    itemLevelText:
      ilvl === null ? null : t('hudChrome.options.itemLevelLine', { level: whole(ilvl) }),
  };
}

export function buildWorldQuestTooltip(input: WorldQuestTooltipInput): WorldQuestTooltipModel {
  const { quest, playerLevel } = input;
  const factionId = worldQuestFaction(quest);
  const factionName = factionNameText(factionId);
  const total = quest.count;
  const current = Math.max(0, Math.min(input.progressCount, total));
  const label = worldQuestObjectiveLabel(quest.id);
  const rewards: WorldQuestTooltipReward[] = [];
  const standing = worldQuestStandingReward(quest, playerLevel);
  const currencyId = FACTION_CURRENCY_IDS[factionId];
  if (standing > 0) {
    rewards.push({
      kind: 'standing',
      factionId,
      amount: standing,
      text: t('hudChrome.worldQuestTooltip.standingAmount', {
        amount: whole(standing),
        faction: factionName,
      }),
      iconUrl: factionEmblemImageUrl(factionId),
    });
  }
  const currency = worldQuestFactionCurrencyReward(quest, playerLevel);
  if (currency > 0) {
    rewards.push({
      kind: 'currency',
      currencyId,
      amount: currency,
      text: t('hudChrome.worldQuestTooltip.currencyAmount', {
        amount: whole(currency),
        currency: factionCurrencyNameText(factionId),
      }),
      iconUrl: currencyImageUrl(currencyId),
    });
  }
  rewards.push(baseReward(quest, playerLevel));
  return {
    questId: quest.id,
    title: worldQuestDisplayName(quest.id),
    factionId,
    factionName,
    timeRemaining: worldQuestDurationText(input.expiresAtMs, input.nowMs),
    objective: {
      label,
      current,
      total,
      text: t('questUi.detail.objectiveProgress', {
        label,
        current: whole(current),
        total: whole(total),
      }),
    },
    rewards,
  };
}
