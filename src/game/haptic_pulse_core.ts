// Rumble patterns for aura proc alerts.
//
// The one notification channel that does not compete for the screen: it reaches a
// player whose eyes are on the boss, and it is the only channel with any room left
// on a phone. Pure and device-free, so the pattern rules are testable without a
// gamepad: the thin driver in haptics.ts owns the actual actuator calls.
//
// Telling patterns apart by feel is much harder than by eye, so this deliberately
// offers a SMALL vocabulary of three shapes rather than one per proc. Past about
// three a player reads "something buzzed", not "which one", and pretending
// otherwise would be a worse lie than showing nothing.

export type HapticShape = 'tap' | 'double' | 'long';

export const HAPTIC_SHAPES: readonly HapticShape[] = ['tap', 'double', 'long'];

export interface HapticPulse {
  /** Total wall time the pattern occupies, milliseconds. */
  durationMs: number;
  /** Gamepad actuator magnitudes, 0 to 1. */
  strongMagnitude: number;
  weakMagnitude: number;
  /** navigator.vibrate form: alternating vibrate/pause milliseconds. */
  vibratePattern: number[];
}

const PULSES: Readonly<Record<HapticShape, HapticPulse>> = {
  // Short and light: the default, and the only one that stays comfortable when a
  // proc fires every few seconds.
  tap: { durationMs: 90, strongMagnitude: 0.35, weakMagnitude: 0.55, vibratePattern: [90] },
  // Two quick beats, the most distinguishable shape from a single tap.
  double: {
    durationMs: 220,
    strongMagnitude: 0.4,
    weakMagnitude: 0.6,
    vibratePattern: [70, 80, 70],
  },
  // One heavier sustained buzz, for the proc worth interrupting yourself over.
  long: { durationMs: 320, strongMagnitude: 0.7, weakMagnitude: 0.5, vibratePattern: [320] },
};

export function hapticPulse(shape: HapticShape): HapticPulse {
  return PULSES[shape] ?? PULSES.tap;
}

/** Read a stored shape back; anything unknown degrades to the gentle default. */
export function sanitizeHapticShape(raw: unknown): HapticShape {
  return typeof raw === 'string' && (HAPTIC_SHAPES as readonly string[]).includes(raw)
    ? (raw as HapticShape)
    : 'tap';
}

/**
 * Whether a pulse may fire now. Two procs landing on the same tick would otherwise
 * stack into one longer, meaningless buzz, and a fast re-proc would leave the motor
 * running continuously; both read as noise rather than as a signal.
 */
export function createHapticGate(minGapMs = 400): { allow(nowMs: number): boolean } {
  let last = Number.NEGATIVE_INFINITY;
  return {
    allow(nowMs) {
      if (nowMs - last < minGapMs) return false;
      last = nowMs;
      return true;
    },
  };
}
