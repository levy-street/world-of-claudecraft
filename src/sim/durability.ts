import { ITEMS } from './data';
import type { PlayerEquipment } from './entity';
import type { PlayerMeta } from './sim';
import { EQUIP_SLOTS, type EquipSlot } from './types';

export type EquipmentDurability = Partial<Record<EquipSlot, number>>;

const SLOT_DURABILITY: Record<EquipSlot, number> = {
  mainhand: 65,
  helmet: 55,
  shoulder: 50,
  chest: 80,
  waist: 45,
  legs: 70,
  gloves: 45,
  feet: 55,
};

const QUALITY_MULT: Record<string, number> = {
  poor: 0.85,
  common: 1,
  uncommon: 1.15,
  rare: 1.3,
  epic: 1.5,
  legendary: 1.8,
};

export const DEATH_DURABILITY_LOSS = 0.1;
export const REPAIR_VALUE_MULT = 0.4;

export function maxDurabilityForItem(itemId: string | undefined): number {
  if (!itemId) return 0;
  const def = ITEMS[itemId];
  if (!def?.slot || (def.kind !== 'weapon' && def.kind !== 'armor')) return 0;
  const mult = QUALITY_MULT[def.quality ?? 'common'] ?? 1;
  return Math.max(1, Math.round(SLOT_DURABILITY[def.slot] * mult));
}

export function currentDurabilityForSlot(meta: PlayerMeta, slot: EquipSlot): number {
  const max = maxDurabilityForItem(meta.equipment[slot]);
  if (max <= 0) return 0;
  const raw = meta.equipmentDurability[slot];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return max;
  return Math.max(0, Math.min(max, Math.floor(raw)));
}

export function normalizeEquipmentDurability(
  equipment: PlayerEquipment,
  input: EquipmentDurability | undefined,
): EquipmentDurability {
  const out: EquipmentDurability = {};
  for (const slot of EQUIP_SLOTS) {
    const max = maxDurabilityForItem(equipment[slot]);
    if (max <= 0) continue;
    const raw = input?.[slot];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const value = Math.max(0, Math.min(max, Math.floor(raw)));
    if (value < max) out[slot] = value;
  }
  return out;
}

export function resetSlotDurability(meta: PlayerMeta, slot: EquipSlot): void {
  delete meta.equipmentDurability[slot];
}

export function damageEquippedDurability(
  meta: PlayerMeta,
  lossRatio = DEATH_DURABILITY_LOSS,
): EquipmentDurability {
  const changed: EquipmentDurability = {};
  for (const slot of EQUIP_SLOTS) {
    const itemId = meta.equipment[slot];
    const max = maxDurabilityForItem(itemId);
    if (!itemId || max <= 0) continue;
    const current = currentDurabilityForSlot(meta, slot);
    const loss = Math.max(1, Math.ceil(max * lossRatio));
    const next = Math.max(0, current - loss);
    if (next < max) meta.equipmentDurability[slot] = next;
    else delete meta.equipmentDurability[slot];
    if (next !== current) changed[slot] = next;
  }
  return changed;
}

export function equipmentRepairCost(meta: PlayerMeta): {
  total: number;
  slots: EquipmentDurability;
} {
  let total = 0;
  const slots: EquipmentDurability = {};
  for (const slot of EQUIP_SLOTS) {
    const itemId = meta.equipment[slot];
    const def = itemId ? ITEMS[itemId] : undefined;
    const max = maxDurabilityForItem(itemId);
    if (!def || max <= 0) continue;
    const current = currentDurabilityForSlot(meta, slot);
    const missing = max - current;
    if (missing <= 0) continue;
    slots[slot] = current;
    total += Math.max(1, Math.ceil((missing / max) * def.sellValue * REPAIR_VALUE_MULT));
  }
  return { total, slots };
}

export function repairAllEquipment(meta: PlayerMeta): number {
  const { total } = equipmentRepairCost(meta);
  if (total <= 0) return 0;
  meta.equipmentDurability = {};
  return total;
}

export function durabilityReadout(meta: PlayerMeta): string {
  const parts: string[] = [];
  for (const slot of EQUIP_SLOTS) {
    const itemId = meta.equipment[slot];
    if (!itemId) continue;
    const max = maxDurabilityForItem(itemId);
    if (max <= 0) continue;
    const def = ITEMS[itemId];
    parts.push(`${def.name} ${currentDurabilityForSlot(meta, slot)}/${max}`);
  }
  return parts.length > 0 ? `Durability: ${parts.join(', ')}.` : 'Durability: no equipped gear.';
}
