// A selected transfer sends canonical source indexes plus a bounded stack pin.
// Full names need not ride back in the command, even for a 200-source vault row.
// The server resolves every descriptor from its own unchanged stack; the pin is
// only a stale-view witness, never authority to create or relabel a source.
import { materialItemIds } from './material_ids';
import type { MaterialComposition, MaterialSourceCount } from './material_sources';
import { normalizeMaterialStack } from './material_stack';
import {
  type MaterialStackSelection,
  materialStackSelectionMatches,
} from './material_stack_selection';
import type { InvSlot } from './types';

export interface MaterialSourceTransferSelection {
  readonly itemId: string;
  readonly target: MaterialStackSelection;
  readonly quantities: readonly { readonly sourceIndex: number; readonly count: number }[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const index = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

/** Present malformed intent is refused, never treated as the automatic choice. */
export function readMaterialSourceTransferSelection(
  value: unknown,
): MaterialSourceTransferSelection | null {
  if (!record(value) || typeof value.itemId !== 'string' || value.itemId.length === 0) return null;
  const target = value.target;
  if (
    !record(target) ||
    !index(target.slotIndex) ||
    typeof target.pin !== 'string' ||
    !/^[0-9a-f]{32}$/.test(target.pin) ||
    !record(target.anchor)
  )
    return null;
  const anchor = target.anchor;
  if (!index(anchor.ordinal) || !positive(anchor.count) || anchor.ordinal >= anchor.count)
    return null;
  if (!Array.isArray(value.quantities) || value.quantities.length === 0) return null;
  const seen = new Set<number>();
  const quantities: { sourceIndex: number; count: number }[] = [];
  let total = 0n;
  for (const quantity of value.quantities) {
    if (
      !record(quantity) ||
      !index(quantity.sourceIndex) ||
      !positive(quantity.count) ||
      seen.has(quantity.sourceIndex)
    )
      return null;
    seen.add(quantity.sourceIndex);
    total += BigInt(quantity.count);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    quantities.push({ sourceIndex: quantity.sourceIndex, count: quantity.count });
  }
  return {
    itemId: value.itemId,
    target: {
      slotIndex: target.slotIndex,
      pin: target.pin,
      anchor: { ordinal: anchor.ordinal, count: anchor.count },
    },
    quantities,
  };
}

export type MaterialSourceTransferResult =
  | {
      readonly ok: true;
      readonly value: { readonly count: number; readonly sources: MaterialComposition };
    }
  | {
      readonly ok: false;
      readonly error: 'invalid-selection' | 'stale-selection' | 'invalid-sources';
    };

/** Cheap command-envelope checks that must run before a ledger reservation. */
export function materialSourceTransferSelectionMatches(
  selection: unknown,
  expected: { readonly itemId?: string; readonly slotIndex: number; readonly count?: unknown },
): boolean {
  const parsed = readMaterialSourceTransferSelection(selection);
  if (
    parsed === null ||
    (expected.itemId !== undefined && parsed.itemId !== expected.itemId) ||
    parsed.target.slotIndex !== expected.slotIndex
  ) {
    return false;
  }
  if (expected.count === undefined) return true;
  return (
    parsed.quantities.reduce((total, quantity) => total + quantity.count, 0) === expected.count
  );
}

/** Resolve only; each receiving command still enforces ownership, locks and fit. */
export function resolveMaterialSourceTransferSelection(
  inventory: readonly InvSlot[],
  selection: MaterialSourceTransferSelection,
): MaterialSourceTransferResult {
  const request = readMaterialSourceTransferSelection(selection);
  if (request === null) return { ok: false, error: 'invalid-selection' };
  if (!materialStackSelectionMatches(inventory, request.itemId, request.target))
    return { ok: false, error: 'stale-selection' };
  const normalized = normalizeMaterialStack(inventory[request.target.slotIndex], materialItemIds());
  if (!normalized.ok) return { ok: false, error: 'invalid-sources' };
  const sources: MaterialSourceCount[] = [];
  let count = 0;
  for (const quantity of request.quantities) {
    const held = normalized.value.materialSources?.[quantity.sourceIndex];
    if (!held || quantity.count > held.count) return { ok: false, error: 'invalid-selection' };
    // normalizeMaterialStack owns these freshly cloned descriptors.
    sources.push({ source: held.source, count: quantity.count });
    count += quantity.count;
  }
  return { ok: true, value: { count, sources } };
}
