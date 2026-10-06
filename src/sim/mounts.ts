import { gliderActionsLocked } from './glider_action_lock';
import { shadowActionsLocked } from './shadow_action_lock';
// Ground riding rules, shared by all hosts. Riding training owns speed and
// access; reins only provide a revocable cosmetic appearance. The keybind
// summons a neutral trained mount wearing the selected mount skin.

import { normalizeMountSkinId } from './content/mount_skins';
import {
  DEFAULT_MOUNT,
  MOUNT_KEYS,
  type MountKey,
  mountDef,
  TRAINING_MOUNT_KEY,
} from './content/mounts';
import { ITEMS } from './data';
import { recalcPlayerStats } from './entity';
import { onShipDeck } from './ship_deck_presence';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { bgInMatch } from './social/battleground';
import { DT, type Entity, FORM_AURA_KINDS, isNonSpellCast } from './types';
import { wispMazeActionsLocked } from './wisp_maze_action_lock';
import { hasWorldQuestDeliveryCargo } from './world_quest_delivery';

// Summon channel duration (seconds). Mounting is a short cast the player can
// interrupt by moving into combat or water. Dismounting has NO channel: it is
// instant from every path (forceDismount), so there is no matching constant.
export const MOUNT_SUMMON_SECONDS = 1.5;

// Cosmetic ownership re-validation cadence. Online reads the host's bounded
// account projection; offline scans the acting character's bags and bank.
// Tick/entity staggering is deterministic and draws no rng.
export const MOUNT_OWNERSHIP_REVALIDATE_TICKS = 4;

// The reins itemId per catalog mount, derived once from the merged ITEMS table
// (single source: the item record declares `mount`, nothing re-lists the map).
// Static content, so the lazy module-level cache is multi-Sim safe.
let mountItemIds: Map<string, string> | null = null;

/** The collectible item that owns `key` (null for an unknown key, or a catalog
 *  mount with no reins item). Every catalog mount now has one, the horse
 *  included (reins_valorsteed). */
export function mountItemId(key: string): string | null {
  if (!mountItemIds) {
    mountItemIds = new Map();
    for (const def of Object.values(ITEMS)) {
      if (def.kind === 'mount') mountItemIds.set(def.mount, def.id);
    }
  }
  return mountItemIds.get(key) ?? null;
}

/** Whether the player owns the mount: any catalog mount (the horse included)
 *  while its reins item sits in bags or bank. Reins are not soulbound, so
 *  ownership travels with the item (a traded-away reins is a lost mount, and
 *  a summon channel re-validates ownership at completion). Unknown keys are
 *  never owned. A fresh player owns nothing. */
export function mountOwned(meta: PlayerMeta, key: string): boolean {
  if (!mountDef(key)) return false;
  if (meta.accountMountSkinIds !== undefined) return meta.accountMountSkinIds.includes(key);
  const itemId = mountItemId(key);
  if (!itemId) return false;
  return (
    meta.inventory.some((s) => s.itemId === itemId) ||
    meta.bank.inventory.some((s) => s.itemId === itemId)
  );
}

/** The catalog subset present in `slots`, in catalog order. Shared by
 *  `ownedMounts` (bags + bank) and `bagOwnedMounts` (bags only, #2739
 *  followup): a single pass collecting reins itemIds into mount keys. */
function collectMountKeys(slots: readonly { itemId: string }[]): MountKey[] {
  const owned = new Set<string>();
  for (const s of slots) {
    const def = ITEMS[s.itemId];
    if (def?.kind === 'mount') owned.add(def.mount);
  }
  return MOUNT_KEYS.filter((key) => owned.has(key));
}

/** Online uses the host's authoritative account item projection. Offline
 * derives ownership from the acting character's bags and bank. */
export function ownedMounts(meta: PlayerMeta): MountKey[] {
  if (meta.accountMountSkinIds !== undefined) {
    return MOUNT_KEYS.filter((key) => meta.accountMountSkinIds!.includes(key));
  }
  return collectMountKeys([...meta.inventory, ...meta.bank.inventory]);
}

/** Local bag-only reins subset, retained for item-based consumers. */
export function bagOwnedMounts(inventory: readonly { itemId: string }[]): MountKey[] {
  return collectMountKeys(inventory);
}

// Recompute the player's derived stats after a mount state change (aura strips,
// mount/dismount): this is the same path an equip change takes.
function recalcFor(ctx: SimContext, e: Entity, meta: PlayerMeta): void {
  recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
}

/** The riding lesson lets the player ride the training Valorsteed before they own
 *  it: the ONE place an unowned mount is allowed to summon and apply. True only
 *  while a lesson is IN_PROGRESS and the target is the training steed
 *  (src/sim/mounts_training.ts). */
