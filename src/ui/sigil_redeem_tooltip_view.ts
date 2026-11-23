// The Crucible sigil purpose line: who takes a redemption token, where they
// stand, and which gear slot it buys ("Can be traded to Quartermaster Bronn
// Emberward, outside the Crucible of the Last Spring entrance in The
// Drakelands, for a Shoulder set piece.").
//
// Players misread the sigil names ("Mantle" is shoulders, "Grip" is hands),
// and the shared item card showed nothing but the name, Epic Tool, Soulbound,
// and the class list. Every fact here is DERIVED from live data, so the line
// cannot drift from what the vendor actually sells:
// - the token is any id CRUCIBLE_VENDOR_STOCK prices with, and the slot is the
//   one slot every offer bought with it shares (a currency that buys slotless
//   patterns, lastflame_core, or a mix of slots, gets no line);
// - the vendor is CRUCIBLE_VENDOR_NPC_ID, localized through tEntity;
// - the place is the raid the vendor stands outside, plus the zone that holds
//   his spawn point (zoneAt over CRUCIBLE_VENDOR_ENTRANCE_POS).
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import {
  CRUCIBLE_VENDOR_ENTRANCE_POS,
  CRUCIBLE_VENDOR_NPC_ID,
  CRUCIBLE_VENDOR_STOCK,
} from '../sim/content/ignivar_loot';
import { ITEMS, zoneAt } from '../sim/data';
import { IGNIVAR_RAID_ARENA_ID } from '../sim/ignivar_raid_ids';
import type { ItemDef, ItemSlot } from '../sim/types';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import { itemSlotLabel } from './item_slot_labels';

/** The one gear slot every vendor offer priced in this token buys, else null. */
export function sigilRedeemSlot(tokenId: string): ItemSlot | null {
  let slot: ItemSlot | null = null;
  for (const offer of CRUCIBLE_VENDOR_STOCK) {
    if (offer.sigilId !== tokenId) continue;
    const bought = ITEMS[offer.itemId]?.slot;
    if (!bought) return null;
    if (slot === null) slot = bought;
    else if (slot !== bought) return null;
  }
  return slot;
}

/** The tooltip purpose line for a Crucible sigil; '' for every other item. */
export function sigilRedeemTooltipLine(item: ItemDef): string {
  const slot = sigilRedeemSlot(item.id);
  if (!slot) return '';
  const zone = zoneAt(CRUCIBLE_VENDOR_ENTRANCE_POS.x, CRUCIBLE_VENDOR_ENTRANCE_POS.z);
  const text = t('hudChrome.itemTooltip.sigilRedeem', {
    vendor: tEntity({ kind: 'npc', id: CRUCIBLE_VENDOR_NPC_ID, field: 'name' }),
    raid: tEntity({ kind: 'dungeon', id: IGNIVAR_RAID_ARENA_ID, field: 'name' }),
    zone: tEntity({ kind: 'zone', id: zone.id, field: 'name' }),
    slot: itemSlotLabel(slot),
  });
  return `<div class="tt-desc tt-sigil-redeem">${esc(text)}</div>`;
}
