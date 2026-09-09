// The source-aware half of a player trade, extracted so social/trade.ts stays a
// coordinator rather than growing past its size budget. Pure: no SimContext, no
// rng, no clock, no player-facing text. Every rule here is the SHARED material
// core's; this module only adapts those cores to the shapes the trade pipeline
// already speaks (staged InvSlot lines, per-unit InventoryUnit lists).
//
// The contract it exists to hold, end to end:
//
//   * A staged line PINS the exact sources it offers. Staging, the confirm-time
//     re-pin, the capacity model and the live removal all read that one
//     composition, so what the counterparty inspected is what leaves the bags.
//   * A pinned source choice NEVER silently falls back. If the exact descriptors
//     are no longer there, the take refuses and the caller fails the swap; it
//     does not substitute another gatherer's units, which is the whole point of
//     recording provenance.
//   * A mixed stack is ONE selectable block. Units sharing a canonical payload
//     group into a single staged line whose composition carries every bucket, so
//     a bulk material trade stays one line instead of degenerating into one line
//     per contributor.
//   * Locks, soulbound windows and the owner deprioritize rule are asked about
//     the EFFECTIVE per-unit payload (materialSourceUnitPayload), so a signed
//     bucket inside a mixed row is skipped while that same row's unrecorded
//     units still ship. A restricted bucket narrows the offer; it never strips
//     identity off the units that ARE eligible, and never refuses the row whole.
//
// DEPENDENCY, and the reason this module reads sources off units rather than
// deriving them: the per-unit carrier is `types.ts InventoryUnit`, whose
// `materialSources` the shared removal walk populates. See the note in
// `pinnedTradeUnits` about what a source-blind remover degrades to.

import { itemInstancePayloadsEqual } from '../item_instance_merge';
import { materialItemIds } from '../material_ids';
import { applyMaterialInventoryTake, planMaterialInventoryTake } from '../material_inventory_take';
import { materialInventoryUnits, materialSourceUnitPayload } from '../material_inventory_units';
import {
  type MaterialComposition,
  type MaterialSource,
  type MaterialSourceResult,
  mergeMaterialCompositions,
  totalMaterialCount,
} from '../material_sources';
import { type MaterialStackSlot, normalizeMaterialStack } from '../material_stack';
import type { InventoryUnit, InvSlot, ItemInstancePayload } from '../types';

/** The per-copy skip predicate every trade site already speaks. */
export type OfferSkip = (instance: ItemInstancePayload | undefined) => boolean;

/**
 * The composition a staged line pins, or undefined for a line that pins none
 * (an ordinary non-material copy, or a decoupled hub's id-plus-count remainder).
 * Reading it in ONE place is what keeps staging, the re-pin and the removal from
 * disagreeing about whether a line is source-pinned at all.
 */
export function pinnedOfferSources(slot: InvSlot): MaterialComposition | undefined {
  // Explicit empty data is a malformed pin, not permission to choose different
  // stock. The pinned take refuses it before either side of the trade moves.
  return slot.materialSources;
}

/**
 * The coalesced composition of a run of units, or undefined when not one of them
 * carries provenance. Merging is `mergeMaterialCompositions`, so identical
 * descriptors coalesce and the canonical order is the algebra's, never this
 * module's: two units of one gatherer become one bucket of two, exactly as the
 * destination stack will hold them.
 *
 * A refusal is REPORTED rather than swallowed. The inputs here are the shared
 * remover's own one-unit compositions, so a failure means data this model cannot
 * read, and quietly dropping it would launder the very attribution the trade
 * exists to move.
 */
export function mergedUnitSources(
  units: readonly InventoryUnit[],
): MaterialSourceResult<MaterialComposition | undefined> {
  // Legacy stock stays legacy: a run where NOTHING was recorded pins nothing,
  // exactly as before provenance existed.
  if (!units.some((unit) => unit.materialSources !== undefined)) {
    return { ok: true, value: undefined };
  }
  // Starts EMPTY rather than adopting the first composition verbatim, so every
  // present one goes through the algebra. Adopting the first meant a single-unit
  // group was never validated at all, and a corrupt leading composition rode
  // into the batch unchecked.
  let merged: MaterialComposition = [];
  for (const unit of units) {
    const sources = unit.materialSources;
    if (sources === undefined) {
      // A legacy unit standing beside recorded ones is not "no unit": it is one
      // unit whose gatherer nobody recorded. It joins as the unrecorded
      // descriptor so the batch total still equals the units in it, instead of
      // shipping a composition that silently describes fewer units than moved.
      const withUnknown = mergeMaterialCompositions(merged, [{ source: {}, count: 1 }]);
      if (!withUnknown.ok) return withUnknown;
      merged = withUnknown.value;
      continue;
    }
    // A one-unit carrier must describe exactly one unit. An EXPLICIT EMPTY list
    // is malformed data, NOT an absent record, and so is any total other than 1:
    // both refuse here rather than merging into a batch whose composition would
    // then disagree with its count. The merge below catches the shape defects a
    // total cannot see (a bad descriptor, a non-positive count).
    if (totalMaterialCount(sources) !== 1) return { ok: false, error: 'sum-mismatch' };
    const next = mergeMaterialCompositions(merged, sources);
    if (!next.ok) return next;
    merged = next.value;
  }
  return { ok: true, value: merged };
}

