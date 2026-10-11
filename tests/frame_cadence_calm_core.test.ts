import { describe, expect, it } from 'vitest';
import {
  CALM_AFTER_COMBAT_S,
  createFrameCadenceCalm,
  stepFrameCadenceCalm,
} from '../src/game/frame_cadence_calm_core';

describe('frame cadence calm', () => {
  it('is not calm at the start of a session, nor in a fight, nor right after one', () => {
    const s = createFrameCadenceCalm();
    expect(stepFrameCadenceCalm(s, false, 1)).toBe(false);
    for (let i = 0; i < CALM_AFTER_COMBAT_S; i++) stepFrameCadenceCalm(s, false, 1);
    expect(stepFrameCadenceCalm(s, false, 0.016)).toBe(true);
    expect(stepFrameCadenceCalm(s, true, 0.016)).toBe(false);
    expect(stepFrameCadenceCalm(s, false, CALM_AFTER_COMBAT_S - 0.1)).toBe(false);
    expect(stepFrameCadenceCalm(s, false, 0.2)).toBe(true);
  });

  it('ignores a frame without a duration', () => {
    const s = createFrameCadenceCalm();
    expect(stepFrameCadenceCalm(s, false, Number.NaN)).toBe(false);
    expect(stepFrameCadenceCalm(s, false, -5)).toBe(false);
    expect(s.quietS).toBe(0);
  });
});
