import { describe, expect, it } from 'vitest';
import {
  advanceFireLiveness,
  createFireLiveness,
  FIRE_CAPTURE_HOLD_SECONDS,
  FIRE_WORK_HOLD_SECONDS,
} from '../src/render/fire/fire_liveness_core';

describe('fire simulation liveness scheduler', () => {
  it('stays idle until a volumetric fire mesh marks the frame, then holds work and capture windows', () => {
    const state = createFireLiveness();
    expect(advanceFireLiveness(state, 1.0, true)).toEqual({
      work: false,
      capture: false,
      resumed: false,
    });

    state.drawnSinceUpdate = true;
    expect(advanceFireLiveness(state, 2.0, true)).toEqual({
      work: true,
      capture: true,
      resumed: true,
    });

    // Still inside FIRE_WORK_HOLD_SECONDS without a new draw.
    expect(advanceFireLiveness(state, 2.0 + FIRE_WORK_HOLD_SECONDS * 0.5, true)).toEqual({
      work: true,
      capture: true,
      resumed: false,
    });

    // Past FIRE_WORK_HOLD_SECONDS but inside FIRE_CAPTURE_HOLD_SECONDS.
    expect(advanceFireLiveness(state, 2.0 + FIRE_WORK_HOLD_SECONDS + 0.1, true)).toEqual({
      work: false,
      capture: true,
      resumed: false,
    });

    // Past FIRE_CAPTURE_HOLD_SECONDS: both work and capture stop.
    expect(advanceFireLiveness(state, 2.0 + FIRE_CAPTURE_HOLD_SECONDS + 0.1, true)).toEqual({
      work: false,
      capture: false,
      resumed: false,
    });
  });

  it('halts immediately when disabled', () => {
    const state = createFireLiveness();
    state.drawnSinceUpdate = true;
    expect(advanceFireLiveness(state, 5.0, false)).toEqual({
      work: false,
      capture: false,
      resumed: false,
    });
  });
});
