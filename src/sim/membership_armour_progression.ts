// The level-20 promotion is durable item state, independent of the temporary
// entitlement. No stat bonuses are baked here; the live projection owns them.
import { bumpBankWireRev } from './bank';
import { MEMBERSHIP_ARMOUR_SLOTS } from './content/membership';
import { isScalingArmour } from './membership_armour';
import type { PlayerMeta } from './sim';

export function perfectMembershipArmour(meta: PlayerMeta, level: number): boolean {
  if (level < 20) return false;
  let equipmentChanged = false;
  let changed = false;
  for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
    const itemId = meta.equipment[slot];
    if (!itemId || !isScalingArmour(itemId) || meta.equipmentInstance[slot]?.perfected) continue;
    meta.equipmentInstance[slot] = { ...meta.equipmentInstance[slot], perfected: true };
    equipmentChanged = changed = true;
  }
  for (const item of meta.inventory) {
    if (!isScalingArmour(item.itemId) || item.instance?.perfected) continue;
    item.instance = { ...item.instance, perfected: true };
    changed = true;
  }
  let bankChanged = false;
  for (const item of meta.bank.inventory) {
    if (!isScalingArmour(item.itemId) || item.instance?.perfected) continue;
    item.instance = { ...item.instance, perfected: true };
    bankChanged = changed = true;
  }
  if (bankChanged) bumpBankWireRev(meta);
  let courierChanged = false;
  for (const item of meta.courier?.cargo ?? []) {
    if (!isScalingArmour(item.itemId) || item.instance?.perfected) continue;
    item.instance = { ...item.instance, perfected: true };
    courierChanged = changed = true;
  }
  if (courierChanged && meta.courier) meta.courier.revision++;
  if (changed) meta.wireRev++;
  return equipmentChanged;
}
