// Cosmetic buddies: collection + summon/dismiss, a sibling sim system behind
// the SimContext seam (module-first; sim.ts keeps thin delegates).
//
// Collection model mirrors ground mounts (src/sim/mounts.ts): every catalog
// buddy is owned while its summon-whistle item (ItemDef kind 'buddy') sits in
// the player's bags or bank. Whistles are NOT soulbound: ownership travels
// with the item, so a buddy can be traded, mailed, or listed away.
//
// Unlike a mount, a buddy has ZERO gameplay effect: no stat recompute, no
// summon channel, no combat/water/battleground gate, no riding-skill gate. It
// IS, since 2026-08-27, a real server-simulated owned mob entity
// (src/sim/content/buddy_mobs.ts's MobTemplate, heeled by
// src/sim/pet/buddy_ai.ts's updateBuddyMob using the exact same A*-pathed
// locomotion as a hunter pet); every summon/dismiss/re-summon below spawns
// or despawns that entity alongside the Entity.buddyKey flip. buddyKey
// ('' = none) stays the source of truth for "which buddy is out" (the wire
// mirrors it like `skin`/`mountKey`, and updateBuddyMob's own safety net
// reads it back to confirm a live buddy entity is still wanted); the entity
// itself is just its physical, positioned, replicated body.
//
// `src/sim`-pure and rng-free.

import { BUDDY_KEYS, type BuddyKey, buddyDef } from './content/buddies';
import { ITEMS } from './data';
import { despawnBuddyEntity, spawnBuddyEntity } from './pet/buddy_ai';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';

// The whistle itemId per catalog buddy, derived once from the merged ITEMS
// table (single source: the item record declares `buddy`, nothing re-lists
// the map). Static content, so the lazy module-level cache is multi-Sim safe.
let buddyItemIds: Map<string, string> | null = null;

/** The collectible item that owns `key` (null for an unknown key, or a
 *  catalog buddy with no whistle item). */
export function buddyItemId(key: string): string | null {
  if (!buddyItemIds) {
    buddyItemIds = new Map();
    for (const def of Object.values(ITEMS)) {
      if (def.kind === 'buddy') buddyItemIds.set(def.buddy, def.id);
    }
  }
  return buddyItemIds.get(key) ?? null;
}

/** Whether the player owns the buddy: its whistle sits in bags or bank.
 *  Unknown keys are never owned. A fresh player owns nothing. */
export function buddyOwned(meta: PlayerMeta, key: string): boolean {
  if (!buddyDef(key)) return false;
  const itemId = buddyItemId(key);
  if (!itemId) return false;
  return (
    meta.inventory.some((s) => s.itemId === itemId) ||
    meta.bank.inventory.some((s) => s.itemId === itemId)
  );
}

/** The owned subset of the catalog, in catalog order (bags + bank). Empty for
 *  a fresh player. Single pass over both containers. */
export function ownedBuddies(meta: PlayerMeta): BuddyKey[] {
  const owned = new Set<string>();
  for (const s of [...meta.inventory, ...meta.bank.inventory]) {
    const def = ITEMS[s.itemId];
    if (def?.kind === 'buddy') owned.add(def.buddy);
  }
  return BUDDY_KEYS.filter((key) => owned.has(key));
}

/** Summon (or dismiss) a SPECIFIC buddy, the way a whistle item works: the
 *  player clicks the item (bags or an action-bar slot) and that buddy starts
 *  following, with no "selected buddy" concept in between. Routed here from
 *  items.ts useItem. Clicking the whistle for the buddy already out puts it
 *  away. Instant: no channel, no gate beyond ownership (re-checked
 *  server-side even though the click proves it). */
export function summonBuddyItem(ctx: SimContext, pid: number, key: string): boolean {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e) return false;
  const def = buddyDef(key);
  if (!def) return false;
  if (e.buddyKey === def.key) {
    e.buddyKey = '';
    despawnBuddyEntity(ctx, pid);
    return true;
  }
  if (!buddyOwned(meta, def.key)) {
    ctx.error(pid, "You don't have that item.");
    return false;
  }
  e.buddyKey = def.key;
  spawnBuddyEntity(ctx, e, def.key);
  return true;
}

/** Dismiss-only toggle for a keybind/button with no item in hand. Does
 *  nothing when no buddy is active: there is deliberately no "selected
 *  buddy" to summon from a bare toggle, same rule as toggleMount. */
export function toggleBuddy(ctx: SimContext, pid: number): boolean {
  const e = ctx.entities.get(pid);
  if (!e?.buddyKey) return false;
  e.buddyKey = '';
  despawnBuddyEntity(ctx, pid);
  return true;
}

/** Enable/disable the autoloot errand for whatever buddy this player has out
 *  (src/sim/pet/buddy_autoloot.ts does the work each tick). A PREFERENCE, not
 *  a buddy command: it is settable with no buddy out and survives a
 *  dismiss/re-summon, so a player who puts a buddy away and whistles a
 *  different one does not have to re-arm it. Session state either way, like
 *  buddyKey itself: nothing here is persisted. */
export function setBuddyAutoloot(ctx: SimContext, pid: number, enabled: boolean): boolean {
  const e = ctx.entities.get(pid);
  if (!e) return false;
  e.buddyAutoloot = enabled;
  return true;
}
