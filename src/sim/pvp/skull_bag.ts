// The Skull Bag: a SUB-INVENTORY for World PvP trophy skulls, bought from the
// honor quartermasters. The bag itself is one ordinary bag item (it takes one
// cell and is never equipped into a socket); what it holds lives OUTSIDE the
// bag pools, on `PlayerMeta.skullBag`, as one material-source composition (one
// bucket per victim, the same per-unit provenance a carried skull stack keeps:
// world_pvp_trophy.ts). There is no cap: a composition is bounded only by the
// safe-integer range, so a player can keep every skull they ever take.
//
// - Carrying the bag routes a looted skull straight into it (`storeLootedSkulls`,
//   called by the corpse take in interaction.ts and by the spoils settlement in
//   world_pvp_spoils.ts), so a full backpack never leaves a skull on a body.
// - `store` moves every plain skull stack carried in the bags into it (skulls
//   that came by trade, mail or the market, or were taken out earlier). A
//   locked or instanced copy is left where it is.
// - `take` moves an exact selection of buckets back into the bags, all or
//   nothing, behind the ordinary bag-room check.
// - Both commands need the bag in the bags; the contents stay on the character
//   either way, so banking the bag or rebuying it never loses a skull.
//
// It must not import bags.ts (world_pvp_spoils.ts imports this module, and
// bags.ts loads the material tables at import time); the room check is
// `ctx.canAddItem`. Host-agnostic: no DOM, no rng, no wall clock.

import { refusedWhileDead } from '../dead_gate';
import {
  canonicalMaterialComposition,
  legacyMaterialComposition,
  type MaterialComposition,
  type MaterialSourceResult,
  mergeMaterialCompositions,
  takeSelectedMaterialSources,
  totalMaterialCount,
} from '../material_sources';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { InvSlot } from '../types';
import { WORLD_PVP_SKULL_BAG_ITEM_ID, WORLD_PVP_SKULL_ITEM_ID } from './world_pvp_trophy';

export { WORLD_PVP_SKULL_BAG_ITEM_ID };

/** Told when a command needs the bag and none is carried. Matched by the
 *  client (src/ui/sim_i18n.ts `worldPvp.skullBagMissing`). */
export const SKULL_BAG_MISSING_LINE = 'You need a Skull Bag in your bags.';
/** Told when `store` finds no plain skull in the bags (`worldPvp.skullBagNothing`). */
export const SKULL_BAG_NOTHING_LINE = 'You carry no skulls to store.';
/** Told when a looted skull goes straight into the bag (`worldPvp.skullBagStored`). */
export const SKULL_BAG_STORED_LINE = 'The skull goes into your Skull Bag.';
/** Told when `store` moves carried skulls in (`worldPvp.skullBagStoredAll`). A
 *  loot line on purpose: both hosts repaint the bags on one. */
export const SKULL_BAG_STORED_ALL_LINE = 'Your skulls go into your Skull Bag.';

/** True when a Skull Bag sits in the player's bags (the bank does not count). */
export function ownsSkullBag(meta: Pick<PlayerMeta, 'inventory'>): boolean {
  return meta.inventory.some((s) => s.itemId === WORLD_PVP_SKULL_BAG_ITEM_ID && s.count > 0);
}

/** The owner's readout, or undefined for a player with no bag and nothing
 *  stored (so the World PvP self key stays unchanged for everyone else). */
export function skullBagInfoFor(
  meta: Pick<PlayerMeta, 'inventory' | 'skullBag'>,
): import('../../world_api').SkullBagInfo | undefined {
  const owned = ownsSkullBag(meta);
  const stored = meta.skullBag ?? [];
  if (!owned && stored.length === 0) return undefined;
  return {
    owned,
    total: totalMaterialCount(stored),
    sources: stored,
  };
}

/** One carried skull stack's composition: its recorded buckets, or the whole
 *  count as unrecorded stock for a stack that predates the records. */
function slotComposition(slot: InvSlot): MaterialSourceResult<MaterialComposition> {
  return slot.materialSources
    ? canonicalMaterialComposition(slot.materialSources, slot.count)
    : legacyMaterialComposition(slot.count);
}

/**
 * Put freshly looted skulls straight into the looter's bag. Returns false (and
 * changes nothing) for any other item, for a looter without the bag, or for
 * sources that do not describe `count` units, so the caller falls back to the
 * ordinary bag grant.
 */
export function storeLootedSkulls(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  count: number,
  sources: MaterialComposition | undefined,
): boolean {
  if (itemId !== WORLD_PVP_SKULL_ITEM_ID || !ownsSkullBag(meta)) return false;
  const incoming = sources
    ? canonicalMaterialComposition(sources, count)
    : legacyMaterialComposition(count);
  if (!incoming.ok || incoming.value.length === 0) return false;
  const merged = mergeMaterialCompositions(meta.skullBag ?? [], incoming.value);
  if (!merged.ok) return false;
  meta.skullBag = merged.value;
  // The grant hub's discovery mark, which a bag-routed skull never passes
  // through: carrying the bag must not hide the skull from the Book of Deeds.
  ctx.markItemDiscovered(meta, WORLD_PVP_SKULL_ITEM_ID);
  ctx.emit({ type: 'loot', text: SKULL_BAG_STORED_LINE, pid: meta.entityId });
  return true;
}

