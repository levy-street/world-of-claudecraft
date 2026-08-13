import { describe, expect, it } from 'vitest';
import {
  createShadowCadenceState,
  resetShadowCadence,
  SHADOW_CADENCE_ENTER_PRESSURE,
  SHADOW_CADENCE_ENTER_SECONDS,
  SHADOW_CADENCE_EXIT_PRESSURE,
  SHADOW_CADENCE_EXIT_SECONDS,
  type ShadowCadenceState,
  updateShadowCadence,
} from '../src/render/shadow_cadence_core';

const DT = 1 / 60;

function run(state: ShadowCadenceState, seconds: number, pressure: number): void {
  const frames = Math.ceil(seconds / DT);
  for (let i = 0; i < frames; i++) updateShadowCadence(state, DT, pressure, true);
}

describe('shadow cadence core', () => {
  it('pins the tuning constants and their asymmetry as literals', () => {
    // The recovery-slower-than-shedding claim and the dead band's existence
    // live in these values; parameterized assertions alone would stay green
    // through a retune that silently removed either property.
    expect(SHADOW_CADENCE_ENTER_PRESSURE).toBe(1);
    expect(SHADOW_CADENCE_EXIT_PRESSURE).toBe(0.85);
    expect(SHADOW_CADENCE_ENTER_SECONDS).toBe(1.5);
    expect(SHADOW_CADENCE_EXIT_SECONDS).toBe(4);
    expect(SHADOW_CADENCE_EXIT_SECONDS).toBeGreaterThan(SHADOW_CADENCE_ENTER_SECONDS);
    expect(SHADOW_CADENCE_EXIT_PRESSURE).toBeLessThan(SHADOW_CADENCE_ENTER_PRESSURE);
  });

  it('stays at full rate under calm and dead-band pressure', () => {
    const state = createShadowCadenceState();
    run(state, 10, 0.4);
    expect(state.halfRate).toBe(false);
    expect(state.renderThisFrame).toBe(true);
    run(state, 10, (SHADOW_CADENCE_ENTER_PRESSURE + SHADOW_CADENCE_EXIT_PRESSURE) / 2);
    expect(state.halfRate).toBe(false);
  });

  it('sheds to half rate only after SUSTAINED over-pressure', () => {
    const state = createShadowCadenceState();
    // A spike shorter than the dwell does not flip the plan.
    run(state, SHADOW_CADENCE_ENTER_SECONDS * 0.6, 1.4);
    expect(state.halfRate).toBe(false);
    // Calm resets the dwell clock, so a second short spike still does not.
    run(state, 1, 0.3);
    run(state, SHADOW_CADENCE_ENTER_SECONDS * 0.6, 1.4);
    expect(state.halfRate).toBe(false);
    // Sustained pressure does.
    run(state, SHADOW_CADENCE_ENTER_SECONDS + DT * 2, 1.4);
    expect(state.halfRate).toBe(true);
  });

  it('renders every other frame under half rate, halving the shadow pass', () => {
    const state = createShadowCadenceState();
    run(state, SHADOW_CADENCE_ENTER_SECONDS + DT * 2, 1.5);
    expect(state.halfRate).toBe(true);
    let renders = 0;
    const frames = 120;
    let last = state.renderThisFrame;
    for (let i = 0; i < frames; i++) {
      updateShadowCadence(state, DT, 1.5, true);
      // Strict alternation, never two skips or two renders in a row.
      expect(state.renderThisFrame).toBe(!last);
      last = state.renderThisFrame;
      if (state.renderThisFrame) renders++;
    }
    expect(renders).toBe(frames / 2);
  });

  it('restores full rate only after SUSTAINED calm (asymmetric recovery)', () => {
    const state = createShadowCadenceState();
    run(state, SHADOW_CADENCE_ENTER_SECONDS + DT * 2, 2);
    expect(state.halfRate).toBe(true);
    // Calm shorter than the exit dwell holds half rate.
    run(state, SHADOW_CADENCE_EXIT_SECONDS * 0.5, 0.3);
    expect(state.halfRate).toBe(true);
    // A dead-band reading restarts the calm clock.
    run(state, 0.2, (SHADOW_CADENCE_ENTER_PRESSURE + SHADOW_CADENCE_EXIT_PRESSURE) / 2);
    run(state, SHADOW_CADENCE_EXIT_SECONDS * 0.9, 0.3);
    expect(state.halfRate).toBe(true);
    // Sustained calm restores, and the first restored frame renders.
    run(state, SHADOW_CADENCE_EXIT_SECONDS + DT * 2, 0.3);
    expect(state.halfRate).toBe(false);
    expect(state.renderThisFrame).toBe(true);
  });

  it('cannot flap when the pressure hovers across a threshold boundary', () => {
    const state = createShadowCadenceState();
    // Alternate one frame over the enter line, one frame in the dead band:
    // the dead-band frames keep resetting the dwell clock, so the plan never
    // flips no matter how long this goes on.
    for (let i = 0; i < 60 * 30; i++) {
      updateShadowCadence(state, DT, i % 2 === 0 ? 1.05 : 0.95, true);
      expect(state.halfRate).toBe(false);
    }
    // Same at the exit boundary once half rate is engaged.
    run(state, SHADOW_CADENCE_ENTER_SECONDS + DT * 2, 1.5);
    expect(state.halfRate).toBe(true);
    for (let i = 0; i < 60 * 30; i++) {
      updateShadowCadence(state, DT, i % 2 === 0 ? 0.8 : 0.9, true);
      expect(state.halfRate).toBe(true);
    }
  });

  it('a disabled budget governor forces full rate and clears the clocks', () => {
    const state = createShadowCadenceState();
    run(state, SHADOW_CADENCE_ENTER_SECONDS + DT * 2, 2);
    expect(state.halfRate).toBe(true);
    updateShadowCadence(state, DT, 2, false);
    expect(state.halfRate).toBe(false);
    expect(state.renderThisFrame).toBe(true);
    expect(state.overSeconds).toBe(0);
  });

  it('holds the plan untouched on degenerate dt (neither dwell nor a wipe)', () => {
    // From a fresh state: no dwell accumulates.
    const state = createShadowCadenceState();
    updateShadowCadence(state, Number.NaN, 2, true);
    updateShadowCadence(state, 0, 2, true);
    updateShadowCadence(state, -1, 2, true);
    expect(state.halfRate).toBe(false);
    expect(state.overSeconds).toBe(0);
    // From an ENGAGED half-rate plan: a single stalled frame must not wipe
    // the plan or flip the parity.
    run(state, SHADOW_CADENCE_ENTER_SECONDS + DT * 2, 2);
    expect(state.halfRate).toBe(true);
    const before = { ...state };
    updateShadowCadence(state, Number.NaN, 0.1, true);
    updateShadowCadence(state, 0, 0.1, true);
    expect(state).toEqual(before);
  });

  it('mutates and returns the caller-owned state (per-frame path allocates nothing)', () => {
    const state = createShadowCadenceState();
    expect(updateShadowCadence(state, DT, 0.4, true)).toBe(state);
    expect(updateShadowCadence(state, Number.NaN, 0.4, true)).toBe(state);
  });

  it('resetShadowCadence returns to the initial full-rate state', () => {
    const state = createShadowCadenceState();
    run(state, SHADOW_CADENCE_ENTER_SECONDS + DT * 2, 2);
    resetShadowCadence(state);
    // The literal shape, not a factory self-comparison: a bad edit to the
    // factory must not move both sides of this assertion together.
    expect(state).toEqual({
      halfRate: false,
      renderThisFrame: true,
      overSeconds: 0,
      calmSeconds: 0,
      phase: 0,
    });
  });
});
