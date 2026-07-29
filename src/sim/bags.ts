// Bags: the WoW-style inventory capacity system. The player carries a fixed
// 16-slot backpack plus up to 4 equippable bag items (kind:'bag', each granting
// `bagSlots` extra slots). Capacity is POOLED: items live in the one flat
// PlayerMeta.inventory list and the equipped bags only raise the slot budget,
// so nothing here pins an item to a specific container (the wire shape and the
// JSONB save shape are unchanged).
//
// This module follows the items.ts pattern: pure capacity/stacking math a
// Vitest imports directly, plus the two command bodies (equipBag/unequipBag)
// as free functions `fn(ctx, ...)` behind SimContext. Backing state stays on
// Sim (PlayerMeta.bags); Sim keeps thin same-named delegates.
//
// Capacity is enforced at the command boundaries (buy, loot, pick up, fish,
// conjure, market collect, trade accept, quest turn-in, unequip, and the
// profession transforms: craft, salvage, disenchant, enchant apply, and the
// unbind stack split, #2350) via canAddItem/fitsAll/countFit pre-checks; a
// transform command models the post-consumption inventory on a scratch copy
// (removeStacked/consumeOneScratch below) so consuming the inputs can free
// the room the output needs. Grant paths a player cannot re-try (winning a
// need/greed roll, master loot, delve end-of-run rewards, dev gives) skip the
// check on purpose: an over-capacity inventory is tolerated (pre-bag saves may
// load overflowing too) and simply blocks new pickups until space is freed.
// Items are never destroyed by capacity.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). This module draws NO rng.

import { ITEMS } from './data';
import { canStackInstancePayloads, isMergeableInstancePayload } from './item_instance_merge';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import {
  cloneItemInstancePayload,
  type InvSlot,
  type ItemDef,
  type ItemInstancePayload,
} from './types';

/** Slots in the always-present backpack every character owns. */
export const BACKPACK_SLOTS = 16;
/** Number of equippable bag sockets next to the backpack. */
export const BAG_SOCKETS = 4;
/** Default stack cap for stackable kinds (consumables, junk, quest drops). */
const DEFAULT_STACK = 20;

/** Kinds that never stack: each copy occupies its own slot, classic style. */
const UNSTACKED_KINDS = new Set(['weapon', 'armor', 'held_offhand', 'bag', 'tool']);

/** Max copies of an item per inventory slot. Explicit `stackSize` wins;
 *  gear/bags/tools default to 1, everything else to 20. */
export function stackSizeOf(def: ItemDef | undefined): number {
  if (!def) return DEFAULT_STACK;
  if (def.stackSize && def.stackSize > 0) return Math.floor(def.stackSize);
  return UNSTACKED_KINDS.has(def.kind) ? 1 : DEFAULT_STACK;
}

/** The tamper ceiling for a PERSISTED slot's count: a counted instanced slot
 *  loads capped at the stack cap identical-payload merges could legitimately
 *  have built; a charge-bearing payload stays one-per-slot regardless (a
 *  counted stack shares ONE payload object, so a hand-edited count would mint
 *  shared-charge copies); an unknown item def stays dormant recoverable data,
 *  uncapped like the plain arm (items are never destroyed by a load); plain
 *  slots are uncapped. Consumed by bank.ts sanitizeBankState AND the
 *  carried-inventory hydration in Sim.addPlayer so the rule cannot drift
 *  between the two load arms. */
export function instancedCountCap(
  def: ItemDef | undefined,
  instance: ItemInstancePayload | undefined,
): number {
  if (!instance) return Number.POSITIVE_INFINITY;
  if (!isMergeableInstancePayload(instance)) return 1;
  return def ? stackSizeOf(def) : Number.POSITIVE_INFINITY;
}

/** Extra slots a bag item grants when equipped (0 for a non-bag). */
export function bagSlotsOf(def: ItemDef | undefined): number {
  return def?.kind === 'bag' ? (def.bagSlots ?? 0) : 0;
}