function storeCarriedSkulls(ctx: SimContext, meta: PlayerMeta): void {
  let stored: MaterialComposition = meta.skullBag ?? [];
  const keep: InvSlot[] = [];
  let moved = 0;
  for (const slot of meta.inventory) {
    // A locked or otherwise instanced copy keeps its own identity in the bags.
    if (slot.itemId !== WORLD_PVP_SKULL_ITEM_ID || slot.instance || slot.count <= 0) {
      keep.push(slot);
      continue;
    }
    const composition = slotComposition(slot);
    const merged = composition.ok ? mergeMaterialCompositions(stored, composition.value) : null;
    if (!merged?.ok) {
      keep.push(slot);
      continue;
    }
    stored = merged.value;
    moved += slot.count;
  }
  if (moved === 0) {
    ctx.error(meta.entityId, SKULL_BAG_NOTHING_LINE);
    return;
  }
  meta.inventory.splice(0, meta.inventory.length, ...keep);
  meta.skullBag = stored;
  ctx.emit({ type: 'loot', text: SKULL_BAG_STORED_ALL_LINE, pid: meta.entityId });
}

/** Reads an untrusted selection into a canonical composition, or null. */
function readSelection(value: unknown): MaterialComposition | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  let total = 0;
  for (const entry of value) {
    const count = (entry as { count?: unknown } | null)?.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return null;
    total += count;
    if (!Number.isSafeInteger(total)) return null;
  }
  const canonical = canonicalMaterialComposition(value, total);
  return canonical.ok ? canonical.value : null;
}

function takeSkulls(ctx: SimContext, meta: PlayerMeta, selection: unknown): void {
  const wanted = readSelection(selection);
  if (!wanted) return;
  const take = takeSelectedMaterialSources(meta.skullBag ?? [], wanted);
  if (!take.ok) return;
  const count = totalMaterialCount(take.value.taken);
  if (!ctx.canAddItem(WORLD_PVP_SKULL_ITEM_ID, count, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return;
  }
  // Grant first, then shrink the bag: a grant that refused (and threw) leaves
  // the skulls where they were. A movement grant: taking your own skulls back
  // out is a relocation, never a fresh acquisition.
  ctx.addItem(WORLD_PVP_SKULL_ITEM_ID, count, meta.entityId, {
    materialSources: take.value.taken,
    movement: true,
  });
  if (take.value.remaining.length > 0) meta.skullBag = take.value.remaining;
  else delete meta.skullBag;
}

/** The one command entry (IWorld `skullBagAction`, wire `skull_bag`). The
 *  action is untrusted here: the server passes the frame through as sent. */
export function skullBagAction(ctx: SimContext, pid: number, action: unknown): void {
  const r = ctx.resolve(pid);
  if (!r || !action || typeof action !== 'object') return;
  const { op, sources } = action as { op?: unknown; sources?: unknown };
  if (op !== 'store' && op !== 'take') return;
  // The bank and vault idiom: the dead move nothing between containers.
  if (refusedWhileDead(ctx, pid)) return;
  if (!ownsSkullBag(r.meta)) {
    ctx.error(r.meta.entityId, SKULL_BAG_MISSING_LINE);
    return;
  }
  if (op === 'store') storeCarriedSkulls(ctx, r.meta);
  else takeSkulls(ctx, r.meta, sources);
}

/** The persisted form: the composition itself, or undefined when empty (so a
 *  save without a bag stays byte-identical). */
export function savedSkullBag(meta: Pick<PlayerMeta, 'skullBag'>): MaterialComposition | undefined {
  const stored = meta.skullBag;
  return stored && stored.length > 0 ? stored : undefined;
}

/** True when a saved bag is absent, empty, or a valid composition. The load
 *  guard (material_slot_load.ts) refuses the whole character otherwise, the
 *  rule every other skull container keeps: bad provenance is never erased. */
export function skullBagLoadValid(saved: unknown): boolean {
  if (saved === undefined || (Array.isArray(saved) && saved.length === 0)) return true;
  return readSelection(saved) !== null;
}

/** Restores the saved composition (validated whole by skullBagLoadValid before
 *  any load coercion runs). */
export function loadSkullBag(meta: Pick<PlayerMeta, 'skullBag'>, saved: unknown): void {
  delete meta.skullBag;
  if (!Array.isArray(saved) || saved.length === 0) return;
  const restored = readSelection(saved);
  if (restored) meta.skullBag = restored;
}
