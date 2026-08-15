// The transit grace for a chain-pulled mob, the second half of the
// premature-boss-pull punish (instances/boss_chain_pull.ts).
//
// The pull anchors every woken mob's leash on the PULLER, so that after the
// fight starts the group can drag them 70 yards and no further. That anchor is
// right for the fight and wrong for the journey: a mob answering the call from
// the far end of a ~180-yard instance begins already outside its own
// DUNGEON_LEASH_DISTANCE sphere, and the leash prelude in combat_profile.ts
// evades it home on its very first engaged tick, before it takes a step. That
// silently reduced "the whole basin comes for you" to "the packs within 70
// yards of the shrine come for you".
//
// So a pulled mob carries an inbound flag that SUSPENDS the soft leash while it
// crosses. The flag is self-clearing on arrival rather than on a timer: the
// moment the mob is inside the leash sphere it is where the pull wanted it, the
// grace is spent, and the ordinary leash governs from that same anchor. This is
// the shape the flee-recovery grace (fleeReturnTimer) already uses one branch
// above, including its one-yard hysteresis, so an arriving mob cannot clear on
// the boundary and break on the next tick.
//
// Deliberately narrow: it holds ONLY the soft leash. The hard tether
// (MobTemplate.hardLeashRadius) is checked first and measures from the spawn,
// and the unreachable-target stall (reachability.ts) still runs as a postlude,
// so a chain-pulled mob pinned by geometry evades home on the normal five-second
// clock instead of chasing forever.
//
// The one deliberate consequence: a group that pulls and immediately runs is
// chased instead of leashed, because a mob kited AWAY from the pull point never
// reaches the sphere that would spend its grace. That is the punish working as
// written, and it stays bounded by the instance, not by the leash: leaving
// through the exit portal scrubs the leaver from every inside hate table
// (instances/dungeons.ts), and a wipe drops the pull the same way, so both outs
// cost the group the attempt.
//
// Pure entity-state, draws NO rng: the parity goldens are untouched.
import { dist2d, type Entity, type Vec3 } from '../types';

// Matches the flee-recovery grace's clearance test (combat_profile.ts): arrival
// registers one yard INSIDE the leash edge, so the tick that spends the grace
// can never be a tick that would also break it.
export const CHAIN_PULL_ARRIVAL_MARGIN = 1;

/** Arm the transit grace: this mob was woken by a chain pull and has to cross. */
export function markChainPullInbound(mob: Entity): void {
  mob.chainPullInbound = true;
}

/**
 * Drop the grace, at the two seams that end a pull: startEvadeHome
 * (combat_profile.ts) and the bulk resets (resetEvadingMob in locomotion.ts,
 * respawnMob in lifecycle.ts) clear it directly alongside chaseStall.
 *
 * The third evade entry, retargetMob (targeting.ts), deliberately does not:
 * that module is a verbatim move held byte-identical for the parity trace, and
 * the flag is inert on its path anyway. A mob it sends to 'evade' consults no
 * leash while walking home, aggroMob refuses to re-pull anything already in
 * 'evade', and resetEvadingMob clears the flag when it arrives.
 */
export function clearChainPullInbound(mob: Entity): void {
  mob.chainPullInbound = false;
}

/**
 * Is this mob still crossing to its pull point, and therefore exempt from the
 * soft leash for this tick?
 *
 * Spends the grace (clearing the flag) on the tick the mob first reaches the
 * leash sphere, so the answer is false from then on and the leash is live.
 * False for any mob that was never chain-pulled.
 */
export function chainPullTransitHoldsLeash(mob: Entity, leashAnchor: Vec3, leash: number): boolean {
  if (!mob.chainPullInbound) return false;
  if (dist2d(mob.pos, leashAnchor) <= leash - CHAIN_PULL_ARRIVAL_MARGIN) {
    mob.chainPullInbound = false;
    return false;
  }
  return true;
}
