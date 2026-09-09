// Pure primary-healing amplification for the v0.42.0 class-tuned healer specs
// (Spiritmend shaman, Sunmender paladin, Groveheart druid). Callers look up the
// class/spec factor via `spec_output_tuning.ts` `primaryHealingMultiplier`, then
// apply it exactly once to the complete raw primary heal or HoT snapshot, after
// base, Healing Power, and existing cast/talent modifiers are assembled, and
// before crit/target healing resolution or storage in a HoT/pool.
//
// A multiplier of 1 (every untargeted spec, no-spec character, and every other
// class/spec) returns the amount byte-identical: no derived healing, harvest,
// deposit, copy, or shield may be scaled a second time.

export function scalePrimaryHealing(amount: number, multiplier: number): number {
  return multiplier === 1 ? amount : Math.round(amount * multiplier);
}
