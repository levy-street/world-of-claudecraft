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
//
// The errand has a visible middle (2026-10-05 owner request: the buddy plays its
// Search clip when it goes to fetch): the buddy walks right up to the corpse,
// stops, and SEARCHES it for BUDDY_SEARCH_SECONDS. The search rides the buddy
// entity's own cast fields under the BUDDY_SEARCH_CAST_ID sentinel, the same
// activity-marker shape a gather or fishing cast uses, so it reaches every
// client through the cast record the wire already carries and the renderer
// plays the rig's Search clip off it with no new protocol. The loot lands at
// BUDDY_SEARCH_FIND_SECONDS, the clips' own "found it" beat, and one search
// clears every eligible corpse within reach, so a pile is one rummage.
//
// A visible search needs a rule the silent pickup did not: when to stop
// trying. "Something on this corpse looks takeable" (ownerCanTakeSomething) is
// a cheap pre-check, not a promise. Loot rules it does not model can still hand
// the owner nothing (a slot the master looter holds, copper on a corpse they
// only have a personal drop on), and a corpse can sit behind something the
// buddy cannot path round. The silent pickup just stood there; a search would
// replay on every client until the corpse rotted. So a corpse that did not
// work out is SET ASIDE for BUDDY_ERRAND_SET_ASIDE_SECONDS (Entity.buddyErrand):
// the buddy moves on to the owner's other corpses, or heels, and tries it again
// once that memory lapses.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports (enforced by
// tests/architecture.test.ts).

import { isInRaidInstance } from '../instances/dungeons';
import { lootCorpse } from '../interaction';
import { lootSlotVisibleTo } from '../loot/loot_roll';
import { corpseHasDecayed } from '../respawn_policy';
import type { SimContext } from '../sim_context';
import {
  BUDDY_SEARCH_CAST_ID,
  type BuddyErrand,
  CAST_COMPLETE_EPS,
  DT,
  dist2d,
  type Entity,
  INTERACT_RANGE,
} from '../types';
import { petFollow } from './pet_ai';

/** How far from the OWNER a corpse may be and still be worth the errand
 *  (yards; the 2026-09-08 owner request). Not measured from the buddy: see
 *  the header. */
export const BUDDY_LOOT_RANGE = 30;

/** How long the buddy stands on a corpse searching it, in seconds: the length
 *  of the rigs' Search clip (public/models/buddies/*.glb), so the cast and the
 *  clip end together. */
export const BUDDY_SEARCH_SECONDS = 3.5;

/** Seconds into the search at which the loot lands: the Search clips' "found
 *  it" beat (the horse's head comes up, the lich lifts, Forgemaw raises his
 *  fist to look). Everything after it is the buddy enjoying the find. */
export const BUDDY_SEARCH_FIND_SECONDS = 2.3;

/** How close the buddy walks before it searches, in yards. Far inside the
 *  generic heel distance on purpose: the clip sniffs and paws at the ground in
 *  front of the body, which only reads if the corpse is actually there. */
export const BUDDY_SEARCH_STAND_OFF = 1.5;

/** How much closer than its best approach so far the buddy has to get, in
 *  yards, for a tick to count as progress toward the corpse. */
const BUDDY_ERRAND_PROGRESS_STEP = 0.03;

/** How long the buddy must go without progress, inside loot reach, before it
 *  gives up on getting closer and searches from where it stands, in seconds.
 *  Long enough that brushing a fence post on the way round is not a stall;
 *  short enough that a walled-off corpse is not a visible wait. */
export const BUDDY_SEARCH_STALL_SECONDS = 0.6;

/** How long the buddy must go without progress while still OUT of loot reach
 *  before it gives the corpse up, in seconds. A route round an obstacle can
 *  lead away from the corpse for a while, so this is several seconds of travel
 *  rather than a moment; past it the buddy is pushing at a wall. */
export const BUDDY_ERRAND_GIVE_UP_SECONDS = 6;