/** Total slot budget: the backpack plus every equipped bag's bagSlots. */
export function bagCapacity(bags: readonly (string | null)[]): number {
  let total = BACKPACK_SLOTS;
  for (const id of bags) if (id) total += bagSlotsOf(ITEMS[id]);
  return total;
}

/** Slots in use. Each InvSlot entry occupies one slot regardless of count
 *  (pre-bag saves may carry overstacked entries; they are tolerated as-is). */
export function usedBagSlots(inventory: readonly InvSlot[]): number {
  return inventory.length;
}

/** How many of `count` copies of an item would fit: existing stacks absorb up
 *  to their stackSize, then each free slot holds one fresh stack. `instance`
 *  is the payload of the copies being added (absent for a plain fungible
 *  add). A slot offers top-up room only when its payload matches under
 *  canStackInstancePayloads (identical-payload stacking): a plain
 *  add never tops up an instanced slot (#1165) and an instanced add never
 *  tops up a plain slot or a differently-instanced one; a non-matching slot
 *  still occupies a slot in the `inventory.length` used count. */
export function countFit(
  inventory: readonly InvSlot[],
  capacity: number,
  itemId: string,
  count: number,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
): number {
  const def = ITEMS[itemId];
  const stack = stackSizeOf(def);
  let room = 0;
  for (const s of inventory) {
    if (
      s.itemId === itemId &&
      canStackInstancePayloads(s.instance, instance) &&
      s.craftedRecipeId === craftedRecipeId &&
      s.count < stack
    ) {
      room += stack - s.count;
    }
  }
  const freeSlots = Math.max(0, capacity - inventory.length);
  // A non-mergeable payload (charges) keeps one-per-slot semantics, so each
  // fresh slot absorbs exactly one copy instead of a full stack.
  const perFreshSlot = instance && !isMergeableInstancePayload(instance) ? 1 : stack;
  room += freeSlots * perFreshSlot;
  return Math.min(count, room);
}

/** True when ALL `count` copies of an instanced grant fit (one by default):
 *  room in a byte-equal mergeable stack (identical-payload stacking) plus free
 *  slots. The corpse focus-harvest signed guards consume this (harvestNode's
 *  signed batch reads countFit directly for the same model) so a slot-full bag
 *  holding a same-payload stack with room keeps the
 *  signature instead of downgrading to the plain fungible fallback (#2139:
 *  every capacity pre-check must model the merge identically, or a guard
 *  that disagrees with addStacked re-opens the overflow class). Counting the
 *  WHOLE grant is what keeps that promise for a multi-unit signed yield
 *  (#2473): a stack with room for one of three units must refuse, or the
 *  remaining two push a fresh slot past capacity. The plain twin is
 *  canAddItem, same all-or-nothing shape. A `count` of 0 answers true (nothing
 *  is always grantable) and addItemInstance early-returns on it, so a caller
 *  that can legitimately reach 0 owns that check itself; no shipped grant can
 *  (a harvest quantity floors at 1). */
export function canGrantItemInstance(
  inventory: readonly InvSlot[],
  capacity: number,
  itemId: string,
  instance: ItemInstancePayload,
  count = 1,
): boolean {
  return countFit(inventory, capacity, itemId, count, instance) >= count;
}

/** How many of a `count`-unit instanced grant actually fit: the same
 *  countFit room model canGrantItemInstance boolean-gates, surfaced as a
 *  number. A signed-grant call site that owns a rolled quantity larger than
 *  one (the corpse-harvest signed grant, mirroring the node-harvest signed
 *  grant's own countFit call) uses this to size its addItemInstance call
 *  instead of truncating an available multi-unit fit down to one. */
export function fitForItemInstance(
  inventory: readonly InvSlot[],
  capacity: number,
  itemId: string,
  count: number,
  instance: ItemInstancePayload,
): number {
  return countFit(inventory, capacity, itemId, count, instance);
}

