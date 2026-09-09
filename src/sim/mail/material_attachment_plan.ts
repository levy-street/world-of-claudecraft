// Pure material planning for Ravenpost attachments. The client may preview this
// exact answer, while PostOffice applies it only after every mail gate passes.
// Requests name an item pool and, optionally, a canonical payload; they never
// name a bag slot or imply that a manually separated stack was selected.

import { itemInstancePayloadsEqual } from '../item_instance_merge';
import { coalesceMaterialTransferSlots } from '../material_exchange_transfer';
import { isMaterialItemId, materialItemIds } from '../material_ids';
import {
  applyMaterialInventoryTake,
  type MaterialTakeError,
  planMaterialInventoryTake,
} from '../material_inventory_take';
import { materialSourceUnitPayload } from '../material_inventory_units';
import { isTransferLockedInstance } from '../transfer_lock';
import { cloneInvSlot, type InvSlot, type ItemInstancePayload } from '../types';

export interface MaterialMailAttachmentRequest {
  readonly itemId: string;
  readonly count: number;
  readonly instance?: ItemInstancePayload;
}

export type MaterialMailAttachmentPlanError =
  | 'invalid-request'
  | 'insufficient'
  | 'invalid-material-state';

export interface MaterialMailAttachmentPlan {
  /** Independent inventory after every material request, in request order. */
  readonly inventory: InvSlot[];
  /**
   * Exact parcel rows for each input request. A null entry means the request is
   * non-material and remains PostOffice's existing responsibility.
   */
  readonly rowsByAttachment: readonly (readonly InvSlot[] | null)[];
}

export type MaterialMailAttachmentPlanResult =
  | { readonly ok: true; readonly value: MaterialMailAttachmentPlan }
  | { readonly ok: false; readonly error: MaterialMailAttachmentPlanError };

type EligibleSource = NonNullable<
  Parameters<typeof planMaterialInventoryTake>[0]['eligibleSource']
>;

function failure(error: MaterialTakeError): MaterialMailAttachmentPlanResult {
  if (error === 'insufficient') return { ok: false, error: 'insufficient' };
  if (error === 'invalid-quantity') return { ok: false, error: 'invalid-request' };
  return { ok: false, error: 'invalid-material-state' };
}

/**
 * Mail's selector rule for a material request.
 *
 * A plain request selects canonical payload-free material, including premium
 * source signatures. A canonical payload request matches that payload without
 * treating source descriptors as instance identity. Legacy signer needles keep
 * their exact historical meaning by matching the reconstructed effective
 * payload, so they cannot select another signer's unit.
 */
function eligibleFor(instance: ItemInstancePayload | undefined): EligibleSource {
  if (instance === undefined) return (_source, slot) => slot.instance === undefined;
  const legacySignerNeedle = typeof instance.signer === 'string';
  return (source, slot) => {
    const effective = materialSourceUnitPayload(slot, source);
    if (isTransferLockedInstance(effective)) return false;
    return legacySignerNeedle
      ? itemInstancePayloadsEqual(effective, instance)
      : itemInstancePayloadsEqual(slot.instance, instance);
  };
}

function planOne(
  inventory: readonly InvSlot[],
  request: MaterialMailAttachmentRequest,
  allowPartial = false,
) {
  return planMaterialInventoryTake({
    inventory,
    itemId: request.itemId,
    count: request.count,
    materialIds: materialItemIds(),
    eligibleSource: eligibleFor(request.instance),
    allowPartial,
  });
}

/**
 * How many units the corresponding material mail request can currently select.
 * Null means the item is outside the material taxonomy. Invalid held state and
 * a locked/unmatched selector expose no sendable units to a client preview.
 */
export function mailMaterialAttachmentAvailableCount(
  inventory: readonly InvSlot[],
  itemId: string,
  instance?: ItemInstancePayload,
): number | null {
  if (!isMaterialItemId(itemId)) return null;
  const planned = planOne(
    inventory,
    { itemId, count: Number.MAX_SAFE_INTEGER, ...(instance === undefined ? {} : { instance }) },
    true,
  );
  return planned.ok ? planned.value.takenCount : 0;
}

/**
 * Plan every material attachment sequentially against one scratch inventory.
 * A late shortfall returns no inventory and no rows, so overlapping requests
 * cannot validate independently and then book a partial letter.
 */
export function planMaterialMailAttachments(
  inventory: readonly InvSlot[],
  attachments: readonly MaterialMailAttachmentRequest[],
): MaterialMailAttachmentPlanResult {
  const scratch = inventory.map(cloneInvSlot);
  const rowsByAttachment: (readonly InvSlot[] | null)[] = [];

  for (const request of attachments) {
    if (!isMaterialItemId(request.itemId)) {
      rowsByAttachment.push(null);
      continue;
    }
    const count = Math.floor(request.count);
    if (!Number.isFinite(request.count) || !Number.isSafeInteger(count) || count <= 0) {
      return { ok: false, error: 'invalid-request' };
    }
    if (request.instance !== undefined && count !== 1) {
      return { ok: false, error: 'invalid-request' };
    }
    const planned = planOne(scratch, { ...request, count });
    if (!planned.ok) return failure(planned.error);
    rowsByAttachment.push(coalesceMaterialTransferSlots(planned.value.taken));
    applyMaterialInventoryTake(scratch, planned.value);
  }

  return { ok: true, value: { inventory: scratch, rowsByAttachment } };
}