/**
 * Is this ONE carrier grantable as it stands?
 *
 * Asked through `normalizeMaterialStack` on the one-unit slot the grant will
 * build, so the preflight asks EXACTLY the question the grant asks rather than a
 * hand-rolled approximation of it. That is what catches the AMBIGUOUS carrier a
 * composition-only check waves through: a unit holding a composition BESIDE a
 * payload `signer` has two conflicting records of who signed it, and the shared
 * model refuses it. Without this the grant throws that refusal instead, after
 * both sides' removals have already run, which is the one outcome a trade must
 * never reach.
 */
function carrierGrantable(
  itemId: string,
  unit: InventoryUnit,
  materialIds: ReadonlySet<string>,
): boolean {
  const slot: MaterialStackSlot = { itemId, count: 1 };
  if (unit.instance !== undefined) slot.instance = unit.instance;
  if (unit.craftedRecipeId !== undefined) slot.craftedRecipeId = unit.craftedRecipeId;
  if (unit.materialSources !== undefined) slot.materialSources = unit.materialSources;
  return normalizeMaterialStack(slot, materialIds).ok;
}

/**
 * The per-BUCKET eligibility a trade removal applies, asked about the effective
 * per-unit payload rather than the stack's raw one.
 *
 * This is what turns a whole-stack verdict into a per-unit one: before
 * provenance, a signed material stack carried its signer on the payload, so a
 * skip predicate judged all of its units together. The signer now lives in the
 * descriptor, so the same question has to be asked once per bucket or a mixed
 * row would answer with whichever unit happened to be checked.
 */
export function offerEligibleSource(
  skip: OfferSkip,
): (source: MaterialSource, slot: MaterialStackSlot) => boolean {
  return (source, slot) => !skip(materialSourceUnitPayload(slot, source));
}

/** What a pinned take needs to know. `inventory` is MUTATED on success only. */
export interface PinnedTakeRequest {
  readonly inventory: InvSlot[];
  readonly itemId: string;
  /** The exact descriptors and counts the staged line pinned. */
  readonly sources: MaterialComposition;
  /** The CANONICAL payload the staged line pinned, absent for a payload-free
   *  line. Part of the pin, not decoration: two stacks of one material can hold
   *  the same descriptor behind different payloads, and a take that matched on
   *  item plus sources alone would ship whichever it reached first. */
  readonly instance?: ItemInstancePayload;
  /** The plain-stack crafted marker the staged line pinned; same reason. */
  readonly craftedRecipeId?: string;
  /** Per-copy exclusion (trade lock, soulbound window), asked per bucket
   *  through the effective per-unit payload. */
  readonly skip: OfferSkip;
}

/**
 * Consumes EXACTLY the pinned descriptors out of `inventory`, or nothing.
 *
 * The choice, the split and the validation are all the shared take core's
 * (`planMaterialInventoryTake` with `selectedSources`, which refuses a short
 * descriptor rather than substituting another). `allowPartial` is deliberately
 * NOT set: a partial pinned take is a silent substitution of quantity, the same
 * defect as substituting a gatherer.
 *
 * Returns null on ANY refusal, having written nothing, so the caller can fail
 * the swap with both sides' goods still in place. A null here is the trade's
 * pin-miss signal, not a reason to reach for a generic walk.
 *
 * NOTE for integration: the units this returns carry their exact one-unit
 * compositions because `materialInventoryUnits` builds them from the plan. A
 * caller that instead reads sources off a source-BLIND remover sees `undefined`
 * on every unit and would degrade to the legacy whole-payload path with no
 * error, which is precisely the silent fallback this module refuses; the trade
 * pipeline therefore routes every material line through here.
 */
