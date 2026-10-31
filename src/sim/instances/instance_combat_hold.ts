// Instance combat hold: inside a claimed instance slot (a dungeon, or one raid
// room, since every Ignivar room is its own slot) a mob NEVER sheds an attacker
// by distance. Its hate table is slot-scoped: an attacker stays on it until they
// leave the slot (the exit portal, a room crossing, or any teleport out), die,
// or escape through stealth. Neither the soft leash nor the hard tether ever
// sends the mob home, so dragging a pull around the slot resets nothing. A mob
// whose straight chase is stopped by geometry first walks a route round it
// (mob/chase_route.ts); only a mob NO route brings to its target (the
// unreachable stall: a perch, a sealed room, a way round too far to search)
// holds in place in an evade stance: immune to damage while it is stuck
// (combat/damage.ts), no swings, casts, or mechanics (mob/locomotion.ts), aggro
// intact; it resumes the moment the target is back in reach or the way is open,
// and once the hold has lasted PIN_PHASE_SECONDS it phases straight through the
// blocking geometry to its target (the same phasing a stuck evader uses to get
// home). The immunity's job, denying free damage to a mob that cannot fight
// back, is done the moment it starts making progress, so a phasing mob can be
// hit on its way in: a ranged player sees a killable mob coming through the
// wall, not an unkillable one. So kiting the instance around can neither reset
// the pull nor chip a pinned mob down for free, and a perch only buys a few
// seconds, which is what a kited chain pull was being farmed for.
//
// CASTERS TOO, by decision. A petSpell caster that obeys the sight rule
// (mob/cast_sight.ts) is "in reach" at spell range only while it SEES its
// target. In spell range of a target behind a sealed gate it used to stand and
// cast through the wall; now it closes, finds no route, stalls and is held
// here exactly like a melee mob, then comes through and casts from the far
// side. It is the same anti-exploit fallback melee has always had in a slot,
// and it happens only when no route exists. Bosses are not swept in: they
// obey neither the sight rule nor the route planner (mob/encounter_body.ts).
// Pinned by tests/mob_cast_line_of_sight.test.ts.
//
// Authored boss arenas are an exception: mob/boss_arena_guard.ts rejects
// outside attacks and resets their bosses when the fighting floor is abandoned
// or the boss is dragged out. This hold still governs ordinary instance mobs.
//
// Scope: the dungeon and raid slots in ctx.instances. Rifts and delves keep
// their own instance records and the open-world rules (the hate-table reach in
// threat.ts THREAT_DROP_RANGE, the leashes, the evade-home stall).
//
// Draws no rng; reads only positions against the live instance claims.

import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { DT } from '../types';
import { claimedInstanceAt, instanceClaimHolds } from './dungeons';

// Seconds a pinned mob holds immune before it phases through the blocking
// geometry toward its target. Long enough that a brief body block or a
// prop-circling hiccup never triggers a walk through walls, short enough that a
// perch is worth nothing.
export const PIN_PHASE_SECONDS = 10;

/** The claimed slot `e` stands in, or null in the open world (cheap there). */
export function claimedSlotOf(ctx: SimContext, e: Entity): InstanceSlot | null {
  return claimedInstanceAt(ctx, e.pos);
}

/** Does this mob fight under the instance hold (it stands in a claimed slot)? */
export function holdsAggroInInstance(ctx: SimContext, mob: Entity): boolean {
  return claimedSlotOf(ctx, mob) !== null;
}

/** Has this attacker left the slot the mob fights in? Inside a slot the answer
 *  replaces the open-world reach test entirely. */
export function attackerLeftInstance(slot: InstanceSlot, attacker: Entity): boolean {
  return !instanceClaimHolds(slot, attacker.pos);
}

/** Hold in place in an evade stance: immune while stuck, aggro intact, not
 *  swinging. Set by the stall verdict (mob/combat_profile.ts); released by the
 *  pinned arm's reach / open-step checks, by losing the target, and by every
 *  pull reset. The value is the seconds held; undefined when not pinned (never
 *  deleted: a delete would flip the live Entity into dictionary mode, and the
 *  parity sampler drops an undefined key exactly like an absent one). */
export function pinInPlace(mob: Entity): void {
  if (mob.evadeInPlace === undefined) mob.evadeInPlace = 0;
  mob.autoAttack = false;
  // Whatever route it was on did not get it there (mob/chase_route.ts): once
  // it has phased through to its target the old waypoints lie behind a wall.
  if (mob.chaseRoute !== undefined && mob.chaseRoute.path.length > 0) mob.chaseRoute.path = [];
}

export function releasePin(mob: Entity): void {
  mob.evadeInPlace = undefined;
}

export function isPinnedInPlace(mob: Entity): boolean {
  return mob.evadeInPlace !== undefined;
}

/** Immune only while genuinely stuck: once the grace is spent and the mob is
 *  phasing toward its target it can be hit on the way in. */
export function isImmuneInPlace(mob: Entity): boolean {
  return mob.evadeInPlace !== undefined && mob.evadeInPlace < PIN_PHASE_SECONDS;
}

/** Advance the pin clock one tick; true once the phase grace has run out. */
export function advancePin(mob: Entity): boolean {
  if (mob.evadeInPlace === undefined) return false;
  mob.evadeInPlace += DT;
  return mob.evadeInPlace >= PIN_PHASE_SECONDS;
}
