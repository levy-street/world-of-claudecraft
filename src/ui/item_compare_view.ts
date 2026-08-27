// The classic item-comparison card: when hovering an equippable item, the
// tooltip appends the piece currently worn in that slot plus the stat change
// you would see if you swapped to it (green = gain, red = loss). The pure-core
// half of the pure-core + thin-consumer split, extracted from
// Hud.itemCompareBlock at the phase 13 review round so the worn-instance
// threading is unit-testable: the worn side resolves its per-copy payload
// through wornTooltipInstance (the same projection the paperdoll tooltip
// uses), so "Currently Equipped" titles a promoted copy with its legendary
// color and chosen name instead of the def card. The card body itself stays
// the host's: `tooltipHtml` is Hud.itemTooltip injected, so this module owns
// the comparison decisions and the delta lines, never the item card markup.
// Reads the IWorld equipment shapes, so it works identically offline and
// online.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { EquipSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { itemStatDeltas } from './item_compare';
import { wornTooltipInstance } from './item_instance_tooltip';
import { statNameKey } from './stat_tooltip_view';

/** The worn source the comparison reads: the equipment map plus the worn
 *  per-copy payloads (the IWorld `equipment` / `equipmentInstances` shapes). */
export interface CompareEquipmentSource {
  equipment: Partial<Record<EquipSlot, string>>;
  instances?: Partial<Record<EquipSlot, ItemInstancePayload>>;
}

/** Renders the worn item's own tooltip card (Hud.itemTooltip with compare
 *  off); `instance` is the worn copy's projected payload, or undefined for a
 *  plain worn copy. */
export type CompareTooltipRenderer = (item: ItemDef, instance?: ItemInstancePayload) => string;

/** The whole comparison block for a hovered `item`, or '' when it has no slot
 *  or nothing relevant is worn. `candidateInstance` is the hovered COPY's own
 *  payload (the bag cell's instance) when the caller has one: the delta lines
 *  then compare merged def + rolled stats on BOTH sides, so a per-copy bake
 *  on either copy moves the numbers the way the swap really would. */
export function itemCompareBlocksHtml(
  item: ItemDef,
  source: CompareEquipmentSource,
  lookup: (id: string) => ItemDef | undefined,
  tooltipHtml: CompareTooltipRenderer,
  candidateInstance?: ItemInstancePayload,
): string {
  if (!item.slot) return '';
  // A hovered ring compares against BOTH worn rings (classic behavior); every
  // other slot kind is its own single equipment key.
  const slots: readonly EquipSlot[] = item.slot === 'ring' ? ['ring1', 'ring2'] : [item.slot];
  return slots
    .map((slot) => compareBlockForSlot(item, slot, source, lookup, tooltipHtml, candidateInstance))
    .join('');
}

function compareBlockForSlot(
  item: ItemDef,
  slot: EquipSlot,
  source: CompareEquipmentSource,
  lookup: (id: string) => ItemDef | undefined,
  tooltipHtml: CompareTooltipRenderer,
  candidateInstance?: ItemInstancePayload,
): string {
  const equippedId = source.equipment[slot];
  if (!equippedId || equippedId === item.id) return '';
  const equipped = lookup(equippedId);
  if (!equipped) return '';
  // Both sides' per-copy payloads feed the delta math: the hovered candidate
  // copy and the worn slot's own instance (its rolled.stats carry the bakes).
  const deltas = itemStatDeltas(item, equipped, candidateInstance, source.instances?.[slot])
    .map((d) => {
      const cls = d.delta > 0 ? 'tt-green' : 'tt-red';
      const sign = d.delta > 0 ? '+' : '−'; // proper minus sign
      const magnitude = formatNumber(Math.abs(d.delta), {
        minimumFractionDigits: d.decimals,
        maximumFractionDigits: d.decimals,
      });
      return `<div class="${cls}">${sign}${magnitude} ${esc(
        t(statNameKey(d.stat) as TranslationKey),
      )}</div>`;
    })
    .join('');
  // The worn side carries its per-copy payload, projected exactly as the
  // paperdoll projects it (worn identity is signer/enchant/rolled/name, never
  // the bond), so both hosts render the identical worn card.
  const worn = wornTooltipInstance(source.instances?.[slot]);
  let html = `<div class="tt-cmp"><div class="tt-cmp-head">${esc(t('itemUi.tooltip.currentlyEquipped'))}</div>`;
  html += `<div class="tt-cmp-body">${tooltipHtml(equipped, worn)}</div>`;
  if (deltas)
    html += `<div class="tt-cmp-head">${esc(t('itemUi.tooltip.ifYouEquip'))}</div>${deltas}`;
  html += `</div>`;
  return html;
}
