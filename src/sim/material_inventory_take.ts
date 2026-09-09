// The ONE decision for spending material OUT of an inventory: which units, from
// which stacks, and the exact atomic edit that removes them. The packing leaf
// (material_stack_packing.ts) is its twin on the grant side; between them every
// bags/bank/vault/transfer consumer reads one answer, so no two call sites can
// spend a different unit for the same request.
//
// It owns no algebra of its own. Validation is normalizeMaterialStack's, the
// automatic spend order is material_sources.ts compareMaterialSpendOrder (the
// same tier rule takeMaterialCount applies within one stack), every split is
// takeMaterialStack, and an explicit selection is validated by
// canonicalMaterialComposition. Nothing here rounds, caps, substitutes a source,
// or drops attribution.
//
// The rules a caller cannot see from those pieces alone:
// - Automatic selection spends unrecorded material first, then other plain
//   material, then premium LAST, across every eligible stack at once; the same
//   descriptor held in two stacks is taken from the HIGHEST index first, so the
//   choice is total and deterministic.
// - `materialSeparated` is a grouping preference, NOT a lock: a separated block
//   is ordinary spendable stock. Spending never merges it with anything, and its
//   remainder stays separated.
// - `instance.locked` IS a lock: those units are never selected, unless the
//   caller opts in with `includeLocked` (default false) to replay a move a
//   lock-blind pipe already made.
// - An explicit slot index or source selection never falls back. If the named
//   slot or descriptor cannot cover the request, the request is refused.
// - `eligibleSource` narrows the pool one BUCKET at a time, so a partly
//   ineligible row spends the units that qualify and leaves the rest exactly
//   where they were. A selected descriptor the predicate drops refuses like any
//   other shortfall; it is never quietly substituted.
//
// Canonical unit adapters for the legacy remover shapes (per-unit payloads,
// InventoryUnit lists) live in the sibling material_inventory_units.ts, so this
// module stays the decision and that one stays the presentation of it.
//
// Failures are codes; nothing throws, clamps, or writes to a caller's data. The
// plan is inert: applyMaterialInventoryTake is the only thing that mutates, and
// only what the plan names.

import {
  canonicalMaterialComposition,
  compareMaterialSpendOrder,
  type MaterialSource,
  type MaterialSourceCount,
  materialSourceKey,
  totalMaterialCount,
} from './material_sources';
import {
  type MaterialStackError,
  type MaterialStackSlot,
  normalizeMaterialStack,
  takeMaterialStack,
} from './material_stack';
import type { InvSlot } from './types';

export type MaterialTakeError =
  /** `slotIndex` names no slot, or names one holding another item. */
  | 'invalid-index'
  /** The inventory itself is not a list of slots (an absent row). */
  | 'invalid-input'
  | MaterialStackError;

export type MaterialTakeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MaterialTakeError };

/** One spend request. Everything past `materialIds` narrows the choice. */
export interface MaterialTakeRequest {
  readonly inventory: readonly MaterialStackSlot[];
  readonly itemId: string;
  /** Units wanted: a positive safe integer. */
  readonly count: number;
  readonly materialIds: ReadonlySet<string>;
  /** Restricts WHICH stacks may be spent (the caller's own priority pass, e.g.
   *  bags' prefer-plain walk). Absent means every stack of the item. */
  readonly eligibleSlot?: (slot: MaterialStackSlot, index: number) => boolean;
  /** Restricts WHICH BUCKETS may be spent, asked once per bucket of every
   *  otherwise eligible stack. This is what lets a fungible-only custody route
   *  (market, mail) spend the unrecorded and provenance-only units out of a
   *  mixed row while the signed units stay put IN THAT SAME ROW, instead of
   *  refusing the whole block or laundering it. The `slot` handed over is the
   *  shared VALIDATED normalized stack, so a predicate reads canonical data and
   *  no caller re-normalizes. It narrows the pool only: it is not a sorter, and
   *  the spend order stays the canonical one. */
  readonly eligibleSource?: (
    source: MaterialSource,
    slot: MaterialStackSlot,
    index: number,
  ) => boolean;
  /** Spend from exactly this inventory index and no other. */
  readonly slotIndex?: number;
  /** Spend exactly these descriptors in these counts. Must total `count`; a
   *  short descriptor refuses rather than substituting another. */
  readonly selectedSources?: readonly MaterialSourceCount[];
  /** Legacy removeStacked semantics: take up to what is available instead of
   *  refusing a shortfall. An exact take is the default. */
  readonly allowPartial?: boolean;
  /** Admit `instance.locked` stacks into the pool. DEFAULT FALSE, and it stays
   *  false for every ordinary spend: the player lock is the owner's own
   *  salvage/craft/vendor safety mark and this module refusing to spend it is
   *  what makes that mark mean anything.
   *
   *  The one caller that sets it is a REPLAY of a move that already happened
   *  through a pipe whose established policy does not consult the lock (the
   *  guild book; see transfer_lock.ts, which scopes the lock to the $WOC rail).
   *  Such a replay must land the same units the live move did, locked payload
   *  included, so a durable book cannot drift from the live one. It is not a
   *  permission to spend a locked copy: the caller has already moved it. */
  readonly includeLocked?: boolean;
}

