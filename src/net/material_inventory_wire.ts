// Inventory deltas are all-or-nothing: malformed sources retain the last mirror.
import { validateMaterialSlotSourcesOnLoad } from '../sim/material_slot_load';
import type { InvSlot } from '../sim/types';

function decodeSlots(value: unknown): InvSlot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    for (const slot of value) {
      if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) return undefined;
      validateMaterialSlotSourcesOnLoad(slot);
    }
    return value as InvSlot[];
  } catch {
    return undefined;
  }
}

export function applyMaterialInventoryWire(
  mirror: { inventory: InvSlot[]; vendorBuyback: InvSlot[]; bags?: (string | null)[] },
  self: { inv?: unknown; buyback?: unknown; bags?: (string | null)[] },
): boolean {
  let changed = false;
  if (self.inv !== undefined) {
    const inventory = decodeSlots(self.inv);
    if (inventory !== undefined) {
      mirror.inventory = inventory;
      changed = true;
    }
  }
  if (self.buyback !== undefined) {
    const buyback = decodeSlots(self.buyback);
    if (buyback !== undefined) {
      mirror.vendorBuyback = buyback;
      changed = true;
    }
  }
  if (self.bags !== undefined) {
    mirror.bags = self.bags;
    changed = true;
  }
  return changed;
}