/** How long a corpse that did not work out stays set aside, in seconds. */
export const BUDDY_ERRAND_SET_ASIDE_SECONDS = 30;

/** True while this buddy is standing on a corpse searching it. */
export function isBuddySearching(buddy: Pick<Entity, 'castingAbility'>): boolean {
  return buddy.castingAbility === BUDDY_SEARCH_CAST_ID;
}

/** A buddy's errand scratch with nothing in it. */
export function newBuddyErrand(): BuddyErrand {
  return {
    corpseId: null,
    best: Number.POSITIVE_INFINITY,
    stall: 0,
    setAside: [],
    setAsideSeconds: 0,
  };
}

/** One errand tick's read of the walk, taken AFTER the buddy has moved: has it
 *  got closer to this corpse than it has ever been? The clock measures
 *  PROGRESS, not travel, on purpose. A buddy sliding back and forth along a
 *  fence is moving every tick and getting nowhere, and a clock that reset on
 *  any movement would never run out for it. A new corpse starts a new read. */
export function advanceBuddyErrandWalk(
  errand: Pick<BuddyErrand, 'corpseId' | 'best' | 'stall'>,
  corpseId: number,
  distToCorpse: number,
): void {
  if (errand.corpseId !== corpseId) {
    errand.corpseId = corpseId;
    errand.best = distToCorpse;
    errand.stall = 0;
    return;
  }
  if (distToCorpse <= errand.best - BUDDY_ERRAND_PROGRESS_STEP) {
    errand.best = distToCorpse;
    errand.stall = 0;
    return;
  }
  errand.stall += DT;
}

/** Whether the buddy should stop walking and start the search this tick.
 *  Normally that is "it has reached the corpse". The second arm keeps a
 *  near-miss from stranding it: a corpse it can reach to loot but has stopped
 *  getting any closer to (see advanceBuddyErrandWalk) is searched from where
 *  the buddy stands, exactly as the errand looted it before the search
 *  existed. Exported for tests/buddies.test.ts, which pins both arms. */
export function shouldBeginBuddySearch(distToCorpse: number, stallSeconds: number): boolean {
  if (distToCorpse <= BUDDY_SEARCH_STAND_OFF) return true;
  // The clock is DT added N times, so it carries float dust the epsilon absorbs.
  return distToCorpse <= INTERACT_RANGE && stallSeconds >= BUDDY_SEARCH_STALL_SECONDS - 1e-6;
}

/** Whether the buddy should give this corpse up: still out of loot reach, and
 *  no closer than it was BUDDY_ERRAND_GIVE_UP_SECONDS ago. */
export function shouldGiveUpBuddyErrand(distToCorpse: number, stallSeconds: number): boolean {
  return distToCorpse > INTERACT_RANGE && stallSeconds >= BUDDY_ERRAND_GIVE_UP_SECONDS - 1e-6;
}

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
 *  inside BUDDY_LOOT_RANGE. `setAside` is the buddy's own short list of corpses
 *  that did not work out (BuddyErrand.setAside); they are passed over. Null
 *  when there is nothing to fetch. Exported for tests/buddies.test.ts, which
 *  pins the ownership rule directly. */
export function buddyLootTarget(
  ctx: SimContext,
  owner: Entity,
  setAside?: readonly number[],
): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  ctx.grid.forEachInRadius(owner.pos.x, owner.pos.z, BUDDY_LOOT_RANGE, (m, d2) => {
    if (d2 >= bestD2) return;
    if (m.kind !== 'mob' || m.ownerId !== null) return;
    if (setAside?.includes(m.id)) return;
    if (!corpseIsOwners(m, owner.id) || !ownerCanTakeSomething(ctx, m, owner.id)) return;
    best = m;
    bestD2 = d2;
  });
  return best;
}

