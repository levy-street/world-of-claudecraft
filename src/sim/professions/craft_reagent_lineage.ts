// Tracked-item lineage across a craft (docs/design/item-tracking.md
// "Lineage"): a recipe that spends a tracked (epic or legendary) copy as a
// reagent ends that copy, and when its output is tracked too the output is a
// DIFFERENT item made from it. So the output is minted as a `derive` row
// naming the spent copy (InventoryGrantOptions.derivedFrom, which the hub in
// item_tracking.ts turns into provenance.derivedFrom), and the spent copy
// writes its final `consume` row naming the output's new guid. An untracked
// output just leaves the consume row with no related guid.
//
// crafting.ts stays the thin consumer: it collects the payloads its
// lock-aware removal spent (item_lock.ts removeUnlockedFromSlots), asks
// craftLineageParent for the guid to pass on the grant, and calls
// recordCraftReagentLineage once the output is in the bags.
//
// `src/sim`-pure: no DOM/render/ui/game/net imports, no rng, no clock. Emits
// only, so the craft's single masterwork draw never moves.

import { isItemGuid } from '../item_provenance';
import { recordTrackedConsumed } from '../item_tracking';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { ItemInstancePayload } from '../types';

/** One reagent unit a craft spent that carried a payload. */
export interface SpentReagentCopy {
  readonly itemId: string;
  readonly instance: ItemInstancePayload;
}

/** The guid the craft's output derives from: the FIRST tracked copy the
 *  craft spent (reagent order), or undefined when it spent none. A derive
 *  row names one parent; any further tracked reagent still gets its own
 *  consume row pointing at the output (recordCraftReagentLineage). */
export function craftLineageParent(spent: readonly SpentReagentCopy[]): string | undefined {
  for (const copy of spent) {
    if (isItemGuid(copy.instance.guid)) return copy.instance.guid;
  }
  return undefined;
}

/** The copy of `resultItemId` in `meta`'s bags minted from `parentGuid` (the
 *  hub stamped its provenance.derivedFrom), or undefined when the output was
 *  not tracked. */
function derivedChildGuid(
  meta: PlayerMeta,
  resultItemId: string,
  parentGuid: string,
): string | undefined {
  for (const slot of meta.inventory) {
    const instance = slot.instance;
    if (slot.itemId !== resultItemId || !instance?.guid) continue;
    if (instance.provenance?.derivedFrom === parentGuid && instance.guid !== parentGuid) {
      return instance.guid;
    }
  }
  return undefined;
}

/** Write the `consume` row for every tracked copy the craft spent, source
 *  `craft:<recipeId>`, detail the output item id, and relatedGuid the
 *  output's new guid when it was minted as a derive of `parentGuid`. Call
 *  AFTER the output grant. A craft that spent no tracked copy writes nothing. */
export function recordCraftReagentLineage(
  ctx: SimContext,
  meta: PlayerMeta,
  recipeId: string,
  resultItemId: string,
  spent: readonly SpentReagentCopy[],
  parentGuid: string | undefined,
): void {
  if (parentGuid === undefined) return;
  const childGuid = derivedChildGuid(meta, resultItemId, parentGuid);
  for (const copy of spent) {
    recordTrackedConsumed(
      ctx,
      meta,
      copy.itemId,
      [copy.instance],
      `craft:${recipeId}`,
      resultItemId,
      childGuid,
    );
  }
}
