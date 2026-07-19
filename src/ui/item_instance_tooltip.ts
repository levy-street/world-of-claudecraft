// Per-copy item-instance tooltip lines (Professions 2.0 Phase 6): the
// ItemInstancePayload additions the item tooltip composes around its def-driven
// card, as pure string builders so every instance variant is Node-testable.
// Composition order in the tooltip: badge lines (masterwork seal, enchanted
// marker) right under the soulbound line, baked bonus stat lines after the
// def's own stats, the maker's mark near the bottom. Copy rule: the seal never
// claims a quality-rank upgrade (deeds quality marks credit the DEF quality),
// so the seal keeps its own gold line instead of recoloring the title. The
// enchanted marker is generic: EnchantDef.name has no localized display
// surface, and an unlocalized string must never reach the tooltip.
import { isEnchantedInstance } from '../sim/professions/enchanting';
import type { ItemInstancePayload, Stats } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';

const ITEM_STAT_LABEL_KEYS: Partial<Record<keyof Stats, TranslationKey>> = {
  armor: 'itemUi.stats.armor',
  str: 'itemUi.stats.str',
  agi: 'itemUi.stats.agi',
  sta: 'itemUi.stats.sta',
  int: 'itemUi.stats.int',
  spi: 'itemUi.stats.spi',
};

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function itemStatName(stat: string): string {
  const key = ITEM_STAT_LABEL_KEYS[stat as keyof Stats];
  return key ? t(key) : cap(stat);
}

export function itemNumber(value: number, fractionDigits = 0): string {
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** The masterwork seal (gold, the soulbound line's style) and the enchanted
 *  marker (green). A legacy signed copy with neither renders nothing here;
 *  legacy enchanted copies (bare rolled.stats without the masterwork flag)
 *  read as enchanted via isEnchantedInstance. */
export function instanceBadgeLines(instance?: ItemInstancePayload): string {
  if (!instance) return '';
  let html = '';
  if (instance.rolled?.masterwork) {
    html += `<div class="tt-sub" style="color:#ffd100">${esc(t('hudChrome.crafting.masterworkSeal'))}</div>`;
  }
  if (isEnchantedInstance(instance)) {
    html += `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(t('hudChrome.crafting.enchantedLine'))}</div>`;
  }
  return html;
}

/** Baked per-copy bonus stats (masterwork tier-delta, or an enchanted copy's
 *  baked enchant stats): distinct green bonus lines after the def's own stats,
 *  reusing the localized stat-line key. */
export function instanceBonusStatLines(instance?: ItemInstancePayload): string {
  const bonusStats = instance?.rolled?.stats;
  if (!bonusStats) return '';
  let html = '';
  for (const [k, v] of Object.entries(bonusStats)) {
    if (!v) continue;
    html += `<div class="tt-green tt-instance-bonus">${esc(
      t('itemUi.tooltip.stat', { value: itemNumber(v), stat: itemStatName(k) }),
    )}</div>`;
  }
  return html;
}

/** The classic "Crafted by X" flavor line for a signed copy. Legacy signed
 *  instances (signer without the masterwork flag) render the mark alone. */
export function instanceMakersMarkLine(instance?: ItemInstancePayload): string {
  if (!instance?.signer) return '';
  return `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(
    t('hudChrome.crafting.makersMark', { name: instance.signer }),
  )}</div>`;
}
