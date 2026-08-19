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
import { auraDisplayNameFromSource } from './aura_display_name';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

// The stat-buff kinds a well-fed dish plausibly carries, each mapped to the
// item tooltip's own stat label so "Stamina" reads identically here, on the
// elixir line, and on a gear stat line. Kinds outside this map take the
// aura-name fallback below.
const WELLFED_STAT_KEYS: Partial<Record<AuraKind, TranslationKey>> = {
  buff_sta: 'itemUi.stats.sta',
  buff_int: 'itemUi.stats.int',
  buff_agi: 'itemUi.stats.agi',
  buff_armor: 'itemUi.stats.armor',
  buff_ap: 'itemUi.stats.attackPower',
};

/** The well-fed line for a buff dish, or '' for any other item. */
export function wellfedTooltipLines(item: ItemDef): string {
  const fed = item.wellfed;
  if (!fed) return '';
  const minutes = formatNumber(fed.duration / 60, { maximumFractionDigits: 1 });
  const statKey = WELLFED_STAT_KEYS[fed.kind];
  const text = statKey
    ? t('itemUi.tooltip.useWellfed', {
        stat: t(statKey),
        value: formatNumber(fed.value, { maximumFractionDigits: 0 }),
        minutes,
      })
    : // The fallback localizes through the buff bar's own matcher, which
      // returns the RAW ENGLISH aura name when no AURA_NAME_KEY row exists:
      // a new unmapped-kind dish needs its aura's sim_i18n entry in the same
      // change or this line ships English inside a localized sentence.
      t('itemUi.tooltip.useWellfedAura', {
        aura: auraDisplayNameFromSource(fed.aura),
        minutes,
      });
  return `<div class="tt-desc">${esc(text)}</div>`;
}
