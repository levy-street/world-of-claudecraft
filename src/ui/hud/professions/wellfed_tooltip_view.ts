// The one Well Fed item tooltip line (unified in Masterwrought 11c): what a
// buff food actually grants, farm dish and apex role plate alike (the
// temporary stat-buff aura the sim mints when the 18s sit-restore COMPLETES;
// an interrupted meal, damage, death, or match reset, forfeits it), as a
// pure string-builder composed inside Hud.itemTooltip directly under the
// restore line it qualifies (the elixir_tooltip_view.ts pattern: t() + esc
// here, no DOM, no Hud state, so tests/wellfed_tooltip_view.test.ts drives
// it directly). The completion trigger AND the one-at-a-time rule are both
// load-bearing copy per docs/design/tooltip-writing.md: under the one
// 'well_fed' aura id a newer meal really does replace the last, so the
// surviving itemUi.tooltip.wellFed pair states both. The numbers come
// straight from the def's own wellFed record, never re-typed copy. A buff
// kind the stat map does not name still renders: the fallback line states
// the aura the food grants (localized through the same matcher the buff bar
// uses), so no buff food ever ships a silent tooltip.

import type { ItemDef } from '../../../sim/types';
import { auraDisplayNameForHud } from '../../aura_display_name';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { WELLFED_STAT_KEYS } from './wellfed_stat_keys';

/** The Well Fed line for a buff food, or '' for any other item. Gated on the
 *  KIND first, which is also what narrows the union to the one def shape
 *  that can spell a wellFed payload at all (FoodItemDef). */
export function wellFedTooltipLines(item: ItemDef): string {
  if (item.kind !== 'food') return '';
  const fed = item.wellFed;
  if (!fed) return '';
  const minutes = formatNumber(fed.duration / 60, { maximumFractionDigits: 1 });
  const statKey = WELLFED_STAT_KEYS[fed.kind];
  // The surviving key pair's placeholder sets, read off i18n.catalog/items.ts
  // (ruling 11c-A4-KEYPAIR): the mapped-stat line takes {stat}/{value}/
  // {minutes} and no aura token at all, while the unmapped-kind fallback is
  // where the aura NAME interpolates, through the buff bar's own matcher
  // chain (AURA_NAME_KEY first, the source prettifier as the raw fallback),
  // so the tooltip and the buff bar can never disagree on the term in any
  // locale; a new food whose aura lacks its sim_i18n row ships English
  // inside a localized sentence, which the S3 round-trip arm in
  // tests/localization_fixes.test.ts is what prevents.
  const text = statKey
    ? t('itemUi.tooltip.wellFed', {
        stat: t(statKey),
        value: formatNumber(fed.value, { maximumFractionDigits: 0 }),
        minutes,
      })
    : t('itemUi.tooltip.wellFedAura', {
        aura: auraDisplayNameForHud(fed.aura, null),
        minutes,
      });
  return `<div class="tt-desc">${esc(text)}</div>`;
}
