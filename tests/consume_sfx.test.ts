import { describe, expect, it } from 'vitest';
import { CONSUME_SFX_TICK_INTERVAL, shouldFireConsumeTickSfx } from '../src/sim/consume_sfx';

describe('shouldFireConsumeTickSfx', () => {
  it('never fires on tick 0 (not yet ticked)', () => {
    expect(shouldFireConsumeTickSfx(0)).toBe(false);
  });

  it('fires only on every 3rd tick, matching CONSUME_SFX_TICK_INTERVAL', () => {
    expect(CONSUME_SFX_TICK_INTERVAL).toBe(3);
    const fired = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(shouldFireConsumeTickSfx);
    expect(fired).toEqual([false, false, true, false, false, true, false, false, true]);
  });
});
