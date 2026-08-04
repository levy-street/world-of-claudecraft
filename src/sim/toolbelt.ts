// The Toolbelt: a fifth, tool-only container beside the 4 general bag sockets.
//
// Unlike a bag (bags.ts), the toolbelt does NOT raise the pooled slot budget.
// It is a separate container of GENERIC tool slots: each slot holds any one
// gathering implement (mining, logging, herbalism, fishing), and how many
// slots a belt has comes from its own ItemDef (`toolSlots`: 2 on the basic
// belt, 3 reinforced, 4 artisan's - the tailoring ladder). A stored tool
// leaves PlayerMeta.inventory entirely, so each belted tool frees one
// backpack slot.
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
import type { GatheringProfessionId } from './content/professions';
import { ITEMS } from './data';
import type { SimContext } from './sim_context';
import { cloneInvSlot, type InvSlot, type ItemDef } from './types';

/** The stored contents: a positional slot per belt slot (null = empty), the
 *  array exactly as long as the worn belt has slots ([] with no belt worn).
 *  Positions are stable across take-outs so the UI's slots never shuffle. */
export interface ToolbeltState {
  /** Equipped toolbelt item id, or null when no belt is worn. */
  equipped: string | null;
  /** The belted tool per slot, in slot order. */
  slots: (InvSlot | null)[];
}

/** True for the container item itself (kind 'toolbelt'), never for a tool. */
export function isToolbeltItem(def: ItemDef | undefined): boolean {
  return def?.kind === 'toolbelt';
}

/** How many tool slots a belt item grants: its authored `toolSlots` (the
 *  tailoring ladder's 2/3/4). Zero for anything that is not a toolbelt. */
export function toolSlotCount(def: ItemDef | undefined): number {
  return isToolbeltItem(def) ? (def?.toolSlots ?? 0) : 0;
}

/** How many slots the WORN belt grants right now (0 with no belt worn). */
export function beltSlotCount(state: ToolbeltState | undefined): number {
  return state?.equipped ? toolSlotCount(ITEMS[state.equipped]) : 0;
}

/** Which tool type an item is, or undefined when it is not a tool. Slots are
 *  generic (any tool fits any slot), so this classifies rather than places:
 *  the UI's one-click stow uses it to prefer a type not already belted. Both
 *  fishing implements resolve to 'fishing': the simple pole (`use.type`
 *  'fishing') and the tiered rods (`gatherTool` + fishing), which is exactly
 *  the pair hasFishingImplement accepts. Note this is deliberately NARROWER
 *  than `kind: 'tool'`, which is a grab bag also covering cosmetic tokens
 *  (skin caches, mech chroma plates, Heroic Marks); those are not tools a
 *  profession uses and never belong on the belt. */
export function toolTypeOf(def: ItemDef | undefined): GatheringProfessionId | undefined {
  const use = def?.use;
  if (!use) return undefined;
  if (use.type === 'fishing') return 'fishing';
  if (use.type === 'gatherTool') return use.professionId;
  return undefined;
}

/** True when the item can be belted at all. */
export function isBeltableTool(def: ItemDef | undefined): boolean {
  return toolTypeOf(def) !== undefined;
}

/** A worn-nothing, stores-nothing belt. The value every fresh character and
 *  every pre-feature save starts from. */
export function emptyToolbelt(): ToolbeltState {
  return { equipped: null, slots: [] };
}

/** True when a belt is worn. Storing/taking is refused without one. */
export function hasToolbelt(state: ToolbeltState | undefined): boolean {
  return !!state?.equipped;
}

/** The belted tools, compacted, in slot order. The order is stable so the
 *  wire shape and the UI both read the same sequence. */
export function storedTools(state: ToolbeltState | undefined): InvSlot[] {
  if (!state) return [];
  const out: InvSlot[] = [];
  for (const slot of state.slots) {
    if (slot) out.push(slot);
  }
  return out;
}

/** The best carried tool a one-click "fill a slot" should stow next, or
 *  undefined when nothing qualifies. Prefers the highest-tier tool of a type
 *  NOT already on the belt (so four clicks belt a pick, axe, sickle, and rod
 *  rather than four picks); ties keep the first carried copy, and the
 *  untiered simple pole loses to any real rod. Pure bag scan. */
