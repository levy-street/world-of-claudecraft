import type { PlayerEquipmentInstances } from '../sim/entity';
import type { EquipSlot, InvSlot, ItemInstancePayload } from '../sim/types';
import type { VendorBuyOptions } from '../sim/vendor_buy_stack';

export interface IWorldInventory {
  inventory: InvSlot[];
  // The 4 equippable bag sockets (kind:'bag' item ids, null = empty socket).
  bags: (string | null)[];
  // Total pooled slot budget: the implicit 16-slot backpack plus every
  // equipped bag's bagSlots (see src/sim/bags.ts). Used slots is inventory.length.
  bagCapacity: number;
  vendorBuyback: InvSlot[];
  equipment: Partial<Record<EquipSlot, string>>;
  equipmentInstances: PlayerEquipmentInstances;
  copper: number;
  equipItem(itemId: string, target?: { slotIndex: number }): void;
  /** Reorder the bags: move the stack at inventory index `from` onto the bag cell at
   *  `to` (a swap when that cell holds a stack, a move to the end when it is free
   *  space). The order is the inventory array itself, persisted with the character. */
  moveInventoryItem(from: number, to: number): void;
  /** One-shot bag clean-up (the classic sort button): consolidate partial
   *  stacks and restamp every stack's persisted cell hint into the canonical
   *  ladder (gear, consumables, tools, materials with fine grades beside
   *  their base, quest, gray trash last). Authoritative like every inventory
   *  command; deterministic, so both hosts land the identical grid
   *  (src/sim/inventory_sort.ts). */
  sortInventory(): void;
  /** Equip into the exact slot the player aimed at (a paperdoll drop target),
   *  instead of letting the sim's resolver pick (a ring dropped on the second
   *  finger lands there even while the first is free). The sim re-validates the
   *  slot against the item, so an illegal pairing is refused, never coerced. */
  equipItemToSlot(itemId: string, slot: EquipSlot, target?: { slotIndex: number }): void;
  unequipItem(slot: EquipSlot): void;
  /** Equip a bag item into a socket (first empty when omitted; swaps in place). */
  equipBag(itemId: string, socket?: number, target?: { slotIndex: number }): void;
  /** Return the bag in `socket` to the inventory (refused when items would not fit). */
  unequipBag(socket: number): void;
  useItem(itemId: string, target?: { slotIndex: number }): void;
  discardItem(itemId: string, count?: number, target?: { slotIndex: number }): void;
  // The request rides an options bag (VendorBuyOptions, phase 21): `bulk`
  // requests as many units as the buyer can currently afford in one purchase,
  // capped at the item's bag stack size (VendorGoodsRow.bulkQuantity previews
  // the count); `count` buys that many row units atomically, refuse-whole on
  // any shortfall. The server re-derives and validates every quantity
  // (vendor_buy_stack.ts), never trusting the client's math; the client sends
  // at most one of the two fields. An empty/omitted bag buys the ordinary
  // single unit (or the food/drink staple stack), byte-identical to today.
  buyItem(npcId: number, itemId: string, opts?: VendorBuyOptions): void;
  sellItem(itemId: string, count?: number, target?: { slotIndex: number }): void;
  // Sell every gray (poor-quality) item in the bags at once while a vendor is open.
  // Quest items and anything flagged noVendorSell are left untouched.
  sellAllJunk(): void;
  // `index` addresses the exact row in vendorBuyback the player clicked
  // (VendorView.buyback[].index); rows can share an itemId with different
  // instance payloads, so the index disambiguates which copy comes back.
  // `instance` is that same row's payload as last seen by the client
  // (VendorView.buyback[].instance): the server only honors the index when
  // the row still carries this exact payload, so a stale index that now
  // points at a different same-itemId row cannot redeem the wrong copy (#2398).
  buyBackItem(
    itemId: string,
    index?: number,
    instance?: ItemInstancePayload,
    craftedRecipeId?: string,
  ): void;
  upgradeRiftItem(itemId: string, target?: { slotIndex: number }): void;
  enchantRiftItem(itemId: string, stat: string, target?: { slotIndex: number }): void;
  socketRiftGem(itemId: string, gemId: string, target?: { slotIndex: number }): void;
}
