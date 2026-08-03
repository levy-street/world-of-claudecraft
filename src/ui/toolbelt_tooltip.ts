// Toolbelt item tooltip lines. A pure string-builder composed inside
// Hud.itemTooltip, mirroring gather_tool_tooltip.ts: t() + esc here, no DOM
// and no Hud state, so tests/toolbelt_tooltip.test.ts drives it directly.
//
// The belt has no bagSlots to quote (it deliberately grants none, see
// src/sim/toolbelt.ts), so where a bag's tooltip states its capacity this
// states its purpose instead: the point of belting a tool is that it stops
// costing backpack space.

import type { ItemDef } from '../sim/types';
import { esc } from './esc';
import { t } from './i18n';

/** The tooltip lines for a toolbelt, or '' for any other item. */
export function toolbeltTooltipLines(item: ItemDef): string {
  if (item.kind !== 'toolbelt') return '';
  return `<div class="tt-desc">${esc(t('itemUi.tooltip.toolbeltDesc'))}</div>`;
}
