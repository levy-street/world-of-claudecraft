// Buddy ownership mirror and character-local summon/dismiss.
// Online hosts hydrate account ownership into PlayerMeta.buddies.owned and
// persist new grant callbacks. Offline worlds keep their own character state.
// Raid wins stay pending on the winning character until the normal reveal.
// Honor vendors grant directly; historical soulbound tokens remain usable.
//
// A buddy IS a real server-simulated owned mob entity (content/buddy_mobs.ts's
// MobTemplate, heeled by pet/buddy_ai.ts's updateBuddyMob using the same
// A*-pathed locomotion as a hunter pet); every summon/dismiss below spawns or
// despawns that entity alongside the Entity.buddyKey flip. buddyKey ('' =
// none) stays the source of truth for "which buddy is out" (the wire mirrors
// it like `skin`/`mountKey`); the entity is its positioned, replicated body.
//
// `src/sim`-pure and rng-free.

import { type BuddyNames, normalizeBuddyNames } from './buddy_names';
import { BUDDY_KEYS, type BuddyKey, buddyDef, normalizeBuddyKey } from './content/buddies';
import { ITEMS } from './data';
import { despawnBuddyEntity, spawnBuddyEntity } from './pet/buddy_ai';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';

/** A companion won off a boss that has not shown itself yet: the player read
 *  the presence line, the buddy reveals on the zone-out (instance) or once
 *  the player walks BUDDY_WORLD_REVEAL_DISTANCE from the kill (world). */
export interface PendingBuddy {
  key: BuddyKey;
  source: 'instance' | 'world';
  /** Kill position, the anchor for the world-source distance test. */
  x: number;
  z: number;
}

export interface BuddyCollection {
  names: BuddyNames;
  owned: Set<BuddyKey>;
  pending: PendingBuddy[];
  /** The companion the bare toggle keybind brings back out: the last one
   *  summoned. '' until the first summon. */
  last: BuddyKey | '';
}

/** The persisted shape (character_state.ts). Absent while the collection is
 *  empty, so pre-buddy saves stay byte-equal. */
export interface SavedBuddyCollection {
  names?: Record<string, string>;
  owned?: string[];
  /** Legacy save fields, accepted on input and discarded on restore. */
  cosmetics?: string[];
  equipped?: Record<string, string>;
  pending?: { key: string; source: string; x?: number; z?: number }[];
  last?: string;
}

export function freshBuddyCollection(): BuddyCollection {
  return { owned: new Set(), pending: [], last: '', names: {} };
}

/** Restore a saved collection through the catalog: a key or cosmetic a
 *  content change removed loads as absent rather than as a dangling id. */
export function restoreBuddyCollection(saved: SavedBuddyCollection | undefined): BuddyCollection {
  const out = freshBuddyCollection();
  if (!saved) return out;
  out.names = normalizeBuddyNames(saved.names);
  for (const key of saved.owned ?? []) {
    const norm = normalizeBuddyKey(typeof key === 'string' ? key : '');
    if (norm) out.owned.add(norm);
  }
  for (const p of saved.pending ?? []) {
    const norm = normalizeBuddyKey(typeof p?.key === 'string' ? p.key : '');
    if (!norm || out.owned.has(norm)) continue;
    if (out.pending.some((q) => q.key === norm)) continue;
    out.pending.push({
      key: norm,
      source: p.source === 'world' ? 'world' : 'instance',
      x: typeof p.x === 'number' && Number.isFinite(p.x) ? p.x : 0,
      z: typeof p.z === 'number' && Number.isFinite(p.z) ? p.z : 0,
    });
  }
  const last = normalizeBuddyKey(saved.last);
  out.last = last && out.owned.has(last) ? last : '';
  return out;
}

/** The save-side shape, or null while nothing is collected (zero-default
 *  omission: the caller leaves the key out). */
