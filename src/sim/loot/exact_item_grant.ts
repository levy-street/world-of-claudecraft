import { countFit } from '../bags';
import { itemInstancePayloadsEqual } from '../item_instance_merge';
import { cloneProceduralPayload } from '../procedural_item';
import type { InvSlot, ItemInstancePayload, LootSlot } from '../types';

export interface ExactItemGrantSink {
  addItem(itemId: string, count: number, pid?: number): void;
  addItemInstance(
    itemId: string,
    instance: ItemInstancePayload,
    pid?: number,
    count?: number,
  ): void;
}

export function cloneExactLootSlot<T extends LootSlot>(slot: T): T {
  return {
    ...slot,
    ...(slot.instance && { instance: cloneProceduralPayload(slot.instance) }),
    ...(slot.personalFor && { personalFor: [...slot.personalFor] }),
  };
}

export function canFitExactLootSlot(
  inventory: readonly InvSlot[],
  capacity: number,
  slot: Pick<LootSlot, 'itemId' | 'count' | 'instance'>,
): boolean {
  return countFit(inventory, capacity, slot.itemId, slot.count, slot.instance) >= slot.count;
}

export function grantExactLootSlot(
  sink: ExactItemGrantSink,
  slot: Pick<LootSlot, 'itemId' | 'count' | 'instance'>,
  pid: number,
): void {
  if (slot.count < 1) return;
  if (slot.instance) sink.addItemInstance(slot.itemId, slot.instance, pid, slot.count);
  else sink.addItem(slot.itemId, slot.count, pid);
}

export function returnExactLootSlotToCorpse(
  items: LootSlot[],
  source: Pick<LootSlot, 'itemId' | 'count' | 'instance'>,
): LootSlot {
  if (source.count < 1) throw new Error('cannot return an empty loot slot');
  // Procedural equipment is unique by UID and stays one unit per corpse row.
  // Never merge it into a counted row, even if a caller accidentally returns
  // the same payload twice: duplicate-UID validation must be able to see that
  // corruption instead of hiding it behind count 2.
  if (!source.instance?.procedural) {
    const existing = items.find(
      (slot) =>
        slot.openToAll &&
        !slot.personalFor &&
        slot.itemId === source.itemId &&
        itemInstancePayloadsEqual(slot.instance, source.instance),
    );
    if (existing) {
      existing.count += source.count;
      return existing;
    }
  }
  const returned: LootSlot = {
    itemId: source.itemId,
    count: source.count,
    openToAll: true,
    ...(source.instance && { instance: cloneProceduralPayload(source.instance) }),
  };
  items.push(returned);
  return returned;
}
