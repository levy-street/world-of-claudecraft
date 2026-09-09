// Atomic material movement shared by personal and guild bank commands.
import type { PoolCapacity } from './bag_pools';
import { addStacked, countFit } from './bags';
import type { MoveResult } from './bank';
import { materialItemIds } from './material_ids';
import type { MaterialComposition } from './material_sources';
import { takeMaterialStack } from './material_stack';
import type { InvSlot } from './types';

export function moveMaterialBetweenContainers(
  source: InvSlot[],
  sourceIndex: number,
  count: number | undefined,
  dest: InvSlot[],
  destPools: PoolCapacity,
  selectedSources?: MaterialComposition,
): MoveResult {
  if (source === dest) return { moved: 0, refusal: 'invalid' };
  const slot = source[sourceIndex];
  if (!slot) return { moved: 0, refusal: 'invalid' };
  const taken = takeMaterialStack(slot, count ?? slot.count, materialItemIds(), selectedSources);
  if (!taken.ok) return { moved: 0, refusal: 'invalid' };
  const { taken: incoming, remaining } = taken.value;
  const { itemId, instance, craftedRecipeId, materialSources } = incoming;
  if (
    countFit(dest, destPools, itemId, incoming.count, instance, craftedRecipeId, materialSources) <
    incoming.count
  ) {
    return { moved: 0, refusal: 'no_fit', noFitCause: 'space' };
  }
  // Packing validates the whole grant before applying it. The source changes
  // only after that grant succeeds, so either side's refusal moves nothing.
  addStacked(dest, itemId, incoming.count, instance, craftedRecipeId, materialSources);
  if (remaining) source[sourceIndex] = remaining;
  else source.splice(sourceIndex, 1);
  return { moved: incoming.count };
}
