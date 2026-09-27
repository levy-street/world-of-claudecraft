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

/** Inline badge, independent of lock, enchant and stack marks. Owns its whole
 *  look in components.css (no library primitive composed underneath). One
 *  accessible channel per surface: decorative (aria-hidden) by default, for
 *  the cells whose own accessible name already carries the quality word
 *  through lootQualityAriaName (bags, banks, vendor, market rows, worn slots)
 *  and for text that names the quality beside it; `labelled` where the badge
 *  is the ONLY channel in its own container (corpse loot rows, vault rows, the
 *  three roll rows, Exchange item cells, standalone chips). A labelled badge
 *  inside a control that carries its own aria-label (the Exchange row button)
 *  is not read twice: the author-supplied name replaces the content. */
export function lootQualityBadgeHtml(
  instance?: ItemInstancePayload,
  opts?: { labelled?: boolean },
): string {
  const tier = lootQualityTier(instance);
  if (!tier) return '';
  const aria = opts?.labelled
    ? ` role="img" aria-label="${esc(lootQualityName(instance))}"`
    : ' aria-hidden="true"';
  return `<span class="loot-quality-badge"${aria}>${TIER_MARKS[tier]}</span>`;
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
