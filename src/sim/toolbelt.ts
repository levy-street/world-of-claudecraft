// The Toolbelt: a fifth, tool-only container beside the 4 general bag sockets.
//
// Unlike a bag (bags.ts), the toolbelt does NOT raise the pooled slot budget.
// It is a separate TYPED container with exactly one slot per tool type in the
// game, where a tool type is a gathering profession (mining, logging,
// herbalism, fishing: GATHERING_PROFESSION_IDS). A stored tool leaves
// PlayerMeta.inventory entirely, so belting your pick, axe, sickle, and rod
// frees four backpack slots.
//
// The payoff rule: a belted tool still counts as CARRIED for every
// owned-tool gate (professions/tools.ts scans). `toolSearchInventory` is the
// one combined view those call sites read, so a tool works exactly the same
// from the belt as from the backpack. Keeping that in a single helper is what
// stops the two containers from drifting apart.
//
// This module follows the bags.ts pattern: pure slot/placement math a Vitest
// imports directly, plus the command bodies as free functions `fn(ctx, ...)`
// behind SimContext. Backing state stays on Sim (PlayerMeta.toolbelt) and Sim
// keeps thin same-named delegates. Draws NO rng; no DOM/Three imports.

import { addStacked, bagCapacity, canAddItem, fitsAll } from './bags';
import { GATHERING_PROFESSION_IDS, type GatheringProfessionId } from './content/professions';
import { ITEMS } from './data';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { cloneInvSlot, type InvSlot, type ItemDef } from './types';

/** A toolbelt slot is keyed by the tool's owning gathering profession: one
 *  slot per tool type in the game. Reusing the profession id (rather than a
 *  parallel enum) is what makes "every type of tool" self-maintaining: a new
 *  gathering profession brings its belt slot with it. */
export type ToolSlotId = GatheringProfessionId;

/** Every tool slot, in the shared stable profession order. The belt has
 *  exactly this many slots, so the count is derived, never authored. */
export const TOOL_SLOT_IDS: readonly ToolSlotId[] = GATHERING_PROFESSION_IDS;

/** The stored contents: at most one tool per type. A missing key is an empty
 *  slot, so the serialized shape stays small for a partly filled belt. */
export interface ToolbeltState {
  /** Equipped toolbelt item id, or null when no belt is worn. */
  equipped: string | null;
  /** The belted tool per type. */
  slots: Partial<Record<ToolSlotId, InvSlot>>;
}

/** Membership test for the closed slot vocabulary. The server validates an
 *  inbound `take_tool` slot with this rather than trusting the wire string. */
export function isToolSlotId(value: string): value is ToolSlotId {
  return (TOOL_SLOT_IDS as readonly string[]).includes(value);
}

/** True for the container item itself (kind 'toolbelt'), never for a tool. */
export function isToolbeltItem(def: ItemDef | undefined): boolean {
  return def?.kind === 'toolbelt';
}

/** Which belt slot an item belongs in, or undefined when it is not a tool.
 *  Both fishing implements resolve to the one 'fishing' slot: the simple pole
 *  (`use.type` 'fishing') and the tiered rods (`gatherTool` + fishing), which
 *  is exactly the pair hasFishingImplement accepts. Note this is deliberately
 *  NARROWER than `kind: 'tool'`, which is a grab bag also covering cosmetic
 *  tokens (skin caches, mech chroma plates, Heroic Marks); those are not tools
 *  a profession uses and never belong on the belt. */
export function toolSlotOf(def: ItemDef | undefined): ToolSlotId | undefined {
  const use = def?.use;
  if (!use) return undefined;
  if (use.type === 'fishing') return 'fishing';
  if (use.type === 'gatherTool') return use.professionId;
  return undefined;
}

/** True when the item can be belted at all. */
export function isBeltableTool(def: ItemDef | undefined): boolean {
  return toolSlotOf(def) !== undefined;
}

/** A worn-nothing, stores-nothing belt. The value every fresh character and
 *  every pre-feature save starts from. */
export function emptyToolbelt(): ToolbeltState {
  return { equipped: null, slots: {} };
}

/** True when a belt is worn. Storing/taking is refused without one. */
export function hasToolbelt(state: ToolbeltState | undefined): boolean {
  return !!state?.equipped;
}