/** Whether this corpse is still a legal errand for this owner right now: the
 *  same three rules buddyLootTarget applies when it picks one, re-checked each
 *  tick of a search because any of them can lapse while the buddy is head-down
 *  (the owner walks off, loots it themselves, or fills their bags). The leash
 *  is INCLUSIVE, like the grid walk that picked the corpse: a strict compare
 *  here made a corpse at exactly BUDDY_LOOT_RANGE get picked, dropped the next
 *  tick and picked again, forever. */
function corpseStillFetchable(ctx: SimContext, corpse: Entity, owner: Entity): boolean {
  return (
    corpse.kind === 'mob' &&
    corpse.ownerId === null &&
    dist2d(owner.pos, corpse.pos) <= BUDDY_LOOT_RANGE &&
    corpseIsOwners(corpse, owner.id) &&
    ownerCanTakeSomething(ctx, corpse, owner.id)
  );
}

/** This buddy's errand scratch, created on first use. */
function errandOf(buddy: Entity): BuddyErrand {
  let errand = buddy.buddyErrand;
  if (!errand) {
    errand = newBuddyErrand();
    buddy.buddyErrand = errand;
  }
  return errand;
}

/** Put a corpse that did not work out aside for a while (see the header). The
 *  clock is one for the whole list and restarts with each addition, so a run
 *  of duds is forgotten together, a set-aside's length after the last one. */
function setCorpseAside(buddy: Entity, corpseId: number): void {
  const errand = errandOf(buddy);
  if (!errand.setAside.includes(corpseId)) errand.setAside.push(corpseId);
  errand.setAsideSeconds = BUDDY_ERRAND_SET_ASIDE_SECONDS;
}

function tickSetAside(errand: BuddyErrand): void {
  if (errand.setAside.length === 0) return;
  errand.setAsideSeconds -= DT;
  if (errand.setAsideSeconds > 0) return;
  errand.setAside.length = 0;
  errand.setAsideSeconds = 0;
}

function beginBuddySearch(buddy: Entity, corpse: Entity): void {
  buddy.castingAbility = BUDDY_SEARCH_CAST_ID;
  buddy.castTotal = BUDDY_SEARCH_SECONDS;
  buddy.castRemaining = BUDDY_SEARCH_SECONDS;
  // The corpse being searched, and the "not found yet" latch: cleared the
  // moment the loot lands, so the tail of the search never loots twice.
  buddy.castTargetId = corpse.id;
  buddy.petPath = [];
  // Nose to the corpse. Entity.facing is 0 = +Z, forward = (sin f, cos f).
  const dx = corpse.pos.x - buddy.pos.x;
  const dz = corpse.pos.z - buddy.pos.z;
  if (dx !== 0 || dz !== 0) buddy.facing = Math.atan2(dx, dz);
}

function endBuddySearch(buddy: Entity): void {
  buddy.castingAbility = null;
  buddy.castRemaining = 0;
  buddy.castTotal = 0;
  buddy.castTargetId = null;
}

/** The find: every corpse of the owner's within the buddy's reach comes up in
 *  the one rummage, so a pile costs one search instead of one each. Collected
 *  first and looted after, because looting can empty a corpse out of the grid
 *  walk it was found on, and looted in id order so that which corpse pays
 *  first when the owner's bags only fit part of a pile never depends on the
 *  grid's bucket history. A corpse the rummage takes NOTHING off is set aside:
 *  the pre-check said it was worth the walk and the loot rules disagreed, so
 *  searching it again would only replay the same empty-handed rummage. */
function lootBuddyPile(ctx: SimContext, buddy: Entity, owner: Entity): void {
  const setAside = buddy.buddyErrand?.setAside;
  const pile: number[] = [];
  ctx.grid.forEachInRadius(buddy.pos.x, buddy.pos.z, INTERACT_RANGE, (m) => {
    if (setAside?.includes(m.id)) return;
    if (corpseStillFetchable(ctx, m, owner)) pile.push(m.id);
  });
  pile.sort((a, b) => a - b);
  // honorFfa=false (the errand never takes an aged-out stranger's corpse; the
  // ownership check above already refuses one, this keeps the distribution
  // side aligned), quiet=true (a passive pass must not toast the owner), and
  // the buddy's own position as the range origin: the owner may be up to
  // BUDDY_LOOT_RANGE away, and it is the BUDDY that is standing on the corpse,
  // which is the whole point of sending it.
  for (const id of pile) {
    if (!lootCorpse(ctx, id, owner.id, false, true, buddy.pos)) setCorpseAside(buddy, id);
  }
}

