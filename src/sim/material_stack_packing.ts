// The ONE fit-and-packing decision for material stacks: how many units of an
// incoming stack the carried inventory can really absorb, and the exact atomic
// edit that absorbs them. bags.ts countFit and addStacked must eventually read
// BOTH answers from here, because a capacity pre-check that models the add even
// slightly differently is what re-opens the overflow class (#2139); one fit
// walk feeding one plan is what makes disagreeing impossible.
//
// A pure leaf with everything injected: material membership, the item's stack
// cap and the fresh-slot budget (the caller's bag-pool headroom) all arrive as
// parameters, so there is no `data.ts`/`bags.ts` import and no global cache, and
// a Vitest imports it directly. It owns no rules of its own either: compatibility
// is `compatibleMaterialStacks`' answer, validation is `normalizeMaterialStack`'s,
// and every unit moves through `takeMaterialStack` and the source algebra's
// merge, so nothing here can invent a source, clip a count, grant a premium
// benefit or lose a unit.
//
// Failures are codes; nothing throws, clamps, or writes to a caller's data. The
// incoming stack is NOT part of `inventory`: a caller repacking a held stack
// takes it out first, which is also where a transfer strips the owner's grouping.

import { isMergeableInstancePayload } from './item_instance_merge';
import { type MaterialComposition, mergeMaterialCompositions } from './material_sources';
import {
  compatibleMaterialStacks,
  type MaterialStackError,
  type MaterialStackSlot,
  normalizeMaterialStack,
  takeMaterialStack,
} from './material_stack';

export type MaterialPackingError =
  /** The whole incoming quantity does not fit, so no edit is planned. */
  | 'insufficient-space'
  /** `stackSize` is not a positive safe integer, or `maxNewSlots` not a nonnegative one. */
  | 'invalid-capacity'
  | MaterialStackError;

export type MaterialPackingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MaterialPackingError };

/** One packing question. Capacity is the CALLER's: `stackSize` is the item's
 *  cap and `maxNewSlots` the fresh stacks the bag pools would still admit. */
export interface MaterialPackRequest {
  readonly inventory: readonly MaterialStackSlot[];
  readonly incoming: MaterialStackSlot;
  readonly materialIds: ReadonlySet<string>;
  readonly stackSize: number;
  readonly maxNewSlots: number;
}

/** An existing stack rewritten in place, identified by its inventory index. */
export interface MaterialSlotReplacement {
  readonly index: number;
  readonly slot: MaterialStackSlot;
}

/** The whole edit, or nothing: apply every replacement at its index and append
 *  every new stack, in order. Slots the plan does not name are untouched. */
export interface MaterialAddPlan {
  readonly replacements: readonly MaterialSlotReplacement[];
  readonly appended: readonly MaterialStackSlot[];
}

const succeed = <T>(value: T): MaterialPackingResult<T> => ({ ok: true, value });
const fail = (error: MaterialPackingError): MaterialPackingResult<never> => ({ ok: false, error });

/** `total + add`, saturated at `cap`. The sum is only ever COMPARED against the
 *  cap, never stored above it, so no intermediate leaves the safe range. */
const addUpTo = (total: number, add: number, cap: number): number =>
  add >= cap - total ? cap : total + add;

/** Room `slots` hypothetical fresh stacks offer at `perSlot` units each,
 *  saturated at `cap`. The product is only evaluated once it is known to be
 *  under the cap, so a huge budget times a huge cap is never multiplied out. */
function freshSlotRoom(slots: number, perSlot: number, cap: number): number {
  if (slots === 0) return 0;
  return slots >= Math.ceil(cap / perSlot) ? cap : slots * perSlot;
}

/** A compatible held stack with room to spare. */
interface TopUpTarget {
  readonly index: number;
  /** The NORMALIZED held stack: what the replacement is built from. */
  readonly held: MaterialStackSlot;
  /** Units it can still take before the cap, always positive. */
  readonly room: number;
}

interface PackingModel {
  /** The normalized incoming stack: the units the plan spends. */
  readonly incoming: MaterialStackSlot;
  readonly targets: readonly TopUpTarget[];
  /** Units one fresh stack holds: the cap, or one for a payload that cannot share. */
  readonly perFreshSlot: number;
  /** Units that really fit, already capped at the requested count. */
  readonly fit: number;
}

/**
 * The one walk both exports share. Validates the capacity and the incoming
 * stack, then reads every SAME-ITEM held stack through the shared adapter:
 * unrelated stock (another item, a non-material) is never read and never
 * touched, while a same-item stack this model cannot parse refuses the whole
 * request rather than being packed around.
 */
