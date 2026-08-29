// Bags: the WoW-style inventory capacity system. The player carries a fixed
// 16-slot backpack plus up to 4 equippable bag items (kind:'bag', each granting
// `bagSlots` extra slots). Capacity is POOLED into TWO pools (phase 05): the
// backpack plus every unrestricted bag feed the general pool, every
// materialsOnly bag feeds a materials-only pool the derived taxonomy alone may
// occupy (src/sim/bag_pools.ts carries the split and the materials-first
// allocation rule). Items still live in the one flat PlayerMeta.inventory
// list and equipped bags only raise the budgets, so nothing here pins an item
// to a specific container (the wire shape and the JSONB save shape are
// unchanged; pools are capacity accounting, not containers).
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

import { freePoolSlots, type PoolCapacity, poolCapacityOf, totalPoolCapacity } from './bag_pools';
import { ITEMS } from './data';
import {
  consumeSelectedInventorySlot,
  newestMatchingSlot,
  selectedInventorySlot,
} from './item_copy_ref';
import { canStackInstancePayloads, isMergeableInstancePayload } from './item_instance_merge';
import { isMaterialItemId } from './material_ids';
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
 *  loads capped at the stack cap identical-payload merges or an in-place
 *  whole-stack lock could legitimately have built; a charge-bearing payload
 *  stays one-per-slot regardless (a counted stack shares ONE payload object,
 *  so a hand-edited count would mint shared-charge copies); an unknown item
 *  def stays dormant recoverable data, uncapped like the plain arm (items are
 *  never destroyed by a load); plain slots are uncapped. Consumed by bank.ts
 *  sanitizeBankState AND the carried-inventory hydration in Sim.addPlayer so
 *  the rule cannot drift between the two load arms. */
export function instancedCountCap(
  def: ItemDef | undefined,
  instance: ItemInstancePayload | undefined,
): number {
  if (!instance) return Number.POSITIVE_INFINITY;
  if (instance.charges !== undefined) return 1;
  return def ? stackSizeOf(def) : Number.POSITIVE_INFINITY;
}

/** Extra slots a bag item grants when equipped (0 for a non-bag). Defined in
 *  bag_pools.ts, where poolCapacityOf reads the same answer, and re-exported
 *  here so the carried-inventory consumers keep one bag-facing import. */
export { bagSlotsOf } from './bag_pools';

/** The carried inventory's two-pool budget: the backpack plus every
 *  unrestricted bag feed the general pool, every materialsOnly bag feeds the
 *  materials pool (src/sim/bag_pools.ts carries the allocation rule). Every
 *  fit gate below takes this split, never a flat number, so no call site can
 *  quietly keep the old pooled-total model. */
export function bagPools(bags: readonly (string | null)[]): PoolCapacity {
  return poolCapacityOf(BACKPACK_SLOTS, bags);
}

/** Total slot budget, both pools summed: the backpack plus every equipped
 *  bag's bagSlots. The equip/unequip shrink guards and the HUD's used/total
 *  readout consume this; it is deliberately NOT a fit answer (a non-material
 *  can be refused while total headroom remains), so fit questions go through
 *  the PoolCapacity-taking gates below. */
export function bagCapacity(bags: readonly (string | null)[]): number {
  return totalPoolCapacity(bagPools(bags));
}

/** How many of `count` copies of an item would fit: existing stacks absorb up
 *  to their stackSize, then each free slot holds one fresh stack. `instance`
 *  is the payload of the copies being added (absent for a plain fungible
 *  add). A slot offers top-up room only when its payload matches under
 *  canStackInstancePayloads (identical-payload stacking): a plain
 *  add never tops up an instanced slot (#1165) and an instanced add never
 *  tops up a plain slot or a differently-instanced one; a non-matching slot
 *  still occupies a slot in the used count. Topping up an existing stack
 *  occupies no new slot, so it is pool-blind; only FRESH stacks consult the
 *  two-pool free-slot math (a non-material may only take general headroom, a
 *  material takes materials headroom first, bag_pools.ts freePoolSlots). */
export function countFit(
  inventory: readonly InvSlot[],
  pools: PoolCapacity,
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
  const freeSlots = freePoolSlots(inventory, pools, itemId, isMaterialItemId);
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
  pools: PoolCapacity,
  itemId: string,
  instance: ItemInstancePayload,
  count = 1,
): boolean {
  return countFit(inventory, pools, itemId, count, instance) >= count;
}

/** True when all `count` copies fit. */
export function canAddItem(
  inventory: readonly InvSlot[],
  pools: PoolCapacity,
  itemId: string,
  count: number,
): boolean {
  return countFit(inventory, pools, itemId, count) >= count;
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
  pools: PoolCapacity,
  itemId: string,
  count: number,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
): boolean {
  return countFit(inventory, pools, itemId, count, instance, craftedRecipeId) >= count;
}

/** True when EVERY add in the batch fits together (simulated cumulatively on a
 *  scratch copy, so three 1-slot items against one free slot correctly fail). */