export function serializeBuddyCollection(c: BuddyCollection): SavedBuddyCollection | null {
  const names = normalizeBuddyNames(c.names);
  const hasNames = Object.keys(names).length > 0;
  if (c.owned.size === 0 && c.pending.length === 0 && c.last === '' && !hasNames) return null;
  return {
    ...(c.owned.size > 0 ? { owned: BUDDY_KEYS.filter((k) => c.owned.has(k)) } : {}),
    ...(c.pending.length > 0 ? { pending: c.pending.map((p) => ({ ...p })) } : {}),
    ...(c.last !== '' ? { last: c.last } : {}),
    ...(hasNames ? { names } : {}),
  };
}

// The whistle itemId per catalog buddy, derived once from the merged ITEMS
// table (single source: the item record declares `buddy`, nothing re-lists
// the map). Static content, so the lazy module-level cache is multi-Sim safe.
let buddyItemIds: Map<string, string> | null = null;

/** The grant-token item for `key` (null for an unknown key, or a catalog
 *  buddy with no whistle). Used by the admin/mail/vendor channels and the
 *  Hunting pane's vendor line, never by ownership. */
export function buddyItemId(key: string): string | null {
  if (!buddyDef(key)) return null;
  if (!buddyItemIds) {
    buddyItemIds = new Map();
    for (const def of Object.values(ITEMS)) {
      if (def.kind === 'buddy') buddyItemIds.set(def.buddy, def.id);
    }
  }
  return buddyItemIds.get(key) ?? null;
}

/** Whether the player has collected the buddy. Unknown keys are never owned.
 *  A fresh player owns nothing. */
export function buddyOwned(meta: PlayerMeta, key: string): boolean {
  if (!buddyDef(key)) return false;
  return meta.buddies.owned.has(key as BuddyKey);
}

/** Apply account entitlements without changing this character's equipped buddy.
 * The host publishes only committed ownership; pending wins stay character-local. */
export function syncBuddyOwnership(ctx: SimContext, pid: number, keys: readonly string[]): boolean {
  const meta = ctx.players.get(pid);
  if (!meta) return false;
  let changed = false;
  for (const key of keys) {
    const normalized = normalizeBuddyKey(key);
    if (!normalized || meta.buddies.owned.has(normalized)) continue;
    meta.buddies.owned.add(normalized);
    changed = true;
  }
  const pending = meta.buddies.pending.filter((p) => !meta.buddies.owned.has(p.key));
  if (pending.length !== meta.buddies.pending.length) {
    meta.buddies.pending = pending;
    changed = true;
  }
  if (changed) meta.wireRev++;
  return changed;
}

/** The owned subset of the catalog, in catalog order. */
export function ownedBuddies(meta: PlayerMeta): BuddyKey[] {
  return BUDDY_KEYS.filter((key) => meta.buddies.owned.has(key));
}

/** The pending (won, unrevealed) companions, catalog order. */
export function pendingBuddies(meta: PlayerMeta): BuddyKey[] {
  return meta.buddies.pending.map((p) => p.key);
}

function spawnFor(ctx: SimContext, meta: PlayerMeta, e: { id: number }, key: BuddyKey): void {
  const owner = ctx.entities.get(e.id);
  if (!owner) return;
  owner.buddyKey = key;
  meta.buddies.last = key;
  spawnBuddyEntity(ctx, owner, key);
}

/** Attach `key` to the character outright: owned, announced (buddyRevealed)
 *  and summoned. Idempotent: an owned buddy is a no-op that returns false, so
 *  a deed retro-grant on login or a duplicate token cannot re-announce. Any
 *  pending entry for the same buddy is consumed by the grant. */
export function grantBuddy(ctx: SimContext, pid: number, key: string): boolean {
  const meta = ctx.players.get(pid);
  const def = buddyDef(key);
  if (!meta || !def) return false;
  if (meta.buddies.owned.has(def.key)) return false;
  meta.buddies.owned.add(def.key);
  meta.buddies.pending = meta.buddies.pending.filter((p) => p.key !== def.key);
  meta.wireRev++;
  ctx.emit({ type: 'buddyRevealed', pid, key: def.key });
  const e = ctx.entities.get(pid);
  if (e && !e.dead) spawnFor(ctx, meta, e, def.key);
  ctx.onBuddyGranted?.(pid, def.key);
  return true;
}

