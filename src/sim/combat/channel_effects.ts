// Pure helpers for deterministic channel effects. Channel lifecycle code owns
// tick timing and RNG; this module only turns the already-rolled first-tick
// magnitude and ordinal into the authored ramp.

/** Scale a channel tick from its one-based ordinal without drawing RNG. */
export function rampedDrainTickDamage(
  firstTickDamage: number,
  rampPct: number | undefined,
  tickNumber: number,
): number {
  const completedSteps = Math.max(0, Math.floor(tickNumber) - 1);
  return Math.round(firstTickDamage * (1 + (rampPct ?? 0) * completedSteps));
}
