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
