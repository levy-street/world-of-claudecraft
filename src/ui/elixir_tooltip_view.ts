// Battle-elixir, buff-scroll AND flask item tooltip line: what using any source
// actually grants (the shared temporary stat-buff aura src/sim/items.ts
// useItem applies; the view gates on the effect record, not the kind, so a
// phase 06 scroll renders the byte-identical line of its band elixir), as a
// pure string-builder composed inside Hud.itemTooltip beside the potion use lines
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

function desc(text: string): string {
  return `<div class="tt-desc">${esc(text)}</div>`;
}

/** The "Use:" line for a battle elixir, buff scroll, or apex flask (any item
 *  carrying the elixir effect record), or '' for any other item. A flask adds
 *  its three extra rules under that shared line. */
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
  // The Use line above is true of a flask word for word (a flask really does
  // replace the same-stat elixir or scroll), so a flask ADDS its own rules
  // rather than restating the shared one. Gated on the KIND, not the payload,
  // because every one of them keys on the flask marker the use path stamps and
  // nothing about the payload distinguishes a flask from the elixir it beats.
  // The middle line is the DOWNWARD refusal (src/sim/items.ts useItem): the
  // shared Use line says a flask replaces a weaker source, and without this the
  // reader would reasonably infer the reverse also works and lose a flask to a
  // careless elixir click. It does not: the quaff is refused outright.
  if (item.kind !== 'flask') return desc(text);
  return (
    desc(text) +
    desc(t('itemUi.tooltip.flaskOnlyOne')) +
    desc(t('itemUi.tooltip.flaskOutranks')) +
    desc(t('itemUi.tooltip.flaskThroughDeath'))
  );
}

/** The Well Fed line for a role food, or '' for any other item. Separate from
 *  the elixir line above because a food renders BOTH: its sit-down restore
 *  line, then this. Gated on the KIND first, which is also what narrows the
 *  union to the one def shape that can spell a wellFed payload at all
 *  (FoodItemDef); no other kind can carry one. */
export function wellFedTooltipLines(item: ItemDef): string {
  if (item.kind !== 'food') return '';
  const fed = item.wellFed;
  if (!fed) return '';
  const minutes = formatNumber(fed.duration / 60, { maximumFractionDigits: 1 });
  const statKey = ELIXIR_STAT_KEYS[fed.kind];
  const text = statKey
    ? t('itemUi.tooltip.wellFed', {
        stat: t(statKey),
        value: formatNumber(fed.value, { maximumFractionDigits: 0 }),
        minutes,
      })
    : // Same unmapped-kind fallback contract as the elixir line above: a new
      // well-fed kind outside the stat map needs its aura's sim_i18n row in
      // the same change or this ships English inside a localized sentence.
      t('itemUi.tooltip.wellFedAura', {
        aura: auraDisplayNameFromSource(fed.aura),
        minutes,
      });
  return desc(text);
}