export function fitsAll(
  inventory: readonly InvSlot[],
  pools: PoolCapacity,
  adds: readonly InvSlot[],
): boolean {
  const scratch = inventory.map((s) => ({ ...s }));
  for (const a of adds) {
    if (countFit(scratch, pools, a.itemId, a.count, a.instance, a.craftedRecipeId) < a.count)
      return false;
    addStacked(scratch, a.itemId, a.count, a.instance, a.craftedRecipeId);
  }
  return true;
}

/** Free FRESH-stack slots the pools offer `itemId` right now: the bag_pools
 *  free-slot answer with the material predicate wired, for conservative
 *  one-slot-per-unit models that bypass countFit's stacking arm.
 *
 *  ZERO PRODUCTION CALLERS as of the v0.40.0 sync, and say so rather than let
 *  the docblock keep naming one. Its consumer was trade.ts fitsAfterSwap's
 *  unknown-stock fallback, which the release DELETED when it rebuilt that model
 *  around the shared shippedOfferUnits walk: units the walk cannot source ship
 *  nothing in the real swap either, so the release argues modelling no arrival
 *  for them is exact rather than optimistic, and the fallback had nothing left
 *  to be conservative about. Kept and routed like the rest on the same footing
 *  as fitForItemInstance above (state.md records that one as dead-but-routed):
 *  it is still the ONE place the sim binds isMaterialItemId for a free-slot
 *  question, and tests/bags.test.ts exercises the split through it. Deleting it
 *  is a maintainer call, not a merge's. */
export function freeBagSlotsFor(
  inventory: readonly InvSlot[],
  pools: PoolCapacity,
  itemId: string,
): number {
  return freePoolSlots(inventory, pools, itemId, isMaterialItemId);
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
// tier then size. A FROZEN back-compat subset of the shipped bag items (the
// phase 05 catalog additions deliberately never join it; the grant ladder is
// a shipped contract), with each slot count cross-checked against the live
// content table by tests/bags.test.ts so a content re-tune cannot silently
// under-grant a pre-bag save.
export const MIGRATION_BAGS: { id: string; slots: number; tier: number }[] = [
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
export function equipBag(
  ctx: SimContext,
  itemId: string,
  socket?: number,
  pid?: number,
  slotIndex?: number,
): void {
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
    const empty = meta.bags.indexOf(null);
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
  //
  // Tolerated imprecision: on a LEGACY overstacked plain bag slot (count > 1,
  // reachable only from a pre-bag or tampered save; live play never overstacks
  // a bag, stackSizeOf pins kind 'bag' to 1), removeItem decrements the count
  // instead of freeing the slot, so the real post-swap length is one MORE than
  // modelled here and the inventory can land one slot past the summed budget.
  // That state is inside the tolerated over-capacity class: it blocks new adds
  // and destroys nothing.
  const after = meta.inventory.length - 1 + (old ? 1 : 0);
  if (after > bagCapacity(newBags)) {
    ctx.error(meta.entityId, 'You have too many items to swap to that bag.');
    return;
  }
  // Bags store only a bare item id in meta.bags (#2837): there is nowhere to
  // park an instance payload or a craftedRecipeId while a bag is worn, so
  // equipping a payload-bearing copy would silently destroy it on the next
  // unequip's plain addStacked grant. Not reachable through shipped content
  // today: no bag recipe or grant currently carries one. The crafted signer
  // mint is bag-exempt at the source (crafting.ts mintsSignedCraftOutput
  // refuses to sign a bag-kind output at ANY rarity, pinned in
  // tests/bags.test.ts), so the phase 05 tailoring ladder's rare and epic
  // craftable bags grant plain and fungible, exactly like the recipe-free
  // rare/epic loot bags always did. Bags are DECLARED payload-free here
  // rather than merely assumed: peek the copy that would be consumed BEFORE
  // consuming it (refusing late would have already removed it) and refuse
  // the equip outright the moment one ever does carry a payload, whatever
  // the source, rather than dropping it.
  const peeked =
    slotIndex !== undefined
      ? selectedInventorySlot(meta.inventory, itemId, slotIndex)
      : newestMatchingSlot(meta.inventory, itemId);
  if (peeked === null) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  if (peeked?.instance || peeked?.craftedRecipeId !== undefined) {
    ctx.error(meta.entityId, 'That bag cannot be equipped while it carries a special property.');
    return;
  }
  // A named slot consumes exactly that copy; an id-only call keeps the legacy
  // newest-first walk (ctx.removeItem) untouched. Both consumers stay
  // tri-state-aware even though the peek above already refused every
  // legitimate case: a silent no-op keeps a future divergence between the
  // peek and consume halves from equipping a bag AND leaving its source copy
  // behind (item_copy_ref.ts's own "branch on all three" contract).
  if (slotIndex !== undefined) {
    // No onInventoryChangedForQuests here: the shared call below already fires for
    // both arms, and running it twice re-evaluated collect objectives on one equip.
    if (consumeSelectedInventorySlot(meta.inventory, itemId, slotIndex) === null) return;
  } else {
    ctx.removeItem(itemId, 1, meta.entityId);
  }

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