/** One tick of a search in progress. Returns false when the search was
 *  abandoned, which hands the buddy straight back to its heel this same tick. */
function tickBuddySearch(ctx: SimContext, buddy: Entity, owner: Entity): boolean {
  buddy.castRemaining = Math.max(0, buddy.castRemaining - DT);
  if (buddy.castTargetId !== null) {
    const corpse = ctx.entities.get(buddy.castTargetId);
    if (!corpse || !corpseStillFetchable(ctx, corpse, owner)) {
      endBuddySearch(buddy);
      return false;
    }
    // Tick-count safe: castRemaining is DT subtracted N times, so the elapsed
    // time carries float dust the epsilon absorbs.
    if (buddy.castTotal - buddy.castRemaining >= BUDDY_SEARCH_FIND_SECONDS - 1e-6) {
      lootBuddyPile(ctx, buddy, owner);
      buddy.castTargetId = null;
    }
  }
  if (buddy.castRemaining <= CAST_COMPLETE_EPS) endBuddySearch(buddy);
  return true;
}

/** The autoloot arm of the per-tick buddy update (src/sim/pet/buddy_ai.ts's
 *  updateBuddyMob). Returns true when the buddy spent this tick on the errand,
 *  which is the caller's signal to SKIP the ordinary heel; false means there
 *  was nothing to fetch and the buddy should heel as usual.
 *
 *  Movement reuses petFollow's own A*-pathed locomotion with the corpse as the
 *  `targetOverride`, so the walk out is the same obstacle-avoiding heel the
 *  buddy already uses, just aimed somewhere else and parked closer
 *  (BUDDY_SEARCH_STAND_OFF). Arriving starts the search above; the loot itself
 *  still needs only INTERACT_RANGE (5yd), so a corpse the buddy cannot quite
 *  stand on is searched from where it stopped rather than never. */
export function updateBuddyAutoloot(ctx: SimContext, buddy: Entity, owner: Entity): boolean {
  // A dead owner has no bags to fill and no corpse of their own to be looting
  // over; the buddy just keeps standing by them (buddy_ai.ts's header rule).
  // Same silent raid gate as the walk-by path (interaction.ts autoLootForParty):
  // a raid's loot is settled by rolls and the master looter, never picked up by
  // someone's follower.
  const armed = owner.buddyAutoloot && !owner.dead && !isInRaidInstance(ctx, owner.pos);
  const errand = buddy.buddyErrand;
  if (errand) tickSetAside(errand);
  if (isBuddySearching(buddy)) {
    if (!armed) {
      endBuddySearch(buddy);
      return false;
    }
    return tickBuddySearch(ctx, buddy, owner);
  }
  const corpse = armed ? buddyLootTarget(ctx, owner, errand?.setAside) : null;
  if (!corpse) {
    if (errand) errand.corpseId = null;
    return false;
  }
  petFollow(ctx, buddy, owner, corpse.pos, BUDDY_SEARCH_STAND_OFF);
  const dist = dist2d(buddy.pos, corpse.pos);
  const walk = errandOf(buddy);
  advanceBuddyErrandWalk(walk, corpse.id, dist);
  if (shouldBeginBuddySearch(dist, walk.stall)) {
    walk.corpseId = null;
    beginBuddySearch(buddy, corpse);
  } else if (shouldGiveUpBuddyErrand(dist, walk.stall)) {
    // Still the errand's tick: the buddy has already moved, so the heel waits
    // for the next one rather than stepping it twice.
    walk.corpseId = null;
    setCorpseAside(buddy, corpse.id);
  }
  return true;
}
