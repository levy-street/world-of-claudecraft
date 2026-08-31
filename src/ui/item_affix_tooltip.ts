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

function affixLine(value: number, labelKey: string): string {
  if (value <= 0) return '';
  return `<div class="tt-green">${esc(
    t('itemUi.tooltip.stat', {
      value: itemNumber(value),
      stat: t(labelKey as TranslationKey),
    }),
  )}</div>`;
}

/** Compare-row label key: healPower has no StatId cell, so it resolves here. */
export function compareStatLabelKey(stat: string): string {
  return stat === 'healPower'
    ? 'hudChrome.statInfo.names.healPower'
    : statNameKey(stat as Parameters<typeof statNameKey>[0]);
}

/** Both affix lines for an item, or '' when it carries neither. */
export function itemAffixTooltipLines(item: ItemDef): string {
  return (
    affixLine(item.spellPower ?? 0, statNameKey('spellPower')) +
    affixLine(item.healPower ?? 0, 'hudChrome.statInfo.names.healPower')
  );
}
