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
// - A mechanic that comes due while the lock runs HOLDS AT DUE: its own timer
//   is not reset, it keeps drifting negative, and the drift is the mechanic's
//   overdue age. When the lock clears, the OLDEST-DUE governed mechanic fires
//   next (mechanicSlotHeld: a due driver yields to any strictly more overdue
//   one; ties fall to driver order). On a kit whose total demand exceeds one
//   fire per spacing window this stretches every cadence proportionally
//   instead of starving whichever driver happens to run last, so no mechanic
//   is ever deleted from a fight and none loses a pending cycle.
//
// Deliberately NOT governed: aoeSlow (the anti-kite snare must keep its own
// cadence or a kiter earns free windows), stoneskin (a self-buff that never
// lands on players), the updateBossMechanics support kit (summonAdds is
// hp-threshold-driven; heals/wards are not player-facing pressure), the
// on-hit dread fear (it only ever hits the swing victim), and the heroic
// charge trigger (it fires from the engaged-tick hook before the mechanics
// tail, chase state included). infernoChannel is
// lock-gated at its fire site but sits outside the oldest-due comparison: its
// cadence deliberately FREEZES while the lock runs (its hp-gate consumption
// must not happen on a held tick), so it cannot accumulate a comparable
// overdue age. No shipped rift kit carries it; revisit if one ever does.
//
// The lock ticks only while the boss is engaged AND in melee contact, the same
// gate the governed timers themselves tick under: a kited boss freezes with
// its held mechanics, then resumes the drain on re-contact.
//
// No SimContext, no rng, no DOM; reads only the static MOBS table and the
// rift rank gate. A Vitest imports it directly. Inert for every mob without
// the spawn stamp, so world and dungeon bosses (and the parity goldens that
// drive them) are untouched.
import { MOBS } from '../data';
import { riftMechanicSuppressed } from '../rift/ranks';
import { DT, type Entity } from '../types';

/** Minimum gap in seconds between two mechanic fires on a rift boss: long
 * enough that the longest mechanic CC (the 2.5s Terrifying Screech fear) fully
 * elapses and leaves a reaction margin before the next mechanic lands. */
export const RIFT_MECHANIC_SPACING_SEC = 5;

/** The spacing-governed drivers of runMobAttackMechanics, template key to the
 * per-entity cadence timer, in driver order. infernoChannel is deliberately
 * absent (see the header). */
const GOVERNED_TIMER_FIELD = {
  aoePulse: 'pulseTimer',
  stomp: 'stompTimer',
  bigCast: 'bigCastTimer',
  deathZoneCast: 'deathZoneCastTimer',
  deathZoneStrike: 'deathZoneStrikeTimer',
  terrify: 'terrifyTimer',
} as const;

export type GovernedMechanicKey = keyof typeof GOVERNED_TIMER_FIELD;

/** Tick the shared lock down once per engaged-and-in-melee tick (the same
 * cadence the governed mechanic timers tick at). Call it at the top of
 * runMobAttackMechanics, before any driver consults the lock. */
export function tickMechanicSpacing(mob: Entity): void {
  if (mob.mechanicLockTimer !== undefined && mob.mechanicLockTimer > 0) {
    mob.mechanicLockTimer = Math.max(0, mob.mechanicLockTimer - DT);
  }
}

/** Whether the lock itself is running. Always false for a mob without the
 * rift spawn stamp (the lock is only ever armed on stamped mobs). */
export function mechanicSpacingBlocked(mob: Entity): boolean {
  return (mob.mechanicLockTimer ?? 0) > 0;
}

/** Whether a DUE governed driver must hold this tick: the lock is running, or
 * a strictly more overdue governed sibling deserves the slot first (oldest-due
 * drain; ties fall to driver order). Always false without the spawn stamp. */
export function mechanicSlotHeld(mob: Entity, key: GovernedMechanicKey): boolean {
  if ((mob.riftMechanicSpacing ?? 0) <= 0) return false;
  if ((mob.mechanicLockTimer ?? 0) > 0) return true;
  const template = MOBS[mob.templateId];
  if (!template) return false;
  const myOverdue = -mob[GOVERNED_TIMER_FIELD[key]];
  for (const other of Object.keys(GOVERNED_TIMER_FIELD) as GovernedMechanicKey[]) {
    if (other === key || !template[other]) continue;
    if (riftMechanicSuppressed(mob, other)) continue;
    if (-mob[GOVERNED_TIMER_FIELD[other]] > myOverdue) return true;
  }
  return false;
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
