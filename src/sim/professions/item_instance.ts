import { proceduralQuality } from '../procedural_item';
import { requiredLevelForItemInstance } from '../procedural_item_level';
import {
  cloneItemInstancePayload,
  type InvSlot,
  type ItemDef,
  type ItemInstancePayload,
} from '../types';

/** The effective economy quality of one concrete item copy. Procedural rarity
 *  is authoritative for generated gear; legacy rolled quality remains the
 *  fallback for pre-procedural instanced gear, then the authored base quality. */
export function professionItemQuality(
  def: ItemDef,
  instance?: ItemInstancePayload,
): NonNullable<ItemDef['quality']> {
  const rarity = instance?.procedural?.rarity;
  if (rarity) return proceduralQuality(rarity) ?? def.quality ?? 'common';
  return (
    (instance?.rolled?.quality as NonNullable<ItemDef['quality']> | undefined) ??
    def.quality ??
    'common'
  );
}

/** Required-level tier used by profession yields. Generated copies scale from
 *  their own item level; authored and legacy copies keep the existing def rule. */
export function professionItemLevel(def: ItemDef, instance?: ItemInstancePayload): number {
  return requiredLevelForItemInstance(def, instance);
}

/** Resolve a server-issued procedural UID to the exact current bag slot.
 *  The client supplies only an opaque selector; every payload fact is read from
 *  authoritative inventory. */
export function exactInventoryIndex(
  inventory: readonly InvSlot[],
  itemId: string,
  instanceUid: string,
): number {
  for (let index = inventory.length - 1; index >= 0; index--) {
    const slot = inventory[index];
    if (slot.itemId === itemId && slot.instance?.procedural?.uid === instanceUid) return index;
  }
  return -1;
}

/** Consume one unit from a previously resolved slot, cloning a shared payload
 *  when the stack survives so callers can transform the return without aliasing. */
export function consumeInventoryUnitAt(
  inventory: InvSlot[],
  index: number,
): ItemInstancePayload | undefined {
  const slot = inventory[index];
  if (!slot || slot.count <= 0) return undefined;
  const instance =
    slot.instance && slot.count > 1 ? cloneItemInstancePayload(slot.instance) : slot.instance;
  slot.count -= 1;
  if (slot.count <= 0) inventory.splice(index, 1);
  return instance;
}
