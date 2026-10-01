// Shared inventory mutation for the instance-grant hub. Materials use exact
// source-aware packing; other items retain their existing per-copy semantics.
import { addStacked, stackSizeOf } from './bags';
import { ITEMS } from './data';
import { canStackInstancePayloads } from './item_instance_merge';
import { isMaterialItemId } from './material_ids';
import type { MaterialComposition } from './material_sources';
import { cloneItemInstancePayload, type InvSlot, type ItemInstancePayload } from './types';

/** Acquisition metadata shared by both inventory grant callbacks. */
export interface InventoryGrantOptions {
  readonly silent?: boolean;
  readonly callerLogs?: boolean;
  readonly craftedRecipeId?: string;
  readonly movement?: boolean;
  readonly materialSources?: MaterialComposition;
  /** Where a world-sourced grant came from, for a tracked copy's provenance
   *  record (item_tracking.ts): a sim-composed id such as "mob:<templateId>"
   *  or "quest:<questId>". Absent means the hub records the generic source
   *  ("craft:<recipeId>" when craftedRecipeId is set, else "world", or
   *  "legacy" for a payload-free copy first seen while changing hands). */
  readonly source?: string;
}

export function grantInventoryInstances(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  instance: ItemInstancePayload,
  craftedRecipeId?: string,
  materialSources?: MaterialComposition,
): void {
  if (isMaterialItemId(itemId)) {
    addStacked(inventory, itemId, count, instance, craftedRecipeId, materialSources);
    return;
  }
  const def = ITEMS[itemId];
  const stack = stackSizeOf(def);
  for (let i = 0; i < count; i++) {
    const mergeTarget = inventory.find(
      (s) =>
        s.itemId === itemId &&
        s.count < stack &&
        s.craftedRecipeId === craftedRecipeId &&
        canStackInstancePayloads(s.instance, instance),
    );
    if (mergeTarget) mergeTarget.count += 1;
    // The first pushed slot holds the caller's payload object (the shipped
    // single-unit contract); any further slot a stack-cap crossing forces
    // gets its own clone, so two slots never share one mutable payload
    // (charges mutate in place, unbind clears boundTo on one slot).
    else
      inventory.push({
        itemId,
        count: 1,
        instance: i === 0 ? instance : cloneItemInstancePayload(instance),
        ...(craftedRecipeId === undefined ? {} : { craftedRecipeId }),
      });
  }
}
