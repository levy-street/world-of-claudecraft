import { describe, expect, it } from 'vitest';
import {
  advanceWaterLiveness,
  createWaterLiveness,
  WATER_CAPTURE_HOLD_SECONDS,
  WATER_WORK_HOLD_SECONDS,
} from '../src/render/ocean/water_liveness_core';

describe('water liveness', () => {
  it('starts live, before anything has drawn', () => {
    const state = createWaterLiveness();
    expect(advanceWaterLiveness(state, 100, true)).toEqual({
      work: true,
      capture: true,
      resumed: false,
    });
  });

  it('idles the work after its hold and the capture after its longer one', () => {
    const state = createWaterLiveness();
    state.drawnSinceUpdate = true;
    advanceWaterLiveness(state, 0, true);
    expect(advanceWaterLiveness(state, WATER_WORK_HOLD_SECONDS - 0.01, true).work).toBe(true);
    const later = advanceWaterLiveness(state, WATER_WORK_HOLD_SECONDS + 0.01, true);
    expect(later.work).toBe(false);
    expect(later.capture).toBe(true);
    expect(advanceWaterLiveness(state, WATER_CAPTURE_HOLD_SECONDS + 0.01, true).capture).toBe(
      false,
    );
  });

  it('reports the frame the work resumes, once', () => {
    const state = createWaterLiveness();
    state.drawnSinceUpdate = true;
    advanceWaterLiveness(state, 0, true);
    advanceWaterLiveness(state, 10, true);
    state.drawnSinceUpdate = true;
    expect(advanceWaterLiveness(state, 11, true)).toEqual({
      work: true,
      capture: true,
      resumed: true,
    });
    expect(advanceWaterLiveness(state, 11.02, true).resumed).toBe(false);
  });

  it('does nothing at all while the water is hidden', () => {
    const state = createWaterLiveness();
    state.drawnSinceUpdate = true;
    expect(advanceWaterLiveness(state, 5, false)).toEqual({
      work: false,
      capture: false,
      resumed: false,
    });
  });
});
