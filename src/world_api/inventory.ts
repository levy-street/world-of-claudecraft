import type { EquipSlot, InvSlot } from '../sim/types';

export interface IWorldInventory {
  inventory: InvSlot[];
  // The 4 equippable bag sockets (kind:'bag' item ids, null = empty socket).
  bags: (string | null)[];
  // Total pooled slot budget: the implicit 16-slot backpack plus every
  // equipped bag's bagSlots (see src/sim/bags.ts). Used slots is inventory.length.
  bagCapacity: number;
  vendorBuyback: InvSlot[];
  equipment: Partial<Record<EquipSlot, string>>;
  copper: number;
  equipItem(itemId: string): void;
  /** Reorder the bags: move the stack at inventory index `from` onto the bag cell at
   *  `to` (a swap when that cell holds a stack, a move to the end when it is free
   *  space). The order is the inventory array itself, persisted with the character. */
  moveInventoryItem(from: number, to: number): void;
  /** Equip into the exact slot the player aimed at (a paperdoll drop target),
   *  instead of letting the sim's resolver pick (a ring dropped on the second
   *  finger lands there even while the first is free). The sim re-validates the
   *  slot against the item, so an illegal pairing is refused, never coerced. */
  equipItemToSlot(itemId: string, slot: EquipSlot): void;
  unequipItem(slot: EquipSlot): void;
  /** Equip a bag item into a socket (first empty when omitted; swaps in place). */
  equipBag(itemId: string, socket?: number): void;
  /** Return the bag in `socket` to the inventory (refused when items would not fit). */
  unequipBag(socket: number): void;
  useItem(itemId: string): void;
  discardItem(itemId: string, count?: number): void;
  buyItem(npcId: number, itemId: string): void;
  sellItem(itemId: string, count?: number): void;
  // Sell every gray (poor-quality) item in the bags at once while a vendor is open.
  // Quest items and anything flagged noVendorSell are left untouched.
  sellAllJunk(): void;
  buyBackItem(itemId: string): void;
}