export function pinnedTradeUnits(request: PinnedTakeRequest): InventoryUnit[] | null {
  const { inventory, itemId, sources, instance, craftedRecipeId, skip } = request;
  const count = totalMaterialCount(sources);
  if (count <= 0) return null;
  // The pin is the WHOLE copy identity, not the item and its descriptors. The
  // comparison runs against the NORMALIZED stack (the shape `eligibleSource`
  // receives), which is the same canonical form the staged line recorded, so a
  // legacy stack whose signer has moved into its buckets compares correctly
  // rather than by whichever spelling the raw slot happened to hold.
  const identityMatches = (slot: MaterialStackSlot): boolean =>
    slot.craftedRecipeId === craftedRecipeId && itemInstancePayloadsEqual(slot.instance, instance);
  const eligible = offerEligibleSource(skip);
  const plan = planMaterialInventoryTake({
    inventory,
    itemId,
    count,
    materialIds: materialItemIds(),
    selectedSources: sources,
    eligibleSource: (source, slot) => identityMatches(slot) && eligible(source, slot),
  });
  if (!plan.ok) return null;
  // The plan is inert until applied, so a refusal above left the bags untouched
  // and this is the first and only write.
  applyMaterialInventoryTake(inventory, plan.value);
  return materialInventoryUnits(plan.value);
}

/** One re-grantable batch of PLAIN (payload-free) units of one item. */
export interface PlainGrantBatch {
  readonly craftedRecipeId: string | undefined;
  readonly count: number;
  /** The coalesced provenance of the batch, absent for legacy stock. */
  readonly materialSources: MaterialComposition | undefined;
}

/**
 * Groups payload-free units for the grant side, keyed on the crafted marker the
 * destination's stacking already keys on, with each batch's provenance
 * coalesced. Batching is preserved deliberately: a twenty-unit material line
 * stays ONE grant carrying one merged composition rather than twenty grants,
 * which is the bulk-trade route the program contract requires to survive.
 *
 * A merge refusal fails the whole grouping (see `mergedUnitSources`). The caller
 * must neither ship nor DROP a batch it could not read: `carriersReadable`
 * exists so the whole swap can be refused on scratch, before any unit moves,
 * and `unitGrantCarriers` is the merge-free restore shape for the case a
 * refusal is somehow reached with units already in hand.
 */
export function plainGrantBatches(
  units: readonly InventoryUnit[],
): MaterialSourceResult<PlainGrantBatch[]> {
  const byRecipe = new Map<string | undefined, InventoryUnit[]>();
  for (const unit of units) {
    if (unit.instance) continue;
    const held = byRecipe.get(unit.craftedRecipeId);
    if (held === undefined) byRecipe.set(unit.craftedRecipeId, [unit]);
    else held.push(unit);
  }
  const batches: PlainGrantBatch[] = [];
  for (const [craftedRecipeId, group] of byRecipe) {
    const merged = mergedUnitSources(group);
    if (!merged.ok) return merged;
    batches.push({ craftedRecipeId, count: group.length, materialSources: merged.value });
  }
  return { ok: true, value: batches };
}

/**
 * Can every one of these units be handed over without losing provenance?
 *
 * This is the PREFLIGHT question, asked on scratch units the confirm walk built
 * from copies of the bags. Answering it before anything moves is what turns an
 * unreadable composition from a dropped grant into a refused trade, with both
 * sides' goods still in their own bags.
 */
export function carriersReadable(itemId: string, units: readonly InventoryUnit[]): boolean {
  // INSTANCED carriers are not exempt. plainGrantBatches skips them by design
  // (they regrant one per copy rather than batched), so asking it alone
  // preflighted only the payload-free subset and let a corrupt or ambiguous
  // composition on an instanced unit through to the grant, which is the exact
  // class this preflight exists to catch.
  const materialIds = materialItemIds();
  if (materialIds.has(itemId)) {
    for (const unit of units) {
      if (!carrierGrantable(itemId, unit, materialIds)) return false;
    }
  }
  return plainGrantBatches(units).ok;
}

/**
 * The same units as ONE CARRIER PER UNIT, each keeping its own composition
 * verbatim.
 *
 * Merge-free by construction, so it cannot refuse: this is the shape a rollback
 * hands back when the batched grouping could not be read. It trades the batching
 * (one grant per unit instead of one per marker) for a guarantee that units are
 * never stranded between two players, which is the right way round on a path
 * that only runs when something has already gone wrong.
 */
export function unitGrantCarriers(units: readonly InventoryUnit[]): PlainGrantBatch[] {
  const carriers: PlainGrantBatch[] = [];
  for (const unit of units) {
    if (unit.instance) continue;
    carriers.push({
      craftedRecipeId: unit.craftedRecipeId,
      count: 1,
      materialSources: unit.materialSources,
    });
  }
  return carriers;
}
