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

import { isChargeBearingPayload } from './item_instance_merge';
import {
  type MaterialStackError,
  type MaterialStackSlot,
  normalizeMaterialStack,
  PreparedMaterialStack,
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
  readonly held: PreparedMaterialStack;
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

  const prepared = PreparedMaterialInventory.read(inventory, incoming.itemId, materialIds);
  if (!prepared.ok) return prepared;
  return prepared.value.model(arriving.value, stackSize, maxNewSlots);
}

/** Only raw reads create these opaque, detached rows. Reuse is restricted to
 * the synchronous planning owner; no backing array or prepared row is exposed. */
export class PreparedMaterialInventory {
  #rows: { index: number; held: PreparedMaterialStack }[];
  #materialIds: ReadonlySet<string>;

  private constructor(
    rows: { index: number; held: PreparedMaterialStack }[],
    ids: ReadonlySet<string>,
  ) {
    this.#rows = rows;
    this.#materialIds = new Set(ids);
  }

  static read(
    inventory: readonly MaterialStackSlot[],
    itemId: string,
    ids: ReadonlySet<string>,
  ): MaterialPackingResult<PreparedMaterialInventory> {
    const rows: { index: number; held: PreparedMaterialStack }[] = [];
    for (let index = 0; index < inventory.length; index++) {
      const slot = inventory[index];
      if (slot.itemId !== itemId) continue;
      const held = PreparedMaterialStack.read(slot, ids);
      if (!held.ok) return held;
      rows.push({ index, held: held.value });
    }
    return succeed(new PreparedMaterialInventory(rows, ids));
  }

  someIdentity(predicate: (slot: MaterialStackSlot) => boolean): boolean {
    return this.#rows.some(({ held }) => predicate(held.identity()));
  }

  plan(
    incoming: MaterialStackSlot,
    stackSize: number,
    maxNewSlots: number,
  ): MaterialPackingResult<MaterialAddPlan> {
    const model = this.model(incoming, stackSize, maxNewSlots);
    return model.ok ? planPackingModel(model.value, this.#materialIds) : model;
  }

  model(
    incoming: MaterialStackSlot,
    stackSize: number,
    maxNewSlots: number,
  ): MaterialPackingResult<PackingModel> {
    if (!Number.isSafeInteger(stackSize) || stackSize <= 0) return fail('invalid-capacity');
    if (!Number.isSafeInteger(maxNewSlots) || maxNewSlots < 0) return fail('invalid-capacity');
    const prepared = PreparedMaterialStack.read(incoming, this.#materialIds);
    if (!prepared.ok) return prepared;
    const arriving = { value: prepared.value.identity() };
    const want = incoming.count;
    const targets: TopUpTarget[] = [];
    let room = 0;
    for (const { index, held } of this.#rows) {
      if (!held.compatible(prepared.value)) continue;
      const free = stackSize - held.count;
      if (free <= 0) continue;
      targets.push({ index, held, room: free });
      room = addUpTo(room, free, want);
    }

    // Only a charge-bearing payload stays one per fresh slot (isChargeBearingPayload,
    // the bags.ts instancedCountCap load-path rule mirrored here): a LOCKED
    // payload has no per-unit identity, since locking is one flag over the WHOLE
    // counted stack (item_lock.ts setItemLocked locks every unit in place, never
    // peeling one off), so it packs a fresh slot up to the normal cap exactly
    // like an unlocked stack. `compatibleMaterialStacks` above still keeps two
    // SEPARATE locked (or charged) stacks from topping up into one another: that
    // anti-taint rule is a different question from how big ONE incoming stack's
    // fresh slots are, and conflating the two was what split a whole locked
    // stack into one-unit slots on every deposit into a new container (vault,
    // bank, guild bank).
    const perFreshSlot = isChargeBearingPayload(arriving.value.instance) ? 1 : stackSize;
    room = addUpTo(room, freshSlotRoom(maxNewSlots, perFreshSlot, want), want);
    return succeed({ incoming: prepared.value.materialize(), targets, perFreshSlot, fit: room });
  }
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
  return planPackingModel(built.value, request.materialIds);
}

function planPackingModel(
  model: PackingModel,
  materialIds: ReadonlySet<string>,
): MaterialPackingResult<MaterialAddPlan> {
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
    const split = takeMaterialStack(pending, moved, materialIds);
    if (!split.ok) return split;
    const taken = PreparedMaterialStack.read(split.value.taken, materialIds);
    if (!taken.ok) return taken;
    const merged = target.held.merge(taken.value);
    if (!merged.ok) return merged;
    replacements.push({ index: target.index, slot: merged.value.materialize() });
    pending = split.value.remaining;
  }

  // Bounded by the fit check above: the remainder is exactly what the admitted
  // fresh slots were counted for, and each pass takes at least one unit.
  while (pending !== null) {
    const moved = Math.min(model.perFreshSlot, pending.count);
    const split = takeMaterialStack(pending, moved, materialIds);
    if (!split.ok) return split;
    const fresh = split.value.taken;
    appended.push(separated ? { ...fresh, materialSeparated: true } : fresh);
    pending = split.value.remaining;
  }

  return succeed({ replacements, appended });
}