function buildPackingModel(request: MaterialPackRequest): MaterialPackingResult<PackingModel> {
  const { inventory, incoming, materialIds, stackSize, maxNewSlots } = request;
  if (!Number.isSafeInteger(stackSize) || stackSize <= 0) return fail('invalid-capacity');
  if (!Number.isSafeInteger(maxNewSlots) || maxNewSlots < 0) return fail('invalid-capacity');

  const arriving = normalizeMaterialStack(incoming, materialIds);
  if (!arriving.ok) return arriving;
  const want = arriving.value.count;

  const targets: TopUpTarget[] = [];
  let room = 0;
  for (let index = 0; index < inventory.length; index++) {
    const slot = inventory[index];
    if (slot.itemId !== incoming.itemId) continue;
    const held = normalizeMaterialStack(slot, materialIds);
    if (!held.ok) return held;
    // Payload, crafted marker and the owner's separation choice are all decided
    // there, never re-derived here, so bags and this plan cannot disagree.
    const compatible = compatibleMaterialStacks(held.value, arriving.value, materialIds);
    if (!compatible.ok) return compatible;
    if (!compatible.value) continue;
    // A legacy OVER-CAP holding is kept exactly as it is: it simply offers
    // nothing, and never appears in a plan that would clip it back.
    const free = stackSize - held.value.count;
    if (free <= 0) continue;
    targets.push({ index, held: held.value, room: free });
    room = addUpTo(room, free, want);
  }

  // A charge-bearing or locked payload stays one per slot (the bags rule), so
  // each fresh stack absorbs one unit rather than a full cap.
  const perFreshSlot = isMergeableInstancePayload(arriving.value.instance) ? stackSize : 1;
  room = addUpTo(room, freshSlotRoom(maxNewSlots, perFreshSlot, want), want);
  return succeed({ incoming: arriving.value, targets, perFreshSlot, fit: room });
}

/**
 * How many of the incoming units the inventory would really take: existing
 * compatible stacks absorb up to the cap, then each admitted fresh slot holds
 * one stack. Always `Math.min(incoming.count, room)`, saturated rather than
 * summed past it, so a huge requested count answers a safe integer.
 */
export function materialStackFit(request: MaterialPackRequest): MaterialPackingResult<number> {
  const model = buildPackingModel(request);
  return model.ok ? succeed(model.value.fit) : model;
}

/** A topped-up copy of a held stack. The owner's bag cell, payload, crafted
 *  marker and grouping stay exactly as they were; only the quantity and the
 *  composition move. `held` is already this module's own normalized copy. */
function toppedUp(
  held: MaterialStackSlot,
  added: number,
  composition: MaterialComposition,
): MaterialStackSlot {
  return { ...held, count: held.count + added, materialSources: composition };
}

/**
 * The whole edit that adds the incoming stack, or an explicit refusal. The fit
 * is checked in full FIRST, so a short request plans nothing at all rather than
 * a partial add. Compatible stacks are topped up in original inventory order,
 * then the remainder becomes capped fresh stacks: deterministic, and never more
 * fresh stacks than the budget the fit was computed against.
 *
 * Every unit moves through `takeMaterialStack`, so the per-source composition is
 * exact on both sides of every split and no stack gains a source it was not
 * handed. Each changed and new slot carries its own payload and composition,
 * detached from the inputs and from each other.
 */
export function planMaterialStackAdd(
  request: MaterialPackRequest,
): MaterialPackingResult<MaterialAddPlan> {
  const built = buildPackingModel(request);
  if (!built.ok) return built;
  const model = built.value;
  if (model.fit < model.incoming.count) return fail('insufficient-space');

  // `takeMaterialStack` strips the owner's bag cell and grouping from what it
  // hands over, which is right for a transfer and wrong for a local repack: an
  // EXPLICITLY separated incoming stack stays separated in the blocks it fills.
  const separated = model.incoming.materialSeparated === true;
  const replacements: MaterialSlotReplacement[] = [];
  const appended: MaterialStackSlot[] = [];
  let pending: MaterialStackSlot | null = model.incoming;

  for (const target of model.targets) {
    if (pending === null) break;
    const moved = Math.min(target.room, pending.count);
    const split = takeMaterialStack(pending, moved, request.materialIds);
    if (!split.ok) return split;
    const merged = mergeMaterialCompositions(
      target.held.materialSources ?? [],
      split.value.taken.materialSources ?? [],
    );
    if (!merged.ok) return fail(merged.error);
    replacements.push({ index: target.index, slot: toppedUp(target.held, moved, merged.value) });
    pending = split.value.remaining;
  }

  // Bounded by the fit check above: the remainder is exactly what the admitted
  // fresh slots were counted for, and each pass takes at least one unit.
  while (pending !== null) {
    const moved = Math.min(model.perFreshSlot, pending.count);
    const split = takeMaterialStack(pending, moved, request.materialIds);
    if (!split.ok) return split;
    const fresh = split.value.taken;
    appended.push(separated ? { ...fresh, materialSeparated: true } : fresh);
    pending = split.value.remaining;
  }

  return succeed({ replacements, appended });
}
