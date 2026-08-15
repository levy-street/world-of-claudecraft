// Pure math + state classification for the Thornhollow Fields flag/rune per-frame
// visuals (no Three, no DOM): the carried-flag lean and bob, the rune gem's
// spin and hover, and the flag state-transition classifier that decides which
// celebration burst plays. battleground_fx.ts is the thin Three consumer.
//
// Graphics fairness: the lean, the carrier ring, and the gem read identically
// on every tier (battleground_props builds them unconditionally); only the
// transient bursts ride the quality-scaled Vfx pool.

export type BgFlagState = 'home' | 'carried' | 'dropped';
export type BgFlagFxKind = 'pickup' | 'capture' | 'return';

// Carried flag: mounted on the carrier's BACK like a war banner (offset
// behind the body along facing, slight raise) and leaned. No bob: the tiny
// high-frequency bounce read as jitter against the walk cycle (owner call).
//
// The lean is deliberately SHALLOW. It began at 0.6 rad (34 degrees), which was
// fine over the old thin stick but reads as a pike carried across the body once
// the pole has real thickness and a spear point on it: the standard should ride
// upright over the shoulder, with just enough tilt to say it is slung rather
// than planted. The raise goes with it, so the butt of a longer pole clears the
// ground instead of dragging through the carrier's heels.
export const BG_CARRY_TILT = 0.32; // radians off vertical
export const BG_CARRY_BACK = 0.42; // yards behind the carrier
export const BG_CARRY_RAISE = 0.5;

// Rune gem: a slow spin with a gentle hover so it reads as a pickup from afar.
export const BG_RUNE_SPIN_RADS = 0.9; // radians per second
export const BG_RUNE_BOB_AMP = 0.12;
export const BG_RUNE_BOB_HZ = 0.55;

/**
 * Classify a flag-state transition into the burst it earns. `prev` is null on
 * the first sighting (interest churn, match start): never a burst, the state
 * was not observed changing. A transition INTO 'carried' is a pickup wherever
 * it came from; 'carried' -> 'home' only happens on a capture and
 * 'dropped' -> 'home' only on a return, so the two are distinguishable from
 * state alone. A drop plays no burst: the banner plus the flag lying on the
 * ground carry that beat.
 */
export function classifyFlagTransition(
  prev: BgFlagState | null,
  next: BgFlagState,
): BgFlagFxKind | null {
  if (prev === null || prev === next) return null;
  if (next === 'carried') return 'pickup';
  if (next === 'home') return prev === 'carried' ? 'capture' : 'return';
  return null;
}

export function runeGemPose(timeS: number): { spin: number; bob: number } {
  return {
    spin: timeS * BG_RUNE_SPIN_RADS,
    bob: Math.sin(timeS * Math.PI * 2 * BG_RUNE_BOB_HZ) * BG_RUNE_BOB_AMP,
  };
}