/** A stack that survives with a smaller remainder, at its original index. */
export interface MaterialTakeReplacement {
  readonly index: number;
  readonly slot: MaterialStackSlot;
}

/**
 * The whole edit, or nothing. Apply with applyMaterialInventoryTake, which
 * writes the replacements and then splices the removals back to front.
 * `replacements` and `removals` are disjoint and both ascend by index.
 */
export interface MaterialTakePlan {
  readonly replacements: readonly MaterialTakeReplacement[];
  /** Indices emptied outright, ascending. */
  readonly removals: readonly number[];
  /** Transfer-ready copies of what left, one per source stack, ascending by
   *  that stack's index. Each carries its exact composition and payload, with
   *  the owner's bag cell and grouping stripped (takeMaterialStack's rule). */
  readonly taken: readonly MaterialStackSlot[];
  /** Units actually taken: `count`, unless allowPartial shortened it. */
  readonly takenCount: number;
}

const succeed = <T>(value: T): MaterialTakeResult<T> => ({ ok: true, value });
const fail = (error: MaterialTakeError): MaterialTakeResult<never> => ({ ok: false, error });

/** A validated, spendable stack. */
interface EligibleStack {
  readonly index: number;
  /** The NORMALIZED stack: what the split is taken from. */
  readonly slot: MaterialStackSlot;
}

/** One descriptor's units in one stack: the unit of choice. */
interface Candidate {
  readonly index: number;
  readonly source: MaterialSource;
  readonly key: string;
  readonly available: number;
}

/** Per-stack selections, accumulated as the choice is made. */
type Selections = Map<number, MaterialSourceCount[]>;

function select(into: Selections, index: number, source: MaterialSource, count: number): void {
  if (count <= 0) return;
  const held = into.get(index);
  if (held === undefined) into.set(index, [{ source, count }]);
  else held.push({ source, count });
}

/**
 * Every stack of `itemId` this request may touch, normalized and validated.
 *
 * Validation covers every stack IN SCOPE even when it will not be spent (a
 * locked or filtered-out one included), so a bag holding provenance this model
 * cannot read refuses the request rather than being quietly spent around, and
 * the answer does not depend on which eligibility pass asked. Slots of another
 * item are never read.
 */
function collectEligible(
  request: MaterialTakeRequest,
): MaterialTakeResult<readonly EligibleStack[]> {
  const { inventory, itemId, materialIds, eligibleSlot, slotIndex } = request;
  const includeLocked = request.includeLocked === true;
  const eligible: EligibleStack[] = [];
  for (let index = 0; index < inventory.length; index++) {
    const slot = inventory[index];
    // Typed as present, but this module answers in codes and never throws: an
    // absent row from untyped persisted data is refused, not dereferenced.
    if (slot === undefined || slot === null) return fail('invalid-input');
    if (slot.itemId !== itemId) continue;
    if (slotIndex !== undefined && index !== slotIndex) continue;
    const normalized = normalizeMaterialStack(slot, materialIds);
    if (!normalized.ok) return normalized;
    // A player-locked copy is never spent unless the caller explicitly replays
    // a move a lock-blind pipe already made; a separated one is ordinary stock.
    if (!includeLocked && slot.instance?.locked === true) continue;
    if (eligibleSlot !== undefined && !eligibleSlot(slot, index)) continue;
    eligible.push({ index, slot: normalized.value });
  }
  return succeed(eligible);
}

/** Every spendable bucket, in the canonical order the automatic choice walks:
 *  unrecorded, then other plain, then premium; ties on the descriptor key, and
 *  the same descriptor taken from the highest index first. `eligibleSource`
 *  drops buckets from the pool here, per bucket, so a partly ineligible row
 *  still contributes the units that ARE eligible. */
function orderedCandidates(
  eligible: readonly EligibleStack[],
  eligibleSource: MaterialTakeRequest['eligibleSource'],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const entry of eligible) {
    for (const bucket of entry.slot.materialSources ?? []) {
      if (eligibleSource !== undefined && !eligibleSource(bucket.source, entry.slot, entry.index)) {
        continue;
      }
      candidates.push({
        index: entry.index,
        source: bucket.source,
        key: materialSourceKey(bucket.source),
        available: bucket.count,
      });
    }
  }
  candidates.sort((a, b) => compareMaterialSpendOrder(a.source, b.source) || b.index - a.index);
  return candidates;
}

/** The default choice: cheapest tier first, premium only once nothing else is
 *  left, so the last premium unit is the last unit spent. */
