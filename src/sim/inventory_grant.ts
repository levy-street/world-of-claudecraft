// Shared inventory mutation for the instance-grant hub. Source-aware items use exact
// source-aware packing; other items retain their existing per-copy semantics.
import { addStacked, stackSizeOf } from './bags';
import { ITEMS } from './data';
import { creditHeroicMarks, isCurrencyGrantId } from './heroic_marks';
import { canStackInstancePayloads } from './item_instance_merge';
import type { MaterialComposition } from './material_sources';
import { isStackProvenanceItemId } from './stack_provenance_ids';
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
  /** The guid of the tracked copy this grant was made FROM (an upgrade
   *  recipe that consumed it, an admin restore of a lost copy): a minted copy
   *  records it as provenance.derivedFrom and its ledger row is a `derive`
   *  naming the parent (item_tracking.ts). Ignored for a copy that already
   *  carries a guid. */
  readonly derivedFrom?: string;
}

/** The plain (payload-free) grant mutation behind Sim.addItem: stack the copies
 *  into the bags, or, for a currency id (Heroic Marks), credit its counter and
 *  touch no slot. The hub's receipt, discovery and Reliquary bookkeeping run
 *  the same either way, so a marks grant reads exactly as it did as an item. */
export function grantPlainStack(
  meta: { inventory: InvSlot[]; heroicMarks: number },
  itemId: string,
  count: number,
  opts?: InventoryGrantOptions,
): void {
  if (isCurrencyGrantId(itemId)) {
    creditHeroicMarks(meta, count);
    return;
  }
  addStacked(
    meta.inventory,
    itemId,
    count,
    undefined,
    opts?.craftedRecipeId,
    opts?.materialSources,
  );
}

export function grantInventoryInstances(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  instance: ItemInstancePayload,
  craftedRecipeId?: string,
  materialSources?: MaterialComposition,
): void {
  if (isStackProvenanceItemId(itemId)) {
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