function trainingSummon(meta: PlayerMeta | undefined, key: string): boolean {
  return key === TRAINING_MOUNT_KEY && meta?.mountTraining?.state === 'IN_PROGRESS';
}

/** Force an instant dismount with no put-away channel: clears the live mount and
 *  any in-flight summon/dismount channel, then recomputes stats. Used by the riding
 *  lesson to take the unowned training steed back the moment the lesson ends, and by
 *  the auto-attack loop and cast path to dismount on ability use. */
export function forceDismount(ctx: SimContext, e: Entity): void {
  if (!e.mountKey && (e.mountCastRemaining ?? 0) <= 0 && e.mountCastKey === '') return;
  e.mountKey = '';
  e.mountCastRemaining = 0;
  e.mountCastKey = '';
  const meta = ctx.players.get(e.id);
  if (meta) recalcFor(ctx, e, meta);
}

/** Put an active riding-lesson player straight onto the training Valorsteed.
 *  Used by the start-platform flow, which replaces the old Marla button and
 *  therefore needs the race click to lend the lesson mount immediately. */
export function forceTrainingMount(ctx: SimContext, e: Entity): boolean {
  const meta = ctx.players.get(e.id);
  if (meta?.mountTraining?.state !== 'IN_PROGRESS') return false;
  // Defense in depth for the whole-match ban: the race start platform is in the
  // open world and a seated fighter cannot stand on it, but this is the one
  // path that APPLIES a mount with no summon channel to gate, so it asks too.
  // Silent (no toast): the caller is unreachable from inside a match, so a
  // refusal line here would be text no player can ever see.
  if (bgInMatch(ctx, e.id)) return false;
  if (hasWorldQuestDeliveryCargo(e)) return false;
  e.mountKey = TRAINING_MOUNT_KEY;
  e.mountCastRemaining = 0;
  e.mountCastKey = '';
  recalcFor(ctx, e, meta);
  return true;
}

// Thornhollow Fields is fought on foot, start to finish. This replaced the
// narrower "while carrying the flag" refusal: one rule for the whole match is
// what a player can actually learn, and the carrier case is a subset of it.
const IN_BATTLEGROUND_MSG = "You can't ride in a battleground.";
// Scheduled ships are ridden on foot: no mount is summoned (or swapped) on a
// ship's deck, moored or under way, and a rider who boards on horseback is
// dismounted as it casts off (transport_ferry.ts). A mount on a moving deck
// would jump its rails (the mounted jump clears them).
const ABOARD_SHIP_MSG = "You can't mount while aboard a ship.";
const RIDING_UNTRAINED_MSG = 'You must learn to ride first. Find a riding trainer.';
const CARRYING_FREIGHT_MSG = "You can't ride while carrying freight.";

/** Strip all active form auras (FORM_AURA_KINDS), ghost_wolf, and stealth from the
 *  entity, emitting aura-removal events for each one removed. Called before a mount
 *  summon starts so the player is never simultaneously shapeshifted/stealthed and
 *  mounting. Stealth is routed through the single `ctx.breakStealth` funnel (not
 *  spliced inline like the forms) until no stealth aura remains, so each aura's
 *  linger/aftereffect side effects fire exactly as they do for every other way
 *  stealth ends. Without this, a stealthed rider keeps the aura's shrunk detection
 *  radius while moving at full mount speed: invisible AND fast, the "stealth horse"
 *  duel exploit. Calls recalcFor if any aura was removed so stat effects (speed,
 *  etc.) clear immediately. */
function cancelFormsAndGhostWolf(ctx: SimContext, e: Entity): void {
  let stripped = false;
  for (let i = e.auras.length - 1; i >= 0; i--) {
    const aura = e.auras[i];
    if (FORM_AURA_KINDS.has(aura.kind) || aura.id === 'ghost_wolf') {
      e.auras.splice(i, 1);
      ctx.emit({
        type: 'aura',
        targetId: e.id,
        name: aura.name,
        gained: false,
      });
      stripped = true;
    }
  }
  while (e.auras.some((a) => a.kind === 'stealth')) {
    ctx.breakStealth(e);
    stripped = true;
  }
  if (stripped) {
    const meta = ctx.players.get(e.id);
    if (meta) recalcFor(ctx, e, meta);
  }
}

