// Toolbelt item tooltip lines. A pure string-builder composed inside
// Hud.itemTooltip, mirroring gather_tool_tooltip.ts: t() + esc here, no DOM
// and no Hud state, so tests/toolbelt_tooltip.test.ts drives it directly.
//
// The belt has no bagSlots to quote (it deliberately grants none, see
// src/sim/toolbelt.ts); what it does have is its own slot count, the number
// that separates the tailoring ladder's three rungs, so that is the stat line
// a bag's capacity line becomes here.

import type { ItemDef } from '../sim/types';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

/** The tooltip lines for a toolbelt, or '' for any other item. */
export function toolbeltTooltipLines(item: ItemDef): string {
  if (item.kind !== 'toolbelt') return '';
  const slots = formatNumber(item.toolSlots ?? 0, { maximumFractionDigits: 0 });
  return (
    `<div class="tt-stat">${esc(t('itemUi.tooltip.toolbeltSlots', { slots }))}</div>` +
    `<div class="tt-desc">${esc(t('itemUi.tooltip.toolbeltDesc'))}</div>`
  );
}
