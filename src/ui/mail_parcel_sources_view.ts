// Pure outgoing-mail presentation model. It asks the same planner as
// PostOffice which material units each pool request would consume, so a chip
// never presents the clicked bag row as though mail had selected that row.

import {
  type MaterialMailAttachmentRequest,
  mailMaterialAttachmentAvailableCount,
  planMaterialMailAttachments,
} from '../sim/mail/material_attachment_plan';
import {
  canonicalMaterialComposition,
  type MaterialComposition,
  mergeMaterialCompositions,
} from '../sim/material_sources';
import type { InvSlot, ItemInstancePayload } from '../sim/types';

/** Null means the complete attachment batch cannot currently be planned. */
export function plannedMailParcelSources(
  inventory: readonly InvSlot[],
  attachments: readonly MaterialMailAttachmentRequest[],
): readonly (MaterialComposition | undefined)[] | null {
  const planned = planMaterialMailAttachments(inventory, attachments);
  if (!planned.ok) return null;
  const previews: (MaterialComposition | undefined)[] = [];
  for (const rows of planned.value.rowsByAttachment) {
    if (rows === null) {
      previews.push(undefined);
      continue;
    }
    let merged: MaterialComposition = [];
    for (const row of rows) {
      const sources = canonicalMaterialComposition(row.materialSources, row.count);
      if (!sources.ok) return null;
      const next = mergeMaterialCompositions(merged, sources.value);
      if (!next.ok) return null;
      merged = next.value;
    }
    previews.push(merged.length > 0 ? merged : undefined);
  }
  return previews;
}

/** Material capacity for a new request appended after every staged parcel.
 * Null preserves the existing non-material stock rules. */
export function appendableMailParcelCount(
  inventory: readonly InvSlot[],
  attachments: readonly MaterialMailAttachmentRequest[],
  itemId: string,
  instance?: ItemInstancePayload,
): number | null {
  const materialOwned = mailMaterialAttachmentAvailableCount(inventory, itemId, instance);
  if (materialOwned === null) return null;
  const prefix = planMaterialMailAttachments(inventory, attachments);
  if (!prefix.ok) return 0;
  const remaining = mailMaterialAttachmentAvailableCount(prefix.value.inventory, itemId, instance);
  if (remaining === null || remaining < 1) return 0;
  const count = instance === undefined ? remaining : 1;
  const candidate = [...attachments, { itemId, count, ...(instance ? { instance } : {}) }];
  return planMaterialMailAttachments(inventory, candidate).ok ? count : 0;
}

/** Largest legal count for an existing material request while every other
 * staged request keeps its position. Null preserves non-material behavior. */
export function mailParcelCountCeiling(
  inventory: readonly InvSlot[],
  attachments: readonly MaterialMailAttachmentRequest[],
  index: number,
): number | null {
  const request = attachments[index];
  if (request === undefined) return 0;
  const materialOwned = mailMaterialAttachmentAvailableCount(
    inventory,
    request.itemId,
    request.instance,
  );
  if (materialOwned === null) return null;
  let low = 0;
  let high = request.instance === undefined ? materialOwned : Math.min(1, materialOwned);
  while (low < high) {
    const count = low + Math.ceil((high - low) / 2);
    const candidate = attachments.map((attachment, attachmentIndex) =>
      attachmentIndex === index ? { ...attachment, count } : attachment,
    );
    if (planMaterialMailAttachments(inventory, candidate).ok) low = count;
    else high = count - 1;
  }
  return low;
}