/** The belted tools, in TOOL_SLOT_IDS order. The order is stable so the wire
 *  shape and the UI both read the same sequence. */
export function storedTools(state: ToolbeltState | undefined): InvSlot[] {
  if (!state) return [];
  const out: InvSlot[] = [];
  for (const id of TOOL_SLOT_IDS) {
    const slot = state.slots[id];
    if (slot) out.push(slot);
  }
  return out;
}

/** How many belt slots are occupied. */
export function usedToolSlots(state: ToolbeltState | undefined): number {
  return storedTools(state).length;
}

/** The best (highest-tier) carried tool for one belt slot, or undefined when
 *  the player carries none. The UI's one-click "fill this slot" reads it so a
 *  player never has to hunt the right pick out of a full backpack; ties keep
 *  the first carried copy, and the untiered simple pole loses to any real rod.
 *  Pure bag scan, mirroring bestOwnedGatherToolTierOrNone's shape. */
export function bestCarriedToolFor(
  inventory: readonly InvSlot[],
  slotId: ToolSlotId,
  items: Readonly<Record<string, ItemDef>>,
): string | undefined {
  let bestId: string | undefined;
  let bestTier = -1;
  for (const slot of inventory) {
    const def = items[slot.itemId];
    if (toolSlotOf(def) !== slotId) continue;
    const use = def?.use;
    const tier = use && use.type === 'gatherTool' ? use.tier : 0;
    if (tier > bestTier) {
      bestTier = tier;
      bestId = slot.itemId;
    }
  }
  return bestId;
}

/** THE combined owned-tool view: everything the player carries, backpack plus
 *  belt. Every professions/tools.ts scan call site reads this instead of
 *  `meta.inventory` so a belted tool gates gathering exactly like a carried
 *  one. Returns the inventory array itself when the belt is empty, so the
 *  common case allocates nothing. */
export function toolSearchInventory(
  inventory: readonly InvSlot[],
  state: ToolbeltState | undefined,
): readonly InvSlot[] {
  const belted = storedTools(state);
  return belted.length === 0 ? inventory : [...inventory, ...belted];
}

/** The one load path (mirrors bank.ts sanitizeBankState). Drops what can no
 *  longer be honored rather than throwing: an unknown or non-belt `equipped`
 *  id, a stored item that is not a tool, and a tool filed under the wrong
 *  type. Stored counts clamp to 1 because a tool never stacks. Items are never
 *  destroyed silently here: `spill` carries every rejected slot back so the
 *  caller can return it to the player's inventory. */
export function sanitizeToolbeltState(raw: unknown): { state: ToolbeltState; spill: InvSlot[] } {
  const state = emptyToolbelt();
  const spill: InvSlot[] = [];
  if (!raw || typeof raw !== 'object') return { state, spill };
  const src = raw as Partial<ToolbeltState>;
  const equipped = typeof src.equipped === 'string' ? src.equipped : null;
  state.equipped = equipped && isToolbeltItem(ITEMS[equipped]) ? equipped : null;
  const slots = src.slots;
  if (!slots || typeof slots !== 'object') return { state, spill };
  for (const id of TOOL_SLOT_IDS) {
    const slot = slots[id];
    if (!slot || typeof slot.itemId !== 'string') continue;
    const kept = cloneInvSlot({ ...slot, count: 1 });
    // A tool filed under the wrong type, or stored with no belt worn, is
    // returned to the player rather than kept in an unreachable slot.
    if (toolSlotOf(ITEMS[slot.itemId]) !== id || !state.equipped) spill.push(kept);
    else state.slots[id] = kept;
  }
  return { state, spill };
}

/** Removes ONE unit of `itemId` from `inventory` and returns the slot that
 *  came out (count 1, payload preserved), or undefined when no copy is
 *  carried. Walks from the end, matching the Sim inventory hub's removeItem
 *  order, so the belt takes the same copy every other consumer would. */
function takeOneFromInventory(inventory: InvSlot[], itemId: string): InvSlot | undefined {
  for (let i = inventory.length - 1; i >= 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId) continue;
    const taken = cloneInvSlot({ ...s, count: 1 });
    s.count -= 1;
    if (s.count <= 0) inventory.splice(i, 1);
    return taken;
  }
  return undefined;
}

