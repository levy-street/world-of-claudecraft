// Pure plan for the Drowning Yard's Mooring Post lamps (bastion_mooring_fx.ts):
// how bright each lamp burns from its mirrored state (the post object's
// template: lit, dark, kindling) and the seconds since that state was seen,
// the flare and death when a post takes a chain, the slow re-ignite as its dark
// runs out, the safe ring a hooked player runs for, and the snap of the chain
// pulled taut to the post. Every answer derives from the sim's own tuning
// (OSSICK_TUNING), so the ring a player reads is the reach the sim checks.
//
// Three-free, DOM-free, deterministic.

import { type MooringState, OSSICK_TUNING } from '../../sim/encounters/sunken_bastion/ids';

/** The lamp's middle above the post's foot (the kit's caged glass, yards). */
export const MOORING_LAMP_HEIGHT = 2.75;
/** The mooring ring on the post's side (yards above its foot). */
export const MOORING_RING_HEIGHT = 1.3;
/** The safe ring's radius: the sim's reach. */
export const MOORING_SAFE_RADIUS = OSSICK_TUNING.postReach;
/** A post's lamp flares and dies over this long when it takes a chain. */
export const MOORING_FLARE_SECONDS = 1.6;
/** The chain snaps taut to the post, holds, then bursts at this age. */
export const MOORING_SNAP_SECONDS = 0.6;
/** Seconds the re-ignite takes (the sim's kindling). */
export const MOORING_KINDLE_SECONDS = OSSICK_TUNING.postKindleSeconds;

export interface MooringLampLook {
  /** The flame inside the cage (0 out, 1 full). */
  flame: number;
  /** The warm halo round the lamp, and the light it throws on the flags
   *  (0 out, 1 full; above 1 while it flares). */
  halo: number;
  /** The ember a dead lamp keeps (0 to 1). */
  ember: number;
}

/** A quick deterministic sputter in [0, 1] (the re-ignite's catching flame). */
export function mooringSputter(t: number): number {
  const a = Math.sin(t * 23.0) * 0.5 + 0.5;
  const b = Math.sin(t * 9.7 + 1.3) * 0.5 + 0.5;
  return a * b > 0.22 ? 1 : 0.25;
}

/**
 * The lamp's look: its `state`, the seconds `since` that state was seen, and
 * the seconds `flare` since the post took a chain (negative when it has not).
 * A flare outshines every state over its first beat, then the lamp dies.
 */
export function mooringLampLook(
  state: MooringState,
  since: number,
  flare: number,
  out: MooringLampLook,
): MooringLampLook {
  if (state === 'lit') {
    // The re-lit lamp blooms over its first half second, then settles.
    out.flame = 1;
    out.halo = since >= 0 && since < 0.5 ? 1 + 0.6 * (1 - since / 0.5) : 1;
    out.ember = 0;
  } else if (state === 'kindling') {
    const k = Math.min(1, Math.max(0, since / MOORING_KINDLE_SECONDS));
    // It catches unevenly at first, steadier as it takes.
    const s = k < 0.85 ? mooringSputter(since) : 1;
    out.flame = k * k * s;
    out.halo = 0.85 * k * k * s;
    out.ember = 0.25 + 0.5 * k;
  } else {
    out.flame = 0;
    out.halo = 0;
    out.ember = 0.2;
  }
  if (flare >= 0 && flare < MOORING_FLARE_SECONDS) {
    const peak = 0.12;
    const f =
      flare < peak
        ? 1 + 2.4 * (flare / peak)
        : 3.4 * Math.max(0, 1 - (flare - peak) / (MOORING_FLARE_SECONDS - peak)) ** 2;
    out.halo = Math.max(out.halo, f);
    out.flame = Math.max(out.flame, flare < 0.5 ? 1 - flare / 0.5 : 0);
    out.ember = Math.max(out.ember, 0.2 + 0.8 * Math.max(0, 1 - flare / MOORING_FLARE_SECONDS));
  }
  return out;
}

/** Does a post's safe ring show? Only a LIT post, and only while the local
 *  player is hooked (it is where they run). */
export function mooringRingShown(state: MooringState, hooked: boolean): boolean {
  return hooked && state === 'lit';
}

/** The safe ring's pulse (0.55 to 1), quicker as the chain shortens toward
 *  the posts' floor (`slack`: 1 plenty of chain, 0 none). */
export function mooringRingPulse(clock: number, slack: number): number {
  const rate = 3 + 6 * (1 - Math.min(1, Math.max(0, slack)));
  return 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(clock * rate));
}

/** The snapped chain's heat (1 white-hot at the snap, cooling while it holds
 *  taut), or -1 once it has burst (at MOORING_SNAP_SECONDS) or before it. */
export function mooringSnapHeat(age: number): number {
  if (age < 0 || age >= MOORING_SNAP_SECONDS) return -1;
  return 1 - 0.6 * (age / MOORING_SNAP_SECONDS);
}