/** Record a boss-roll win as a pending companion and tell the player something
 *  is watching them (buddyPresence). Owned or already-pending keys return
 *  false: the presence line never repeats for a companion the player has. */
export function attachPendingBuddy(
  ctx: SimContext,
  pid: number,
  key: string,
  source: PendingBuddy['source'],
  at: { x: number; z: number },
): boolean {
  const meta = ctx.players.get(pid);
  const def = buddyDef(key);
  if (!meta || !def) return false;
  if (meta.buddies.owned.has(def.key)) return false;
  if (meta.buddies.pending.some((p) => p.key === def.key)) return false;
  meta.buddies.pending.push({ key: def.key, source, x: at.x, z: at.z });
  meta.wireRev++;
  ctx.emit({ type: 'buddyPresence', pid, key: def.key });
  return true;
}

/** Reveal every pending companion whose condition `ready` accepts: each one
 *  becomes owned and announced; the LAST revealed is the one summoned (a
 *  player who won two at once still has one follower out). */
export function revealPendingBuddies(
  ctx: SimContext,
  pid: number,
  ready: (p: PendingBuddy) => boolean = () => true,
): BuddyKey[] {
  const meta = ctx.players.get(pid);
  if (!meta || meta.buddies.pending.length === 0) return [];
  const revealed: BuddyKey[] = [];
  const keep: PendingBuddy[] = [];
  for (const p of meta.buddies.pending) {
    if (!ready(p)) {
      keep.push(p);
      continue;
    }
    revealed.push(p.key);
  }
  if (revealed.length === 0) return [];
  meta.buddies.pending = keep;
  for (const key of revealed) grantBuddy(ctx, pid, key);
  return revealed;
}

/** Summon a SPECIFIC owned buddy, or put it away when it is the one out.
 *  Instant: no channel, no gate beyond ownership (re-checked server-side even
 *  when a click proves it). Routed here from the Cosmetics buddy command and
 *  from the grant token's use. */
export function summonBuddy(ctx: SimContext, pid: number, key: string): boolean {
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
    ctx.error(pid, "You haven't collected that companion.");
    return false;
  }
  spawnFor(ctx, meta, e, def.key);
  return true;
}

/** Use a grant token (a whistle item): attach the companion and consume the
 *  token. A token for a companion the player already has is REFUSED without
 *  being consumed, so a duplicate stays a duplicate rather than vanishing. */
export function useBuddyToken(ctx: SimContext, pid: number, itemId: string): boolean {
  const meta = ctx.players.get(pid);
  const item = ITEMS[itemId];
  if (!meta || !item || item.kind !== 'buddy') return false;
  const def = buddyDef(item.buddy);
  if (!def) return false;
  if (meta.buddies.owned.has(def.key)) {
    ctx.error(pid, 'You already have that companion.');
    return false;
  }
  ctx.removeItem(itemId, 1, pid);
  return grantBuddy(ctx, pid, item.buddy);
}

/** The bare keybind/button toggle: dismiss the active buddy, or bring the last
 *  summoned one back out when none is. */
export function toggleBuddy(ctx: SimContext, pid: number): boolean {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e) return false;
  if (e.buddyKey) {
    e.buddyKey = '';
    despawnBuddyEntity(ctx, pid);
    return true;
  }
  const last = meta.buddies.last;
  if (!last || !meta.buddies.owned.has(last)) return false;
  spawnFor(ctx, meta, e, last);
  return true;
}

/** Enable/disable the autoloot errand for whatever buddy this player has out
 *  (src/sim/pet/buddy_autoloot.ts does the work each tick). A PREFERENCE, not
 *  a buddy command: it is settable with no buddy out and survives a
 *  dismiss/re-summon. Session state, like buddyKey itself. */
export function setBuddyAutoloot(ctx: SimContext, pid: number, enabled: boolean): boolean {
  const e = ctx.entities.get(pid);
  if (!e) return false;
  e.buddyAutoloot = enabled;
  return true;
}
