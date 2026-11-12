// The item tooltip's authored-affix lines: Spell Power and Healing Power,
// the Crucible tier's affix debut. Rendered between the primary stats and
// the combat ratings, matching the catalog doc's Stats | Affix | Ratings
// column order. Healing Power has no character-sheet cell yet, so its label
// key is addressed directly rather than through statNameKey's StatId union.
import { countsWarfareRating } from '../sim/pvp/power';
import type { ItemDef } from '../sim/types';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';
import type { CompareStat } from './item_compare';
import { compareStatLineHtml, type ItemCompareMarks } from './item_compare_view';
import { itemNumber } from './item_instance_tooltip';
import { statNameKey } from './stat_tooltip_view';

// The compare-row label key lives beside the per-copy bonus lines that share
// it (item_instance_tooltip.ts); re-exported so hud.ts keeps one import site.
export { compareStatLabelKey } from './item_instance_tooltip';

function affixLine(
  value: number,
  labelKey: string,
  stat: CompareStat,
  marks?: ItemCompareMarks,
): string {
  if (value <= 0) return '';
  const text = t('itemUi.tooltip.stat', {
    value: itemNumber(value),
    stat: t(labelKey as TranslationKey),
  });
  return compareStatLineHtml('tt-green', esc(text), marks, stat);
}

/** Both affix lines for an item, or '' when it carries neither. `marks` adds
 *  each line's comparison cell (item_compare_view.ts). */
export function itemAffixTooltipLines(item: ItemDef, marks?: ItemCompareMarks): string {
  return (
    affixLine(item.spellPower ?? 0, statNameKey('spellPower'), 'spellPower', marks) +
    affixLine(item.healPower ?? 0, 'hudChrome.statInfo.names.healPower', 'healPower', marks)
  );
}

/** The combat-rating affix lines: the WARFARE rating (the lower of the two
 *  PvP ratings, shown once) and the hit / crit / haste ratings as classic
 *  "+N Rating" lines sharing the character-sheet labels. Hit answers the
 *  higher-level miss/resist penalty; crit and haste add throughput. */
export function itemRatingTooltipLines(item: ItemDef, marks?: ItemCompareMarks): string {
  let html = '';
  const line = (value: number, stat: CompareStat) => {
    const text = t('itemUi.tooltip.stat', {
      value: itemNumber(value),
      stat: t(statNameKey(stat as Parameters<typeof statNameKey>[0]) as TranslationKey),
    });
    return compareStatLineHtml('tt-green', esc(text), marks, stat);
  };
  const warfareRating = Math.min(item.pvpOffenseRating ?? 0, item.pvpDefenseRating ?? 0);
  if (warfareRating > 0) {
    html += line(warfareRating, 'warfare');
    // The one rule (src/sim/pvp/power.ts): an item that adds none in the offhand
    // only counts in the main hand.
    if (!countsWarfareRating('offhand', item))
      html += `<div class="tt-sub">${esc(t('itemUi.tooltip.warfareMainHandOnly'))}</div>`;
  }
  for (const ratingStat of ['hitRating', 'critRating', 'hasteRating'] as const) {
    const value = item[ratingStat] ?? 0;
    if (value > 0) html += line(value, ratingStat);
  }
  return html;
}
