// The item tooltip's authored-affix lines: Spell Power and Healing Power,
// the Crucible tier's affix debut. Rendered between the primary stats and
// the combat ratings, matching the catalog doc's Stats | Affix | Ratings
// column order. Healing Power has no character-sheet cell yet, so its label
// key is addressed directly rather than through statNameKey's StatId union.
import type { ItemDef } from '../sim/types';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';
import { itemNumber } from './item_instance_tooltip';
import { statNameKey } from './stat_tooltip_view';

// The compare-row label key lives beside the per-copy bonus lines that share
// it (item_instance_tooltip.ts); re-exported so hud.ts keeps one import site.
export { compareStatLabelKey } from './item_instance_tooltip';

function affixLine(value: number, labelKey: string): string {
  if (value <= 0) return '';
  return `<div class="tt-green">${esc(
    t('itemUi.tooltip.stat', {
      value: itemNumber(value),
      stat: t(labelKey as TranslationKey),
    }),
  )}</div>`;
}

/** Both affix lines for an item, or '' when it carries neither. */
export function itemAffixTooltipLines(item: ItemDef): string {
  return (
    affixLine(item.spellPower ?? 0, statNameKey('spellPower')) +
    affixLine(item.healPower ?? 0, 'hudChrome.statInfo.names.healPower')
  );
}

/** The combat-rating affix lines: the WARFARE rating (the lower of the two
 *  PvP ratings, shown once) and the hit / crit / haste ratings as classic
 *  "+N Rating" lines sharing the character-sheet labels. Hit answers the
 *  higher-level miss/resist penalty; crit and haste add throughput. */
export function itemRatingTooltipLines(item: ItemDef): string {
  let html = '';
  const line = (value: number, stat: string) =>
    `<div class="tt-green">${esc(
      t('itemUi.tooltip.stat', {
        value: itemNumber(value),
        stat: t(statNameKey(stat as Parameters<typeof statNameKey>[0]) as TranslationKey),
      }),
    )}</div>`;
  const warfareRating = Math.min(item.pvpOffenseRating ?? 0, item.pvpDefenseRating ?? 0);
  if (warfareRating > 0) html += line(warfareRating, 'warfare');
  for (const ratingStat of ['hitRating', 'critRating', 'hasteRating'] as const) {
    const value = item[ratingStat] ?? 0;
    if (value > 0) html += line(value, ratingStat);
  }
  return html;
}