/** True when all `count` copies fit. */
export function canAddItem(
  inventory: readonly InvSlot[],
  capacity: number,
  itemId: string,
  count: number,
): boolean {
  return countFit(inventory, capacity, itemId, count) >= count;
}

/** The ONE capacity check the exchange pipes share (market buy/cancel/collect,
 *  mail claim, vendor buyback), payload-aware on both arms (#2139: the
 *  pre-check must model the grant identically or the overflow class re-opens):
 *  with `instance` absent this is canAddItem, with it canGrantItemInstance.
 *  Also threads the plain-stack `craftedRecipeId` marker: a caller granting a
 *  crafted plain stack must pre-check with the same marker `grantCopies`
 *  grants with, or the fit check can see room in a marker-free stack that the
 *  actual grant (keyed on the marker by addStacked) cannot merge into,
 *  overfilling the recipient's bags past the modelled cap. Its grant twin is
 *  item_instance_transfer.ts grantCopies. */
export function canGrantCopies(
  inventory: readonly InvSlot[],
  capacity: number,
  itemId: string,
  count: number,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
): boolean {
  return countFit(inventory, capacity, itemId, count, instance, craftedRecipeId) >= count;
}

/** True when EVERY add in the batch fits together (simulated cumulatively on a
 *  scratch copy, so three 1-slot items against one free slot correctly fail). */
export function fitsAll(
  inventory: readonly InvSlot[],
  capacity: number,
  adds: readonly InvSlot[],
): boolean {
  const scratch = inventory.map((s) => ({ ...s }));
  for (const a of adds) {
    if (countFit(scratch, capacity, a.itemId, a.count, a.instance, a.craftedRecipeId) < a.count)
      return false;
    addStacked(scratch, a.itemId, a.count, a.instance, a.craftedRecipeId);
  }
  return true;
}

/** Stack-aware add: top up existing stacks to their stackSize, then append
 *  fresh stacks. `instance` is the payload the added copies carry (absent for
 *  a plain fungible add). A stack is a top-up target only when its payload
 *  matches under canStackInstancePayloads (identical-payload stacking;
 *  before it, #1165 kept every signer/charges/rolled/boundTo copy in its
 *  own slot): a plain add never merges into an instanced slot and an
 *  instanced add never merges into a plain or differently-instanced one.
 *  Applies NO capacity cap (capacity is a pre-check concern); callers on a
 *  gated path check canAddItem/fitsAll first. */
export function addStacked(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
): void {
  const def = ITEMS[itemId];
  const stack = stackSizeOf(def);
  let remaining = count;
  for (const s of inventory) {
    if (remaining <= 0) return;
    if (
      s.itemId !== itemId ||
      !canStackInstancePayloads(s.instance, instance) ||
      s.craftedRecipeId !== craftedRecipeId ||
      s.count >= stack
    )
      continue;
    const take = Math.min(stack - s.count, remaining);
    s.count += take;
    remaining -= take;
  }
  const mergeable = isMergeableInstancePayload(instance);
  while (remaining > 0) {
    // A charge-bearing payload stays one-per-slot; every fresh instanced slot
    // carries its own deep clone so two slots never alias one mutable payload.
    const take = instance && !mergeable ? 1 : Math.min(stack, remaining);
    const slot: InvSlot = instance
      ? { itemId, count: take, instance: cloneItemInstancePayload(instance) }
      : { itemId, count: take };
    if (craftedRecipeId !== undefined) slot.craftedRecipeId = craftedRecipeId;
    inventory.push(slot);
    remaining -= take;
  }
}

/** Units of `itemId` a scratch inventory holds, instanced slots included: the
 *  read half of removeStacked below, for a capacity simulation that has to
 *  decide HOW MUCH it can take from the scratch copy before taking it (the
 *  grade-spanning craft consumption in professions/crafting.ts). Mirrors the
 *  Sim hub's countItem, which sums the same slots. */
export function countStacked(inventory: readonly InvSlot[], itemId: string): number {
  let total = 0;
  for (const s of inventory) if (s.itemId === itemId) total += s.count;
  return total;
}

