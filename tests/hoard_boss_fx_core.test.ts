import { describe, expect, it } from 'vitest';
import {
  HOARD_CUE_URGENT_SEC,
  hoardCueProgress,
  hoardCueVisualPlan,
} from '../src/render/hoard_boss_fx_core';

describe('Buried Hoard boss cue visual plan', () => {
  it('fills its countdown monotonically and clamps malformed input safely', () => {
    expect(hoardCueProgress(2, 2)).toBe(0);
    expect(hoardCueProgress(1, 2)).toBe(0.5);
    expect(hoardCueProgress(0, 2)).toBe(1);
    expect(hoardCueProgress(-1, 2)).toBe(1);
    expect(hoardCueProgress(1, 0)).toBe(1);
  });

  it('keeps every graphics tier on the same urgent, readable plan', () => {
    const calm = hoardCueVisualPlan(1.5, 2, 0.4);
    const urgent = hoardCueVisualPlan(HOARD_CUE_URGENT_SEC, 2, 0.4);
    expect(calm.urgent).toBe(false);
    expect(urgent.urgent).toBe(true);
    expect(calm.countdownScale).toBeGreaterThan(0);
    expect(urgent.countdownScale).toBeGreaterThan(calm.countdownScale);
    expect(urgent.pulseScale).not.toBe(calm.pulseScale);
  });
});