/** Summon a SPECIFIC mount, the way a WoW reins item works: the player clicks the
 *  item (bags or an action-bar slot) and rides that mount, with no "selected
 *  mount" concept in between. Routed here from items.ts useItem.
 *
 *  Gate order matters and mirrors the old toggle path exactly:
 *    1. riding skill  (the ONE gate that must never be bypassable: the item is in
 *       your bags, so without this check owning reins would imply riding them)
 *    2. ownership     (re-checked server-side even though the click proves it)
 *    3. in a battleground, then dead/ghost, then combat
 *
 *  The battleground gate sits ABOVE dead/ghost and combat deliberately: it is a
 *  standing rule for the whole match, not a transient state, so it is the one
 *  that should speak. A downed or in-combat fighter pressing their reins would
 *  otherwise be told the momentary reason and try again a second later.
 *
 *  Already riding something else: swap INSTANTLY, no dismount channel and no new
 *  summon channel. Clicking the reins you are already riding dismounts. */
/** Wear (skinId) or take off (null) a mount SKIN (content/mount_skins.ts) on a
 *  player: the persisted meta field plus the entity mirror the identity wire
 *  (`msk`) reads. Cosmetic only: the ridden mount keeps its own key, so speed,
 *  the melee block and crit are untouched. The account-ownership gate is the
 *  caller's (the server's session cosmetics; Sim.changeMountSkin offline).
 *  An id outside the catalog is refused. */
export function setMountSkin(ctx: SimContext, pid: number, skinId: string | null): boolean {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || e?.kind !== 'player') return false;
  const next = skinId === null ? null : normalizeMountSkinId(skinId);
  if (skinId !== null && next === null) return false;
  meta.mountSkinId = next;
  e.mountSkinId = next;
  if (next === null && e.mountKey) e.mountKey = DEFAULT_MOUNT;
  if (next === null && e.mountCastKey) e.mountCastKey = DEFAULT_MOUNT;
  return true;
}

export function summonMountItem(ctx: SimContext, pid: number, key: string): boolean {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e) return false;
  if (
    wispMazeActionsLocked(meta.worldQuestLog) ||
    shadowActionsLocked(meta.worldQuestLog) ||
    gliderActionsLocked(meta.worldQuestLog)
  )
    return false;
  const def = mountDef(key);
  if (!def) return false;
  // Clicking the reins you are currently riding puts the mount away.
  if (e.mountKey && (e.mountSkinId ?? e.mountKey) === def.key) {
    forceDismount(ctx, e);
    return true;
  }
  // A summon already in flight swallows the click, matching toggleMount.
  if ((e.mountCastRemaining ?? 0) > 0) return false;
  if (!meta.ridingTrained && !trainingSummon(meta, def.key)) {
    ctx.error(pid, RIDING_UNTRAINED_MSG);
    return false;
  }
  if (!mountOwned(meta, def.key) && !trainingSummon(meta, def.key)) {
    // Reuses the registered useItem deny (sim_i18n error.noItem) rather than
    // minting a new sim string.
    ctx.error(pid, "You don't have that item.");
    return false;
  }
  // Thornhollow Fields is fought on foot for the WHOLE match (form-up, active
  // play, and the post-match hold), not just while carrying. Seating a fighter
  // already force-dismounts them (social/battleground.ts placeInBg); this is
  // the other half of the same rule, and it also covers the mount-to-mount
  // swap below, which is not a summon and would otherwise slip past every gate.
  if (bgInMatch(ctx, pid)) {
    ctx.error(pid, IN_BATTLEGROUND_MSG);
    return false;
  }
  if (hasWorldQuestDeliveryCargo(e)) {
    ctx.error(pid, CARRYING_FREIGHT_MSG);
    return false;
  }
  if (e.dead || e.ghost) return false;
  if (e.inCombat) {
    ctx.error(pid, "You can't do that while in combat.");
    return false;
  }
  if (onShipDeck(ctx, e)) {
    ctx.error(pid, ABOARD_SHIP_MSG);
    return false;
  }
  if (isNonSpellCast(e.castingAbility)) {
    ctx.error(pid, 'You are busy.');
    return false;
  }
  setMountSkin(ctx, pid, def.key);
  // Swapping between mounts is instant: the player is already mounted, so there
  // is nothing to summon, only a model to change.
  if (e.mountKey) {
    e.mountKey = def.key;
    e.mountCastRemaining = 0;
    e.mountCastKey = '';
    recalcFor(ctx, e, meta);
    return true;
  }
  cancelFormsAndGhostWolf(ctx, e);
  e.mountCastRemaining = MOUNT_SUMMON_SECONDS;
  e.mountCastKey = def.key;
  return true;
}

/** Summon the trained ride with the selected cosmetic, or dismount instantly.
 * The riding lesson lends the same neutral mount before training is complete. */
