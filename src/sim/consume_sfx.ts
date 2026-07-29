// Pure leaf: when an eat/drink regen tick (combat/auras.ts) should make a
// sound. Classic WoW's own eat/drink tick lands roughly every 6 seconds; our
// CONSUME_DURATION/CONSUME_TICKS (types.ts) tick twice as fast (every 2s), so
// firing on every 3rd tick reproduces that same ~6s cadence rather than
// copying the raw tick interval.
export const CONSUME_SFX_TICK_INTERVAL = 3;

export function shouldFireConsumeTickSfx(ticksElapsed: number): boolean {
  return ticksElapsed > 0 && ticksElapsed % CONSUME_SFX_TICK_INTERVAL === 0;
}