/** Returns a belted tool to the inventory, preserving its payload. */
function returnToInventory(inventory: InvSlot[], slot: InvSlot): void {
  addStacked(inventory, slot.itemId, slot.count, slot.instance, slot.craftedRecipeId);
}

/** Wear a toolbelt. The belt item leaves the inventory (freeing its slot);
 *  wearing a second belt swaps, the old one returning to the slot the new one
 *  freed, so the swap itself never needs spare room. Stored tools stay put
 *  across a swap: every belt has the same typed slots. */
export function equipToolbelt(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const def = ITEMS[itemId];
  if (!isToolbeltItem(def)) return;
  if (ctx.countItem(itemId, meta.entityId) <= 0) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  const old = meta.toolbelt.equipped;
  if (old === itemId) return;
  ctx.removeItem(itemId, 1, meta.entityId);
  if (old) addStacked(meta.inventory, old, 1);
  meta.toolbelt.equipped = itemId;
  ctx.onInventoryChangedForQuests(meta);
  ctx.emit({
    type: 'log',
    text: `Equipped ${def?.name ?? itemId}.`,
    color: '#8f8',
    pid: meta.entityId,
  });
}

/** Take the belt off. Everything it holds comes back with it, so the belt and
 *  its tools need room together: refused when they do not all fit, and nothing
 *  is ever force-dropped. */
export function unequipToolbelt(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const itemId = meta.toolbelt.equipped;
  if (!itemId) return;
  const returning: InvSlot[] = [{ itemId, count: 1 }, ...storedTools(meta.toolbelt)];
  if (!fitsAll(meta.inventory, bagCapacity(meta.bags), returning)) {
    ctx.error(meta.entityId, 'You have too many items to remove that toolbelt.');
    return;
  }
  meta.toolbelt.equipped = null;
  for (const id of TOOL_SLOT_IDS) {
    const slot = meta.toolbelt.slots[id];
    if (!slot) continue;
    delete meta.toolbelt.slots[id];
    returnToInventory(meta.inventory, slot);
  }
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

/** Move a carried tool into its typed belt slot. The slot is chosen by the
 *  tool, never by the player: a pick can only ever go in the mining slot.
 *  Belting onto an occupied slot swaps, the displaced tool returning to the
 *  slot the belted one frees, so the swap needs no spare room. */
export function storeToolInBelt(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const def = ITEMS[itemId];
  if (!hasToolbelt(meta.toolbelt)) {
    ctx.error(meta.entityId, 'You are not wearing a toolbelt.');
    return;
  }
  const target = toolSlotOf(def);
  if (target === undefined) {
    ctx.error(meta.entityId, 'Only tools fit in a toolbelt.');
    return;
  }
  const taken = takeOneFromInventory(meta.inventory, itemId);
  if (!taken) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  const displaced = meta.toolbelt.slots[target];
  meta.toolbelt.slots[target] = taken;
  if (displaced) returnToInventory(meta.inventory, displaced);
  ctx.onInventoryChangedForQuests(meta);
  ctx.emit({
    type: 'log',
    text: `Stowed ${def?.name ?? itemId} in your toolbelt.`,
    color: '#8f8',
    pid: meta.entityId,
  });
}

/** Take the tool out of one belt slot, back into the inventory. Refused when
 *  the backpack is full, so a tool is never destroyed by a full bag. */
export function takeToolFromBelt(ctx: SimContext, slotId: ToolSlotId, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const slot = meta.toolbelt.slots[slotId];
  if (!slot) return;
  if (!canAddItem(meta.inventory, bagCapacity(meta.bags), slot.itemId, slot.count)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return;
  }
  delete meta.toolbelt.slots[slotId];
  returnToInventory(meta.inventory, slot);
  ctx.onInventoryChangedForQuests(meta);
  const def = ITEMS[slot.itemId];
  ctx.emit({
    type: 'log',
    text: `Took ${def?.name ?? slot.itemId} from your toolbelt.`,
    color: '#8f8',
    pid: meta.entityId,
  });
}
