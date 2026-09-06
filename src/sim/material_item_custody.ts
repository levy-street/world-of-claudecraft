// Material custody for the ITEM surfaces: per-copy takes (equip / use / sell a
// named copy), the per-unit disposal walks (sell, discard, trade), and the
// vendor buyback row. items.ts and item_copy_ref.ts adapt to this leaf rather
// than growing their own material arms, so the decision lives in one place and
// the monolith stays a coordinator.
//
// Everything routes through the shared planner (material_inventory_take.ts) and
// its unit adapters (material_inventory_units.ts). The rules that follow from
// that, and that a caller must not re-derive:
//
// - A material unit NEVER leaves through a raw `count -= 1`. That decrement
//   cannot say which descriptor left, so it strands the stack's composition
//   against its count. Every take here is a plan the planner builds and applies.
// - Unrecorded material goes first, premium LAST, across the whole eligible
//   pool. Whether a stack still carries an `instance` is not a priority.
// - `skip` / `deprioritize` are judged on the unit's EFFECTIVE payload (the
//   canonical payload plus its descriptor's legacy signer), because the signer
//   the old predicates keyed on no longer lives on the stack. A unit with no
//   effective payload is the analogue of a plain slot, which the legacy walks
//   never showed those predicates at all.
// - A player-locked stack is never spent; the planner's `includeLocked` escape
//   is for replaying a move a lock-blind pipe already made, and no custody path
//   here is one.
// - Nothing is capped or truncated, no source is invented or substituted, and
//   a refusal writes nothing.
//
// A non-material id answers empty from every entry point, so a caller keeps its
// legacy walk byte for byte by branching on the answer or on the registry.
//
// Pure leaf: no SimContext, no rng, no clock. A Vitest drives it with a plain
// `InvSlot[]`.

import { isMaterialItemId, materialItemIds } from './material_ids';
import {
  applyMaterialInventoryTake,
  type MaterialTakePlan,
  planMaterialInventoryTake,
} from './material_inventory_take';
import {
  consumedMaterialInstancePayloads,
  materialInventoryUnits,
  materialSourceUnitPayload,
} from './material_inventory_units';
import {
  type MaterialComposition,
  type MaterialSource,
  mergeMaterialCompositions,
} from './material_sources';
import type { MaterialStackSlot } from './material_stack';
import type { InventoryUnit, InvSlot, ItemInstancePayload } from './types';

/** Dev-channel only, never player-visible: material data the shared model
 *  refuses to read reached a custody path. Thrown BEFORE any write. */
const MATERIAL_CUSTODY_REFUSED = 'material item custody: the shared model refused the plan';

/** A predicate over one unit's EFFECTIVE payload. The legacy item predicates
 *  have exactly this shape, so a caller passes its existing one unchanged. */
export type MaterialUnitPredicate = (payload: ItemInstancePayload) => boolean;

/** The disposal filters the item walks already carry, re-expressed per unit. */
export interface MaterialUnitFilters {
  /** Units whose effective payload matches are NEVER taken. */
  readonly skip?: MaterialUnitPredicate;
  /** Units whose effective payload matches are taken LAST, after every other
   *  eligible unit, preserving the seller-owns-it copy-choice rule. */
  readonly deprioritize?: MaterialUnitPredicate;
  /** Only units that HAVE an effective payload may be taken: the material
   *  reading of the legacy instanced-slots-only arm. */
  readonly payloadOnly?: boolean;
}

/** A planned one-unit withdrawal, held INERT so the caller can still refuse
 *  (a capacity preflight) before anything is written. */
export interface MaterialUnitWithdrawal {
  /** The unit as it would leave: canonical payload, exact one-unit source. */
  readonly unit: InventoryUnit;
  readonly plan: MaterialTakePlan;
}

/** Build the `eligibleSource` predicate for one disposal pass. `takeLast`
 *  selects the class this pass may spend: the preferred units first, then
 *  everything `skip` still allows. */
