// Well-fed buff-dish item tooltip line: what the four farming buff dishes
// actually grant (the temporary stat-buff aura the sim mints when the 18s
// sit-restore COMPLETES; an interrupted meal, damage, death, or match reset,
// forfeits it), as a pure string-builder composed inside Hud.itemTooltip
// beside the elixir use line (the elixir_tooltip_view.ts pattern: t() + esc
// here, no DOM, no Hud state, so tests/wellfed_tooltip_view.test.ts drives it
// directly). The completion trigger is load-bearing copy per
// docs/design/tooltip-writing.md (state important triggers and limits from
// the live mechanic), and the numbers come straight from the def's own
// wellfed record, never re-typed copy. A buff kind the stat map does not
// name still renders: the fallback line states the aura the dish grants
// (localized through the same matcher the buff bar uses), so no buff dish
// ever ships a silent tooltip.

import type { AuraKind, ItemDef } from '../sim/types';
import { auraDisplayNameForHud } from './aura_display_name';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

// The stat map moved to the pure leaf src/ui/wellfed_stat_keys.ts (Phase 14:
// the wiki's dish effect prose is a consumer too, and the guide bundle may
// not reach this module's sim_i18n graph). Re-exported unchanged for
// feast_tooltip_view.ts and every other existing importer.
export { WELLFED_STAT_KEYS } from './wellfed_stat_keys';

import { WELLFED_STAT_KEYS } from './wellfed_stat_keys';

/** The well-fed line for a buff dish, or '' for any other item. */
export function wellfedTooltipLines(item: ItemDef): string {
  const fed = item.wellfed;
  if (!fed) return '';
  const minutes = formatNumber(fed.duration / 60, { maximumFractionDigits: 1 });
  const statKey = WELLFED_STAT_KEYS[fed.kind];
  // BOTH branches interpolate the buff name through the buff bar's own
  // matcher chain (AURA_NAME_KEY first, the source prettifier as the raw
  // fallback), so the tooltip and the buff bar can never disagree on the
  // term in any locale; a new dish whose aura lacks its sim_i18n row ships
  // English inside a localized sentence, which the S3 round-trip arm in
  // tests/localization_fixes.test.ts is what prevents.
  const aura = auraDisplayNameForHud(fed.aura, null);
  const text = statKey
    ? t('itemUi.tooltip.useWellfed', {
        aura,
        stat: t(statKey),
        value: formatNumber(fed.value, { maximumFractionDigits: 0 }),
        minutes,
      })
    : t('itemUi.tooltip.useWellfedAura', { aura, minutes });
  return `<div class="tt-desc">${esc(text)}</div>`;
}
