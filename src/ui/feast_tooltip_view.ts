// Shared-feast item tooltip lines (Phase 12): what USING the feast item does
// (places a farm_feast world entity others eat from) and what each serving
// pays, as a pure string-builder composed inside Hud.itemTooltip beside the
// wellfed line (the elixir_tooltip_view.ts pattern: t() + esc here, no DOM,
// no Hud state, so tests/feast_tooltip_view.test.ts drives it directly).
// Every number is RESOLVED from the live records, never re-typed copy
// (docs/design/tooltip-writing.md): servings and duration from the def's own
// feast record, the buff numbers from the pointed-at dish's wellFed record
// (feast.dishItemId), and the meal length from CONSUME_DURATION, the same
// sit-restore a bagged dish runs. The finish-the-meal trigger is
// load-bearing copy: the buff lands only when the 18s eat COMPLETES (an
// interrupted meal forfeits it), exactly like the well-fed line. The buff
// NAME interpolates through the buff bar's own matcher chain in every branch
// (the (by) rule), and the stat label comes from the wellfed view's own
// exported map, so the feast line, the dish tooltip, and the buff bar can
// never disagree on a term in any locale.

import { ITEMS } from '../sim/data';
import { CONSUME_DURATION, DT, type ItemDef } from '../sim/types';
import { auraDisplayNameForHud } from './aura_display_name';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { WELLFED_STAT_KEYS } from './wellfed_tooltip_view';

/** The feast lines for a placeable feast item, or '' for any other item.
 *  `items` is injectable so the dish-resolution branches are testable
 *  off-data; production callers use the live table default. */
export function feastTooltipLines(
  item: ItemDef,
  items: Record<string, ItemDef | undefined> = ITEMS,
): string {
  const feast = 'feast' in item ? item.feast : undefined;
  if (!feast) return '';
  const servings = formatNumber(feast.charges, { maximumFractionDigits: 0 });
  const feastMinutes = formatNumber((feast.durationTicks * DT) / 60, { maximumFractionDigits: 1 });
  let html = `<div class="tt-desc">${esc(
    t('itemUi.tooltip.useFeast', { servings, minutes: feastMinutes }),
  )}</div>`;
  // The serving's buff, stated in the capstone dish's own resolved well-fed
  // form. A feast whose dish carries no wellFed record states only the
  // placement line (the restore alone is the dish's own tooltip's story).
  const dishDef = items[feast.dishItemId];
  const fed = dishDef && dishDef.kind === 'food' ? dishDef.wellFed : undefined;
  if (fed) {
    const aura = auraDisplayNameForHud(fed.aura, null);
    const minutes = formatNumber(fed.duration / 60, { maximumFractionDigits: 1 });
    const seconds = formatNumber(CONSUME_DURATION, { maximumFractionDigits: 0 });
    const statKey = WELLFED_STAT_KEYS[fed.kind];
    const text = statKey
      ? t('itemUi.tooltip.useFeastBuff', {
          aura,
          stat: t(statKey),
          value: formatNumber(fed.value, { maximumFractionDigits: 0 }),
          minutes,
          seconds,
        })
      : t('itemUi.tooltip.useFeastBuffAura', { aura, minutes, seconds });
    html += `<div class="tt-desc">${esc(text)}</div>`;
  }
  return html;
}