export function toggleMount(ctx: SimContext, pid: number): boolean {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e) return false;
  if (
    wispMazeActionsLocked(meta.worldQuestLog) ||
    shadowActionsLocked(meta.worldQuestLog) ||
    gliderActionsLocked(meta.worldQuestLog)
  )
    return false;
  // A toggle while a summon/dismount is already channeling is ignored.
  if ((e.mountCastRemaining ?? 0) > 0) return false;
  if (e.mountKey) {
    // Dismounting is instant and never gated. There is no put-away channel: a
    // mount is a convenience, and making the player wait to get OFF one only ever
    // cost them a reaction.
    forceDismount(ctx, e);
    return true;
  }
  // Riding skill gate: the player must have purchased riding from Marla before
  // they can summon any mount. The training lesson is the one exception (it teaches
  // the skill via the quest and lends the Valorsteed during the lesson itself).
  if (!meta.ridingTrained && meta.mountTraining?.state !== 'IN_PROGRESS') {
    ctx.error(pid, RIDING_UNTRAINED_MSG);
    return false;
  }
  if (bgInMatch(ctx, pid)) {
    ctx.error(pid, IN_BATTLEGROUND_MSG);
    return false;
  }
  if (hasWorldQuestDeliveryCargo(e)) {
    ctx.error(pid, CARRYING_FREIGHT_MSG);
    return false;
  }
  if (e.dead || e.ghost) return false;
  if (e.inCombat) {
    ctx.error(pid, "You can't do that while in combat.");
    return false;
  }
  if (onShipDeck(ctx, e)) {
    ctx.error(pid, ABOARD_SHIP_MSG);
    return false;
  }
  if (isNonSpellCast(e.castingAbility)) {
    ctx.error(pid, 'You are busy.');
    return false;
  }
  cancelFormsAndGhostWolf(ctx, e);
  e.mountCastRemaining = MOUNT_SUMMON_SECONDS;
  e.mountCastKey = DEFAULT_MOUNT;
  return true;
}

/** Advance the summon channel and revoke unavailable collectible appearances.
 * Water dismounts instantly; combat/water cancel a summon. Riding access and
 * speed remain trained character state when a collectible item disappears. */
export function updateMountTransition(ctx: SimContext, e: Entity, swimming: boolean): void {
  const meta = ctx.players.get(e.id);
  // (a) Water force-dismounts instantly: no ground mount swims. Also clears any
  // in-flight channel so a re-mount starts clean once back on land.
  if (swimming && e.mountKey) {
    e.mountKey = '';
    e.mountCastRemaining = 0;
    e.mountCastKey = '';
    if (meta) recalcFor(ctx, e, meta);
    return;
  }
  // Only the cosmetic follows the item. Losing reins never removes training
  // or dismounts a character; the neutral trained ride remains available.
  if (
    meta &&
    e.mountSkinId &&
    mountDef(e.mountSkinId) &&
    ctx.tickCount % MOUNT_OWNERSHIP_REVALIDATE_TICKS === e.id % MOUNT_OWNERSHIP_REVALIDATE_TICKS &&
    !mountOwned(meta, e.mountSkinId)
  ) {
    setMountSkin(ctx, e.id, null);
  }
  // (b) Advance an in-flight summon/dismount channel.
  if ((e.mountCastRemaining ?? 0) > 0) {
    // A summon (mountCastKey names a mount) cancels on entering combat or water,
    // with no error toast. A dismount (mountCastKey === '') always proceeds.
    if (e.mountCastKey !== '' && (e.inCombat || swimming)) {
      e.mountCastRemaining = 0;
      e.mountCastKey = '';
      return;
    }
    e.mountCastRemaining -= DT;
    if (e.mountCastRemaining <= 0) {
      const target = e.mountCastKey;
      if (target === '') {
        e.mountKey = '';
      } else if (
        mountDef(target) &&
        meta &&
        (meta.ridingTrained || trainingSummon(meta, target)) &&
        // a channel that ends on a ship's deck lapses (the summon was refused
        // aboard; this covers one finished standing on the gangway's lip)
        !onShipDeck(ctx, e)
      ) {
        // Strip any form that slipped through during the channel (e.g. instant
        // shapeshifts cast while channeling), so the player is never
        // simultaneously mounted and shapeshifted at completion.
        cancelFormsAndGhostWolf(ctx, e);
        if (e.mountSkinId && mountDef(e.mountSkinId) && !mountOwned(meta, e.mountSkinId)) {
          setMountSkin(ctx, e.id, null);
        }
        e.mountKey = e.mountSkinId ? target : DEFAULT_MOUNT;
      }
      // A summon whose reins vanished mid-channel leaves the player unmounted.
      e.mountCastRemaining = 0;
      e.mountCastKey = '';
      if (meta) recalcFor(ctx, e, meta);
    }
  }
}
