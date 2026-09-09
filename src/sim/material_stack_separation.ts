// Manual grouping plans leave the input untouched, including on a stale
// selection, invalid source choice, or insufficient space. A grouping flag is
// owner presentation state; transfer adapters strip it from departing units.
import { isMergeableInstancePayload } from './item_instance_merge';
import {
  type MaterialComposition,
  type MaterialSourceCount,
  mergeMaterialCompositions,
  totalMaterialCount,
} from './material_sources';
import { normalizeMaterialStack, takeMaterialStack } from './material_stack';
import {
  type MaterialStackSelection,
  materialStackSelectionMatches,
} from './material_stack_selection';
import type { InvSlot } from './types';

export interface MaterialSeparationRequest {
  readonly inventory: readonly InvSlot[];
  readonly itemId: string;
  readonly selection: MaterialStackSelection;
  readonly materialIds: ReadonlySet<string>;
  readonly stackSize: number;
  readonly maxNewSlots: number;
  /** Absent separates by stable gatherer; present extracts exactly these units. */
  readonly selectedSources?: MaterialComposition;
}
export type MaterialSeparationResult =
  | { readonly ok: true; readonly value: InvSlot[] }
  | { readonly ok: false; readonly error: string };
const refuse = (error: string): MaterialSeparationResult => ({ ok: false, error });

function gathererGroups(sources: MaterialComposition): MaterialComposition[] {
  const groups = new Map<string, MaterialSourceCount[]>();
  for (const bucket of sources) {
    const g = bucket.source.gatherer;
    // Keep every snapshot and premium descriptor within its person's block.
    const key = g === undefined ? '' : JSON.stringify([g.kind, g.id]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [bucket]);
    else group.push(bucket);
  }
  return [...groups.values()];
}

export function planMaterialStackSeparation(
  request: MaterialSeparationRequest,
): MaterialSeparationResult {
  const { inventory, itemId, selection, materialIds, stackSize, maxNewSlots } = request;
  if (!materialStackSelectionMatches(inventory, itemId, selection))
    return refuse('stale-selection');
  if (
    !Number.isSafeInteger(stackSize) ||
    stackSize <= 0 ||
    !Number.isSafeInteger(maxNewSlots) ||
    maxNewSlots < 0
  )
    return refuse('invalid-capacity');
  const normalized = normalizeMaterialStack(inventory[selection.slotIndex], materialIds);
  if (!normalized.ok) return normalized;
  const held = normalized.value;
  if (!isMergeableInstancePayload(held.instance)) return refuse('restricted');

  let remaining: InvSlot | null = null;
  let groups: MaterialComposition[];
  if (request.selectedSources === undefined) groups = gathererGroups(held.materialSources ?? []);
  else {
    const selected = mergeMaterialCompositions([], request.selectedSources);
    if (!selected.ok) return selected;
    const take = takeMaterialStack(
      held,
      totalMaterialCount(selected.value),
      materialIds,
      selected.value,
    );
    if (!take.ok) return take;
    remaining = take.value.remaining;
    groups = [take.value.taken.materialSources ?? []];
  }
  // Count required cells BEFORE producing them, so a retained legacy overstack
  // cannot allocate millions of rows only to discover the bags are full.
  let rows = remaining === null ? 0n : 1n;
  for (const group of groups) {
    const total = BigInt(totalMaterialCount(group));
    rows += (total + BigInt(stackSize) - 1n) / BigInt(stackSize);
  }
  if (rows > BigInt(maxNewSlots) + 1n) return refuse('insufficient-space');

  const replacement: InvSlot[] = remaining === null ? [] : [remaining];
  for (const group of groups) {
    let pending: InvSlot | null = {
      ...held,
      count: totalMaterialCount(group),
      materialSources: group,
    };
    while (pending !== null) {
      const split = takeMaterialStack(pending, Math.min(stackSize, pending.count), materialIds);
      if (!split.ok) return split;
      replacement.push({ ...split.value.taken, materialSeparated: true });
      pending = split.value.remaining;
    }
  }
  if (held.slot !== undefined && replacement.length > 0) replacement[0].slot = held.slot;
  const next = inventory.slice();
  // Bounded by actual free cells; no unbounded input expansion at this splice.
  next.splice(selection.slotIndex, 1, ...replacement);
  return { ok: true, value: next };
}
