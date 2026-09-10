// Buddy autoloot: the errand a cosmetic buddy runs instead of heeling while
// its owner has the toggle on (Entity.buddyAutoloot, flipped from the buddy's
// own target-frame right-click menu). The buddy walks to the owner's OWN
// lootable corpses within BUDDY_LOOT_RANGE of the OWNER and loots them into
// the owner's bags, then goes back to its heel offset.
//
// Three rules the owner asked for, and one this file adds so the errand can
// never strand the buddy:
//  - Range is measured from the OWNER, not from the buddy, so the buddy never
//    wanders off the leash chasing a corpse the owner has already left behind:
//    the moment the owner walks past BUDDY_LOOT_RANGE of a corpse, that corpse
//    stops being a candidate and the buddy heels home.
//  - "Only corpses that belong to the player": corpseIsOwners below accepts a
//    corpse the OWNER THEMSELVES tapped, or one holding a personal drop
//    reserved for them. Deliberately NARROWER than the walk-by autoloot path
//    (interaction.ts autoLootForParty, which also takes a party-mate's tap and
//    untapped corpses): a buddy visibly walking over and picking a corpse
//    clean reads as stealing in a way a proximity pickup does not, so it only
//    ever touches loot that is unambiguously its owner's. FFA never applies.
//  - The loot lands on the OWNER (their bags, their money, their quest
//    credit); the buddy is only the pair of legs. It carries nothing.
//  - A corpse the owner cannot actually take anything from right now (bags
//    full for every item on it) is not a candidate at all, so a full-bagged
//    player's buddy heels normally instead of standing over a corpse it can
//    never finish.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports (enforced by
// tests/architecture.test.ts).

import { isInRaidInstance } from '../instances/dungeons';
import { lootCorpse } from '../interaction';
import { lootSlotVisibleTo } from '../loot/loot_roll';
import { corpseHasDecayed } from '../respawn_policy';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, INTERACT_RANGE } from '../types';
import { petFollow } from './pet_ai';

/** How far from the OWNER a corpse may be and still be worth the errand
 *  (yards; the 2026-09-08 owner request). Not measured from the buddy: see
 *  the header. */
export const BUDDY_LOOT_RANGE = 30;

/** Whether `mob` is a corpse this exact player owns the loot on: their own
 *  tap, or a personal drop reserved for them. A party-mate's tap, an untapped
 *  corpse and an aged-out FFA corpse are all deliberately excluded. */
export function corpseIsOwners(mob: Entity, ownerId: number): boolean {
  if (!mob.lootable || !mob.loot || corpseHasDecayed(mob.dead, mob.corpseTimer)) return false;
  if (mob.tappedById === ownerId) return true;
  return mob.loot.items.some((s) => s.personalFor?.includes(ownerId));
}

/** Whether the owner could take at least one thing off this corpse right now.
 *  Copper always fits; an item only counts when it is visible to the owner
 *  AND their bags have room for it, so a full-bagged owner's buddy never
 *  starts an errand it cannot finish (and never re-picks the same corpse on
 *  the next tick forever). */
function ownerCanTakeSomething(ctx: SimContext, mob: Entity, ownerId: number): boolean {
  if (!mob.loot) return false;
  if (mob.loot.copper > 0) return true;
  return mob.loot.items.some(
    (s) => s.count > 0 && lootSlotVisibleTo(s, ownerId) && ctx.canAddItem(s.itemId, 1, ownerId),
  );
}

/** The corpse the buddy should be walking to this tick: the one nearest the
 *  OWNER among those the owner owns, still has something takeable on, and is
 *  inside BUDDY_LOOT_RANGE. Null when there is nothing to fetch. Exported for
 *  tests/buddies.test.ts, which pins the ownership rule directly. */
export function buddyLootTarget(ctx: SimContext, owner: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  ctx.grid.forEachInRadius(owner.pos.x, owner.pos.z, BUDDY_LOOT_RANGE, (m, d2) => {
    if (d2 >= bestD2) return;
    if (m.kind !== 'mob' || m.ownerId !== null) return;
    if (!corpseIsOwners(m, owner.id) || !ownerCanTakeSomething(ctx, m, owner.id)) return;
    best = m;
    bestD2 = d2;
  });
  return best;
}

/** The autoloot arm of the per-tick buddy update (src/sim/pet/buddy_ai.ts's
 *  updateBuddyMob). Returns true when the buddy spent this tick on the errand,
 *  which is the caller's signal to SKIP the ordinary heel; false means there
 *  was nothing to fetch and the buddy should heel as usual.
 *
 *  Movement reuses petFollow's own A*-pathed locomotion with the corpse as the
 *  `targetOverride`, so the walk out is the same obstacle-avoiding heel the
 *  buddy already uses, just aimed somewhere else. petFollow parks the buddy at
 *  PET_FOLLOW_DISTANCE (3.5yd) from what it is aimed at, comfortably inside
 *  the INTERACT_RANGE (5yd) the loot itself needs, so arriving and looting are
 *  not in tension. */
export function updateBuddyAutoloot(ctx: SimContext, buddy: Entity, owner: Entity): boolean {
  // A dead owner has no bags to fill and no corpse of their own to be looting
  // over; the buddy just keeps standing by them (buddy_ai.ts's header rule).
  if (!owner.buddyAutoloot || owner.dead) return false;
  // Same silent raid gate as the walk-by path (interaction.ts autoLootForParty):
  // a raid's loot is settled by rolls and the master looter, never picked up by
  // someone's follower.
  if (isInRaidInstance(ctx, owner.pos)) return false;
  const corpse = buddyLootTarget(ctx, owner);
  if (!corpse) return false;
  petFollow(ctx, buddy, owner, corpse.pos);
  // honorFfa=false (the errand never takes an aged-out stranger's corpse; the
  // ownership check above already refuses one, this keeps the distribution
  // side aligned), quiet=true (a passive pass must not toast the owner), and
  // the buddy's own position as the range origin: the owner may be up to
  // BUDDY_LOOT_RANGE away, and it is the BUDDY that has to be standing on the
  // corpse, which is the whole point of sending it.
  if (dist2d(buddy.pos, corpse.pos) <= INTERACT_RANGE) {
    lootCorpse(ctx, corpse.id, owner.id, false, true, buddy.pos);
  }
  return true;
}