/** Stack-aware removal mirroring the Sim hub's removeItem walk (from the end,
 *  instanced slots included, exactly like removeItem), for capacity simulations
 *  on a scratch copy whose live path removes with removeItem (the trade swap,
 *  craft/enchant reagents). The quest turn-in gate instead models its
 *  prefer-plain hand-in with consumeOneScratch below. */
export function removeStacked(inventory: InvSlot[], itemId: string, count: number): void {
  let remaining = count;
  for (let i = inventory.length - 1; i >= 0 && remaining > 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId) continue;
    const take = Math.min(s.count, remaining);
    s.count -= take;
    remaining -= take;
    if (s.count <= 0) inventory.splice(i, 1);
  }
}

/** Scratch mirror of the sim's preferential single-copy removers, for
 *  capacity simulations (#2350): removes ONE unit of `itemId` from a scratch
 *  inventory, choosing the victim slot exactly like the live removers do: a
 *  plain fungible slot first (highest index, removeFungibleItem's walk), then
 *  an instanced slot `excludeInstance` does not match (highest index,
 *  removeEnchantableItem's second pass), and only then an excluded instanced
 *  slot (highest index: with no preferred copy left, the live paths fall back
 *  to the plain removeItem walk, where only excluded slots remain). With no
 *  `excludeInstance` it models items.ts removePreferFungible in its
 *  predicate-less form, the only form its callers here use (salvage); the
 *  trade path's `deprioritize` two-pass has its own dedicated mirror,
 *  trade.ts fitsAfterSwap. With
 *  professions/enchanting.ts isEnchantedInstance it models the
 *  countEnchantableItem >= 1 ? removeEnchantableItem : removeItem split
 *  (disenchant) and removeEnchantableItem alone (apply-enchant, whose
 *  not_held gate already guarantees an unexcluded copy exists). Returns the
 *  victim slot's payload (undefined for a plain victim or no victim at all)
 *  so a transform command can model the grant it mints FROM the consumed
 *  copy. A capacity pre-check must model the removal identically to the
 *  remover it gates, or the guard re-opens the overflow class (#2139). */
export function consumeOneScratch(
  scratch: InvSlot[],
  itemId: string,
  excludeInstance?: (instance: ItemInstancePayload) => boolean,
): ItemInstancePayload | undefined {
  const passes: ((s: InvSlot) => boolean)[] = [
    (s) => !s.instance,
    (s) => !!s.instance && !excludeInstance?.(s.instance),
    (s) => !!s.instance,
  ];
  for (const eligible of passes) {
    for (let i = scratch.length - 1; i >= 0; i--) {
      const s = scratch[i];
      if (s.itemId !== itemId || !eligible(s)) continue;
      const instance = s.instance;
      s.count -= 1;
      if (s.count <= 0) scratch.splice(i, 1);
      return instance;
    }
  }
  return undefined;
}

/** The standard full-bags rejection, shared by every capacity-gated command. */
export function bagsFullError(ctx: SimContext, pid: number): void {
  ctx.error(pid, 'Your bags are full.');
}

// The bag ladder the pre-bag save migration draws from, ordered by quality
// tier then size. Mirrors the shipped bag items in content/items.ts.
const MIGRATION_BAGS: { id: string; slots: number; tier: number }[] = [
  { id: 'linen_pouch', slots: 6, tier: 0 }, // common
  { id: 'travelers_knapsack', slots: 8, tier: 0 }, // common
  { id: 'wolfhide_satchel', slots: 10, tier: 1 }, // uncommon
  { id: 'gravewoven_bag', slots: 12, tier: 2 }, // rare
  { id: 'mistcallers_duffel', slots: 14, tier: 3 }, // epic
];

/** Back-compat grant for a PRE-BAG save (no `bags` field) whose inventory
 *  already exceeds the backpack: the bags to equip (socket order) so nothing
 *  the player owned stops fitting. Policy: the LOWEST quality tier whose bags
 *  can cover the need on their own wins (a 30-slot save gets two common bags,
 *  never a free epic), then the fewest bags within that tier (largest-first,
 *  with the tail socket downsized to the smallest bag that still covers it).
 *  A hoard past the 72-slot ceiling gets the four largest bags and keeps the
 *  tolerated overflow. Deterministic, no rng; runs only at load time. */
