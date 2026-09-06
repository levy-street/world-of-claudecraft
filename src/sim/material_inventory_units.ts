// The per-UNIT views of a material spend: the shapes the pre-source removers
// reported, rebuilt from a plan so the old call sites keep working while the
// exact provenance rides along. material_inventory_take.ts decides WHICH units
// leave; this module only presents them, and adds no rule of its own.
//
// Two shapes, deliberately distinct, and never interchangeable:
//
// - `materialInventoryUnits` is the TRANSFER carrier. Each unit's `instance` is
//   CANONICAL (never carries a legacy `signer`, which now lives in the
//   descriptor) and its provenance rides in `materialSources`. Forging the
//   signer back onto the payload here would make every one of these units read
//   as ambiguous-signer the moment a grant normalized it.
// - `consumedMaterialInstancePayloads` is the EFFECT data of something being
//   consumed or discarded: the LEGACY per-unit payload, signer included, for
//   the old eligibility and premium-consumption checks that read `.signer`.
//   It describes units that are going away, so it must never be handed to a
//   grant path as if it were a carrier.
//
// Pure and total: no rng, no clock, no host lookup, no player-facing text.
// Every returned object is freshly built and shares nothing with the plan, with
// the caller's slots, or with another returned unit.

import type { MaterialTakePlan } from './material_inventory_take';
import { cloneMaterialData, cloneMaterialPayload } from './material_payload_identity';
import type { MaterialSource } from './material_sources';
import type { InventoryUnit, ItemInstancePayload } from './types';

/** The payload half of a stack: a `MaterialStackSlot` satisfies it, so callers
 *  pass the slot itself (a plan's taken copy, or a held one). */
export interface MaterialUnitPayloadCarrier {
  readonly instance?: ItemInstancePayload;
}

/** True when no key is actually SET. Mirrors the canonicalization in
 *  material_stack.ts: an explicitly `undefined` key counts as absent, so an
 *  emptied payload reads as no payload rather than surviving as an object that
 *  refuses to merge with a stack carrying none. */
function isEmptyPayload(payload: ItemInstancePayload): boolean {
  const record = payload as Record<string, unknown>;
  return Object.keys(record).every((key) => record[key] === undefined);
}

/**
 * The CANONICAL payload of a unit: a deep copy with the legacy `signer`
 * removed, since the descriptor owns it now, and an emptied result read as no
 * payload. Defensive about its input so a raw held slot and an already
 * normalized one answer identically.
 */
function canonicalUnitPayload(
  payload: ItemInstancePayload | undefined,
): ItemInstancePayload | undefined {
  if (payload === undefined) return undefined;
  const next = cloneMaterialPayload(payload);
  delete next.signer;
  return isEmptyPayload(next) ? undefined : next;
}

/**
 * The EFFECTIVE legacy payload of one unit of `source` in `slot`: the canonical
 * payload with that descriptor's own `signer` stamped on. This is the shape the
 * old eligibility and premium-consumption checks read, so a unit spent from a
 * signed bucket still answers as signed.
 *
 * A gatherer alone contributes nothing: provenance is not a signature, and no
 * unit becomes premium merely by having a recorded gatherer. An empty-string
 * signer is a legal legacy value and is preserved verbatim, which keeps it
 * non-premium under the same truthiness test as before.
 *
 * Independent of both inputs; nothing is mutated.
 */
export function materialSourceUnitPayload(
  slot: MaterialUnitPayloadCarrier,
  source: MaterialSource,
): ItemInstancePayload | undefined {
  const canonical = canonicalUnitPayload(slot.instance);
  if (source.signer === undefined) return canonical;
  return { ...(canonical ?? {}), signer: source.signer };
}

// Both helpers below walk PLAN, SLOT, BUCKET and expand per unit only in the
// innermost loop, with no intermediate per-unit array. A bucket count is a
// quantity, not a collection: a tolerated legacy stack can hold an enormous one,
// so anything decided per BUCKET is decided once, before that expansion.

/**
 * The plan as transfer-ready `InventoryUnit`s, ONE PER UNIT: canonical payload
 * (no forged signer), the exact one-unit composition, and the plain-stack
 * `craftedRecipeId` marker retained so a re-grant cannot launder it.
 *
 * ORDER: the plan's `taken` order (ascending by the stack each copy came from),
 * then each copy's composition order (the canonical descriptor key order). That
 * is stable and total, and it is deliberately NOT the order the units were
 * CHOSEN in: the plan groups its output by slot, so the spend priority that
 * picked unrecorded before premium is not recoverable from it.
 *
 * One unit per unit taken is this helper's whole contract, so the returned
 * length is the caller's requested quantity; nothing is capped or truncated.
 * Every unit owns its payload and its descriptor outright, so a caller may hand
 * each to a different destination.
 */
export function materialInventoryUnits(plan: MaterialTakePlan): InventoryUnit[] {
  const units: InventoryUnit[] = [];
  for (const slot of plan.taken) {
    for (const bucket of slot.materialSources ?? []) {
      for (let i = 0; i < bucket.count; i++) {
        units.push({
          instance: canonicalUnitPayload(slot.instance),
          craftedRecipeId: slot.craftedRecipeId,
          materialSources: [{ source: cloneMaterialData(bucket.source), count: 1 }],
        });
      }
    }
  }
  return units;
}

/**
 * The plan as the payload list the old `removeItem` family reported: the
 * EFFECTIVE per-unit payloads, legacy signer included, for units that actually
 * have one. A plain unrecorded unit carries no payload and contributes no
 * entry, so this is the consumed EFFECT data and never a count of units.
 *
 * Whether a unit HAS an effective payload is a property of its bucket (one
 * descriptor, one stack payload), so it is resolved once per bucket and a
 * payloadless bucket is skipped whole. That keeps the legacy remover's cost
 * shape: it skipped an uninstanced count in O(1), and spending a tolerated
 * legacy stack of billions of unrecorded units must not allocate per unit.
 * Buckets that DO carry one still emit an independent copy per unit, with no
 * cap or truncation.
 */
export function consumedMaterialInstancePayloads(plan: MaterialTakePlan): ItemInstancePayload[] {
  const payloads: ItemInstancePayload[] = [];
  for (const slot of plan.taken) {
    for (const bucket of slot.materialSources ?? []) {
      const effective = materialSourceUnitPayload(slot, bucket.source);
      if (effective === undefined) continue;
      // The probe IS the first unit's copy; the rest are cloned from it, so no
      // two consumed entries share an object.
      payloads.push(effective);
      for (let i = 1; i < bucket.count; i++) payloads.push(cloneMaterialPayload(effective));
    }
  }
  return payloads;
}
