// Pure plan for the Sunken Bastion's fifth-pass visuals (bastion_gaol_fx.ts and
// bastion_reaper_fx.ts): how the Turnkey's cage shadow and Ossick's anchor mark
// fill, how hot the anchor chain runs as its victim nears the pit, how a
// shackle pair's chain hangs or strains, and how the reaper's pool and sweep
// fill before the scythe lands. Every answer derives from the sim's own
// encounter constants, so the ring a player reads is the reach the sim tests.
//
// Three-free, DOM-free, deterministic.

import {
  OSSICK_TUNING,
  PIT_RIM,
  shackleRange,
  TURNKEY_TUNING,
  VAEL_TUNING,
} from '../../sim/encounters/sunken_bastion/ids';

/** The cage shadow's radius under a marked player (the cage's own footprint). */
export const CAGE_MARK_RADIUS = 1.9;
/** The anchor mark's radius under its target (the victim's own spot). */
export const ANCHOR_MARK_RADIUS = 1.6;
/** Where the anchor's ring sits on its body (the winch chain's end), in yards
 *  up from its foot (gaol_props.py ANCHOR_H plus the ring). */
export const ANCHOR_RING_HEIGHT = 4.5;
/** The pit's rim, the line a hauled player must never reach. */
export const PIT_RIM_RADIUS = PIT_RIM;
/** How long the pool shows before the scythe lands (the sweep fan's clock). */
export const REAPER_WARNING_SECONDS = VAEL_TUNING.poolSeconds + VAEL_TUNING.riseSeconds;
/** The sweep's reach and arc, exactly the sim's. */
export const REAPER_SWEEP_RANGE = VAEL_TUNING.sweepRange;
export const REAPER_SWEEP_ARC_DEG = VAEL_TUNING.sweepArcDeg;
/** The shadow pool's own disc (under the rising reaper). */
export const REAPER_POOL_RADIUS = 2.4;
/** The heroic Grave Shadow's burning reach, exactly the sim's. */
export const GRAVE_SHADOW_RADIUS = VAEL_TUNING.graveRadius;

/** 0..1 how far the reaper's warning has run, from the pool's first sight. */
export function reaperWarningFill(age: number): number {
  if (REAPER_WARNING_SECONDS <= 0) return 1;
  return Math.min(1, Math.max(0, age / REAPER_WARNING_SECONDS));
}

/** 0 when the anchor bites, 1 at the pit's rim: the chain heats as it hauls. */
export function anchorHeat(dist: number, startDist: number): number {
  const span = startDist - PIT_RIM;
  if (span <= 1e-6) return 1;
  return Math.min(1, Math.max(0, 1 - (dist - PIT_RIM) / span));
}

/** The shackle chain between a pair `dist` apart with `range` of reach: its
 *  sag (slack hangs, taut is straight), and whether it bites. */
export function shackleLook(
  dist: number,
  range: number,
): { strained: boolean; sag: number; tension: number } {
  const r = range > 0 ? range : shackleRange(false);
  const tension = Math.min(1, Math.max(0, dist / r));
  return { strained: dist > r, sag: Math.max(0.05, (r - dist) * 0.28), tension };
}

/** The ring the pair must keep inside: centred between them, half the reach. */
export function shackleRingRadius(range: number): number {
  return (range > 0 ? range : shackleRange(false)) / 2;
}

/** The escape the cage shows on its own body (the same number the prompt
 *  reads): 0 locked to 1 broken. */
export function cageCrack(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - hp / maxHp));
}

/** Seconds a cage stands before it crushes (for the cage's ember warning). */
export const CAGE_CRUSH_SECONDS = TURNKEY_TUNING.cageMax;
/** Seconds the winch holds before it hauls (the chain winds taut). */
export const ANCHOR_SETTLE_SECONDS = OSSICK_TUNING.anchorSettle;
