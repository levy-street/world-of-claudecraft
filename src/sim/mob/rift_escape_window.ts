// Rift boss escape windows (the mechanic-overlap follow-up to the shared
// spacing lock in ./mechanic_spacing.ts).
//
// The spacing lock spaces mechanic FIRES; the 2026-08-04 player feedback showed
// the remaining overlaps live in the layers the lock deliberately left alone:
// the free-running anti-kite snare (aoeSlow) could fire in the middle of a
// death-zone telegraph, the on-hit control procs (web root, knockback) could
// strip movement during one, and a death zone's fuse assumed an UNIMPAIRED
// runner (the RIFT_S_ZONE_TEMPO escape math is solved at player run speed 7,
// rift/ranks.ts), so a snared player could face a mathematically inescapable
// zone. This module is the shared definition of "the players are being asked
// to move RIGHT NOW" that those layers consult:
//
// - riftEscapeWindowActive: a telegraph is live on this boss. The window is an
//   ABSOLUTE sim-time deadline (escapeWindowUntil), stamped at every telegraph
//   start to the moment the last blast can land, never a castingAbility
//   introspection: a kited boss freezes its melee-gated cast bar, and a frozen
//   bar pinning the window open would permanently disable the very anti-kite
//   snare the exemption in mechanic_spacing.ts protects. While the window is
//   open, the snare holds at due (mob/locomotion.ts) and the on-hit control
//   procs still DRAW their rng roll (parity draw-order stability, the
//   mechanicDamageMult precedent) but skip their effect (mob/mob_swing.ts).
// - impairedZoneFuseMult: how much longer a death-zone fuse must run for THIS
//   anchor so their CURRENT movement impairment still leaves a real escape
//   window, capped so a permaslow cannot stretch a zone forever.
//
// Everything here is gated on the rift spawn stamp (riftMechanicSpacing, set
// only by rift/runs.ts): world, dungeon, and raid bosses never consult these
// and keep their shipped behavior. A SYSTEM MODULE behind the SimContext seam
// (it reads ctx.time/isRooted/moveSpeedMult), not a pure leaf; it draws no
// rng and touches no DOM, and a Vitest imports it directly.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** How long a rift-stamped boss's instant AoE mechanics (stomp, aoePulse) wind
 * up before detonating: the ground-ring telegraph players react to. Shorter
 * than one GCD-ish beat would not be reactable; longer would let melee trivially
 * zone every pulse. */
export const RIFT_MECHANIC_WINDUP_SEC = 1.2;

/** Minimum gap between a windup detonation and the boss's next auto-attack, so
 * a blast can never stack with a white swing in the same instant (the "double
 * hit with no tell" tank report on Warlord Grask). */
export const RIFT_POST_MECHANIC_SWING_GAP_SEC = 0.6;

/** Ceiling on the impairment fuse stretch: a rooted or fully-snared anchor gets
 * at most this multiple of the authored fuse. */
export const RIFT_IMPAIRED_FUSE_CAP = 2;

/** Half-angle of a rift-stamped boss's cleave splash, measured from its facing:
 * PI/2 makes the cleave a 180 degree FRONTAL arc (the Nythraxis Gravebreaker
 * arc precedent), so melee standing behind the boss can play the fight. World
 * and dungeon cleave carriers keep the shipped radial splash. Deliberately
 * narrower than the 2.2 rad MELEE_ARC swing cone: the splash must forgive a
 * player who committed to the back half even as the boss's facing re-aims at
 * its aggro target each tick, so a tank pivot cannot sweep the whole room. */
export const RIFT_CLEAVE_HALF_ARC = Math.PI / 2;

/** Whether this boss is currently asking its players to move: a telegraph
 * (instant-mechanic windup, bigCast bar, or death-zone fuse) stamped a
 * deadline that has not yet passed. The deadline is wall-clock sim time, so it
 * expires exactly when the client-side ring/zone visual does; a kited boss
 * whose melee-gated cast bar froze can never pin the window open (that would
 * permanently disable the anti-kite snare, the exact exploit the exemption in
 * mechanic_spacing.ts exists to prevent). Always false without the rift spawn
 * stamp. */
export function riftEscapeWindowActive(ctx: SimContext, mob: Entity): boolean {
  if ((mob.riftMechanicSpacing ?? 0) <= 0) return false;
  return (mob.escapeWindowUntil ?? 0) > ctx.time;
}

/** Open the escape window for a telegraph starting NOW whose last blast lands
 * by `durationSec` from now. Never shrinks an already-open longer window
 * (overlapping telegraphs keep the furthest deadline). No-op without the rift
 * spawn stamp, so the field is never defined on an unstamped mob. */
export function openRiftEscapeWindow(ctx: SimContext, mob: Entity, durationSec: number): void {
  if ((mob.riftMechanicSpacing ?? 0) <= 0) return;
  mob.escapeWindowUntil = Math.max(mob.escapeWindowUntil ?? 0, ctx.time + durationSec);
}

/** Drop any in-flight windup and open window with the pull (evade home,
 * respawn): the telegraph promise dies with the fight. Touches only mobs whose
 * fields were ever armed, so it can never define them on an unstamped mob (the
 * resetMechanicSpacing defined-vs-undefined discipline). */
export function resetRiftMechanicWindups(mob: Entity): void {
  if (mob.stompWindupRemaining !== undefined) mob.stompWindupRemaining = 0;
  if (mob.pulseWindupRemaining !== undefined) mob.pulseWindupRemaining = 0;
  if (mob.escapeWindowUntil !== undefined) mob.escapeWindowUntil = 0;
}

/** Fuse stretch for a death zone anchored on this player: 1 for an unimpaired
 * runner, 1/moveSpeedMult for a snared one, and the full cap for a rooted one,
 * clamped to [1, RIFT_IMPAIRED_FUSE_CAP]. Deterministic (reads only aura-derived
 * movement state, draws no rng), so it can run between the anchor draw and the
 * zone push without perturbing the rng stream. */
export function impairedZoneFuseMult(ctx: SimContext, anchor: Entity): number {
  if (ctx.isRooted(anchor)) return RIFT_IMPAIRED_FUSE_CAP;
  const mult = ctx.moveSpeedMult(anchor);
  if (mult >= 1) return 1;
  return Math.min(RIFT_IMPAIRED_FUSE_CAP, 1 / Math.max(mult, 1 / RIFT_IMPAIRED_FUSE_CAP));
}