export function migrationBagsFor(usedSlots: number): string[] {
  let remaining = usedSlots - BACKPACK_SLOTS;
  if (remaining <= 0) return [];
  const tierMax = (tier: number): number =>
    Math.max(...MIGRATION_BAGS.filter((b) => b.tier <= tier).map((b) => b.slots));
  const topTier = MIGRATION_BAGS[MIGRATION_BAGS.length - 1].tier;
  let tier = 0;
  while (tier < topTier && tierMax(tier) * BAG_SOCKETS < remaining) tier++;
  const allowed = MIGRATION_BAGS.filter((b) => b.tier <= tier);
  const largest = allowed[allowed.length - 1];
  const granted: string[] = [];
  while (remaining > 0 && granted.length < BAG_SOCKETS) {
    const pick = allowed.find((b) => b.slots >= remaining) ?? largest;
    granted.push(pick.id);
    remaining -= pick.slots;
  }
  return granted;
}

const inRange = (socket: number): boolean =>
  Number.isInteger(socket) && socket >= 0 && socket < BAG_SOCKETS;

/** Equip a bag item into a socket (first empty when omitted). Equipping onto an
 *  occupied socket swaps: the old bag returns to the slot the new one freed, so
 *  the swap itself never needs spare room; only a capacity SHRINK (smaller bag)
 *  is guarded so the pooled inventory never ends up above budget via a swap. */
export function equipBag(ctx: SimContext, itemId: string, socket?: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const def = ITEMS[itemId];
  if (def?.kind !== 'bag') return;
  if (ctx.countItem(itemId, meta.entityId) <= 0) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  let target = socket;
  if (target === undefined) {
    const empty = meta.bags.findIndex((b) => b === null);
    target = empty >= 0 ? empty : -1;
  }
  if (target === -1) {
    ctx.error(meta.entityId, 'All your bag slots are full.');
    return;
  }
  if (!inRange(target)) return;
  const old = meta.bags[target];
  const newBags = meta.bags.slice();
  newBags[target] = itemId;
  // Simulate the post-swap inventory: the equipped bag leaves it, the replaced
  // bag (if any) returns to it. Guard only against ending above the new budget.
  const after = meta.inventory.length - 1 + (old ? 1 : 0);
  if (after > bagCapacity(newBags)) {
    ctx.error(meta.entityId, 'You have too many items to swap to that bag.');
    return;
  }
  ctx.removeItem(itemId, 1, meta.entityId);
  if (old) addStacked(meta.inventory, old, 1);
  meta.bags[target] = itemId;
  ctx.onInventoryChangedForQuests(meta);
  ctx.emit({ type: 'log', text: `Equipped ${def.name}.`, color: '#8f8', pid: meta.entityId });
}

/** Remove the bag in `socket` back to the inventory. Blocked when the shrunk
 *  budget (minus this bag's slots, plus the bag item itself) cannot hold the
 *  current items: free up space first, nothing is ever force-dropped. */
export function unequipBag(ctx: SimContext, socket: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  if (!inRange(socket)) return;
  const itemId = meta.bags[socket];
  if (!itemId) return;
  const newBags = meta.bags.slice();
  newBags[socket] = null;
  if (meta.inventory.length + 1 > bagCapacity(newBags)) {
    ctx.error(meta.entityId, 'You have too many items to remove that bag.');
    return;
  }
  meta.bags[socket] = null;
  addStacked(meta.inventory, itemId, 1);
  ctx.onInventoryChangedForQuests(meta);
  const def = ITEMS[itemId];
  ctx.emit({
    type: 'log',
    text: `Unequipped ${def?.name ?? itemId}.`,
    color: '#8f8',
    pid: meta.entityId,
  });
}