export function bestStowCandidate(
  inventory: readonly InvSlot[],
  state: ToolbeltState | undefined,
  items: Readonly<Record<string, ItemDef>>,
): string | undefined {
  const beltedTypes = new Set<GatheringProfessionId>();
  for (const slot of storedTools(state)) {
    const type = toolTypeOf(items[slot.itemId]);
    if (type) beltedTypes.add(type);
  }
  let bestId: string | undefined;
  let bestTier = -1;
  for (const slot of inventory) {
    const def = items[slot.itemId];
    const type = toolTypeOf(def);
    if (type === undefined || beltedTypes.has(type)) continue;
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
 *  id, a stored item that is not a tool, and any tool past the worn belt's
 *  slot count. Stored counts clamp to 1 because a tool never stacks. Items
 *  are never destroyed silently here: `spill` carries every rejected slot
 *  back so the caller can return it to the player's inventory. A legacy
 *  typed-map `slots` object (the pre-rework shape) spills its tools the same
 *  way, so an old save migrates with everything back in the backpack. */
export function sanitizeToolbeltState(raw: unknown): { state: ToolbeltState; spill: InvSlot[] } {
  const state = emptyToolbelt();
  const spill: InvSlot[] = [];
  if (!raw || typeof raw !== 'object') return { state, spill };
  const src = raw as { equipped?: unknown; slots?: unknown };
  const equipped = typeof src.equipped === 'string' ? src.equipped : null;
  state.equipped = equipped && isToolbeltItem(ITEMS[equipped]) ? equipped : null;
  const capacity = beltSlotCount(state);
  state.slots = Array.from({ length: capacity }, () => null);
  const rawSlots = src.slots;
  if (!rawSlots || typeof rawSlots !== 'object') return { state, spill };
  const positional = Array.isArray(rawSlots);
  const entries: unknown[] = positional ? rawSlots : Object.values(rawSlots);
  for (let i = 0; i < entries.length; i++) {
    const slot = entries[i] as Partial<InvSlot> | null;
    if (!slot || typeof slot.itemId !== 'string') continue;
    const kept = cloneInvSlot({ ...(slot as InvSlot), count: 1 });
    // A non-tool, a tool past the belt's slot count, contents with no belt
    // worn, and every legacy typed-map entry are returned to the player
    // rather than kept in an unreachable slot.
    if (!positional || i >= capacity || !isBeltableTool(ITEMS[kept.itemId])) spill.push(kept);
    else state.slots[i] = kept;
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
 *  freed, so the swap itself is net-zero on space. Stored tools carry over
 *  compacted into the new belt's slots; on a swap DOWN the ladder the tools
 *  past the smaller belt's slot count come back to the inventory, and the
 *  whole swap is refused when they would not fit (nothing is force-dropped). */
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
  const capacity = toolSlotCount(def);
  const stored = storedTools(meta.toolbelt);
  const kept = stored.slice(0, capacity);
  const overflow = stored.slice(capacity);
  if (overflow.length > 0) {
    // Only the overflow needs spare room: the new belt leaves the inventory
    // and the old belt returns to it, a net-zero trade probed on a copy.
    const probe = meta.inventory.map(cloneInvSlot);
    takeOneFromInventory(probe, itemId);
    const returning: InvSlot[] = [...(old ? [{ itemId: old, count: 1 }] : []), ...overflow];
    if (!fitsAll(probe, bagCapacity(meta.bags), returning)) {
      ctx.error(meta.entityId, 'You have too many items to swap to that toolbelt.');
      return;
    }
  }
  ctx.removeItem(itemId, 1, meta.entityId);
  if (old) addStacked(meta.inventory, old, 1);
  meta.toolbelt.equipped = itemId;
  meta.toolbelt.slots = [
    ...kept,
    ...Array.from({ length: capacity - kept.length }, (): InvSlot | null => null),
  ];
  for (const slot of overflow) returnToInventory(meta.inventory, slot);
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
  const stored = storedTools(meta.toolbelt);
  meta.toolbelt.equipped = null;
  meta.toolbelt.slots = [];
  for (const slot of stored) returnToInventory(meta.inventory, slot);
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

/** Move a carried tool into the first empty belt slot. Slots are generic, so
 *  any gathering implement goes in any slot; a full belt refuses rather than
 *  swapping (take a tool out first - with generic slots there is no one
 *  obvious victim to displace). */
export function storeToolInBelt(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const def = ITEMS[itemId];
  if (!hasToolbelt(meta.toolbelt)) {
    ctx.error(meta.entityId, 'You are not wearing a toolbelt.');
    return;
  }
  if (!isBeltableTool(def)) {
    ctx.error(meta.entityId, 'Only tools fit in a toolbelt.');
    return;
  }
  const free = meta.toolbelt.slots.indexOf(null);
  if (free === -1) {
    ctx.error(meta.entityId, 'Your toolbelt is full.');
    return;
  }
  const taken = takeOneFromInventory(meta.inventory, itemId);
  if (!taken) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  meta.toolbelt.slots[free] = taken;
  ctx.onInventoryChangedForQuests(meta);
  ctx.emit({
    type: 'log',
    text: `Stowed ${def?.name ?? itemId} in your toolbelt.`,
    color: '#8f8',
    pid: meta.entityId,
  });
}

/** Take the tool out of one belt slot, back into the inventory. Refused when
 *  the backpack is full, so a tool is never destroyed by a full bag. The slot
 *  index comes off the wire, so it is validated here rather than trusted. */
export function takeToolFromBelt(ctx: SimContext, slotIndex: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= meta.toolbelt.slots.length)
    return;
  const slot = meta.toolbelt.slots[slotIndex];
  if (!slot) return;
  if (!canAddItem(meta.inventory, bagCapacity(meta.bags), slot.itemId, slot.count)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return;
  }
  meta.toolbelt.slots[slotIndex] = null;
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
