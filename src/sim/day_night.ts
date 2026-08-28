// The world day/night cycle, the half the SIM needs.
//
// The cycle itself has always been a renderer concern: a forty-five-minute period
// anchored to the Unix epoch, so every client computes the same phase from its own
// clock with no wire traffic (src/render/day_night_core.ts turns the phase into sky,
// light and fog). The moment a GAMEPLAY rule depends on the time of day (a world boss
// who sleeps through the night), the phase math has to live where the sim can reach
// it, so the period and the phase function moved here and the renderer re-exports
// them. One definition, so the sky and the boss can never disagree about when dawn is.
//
// Determinism: this file never reads a clock. The host hands the sim a millisecond
// timestamp through `SimConfig.dayNightNowMs` (the server's Date.now, the offline
// client's Date.now or its /daynight override, nothing at all for tests and the RL
// env) and everything here is a pure function of that number.

/** Period of one full day and night, in milliseconds (forty-five minutes). */
export const DAY_NIGHT_CYCLE_MS = 45 * 60 * 1000;

/** Cycle position in [0, 1) for a Unix millisecond timestamp. Epoch-anchored, so
 *  the same instant yields the same phase in every timezone. The double modulo
 *  keeps it in range even for a negative input (defensive; now is never < 0). */
export function cyclePhase(nowMs: number): number {
  return (
    (((nowMs % DAY_NIGHT_CYCLE_MS) + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS) / DAY_NIGHT_CYCLE_MS
  );
}

/** Phase of sunrise, solar noon and sunset (midnight is 0). The sun is exactly on the
 *  horizon at DAWN and DUSK (day_night_core.sunDirection), so "daylight" below is the
 *  half of the cycle the sun is up. NOON is what a clock with no live cycle reports. */
export const DAWN_PHASE = 0.25;
export const NOON_PHASE = 0.5;
export const DUSK_PHASE = 0.75;

/** Wrap any real number into a cycle phase in [0, 1). */
function wrapPhase(phase: number): number {
  const p = phase % 1;
  return p < 0 ? p + 1 : p;
}

/** True while the sun is up: from sunrise (inclusive) to sunset (exclusive). */
export function isDaylightPhase(phase: number): boolean {
  const p = wrapPhase(phase);
  return p >= DAWN_PHASE && p < DUSK_PHASE;
}

/** The millisecond timestamp inside the first cycle that has this phase. Lets a host
 *  synthesize a clock from a phase (the offline /daynight override). */
export function phaseToCycleMs(phase: number): number {
  return Math.round(wrapPhase(phase) * DAY_NIGHT_CYCLE_MS);
}

/**
 * Did the clock pass sunrise between two consecutive readings?
 *
 * Wrap-aware: a reading just before midnight followed by one just after dawn (a long
 * host stall) still counts, and two equal readings never do. Used by the world-boss
 * scheduler so "he rises again at the next dawn" fires exactly once per day.
 */
export function crossedDawn(prevPhase: number, nextPhase: number): boolean {
  const prev = wrapPhase(prevPhase);
  const next = wrapPhase(nextPhase);
  if (prev === next) return false;
  if (prev < next) return prev < DAWN_PHASE && DAWN_PHASE <= next;
  // Wrapped through midnight.
  return DAWN_PHASE > prev || DAWN_PHASE <= next;
}
