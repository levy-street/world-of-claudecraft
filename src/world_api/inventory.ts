import type { EquipSlot, InvSlot } from '../sim/types';

export interface IWorldInventory {
  inventory: InvSlot[];
  bank: InvSlot[];
  vendorBuyback: InvSlot[];
  equipment: Partial<Record<EquipSlot, string>>;
  copper: number;
  bankCopper: number;
  equipItem(itemId: string): void;
  unequipItem(slot: EquipSlot): void;
  depositBankItem(itemId: string, count?: number): void;
  withdrawBankItem(itemId: string, count?: number): void;
  depositBankCopper(amount: number): void;
  withdrawBankCopper(amount: number): void;
  useItem(itemId: string): void;
  discardItem(itemId: string, count?: number): void;
  buyItem(npcId: number, itemId: string): void;
  sellItem(itemId: string, count?: number): void;
  // Sell every gray (poor-quality) item in the bags at once while a vendor is open.
  // Quest items and anything flagged noVendorSell are left untouched.
  sellAllJunk(): void;
  buyBackItem(itemId: string): void;
}