function passFilter(
  filters: MaterialUnitFilters,
  takeLast: boolean,
): (source: MaterialSource, slot: MaterialStackSlot) => boolean {
  return (source, slot) => {
    const effective = materialSourceUnitPayload(slot, source);
    if (filters.payloadOnly === true && effective === undefined) return false;
    if (effective !== undefined && filters.skip?.(effective) === true) return false;
    if (takeLast) return true;
    return !(effective !== undefined && filters.deprioritize?.(effective) === true);
  };
}

interface SpendRequest {
  readonly inventory: InvSlot[];
  readonly itemId: string;
  readonly count: number;
  readonly slotIndex?: number;
  readonly eligibleSource?: (source: MaterialSource, slot: MaterialStackSlot) => boolean;
  readonly allowPartial?: boolean;
}

/** Plan one take, refusing before any write. `null` means the request found
 *  nothing to take (a shortfall, a filtered pool, a bad index), which is a
 *  caller decision rather than an error; unreadable data throws instead. */
function planSpend(request: SpendRequest): MaterialTakePlan | null {
  const plan = planMaterialInventoryTake({
    inventory: request.inventory,
    itemId: request.itemId,
    count: request.count,
    materialIds: materialItemIds(),
    slotIndex: request.slotIndex,
    eligibleSource: request.eligibleSource,
    allowPartial: request.allowPartial,
  });
  if (!plan.ok) {
    if (plan.error === 'insufficient' || plan.error === 'invalid-index') return null;
    throw new Error(MATERIAL_CUSTODY_REFUSED);
  }
  return plan.value.takenCount === 0 ? null : plan.value;
}

/**
 * Plan ONE unit out of the stack at `slotIndex`, without writing. The named
 * stack is the only one in scope, so a locked or unreadable neighbour is
 * irrelevant and a refusal here means that stack cannot give a unit.
 */
export function planMaterialUnitWithdrawal(
  inventory: InvSlot[],
  itemId: string,
  slotIndex: number,
): MaterialUnitWithdrawal | null {
  if (!isMaterialItemId(itemId)) return null;
  const plan = planSpend({ inventory, itemId, count: 1, slotIndex });
  if (plan === null) return null;
  const unit = materialInventoryUnits(plan)[0];
  return unit === undefined ? null : { unit, plan };
}

/** Apply a withdrawal planned from THIS array. */
export function commitMaterialUnitWithdrawal(
  inventory: InvSlot[],
  withdrawal: MaterialUnitWithdrawal,
): void {
  applyMaterialInventoryTake(inventory, withdrawal.plan);
}

/**
 * Take ONE unit out of the stack the caller NAMED, or refuse. The unit carries
 * its exact source and the stack keeps the canonical remainder, so the copy a
 * per-copy command consumes is fully described.
 */
export function takeMaterialUnitFromSlot(
  inventory: InvSlot[],
  itemId: string,
  slotIndex: number,
): InventoryUnit | null {
  const withdrawal = planMaterialUnitWithdrawal(inventory, itemId, slotIndex);
  if (withdrawal === null) return null;
  commitMaterialUnitWithdrawal(inventory, withdrawal);
  return withdrawal.unit;
}

/**
 * Take ONE unit for an id-only command, through ONE global planner request.
 *
 * NOT a newest-stack walk. The frozen automatic material order is global:
 * unrecorded and other nonpremium units first, premium LAST, across every
 * eligible stack at once. Choosing the newest STACK and only then ordering
 * inside it would spend a premium unit out of a late stack while plain units
 * sat in an earlier one, which is the exact inversion the order exists to
 * prevent. The legacy newest-first bias survives only where the canonical order
 * is indifferent: the planner breaks a tie between two stacks holding the SAME
 * descriptor by taking the highest index.
 *
 * Non-material ids answer null so their caller keeps the old walk untouched.
 */
export function takeMaterialUnit(inventory: InvSlot[], itemId: string): InventoryUnit | null {
  if (!isMaterialItemId(itemId)) return null;
  const plan = planSpend({ inventory, itemId, count: 1 });
  if (plan === null) return null;
  const unit = materialInventoryUnits(plan)[0];
  if (unit === undefined) return null;
  applyMaterialInventoryTake(inventory, plan);
  return unit;
}

