// Battle-elixir item tooltip line: what quaffing the elixir actually grants
// (the temporary stat-buff aura src/sim/items.ts useItem applies), as a pure
// string-builder composed inside Hud.itemTooltip beside the potion use lines
// (the gather_tool_tooltip.ts pattern: t() + esc here, no DOM, no Hud state,
// so tests/elixir_tooltip_view.test.ts drives it directly). The numbers come
// straight from the def's own elixir record, never re-typed copy. A buff kind
// the stat map does not name still renders: the fallback line states the aura
// the elixir grants (localized through the same matcher the buff bar uses),
// so no elixir ever ships a silent tooltip.

import type { AuraKind, ItemDef } from '../sim/types';
import { auraDisplayNameFromSource } from './aura_display_name';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

// The stat-buff kinds an elixir plausibly carries, each mapped to the item
// tooltip's own stat label so "Stamina" reads identically here and on a gear
// stat line. Kinds outside this map take the aura-name fallback below.
const ELIXIR_STAT_KEYS: Partial<Record<AuraKind, TranslationKey>> = {
  buff_sta: 'itemUi.stats.sta',
  buff_int: 'itemUi.stats.int',
  buff_agi: 'itemUi.stats.agi',
  buff_armor: 'itemUi.stats.armor',
  buff_ap: 'itemUi.stats.attackPower',
};

/** The "Use:" line for a battle elixir, or '' for any other item. */
export function elixirTooltipLines(item: ItemDef): string {
  const elx = item.elixir;
  if (!elx) return '';
  const minutes = formatNumber(elx.duration / 60, { maximumFractionDigits: 1 });
  const statKey = ELIXIR_STAT_KEYS[elx.kind];
  const text = statKey
    ? t('itemUi.tooltip.useElixir', {
        stat: t(statKey),
        value: formatNumber(elx.value, { maximumFractionDigits: 0 }),
        minutes,
      })
    : // The fallback localizes through the buff bar's own matcher, which
      // returns the RAW ENGLISH aura name when no AURA_NAME_KEY row exists:
      // a new unmapped-kind elixir needs its aura's sim_i18n entry in the
      // same change or this line ships English inside a localized sentence.
      t('itemUi.tooltip.useElixirAura', {
        aura: auraDisplayNameFromSource(elx.aura),
        minutes,
      });
  return `<div class="tt-desc">${esc(text)}</div>`;
}
