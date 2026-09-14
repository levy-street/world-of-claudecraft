// Permanent loot quality is separate from item rarity and name.
import { lootQualityItemLevelBonus, lootQualityTier } from '../sim/loot_quality';
import type { ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

const TIER_KEYS: readonly TranslationKey[] = [
  'hudChrome.lootQuality.ordinary',
  'hudChrome.lootQuality.superior',
  'hudChrome.lootQuality.exceptional',
  'hudChrome.lootQuality.magnificent',
  'hudChrome.lootQuality.transcendent',
];
const TIER_MARKS = ['', 'I', 'II', 'III', 'IV'] as const;

export function lootQualityName(instance?: ItemInstancePayload): string {
  return t(TIER_KEYS[lootQualityTier(instance)]);
}

/** Inline badge, independent of lock, enchant and stack marks. */
export function lootQualityBadgeHtml(instance?: ItemInstancePayload): string {
  const tier = lootQualityTier(instance);
  if (!tier) return '';
  return `<span class="loot-quality-badge ui-badge" role="img" aria-label="${esc(lootQualityName(instance))}">${TIER_MARKS[tier]}</span>`;
}

export function lootQualityAriaName(name: string, instance?: ItemInstancePayload): string {
  return lootQualityTier(instance)
    ? t('hudChrome.lootQuality.itemName', { item: name, quality: lootQualityName(instance) })
    : name;
}

export function lootQualityTooltipLine(instance?: ItemInstancePayload): string {
  if (!lootQualityTier(instance)) return '';
  return `<div class="tt-sub loot-quality-line">${lootQualityBadgeHtml(instance)} ${esc(
    t('hudChrome.lootQuality.tooltip', {
      quality: lootQualityName(instance),
      levels: formatNumber(lootQualityItemLevelBonus(instance)),
    }),
  )}</div>`;
}
