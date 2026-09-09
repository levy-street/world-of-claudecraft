// The slot-level adapter over the source-count algebra (material_sources.ts):
// project a legacy stack's provenance, decide when two stacks may share a slot,
// split a quantity off one. `materialSources` is the exact per-unit composition;
// `materialSeparated` is the owner's container-only grouping, never power and
// never journal identity. Material membership is injected, never imported (the
// content registry is eager). Failures are codes; nothing throws or clamps.

import { canStackInstancePayloads } from './item_instance_merge';
import { cloneMaterialPayload } from './material_payload_identity';
import {
  canonicalMaterialComposition,
  legacyMaterialComposition,
  type MaterialComposition,
  type MaterialSourceCount,
  type MaterialSourceError,
  takeMaterialCount,
  takeSelectedMaterialSources,
  totalMaterialCount,
} from './material_sources';
import { cloneInvSlot, type InvSlot, type ItemInstancePayload } from './types';

/**
 * An inventory slot as the material model sees it. Both added fields are
 * OPTIONAL and additive: a slot with neither is ordinary legacy stock.
 */
export type MaterialStackSlot = InvSlot & {
  /** Exact per-unit provenance; every unit of `count` sits in exactly one bucket. */
  materialSources?: MaterialComposition;
  /** The owner's container-only grouping choice: never power, never identity. */
  materialSeparated?: true;
};

export type MaterialStackError =
  /** The item id is not a known material, so this adapter does not own it. */
  | 'not-material'
  /** A slot-level signer AND an explicit composition: which one is the truth? */
  | 'ambiguous-signer'
  /** The REQUESTED take quantity is not a positive safe integer. */
  | 'invalid-quantity'
  | MaterialSourceError;

export type MaterialStackResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MaterialStackError };

/** The two halves of a slot take. They share no object, with each other or the input. */
export interface MaterialStackTake {
  /** The transfer-ready copy: exactly `quantity` units, no owner grouping. */
  readonly taken: MaterialStackSlot;
  /** What stays with the owner, or null when the whole stack was taken. */
  readonly remaining: MaterialStackSlot | null;
}

const succeed = <T>(value: T): MaterialStackResult<T> => ({ ok: true, value });
const fail = (error: MaterialStackError): MaterialStackResult<never> => ({ ok: false, error });

// Payload copies use the ONE safe walk (cloneMaterialPayload): unknown persisted
// fields and an own '__proto__' key survive, and no copy aliases a caller's slot.

/** True when no key is actually SET. An explicit `undefined` counts as absent,
 *  matching item_instance_merge's structural equality, so an empty payload never
 *  survives as an object that refuses to merge with a stack carrying none. */
function isEmptyPayload(payload: ItemInstancePayload): boolean {
  const record = payload as Record<string, unknown>;
  return Object.keys(record).every((key) => record[key] === undefined);
}

/** The canonical payload for a normalized stack: emptied of its legacy `signer`
 *  (which the composition now carries) and undefined when nothing is left. */
function canonicalPayload(
  payload: ItemInstancePayload | undefined,
  dropSigner: boolean,
): ItemInstancePayload | undefined {
  if (payload === undefined) return undefined;
  const next = cloneMaterialPayload(payload);
  if (dropSigner) delete next.signer;
  return isEmptyPayload(next) ? undefined : next;
}

/** A fresh owner-side slot: the input's other fields, with the count, the
 *  composition and the payload this module owns supplied explicitly. */
function ownerSlot(
  slot: MaterialStackSlot,
  count: number,
  composition: MaterialComposition,
  instance: ItemInstancePayload | undefined,
): MaterialStackSlot {
  const next = cloneInvSlot(slot);
  next.count = count;
  next.materialSources = composition;
  // Overwritten unconditionally: cloneInvSlot's payload copy is deep only over
  // the KNOWN payload fields.
  if (instance === undefined) delete next.instance;
  else next.instance = cloneMaterialPayload(instance);
  if (next.materialSeparated !== true) delete next.materialSeparated;
  return next;
}

/**
 * The one reading of a slot's composition, and the ONLY entry the other two
 * operations take.
 *
 * - Legacy stock with no `materialSources`: `count` and the payload's legacy
 *   `signer` project through `legacyMaterialComposition` (no gatherer is
 *   invented, nobody recorded one) and the signer MOVES into the descriptor.
 * - An explicit composition: validated against the held count, then returned
 *   canonically ordered and coalesced.
 * - Both at once: AMBIGUOUS, refused rather than overwriting either reading.
 *
 * Either way the payload is canonicalized the same, so an empty payload and no
 * payload are one state. Invalid input is refused whole, never demoted to
 * unrecorded stock, and a legacy OVER-CAP count is kept intact: stack caps stay
 * with the item-defined packing code in bags.ts.
 */