/** The passes one disposal walk runs: the preferred class, then (only when a
 *  deprioritize predicate exists) everything else `skip` allows. */
const passesFor = (filters: MaterialUnitFilters): readonly boolean[] =>
  filters.deprioritize === undefined ? [false] : [false, true];

/**
 * Validate the WHOLE pool before a multi-pass walk writes anything.
 *
 * `collectEligible` refuses unreadable provenance across every in-scope stack,
 * so a probe that is allowed to take nothing still proves the pool is readable.
 * Without it the guarantee would rest on an argument (pass 2 sees the same
 * scope pass 1 already validated) rather than on construction, and a walk that
 * threw on its SECOND pass would have already mutated on its first.
 */
function validatePool(inventory: readonly InvSlot[], itemId: string): void {
  const probe = planMaterialInventoryTake({
    inventory,
    itemId,
    count: 1,
    materialIds: materialItemIds(),
    eligibleSource: () => false,
    allowPartial: true,
  });
  if (!probe.ok) throw new Error(MATERIAL_CUSTODY_REFUSED);
}

/** Run a disposal walk, handing each pass's plan to `collect`. Returns the
 *  units actually taken. */
function walk(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  filters: MaterialUnitFilters,
  collect: (plan: MaterialTakePlan) => void,
): number {
  if (!isMaterialItemId(itemId)) return 0;
  if (count > 0) validatePool(inventory, itemId);
  let left = count;
  for (const takeLast of passesFor(filters)) {
    if (left <= 0) break;
    const plan = planSpend({
      inventory,
      itemId,
      count: left,
      eligibleSource: passFilter(filters, takeLast),
      allowPartial: true,
    });
    if (plan === null) continue;
    collect(plan);
    applyMaterialInventoryTake(inventory, plan);
    left -= plan.takenCount;
  }
  return count - left;
}

/**
 * Take up to `count` units for a DISPOSAL that hands the copies on (a vendor
 * sale, a trade offer): one carrier per unit, each with its exact one-unit
 * source, so the receiving side can land the same units.
 */
export function takeMaterialUnits(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  filters: MaterialUnitFilters = {},
): InventoryUnit[] {
  const units: InventoryUnit[] = [];
  walk(inventory, itemId, count, filters, (plan) => {
    // Never spread: a plan's unit list is as long as the quantity taken.
    for (const unit of materialInventoryUnits(plan)) units.push(unit);
  });
  return units;
}

/**
 * Take up to `count` units for a consumption that DESTROYS them (discard, and
 * the legacy `removePreferFungible` shape), reporting the effective payloads of
 * the units that had one. Deliberately NOT a transfer carrier: it drops the
 * composition, exactly like the payload list it replaces, so a caller that must
 * re-grant the copies uses `takeMaterialUnits` instead.
 */
export function consumeMaterialUnitPayloads(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  filters: MaterialUnitFilters = {},
): ItemInstancePayload[] {
  const payloads: ItemInstancePayload[] = [];
  walk(inventory, itemId, count, filters, (plan) => {
    for (const payload of consumedMaterialInstancePayloads(plan)) payloads.push(payload);
  });
  return payloads;
}

/**
 * The composition a vendor buyback row holds after absorbing one more unit's
 * worth. Exact on both sides: a one-unit top-up adds that unit's descriptor and
 * nothing else, so a row that already holds three descriptors is never rewritten
 * as a whole-row deposit.
 *
 * A non-material addition leaves the row's own composition alone, so a plain
 * row stays plain and no composition is ever invented for one.
 */
export function buybackCompositionAfter(
  held: MaterialComposition | undefined,
  addition: MaterialComposition | undefined,
): MaterialComposition | undefined {
  if (addition === undefined) return held;
  // Through the algebra rather than a concat: it validates, coalesces, orders
  // canonically and deep-copies, so the row never aliases the caller's unit.
  const merged = mergeMaterialCompositions(held ?? [], addition);
  if (!merged.ok) throw new Error(MATERIAL_CUSTODY_REFUSED);
  return merged.value;
}