function chooseAutomatically(
  candidates: readonly Candidate[],
  count: number,
  into: Selections,
): number {
  let owed = count;
  for (const candidate of candidates) {
    if (owed === 0) break;
    const spend = Math.min(owed, candidate.available);
    select(into, candidate.index, candidate.source, spend);
    owed -= spend;
  }
  return count - owed;
}

/** The explicit choice: exactly the named descriptors, each satisfied from the
 *  highest index down. A descriptor the inventory cannot cover is never made up
 *  from another one; the caller asked for those units. */
function chooseSelected(
  candidates: readonly Candidate[],
  wanted: readonly MaterialSourceCount[],
  allowPartial: boolean,
  into: Selections,
): MaterialTakeResult<number> {
  let taken = 0;
  for (const want of wanted) {
    const key = materialSourceKey(want.source);
    let owed = want.count;
    for (const candidate of candidates) {
      if (owed === 0) break;
      if (candidate.key !== key) continue;
      const spend = Math.min(owed, candidate.available);
      select(into, candidate.index, candidate.source, spend);
      owed -= spend;
    }
    if (owed > 0 && !allowPartial) return fail('insufficient');
    taken += want.count - owed;
  }
  return succeed(taken);
}

/**
 * Plans the removal of `count` units of a material, or refuses. Nothing is
 * written: the caller applies the returned plan (or discards it, which is what
 * makes this usable as a scratch predictor for a capacity gate).
 *
 * The whole request is validated before any unit is chosen, and the whole
 * choice is made before any split is built, so a refusal leaves the caller's
 * inventory untouched in every arm.
 */
export function planMaterialInventoryTake(
  request: MaterialTakeRequest,
): MaterialTakeResult<MaterialTakePlan> {
  const { inventory, itemId, count, materialIds, slotIndex, selectedSources } = request;
  const allowPartial = request.allowPartial === true;

  if (!materialIds.has(itemId)) return fail('not-material');
  if (!Number.isSafeInteger(count) || count <= 0) return fail('invalid-quantity');
  if (slotIndex !== undefined) {
    if (!Number.isSafeInteger(slotIndex) || slotIndex < 0 || slotIndex >= inventory.length) {
      return fail('invalid-index');
    }
    if (inventory[slotIndex].itemId !== itemId) return fail('invalid-index');
  }

  const collected = collectEligible(request);
  if (!collected.ok) return collected;
  const eligible = collected.value;
  const candidates = orderedCandidates(eligible, request.eligibleSource);

  const selections: Selections = new Map();
  let takenCount: number;
  if (selectedSources === undefined) {
    takenCount = chooseAutomatically(candidates, count, selections);
    if (takenCount < count && !allowPartial) return fail('insufficient');
  } else {
    // Validated against the REQUESTED quantity: a selection is a statement about
    // the whole take, so one that does not total `count` is a caller error
    // rather than a partial fill.
    const wanted = canonicalMaterialComposition(selectedSources, count);
    if (!wanted.ok) return fail(wanted.error);
    const chosen = chooseSelected(candidates, wanted.value, allowPartial, selections);
    if (!chosen.ok) return chosen;
    takenCount = chosen.value;
  }

  const replacements: MaterialTakeReplacement[] = [];
  const removals: number[] = [];
  const taken: MaterialStackSlot[] = [];
  for (const entry of eligible) {
    const selection = selections.get(entry.index);
    if (selection === undefined) continue;
    const split = takeMaterialStack(
      entry.slot,
      totalMaterialCount(selection),
      materialIds,
      selection,
    );
    if (!split.ok) return split;
    taken.push(split.value.taken);
    if (split.value.remaining === null) removals.push(entry.index);
    else replacements.push({ index: entry.index, slot: split.value.remaining });
  }
  return succeed({ replacements, removals, taken, takenCount });
}

/**
 * Applies a plan built from THIS inventory. Replacements are written by index,
 * then removals are spliced back to front so an earlier splice cannot shift a
 * later index. Nothing the plan does not name is touched.
 */
export function applyMaterialInventoryTake(inventory: InvSlot[], plan: MaterialTakePlan): void {
  for (const replacement of plan.replacements) inventory[replacement.index] = replacement.slot;
  for (let i = plan.removals.length - 1; i >= 0; i--) inventory.splice(plan.removals[i], 1);
}

/**
 * The single descriptor a one-unit take spent, for a caller that has to report
 * WHAT it consumed in the pre-source shape (bags' consumeOneScratch). Undefined
 * for any other plan, so a caller cannot mistake a multi-unit take for one.
 */
export function soleTakenSource(plan: MaterialTakePlan): MaterialSource | undefined {
  if (plan.takenCount !== 1 || plan.taken.length !== 1) return undefined;
  const composition = plan.taken[0].materialSources ?? [];
  return composition.length === 1 ? composition[0].source : undefined;
}