export function normalizeMaterialStack(
  slot: MaterialStackSlot,
  materialIds: ReadonlySet<string>,
): MaterialStackResult<MaterialStackSlot> {
  if (!materialIds.has(slot.itemId)) return fail('not-material');
  if (!Number.isSafeInteger(slot.count) || slot.count <= 0) return fail('invalid-count');

  const signer = slot.instance?.signer;
  if (slot.materialSources === undefined) {
    const projected = legacyMaterialComposition(slot.count, signer);
    if (!projected.ok) return fail(projected.error);
    const instance = canonicalPayload(slot.instance, true);
    return succeed(ownerSlot(slot, slot.count, projected.value, instance));
  }

  if (signer !== undefined) return fail('ambiguous-signer');
  const canonical = canonicalMaterialComposition(slot.materialSources, slot.count);
  if (!canonical.ok) return fail(canonical.error);
  const instance = canonicalPayload(slot.instance, false);
  return succeed(ownerSlot(slot, slot.count, canonical.value, instance));
}

/**
 * May these two stacks share one slot? Both normalize first, then: same item id,
 * same `craftedRecipeId`, same structural payload through the canonical merge
 * predicate (`canStackInstancePayloads`, which also keeps charge-bearing and
 * locked copies one per slot), and neither side manually separated.
 *
 * NOT identity: gatherer and signature composition (differently sourced units
 * sharing a stack is the point), per-source quantities, the total count, and the
 * owner's bag cell. A normalization refusal propagates as a failure rather than
 * as "incompatible", so a malformed stack can never read as a merge decision.
 */
export function compatibleMaterialStacks(
  a: MaterialStackSlot,
  b: MaterialStackSlot,
  materialIds: ReadonlySet<string>,
): MaterialStackResult<boolean> {
  const left = normalizeMaterialStack(a, materialIds);
  if (!left.ok) return left;
  const right = normalizeMaterialStack(b, materialIds);
  if (!right.ok) return right;

  const x = left.value;
  const y = right.value;
  if (x.itemId !== y.itemId) return succeed(false);
  if (x.craftedRecipeId !== y.craftedRecipeId) return succeed(false);
  if (x.materialSeparated === true || y.materialSeparated === true) return succeed(false);
  return succeed(canStackInstancePayloads(x.instance, y.instance));
}

/**
 * Splits `quantity` units off a stack. Without `selectedSources` the algebra's
 * default spend order applies (unrecorded first, premium last); with them the
 * take is exactly those descriptors in exactly those counts, and their total
 * must equal `quantity`. A short bucket or a mismatched total refuses the whole
 * request: it is atomic in both directions and never substitutes a source.
 *
 * `taken` is a TRANSFER-ready item: the owner's bag cell and grouping choice are
 * stripped there and only there, while the payload, `craftedRecipeId` and the
 * exact sources ride along. `remaining` keeps the ownership metadata, or is null
 * when nothing is left. Neither half shares an object with the input or with
 * the other.
 */
export function takeMaterialStack(
  slot: MaterialStackSlot,
  quantity: number,
  materialIds: ReadonlySet<string>,
  selectedSources?: readonly MaterialSourceCount[],
): MaterialStackResult<MaterialStackTake> {
  const normalized = normalizeMaterialStack(slot, materialIds);
  if (!normalized.ok) return normalized;
  const held = normalized.value;
  const composition = held.materialSources ?? [];

  if (!Number.isSafeInteger(quantity) || quantity <= 0) return fail('invalid-quantity');
  if (quantity > held.count) return fail('insufficient');

  const split =
    selectedSources === undefined
      ? takeMaterialCount(composition, quantity)
      : takeSelectedMaterialSources(composition, selectedSources);
  if (!split.ok) return fail(split.error);
  // Judged on the VALIDATED selection, so a selection listing one descriptor
  // twice is summed the way the take spent it.
  if (totalMaterialCount(split.value.taken) !== quantity) return fail('sum-mismatch');

  const taken: MaterialStackSlot = {
    itemId: held.itemId,
    count: quantity,
    materialSources: split.value.taken,
  };
  if (held.instance !== undefined) taken.instance = cloneMaterialPayload(held.instance);
  if (held.craftedRecipeId !== undefined) taken.craftedRecipeId = held.craftedRecipeId;

  const rest = held.count - quantity;
  const remaining = rest === 0 ? null : ownerSlot(held, rest, split.value.remaining, held.instance);
  return succeed({ taken, remaining });
}
