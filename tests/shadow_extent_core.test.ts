import { describe, expect, it } from 'vitest';
import {
  SHADOW_CADENCE_ENTER_SECONDS,
  SHADOW_CADENCE_EXIT_SECONDS,
} from '../src/render/shadow_cadence_core';
import {
  createShadowExtent,
  resetShadowExtent,
  SHADOW_EXTENT_BASE_YARDS,
  SHADOW_EXTENT_ENTER_PRESSURE,
  SHADOW_EXTENT_ENTER_SECONDS,
  SHADOW_EXTENT_EXIT_PRESSURE,
  SHADOW_EXTENT_EXIT_SECONDS,
  SHADOW_EXTENT_PROXY_RANGE_YARDS,
  SHADOW_EXTENT_SCALES,
  type ShadowExtentState,
  updateShadowExtent,
} from '../src/render/shadow_extent_core';

const DT = 1 / 60;

/** Drive `seconds` of frames at a fixed pressure. */
function run(state: ShadowExtentState, seconds: number, pressure: number): ShadowExtentState {
  for (let t = 0; t < seconds; t += DT) updateShadowExtent(state, DT, pressure, true);
  return state;
}

describe('shadow extent ladder', () => {
  it('starts at full extent and holds there while the budget is calm', () => {
    const state = createShadowExtent();
    expect(state.step).toBe(0);
    expect(state.scale).toBe(1);
    run(state, 30, 0.2);
    expect(state.step).toBe(0);
    expect(state.scale).toBe(1);
  });

  it('walks ONE step per sustained-pressure dwell, never straight to the floor', () => {
    const state = createShadowExtent();
    // Just under the dwell: still full extent, so a one-second spike sheds nothing.
    run(state, SHADOW_EXTENT_ENTER_SECONDS - 0.5, SHADOW_EXTENT_ENTER_PRESSURE);
    expect(state.step).toBe(0);
    // Past the dwell: exactly one step, not the floor.
    run(state, 0.6, SHADOW_EXTENT_ENTER_PRESSURE);
    expect(state.step).toBe(1);
    expect(state.scale).toBe(SHADOW_EXTENT_SCALES[1]);
    // A second full dwell is needed for the second step.
    run(state, SHADOW_EXTENT_ENTER_SECONDS - 0.5, SHADOW_EXTENT_ENTER_PRESSURE);
    expect(state.step).toBe(1);
    run(state, 0.6, SHADOW_EXTENT_ENTER_PRESSURE);
    expect(state.step).toBe(2);
    expect(state.scale).toBe(SHADOW_EXTENT_SCALES[2]);
  });

  it('stops at the floor however long the pressure lasts', () => {
    const state = createShadowExtent();
    run(state, 120, 4);
    expect(state.step).toBe(SHADOW_EXTENT_SCALES.length - 1);
    expect(state.scale).toBe(SHADOW_EXTENT_SCALES.at(-1));
  });

  it('climbs back one step per sustained-calm dwell', () => {
    const state = createShadowExtent();
    run(state, 120, 4);
    expect(state.step).toBe(2);
    run(state, SHADOW_EXTENT_EXIT_SECONDS - 0.5, SHADOW_EXTENT_EXIT_PRESSURE);
    expect(state.step).toBe(2);
    run(state, 0.6, SHADOW_EXTENT_EXIT_PRESSURE);
    expect(state.step).toBe(1);
    run(state, SHADOW_EXTENT_EXIT_SECONDS + 0.5, SHADOW_EXTENT_EXIT_PRESSURE);
    expect(state.step).toBe(0);
    expect(state.scale).toBe(1);
    // And it cannot climb above full extent.
    run(state, 60, 0);
    expect(state.step).toBe(0);
    expect(state.scale).toBe(1);
  });

  it('holds the step in the dead band and restarts both dwell clocks', () => {
    const state = createShadowExtent();
    run(state, SHADOW_EXTENT_ENTER_SECONDS + 0.5, SHADOW_EXTENT_ENTER_PRESSURE);
    expect(state.step).toBe(1);
    // Between exit and enter: neither clock may accumulate, so a long stay
    // here moves nothing in either direction.
    const dead = (SHADOW_EXTENT_ENTER_PRESSURE + SHADOW_EXTENT_EXIT_PRESSURE) / 2;
    run(state, 60, dead);
    expect(state.step).toBe(1);
    expect(state.overSeconds).toBe(0);
    expect(state.calmSeconds).toBe(0);
  });

  it('cannot flap: alternating spikes below the dwell never move the ladder', () => {
    const state = createShadowExtent();
    for (let i = 0; i < 40; i++) {
      run(state, SHADOW_EXTENT_ENTER_SECONDS - 0.5, SHADOW_EXTENT_ENTER_PRESSURE);
      run(state, SHADOW_EXTENT_EXIT_SECONDS - 0.5, SHADOW_EXTENT_EXIT_PRESSURE);
    }
    expect(state.step).toBe(0);
  });

  it('never sheds while the governor is disabled, and a disabled frame restores', () => {
    const state = createShadowExtent();
    run(state, 120, 4);
    expect(state.step).toBe(2);
    updateShadowExtent(state, DT, 4, false);
    expect(state.step).toBe(0);
    expect(state.scale).toBe(1);
    expect(state.overSeconds).toBe(0);
    for (let i = 0; i < 600; i++) updateShadowExtent(state, DT, 9, false);
    expect(state.step).toBe(0);
  });

  it('holds the ladder through a degenerate frame time', () => {
    const state = createShadowExtent();
    run(state, SHADOW_EXTENT_ENTER_SECONDS + 0.5, SHADOW_EXTENT_ENTER_PRESSURE);
    const step = state.step;
    const over = state.overSeconds;
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      updateShadowExtent(state, dt, 4, true);
      expect(state.step).toBe(step);
      expect(state.overSeconds).toBe(over);
    }
  });

  it('resets to full extent with cleared clocks', () => {
    const state = createShadowExtent();
    run(state, 120, 4);
    resetShadowExtent(state);
    expect(state).toEqual({ step: 0, scale: 1, overSeconds: 0, calmSeconds: 0 });
  });
});

describe('shadow extent ladder shape', () => {
  it('is strictly decreasing from full quality, and floors above the proxy band', () => {
    expect(SHADOW_EXTENT_SCALES[0]).toBe(1);
    for (let i = 1; i < SHADOW_EXTENT_SCALES.length; i++) {
      expect(SHADOW_EXTENT_SCALES[i]).toBeLessThan(SHADOW_EXTENT_SCALES[i - 1]);
      expect(SHADOW_EXTENT_SCALES[i]).toBeGreaterThan(0);
    }
    // The fairness bound the floor was chosen for: at the deepest step the
    // box still reaches past the range where a character stops casting at
    // all, so no rig loses its shadow to the shed while still casting.
    const floor = SHADOW_EXTENT_BASE_YARDS * (SHADOW_EXTENT_SCALES.at(-1) ?? 0);
    expect(floor).toBeGreaterThanOrEqual(SHADOW_EXTENT_PROXY_RANGE_YARDS);
  });

  it('sheds after the cadence and restores before it, in both directions', () => {
    // The extent is the deeper, more visible shed, so it must never engage
    // before the cadence nor outlast it on the way back.
    expect(SHADOW_EXTENT_ENTER_SECONDS).toBeGreaterThan(SHADOW_CADENCE_ENTER_SECONDS);
    expect(SHADOW_EXTENT_EXIT_SECONDS).toBeGreaterThan(SHADOW_CADENCE_EXIT_SECONDS);
  });
});
