// Whole-stack moves between a storage container and courier cargo, shared by the
// personal bank leg and the other-character leg so both take a picked stack the
// same way: its original quantity and identity, even after a deposit topped the
// same slot up.
import { moveBetweenContainers } from '../bank';
import { isStackProvenanceItemId } from '../stack_provenance_ids';
import { cloneInvSlot, type InvSlot } from '../types';
import { COURIER_CAPACITY } from './types';

/** Move `original` (as picked) out of `source[index]` into `cargo`; returns the
 *  units moved, 0 when the slot no longer holds it or cargo has no room. */
export function withdrawOriginal(
  source: InvSlot[],
  index: number,
  original: InvSlot,
  cargo: InvSlot[],
  capacity = COURIER_CAPACITY,
): number {
  const current = source[index];
  if (!current || current.itemId !== original.itemId || current.count < original.count) return 0;
  const pools = { general: capacity, materials: 0 };
  if (
    original.instance &&
    !isStackProvenanceItemId(original.itemId) &&
    current.count > original.count
  ) {
    const remaining = cloneInvSlot(current);
    remaining.count -= original.count;
    const countBefore = current.count;
    current.count = original.count;
    const result = moveBetweenContainers(source, index, undefined, cargo, pools);
    if (result.moved > 0) source.splice(index, 0, remaining);
    else current.count = countBefore;
    return result.moved;
  }
  return moveBetweenContainers(
    source,
    index,
    original.count,
    cargo,
    pools,
    original.materialSources,
  ).moved;
}
