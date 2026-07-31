// Shared spacing lock between a rift boss's attack mechanics.
//
// Every boss mechanic in runMobAttackMechanics (mob/locomotion.ts) runs on its
// own free-running timer, so any two of them land on the same tick whenever
// their cadences align (playtest 2026-07-30: the Abyssal Maw feared and AOE'd
// the same instant). On a rift-spawned boss (riftMechanicSpacing stamped by
// rift/runs.ts) the player-facing mechanics share ONE per-entity lock:
//
// - A mechanic may only FIRE while the lock is clear; firing re-arms the lock
//   for riftMechanicSpacing seconds (a hardcast adds its cast time on top, so
//   an instant can never land while a telegraph bar fills either).
// - A mechanic that comes due while the lock runs HOLDS AT DUE (its own timer
//   clamps at zero) and fires the tick the lock clears; it never loses its
//   whole cycle. When several hold at once they drain one per spacing window
//   in driver order, each re-arming the lock for the next.
//
// Deliberately NOT governed: aoeSlow (the anti-kite snare must keep its own
// cadence or a kiter earns free windows), stoneskin (a self-buff that never
// lands on players), and the updateBossMechanics support kit (summonAdds is
// hp-threshold-driven; heals/wards are not player-facing pressure).
//
// Pure leaf: no SimContext, no rng; a Vitest imports it directly. Inert for
// every mob without the spawn stamp, so world and dungeon bosses (and the
// parity goldens that drive them) are untouched.
import { DT, type Entity } from '../types';

/** Minimum gap in seconds between two mechanic fires on a rift boss: long
 * enough that the longest mechanic CC (the 2.5s Terrifying Screech fear) fully
 * elapses and leaves a reaction margin before the next mechanic lands. */
export const RIFT_MECHANIC_SPACING_SEC = 5;

/** Tick the shared lock down once per engaged-and-in-melee tick (the same
 * cadence the governed mechanic timers tick at). Call it at the top of
 * runMobAttackMechanics, before any driver consults the lock. */
export function tickMechanicSpacing(mob: Entity): void {
  if (mob.mechanicLockTimer !== undefined && mob.mechanicLockTimer > 0) {
    mob.mechanicLockTimer = Math.max(0, mob.mechanicLockTimer - DT);
  }
}

/** Whether a due mechanic must hold this tick. Always false for a mob without
 * the rift spawn stamp (the lock is only ever armed on stamped mobs). */
export function mechanicSpacingBlocked(mob: Entity): boolean {
  return (mob.mechanicLockTimer ?? 0) > 0;
}

/** Arm the shared lock for one spacing window. A hardcast passes its cast time
 * as holdSec so the lock covers the whole telegraph bar plus one spacing
 * window after the detonation. No-op without the rift spawn stamp. */
export function claimMechanicSpacing(mob: Entity, holdSec = 0): void {
  const spacing = mob.riftMechanicSpacing ?? 0;
  if (spacing <= 0) return;
  mob.mechanicLockTimer = spacing + holdSec;
}

/** Drop the lock with the pull (evade home, respawn). Touches only mobs whose
 * lock was ever armed, so it can never define the field on an unstamped mob
 * (a defined-vs-undefined flip would churn the parity entity samples). */
export function resetMechanicSpacing(mob: Entity): void {
  if (mob.mechanicLockTimer !== undefined) mob.mechanicLockTimer = 0;
}
