import { describe, expect, it } from 'vitest';
import {
  applyTerrainDetailShed,
  createTerrainDetailShedState,
  nextTerrainDetailRestoreTarget,
  nextTerrainDetailShedTarget,
  resetTerrainDetailShed,
  shedTerrainDetailKnob,
  TERRAIN_DETAIL_ENTER_PRESSURE,
  TERRAIN_DETAIL_ENTER_SECONDS,
  TERRAIN_DETAIL_EXIT_PRESSURE,
  TERRAIN_DETAIL_EXIT_SECONDS,
  TERRAIN_DETAIL_FLOOR,
  TERRAIN_DETAIL_LADDER,
  TERRAIN_DETAIL_SLEW_PER_SECOND,
  type TerrainDetailShedState,
  type TerrainDetailUniformRefs,
  terrainDetailKnobs,
  terrainDetailShedApplies,
  updateTerrainDetailShed,
} from '../src/render/terrain_detail_shed_core';

const DT = 1 / 60;

function run(state: TerrainDetailShedState, seconds: number, pressure: number): void {
  const frames = Math.ceil(seconds / DT);
  for (let i = 0; i < frames; i++) updateTerrainDetailShed(state, DT, pressure, true);
}

/** Enough time for one dwell step AND for the applied level to settle on it. */
/** The widest rung gap, the time the slew needs for the first shed step. */
const FIRST_STEP = 1 - TERRAIN_DETAIL_LADDER[1];
const STEP_SETTLE_SECONDS = TERRAIN_DETAIL_ENTER_SECONDS + FIRST_STEP / 0.5 + 0.1;

// The static requests (gfx.ts): ultra relief 3 / 3 taps / clamp 0.85,
// insane 3 / 4 / 1, high 1 / 0 / 0 (the floor on every knob), medium 0 / 0 / 0.
const ULTRA_REQUEST = { relief: 3, taps: 3, clampK: 0.85 };
const INSANE_REQUEST = { relief: 3, taps: 4, clampK: 1 };
const HIGH_REQUEST = { relief: 1, taps: 0, clampK: 0 };
const MEDIUM_REQUEST = { relief: 0, taps: 0, clampK: 0 };

function uniforms(): TerrainDetailUniformRefs {
  return {
    uReliefSteps: { value: 3 },
    uWornDetailTaps: { value: 4 },
    uWornDetailClampK: { value: 1 },
  };
}

describe('terrain detail shed core: knob mapping', () => {
  it('pins the floor as high tier own static profile', () => {
    expect(TERRAIN_DETAIL_FLOOR).toEqual({ relief: 1, taps: 0, clampK: 0 });
  });

  it('at level 1 every knob equals the tier request exactly (the static preset is untouched)', () => {
    expect(terrainDetailKnobs(ULTRA_REQUEST, 1)).toEqual(ULTRA_REQUEST);
    expect(terrainDetailKnobs(INSANE_REQUEST, 1)).toEqual(INSANE_REQUEST);
    expect(terrainDetailKnobs(HIGH_REQUEST, 1)).toEqual(HIGH_REQUEST);
    expect(terrainDetailKnobs(MEDIUM_REQUEST, 1)).toEqual(MEDIUM_REQUEST);
  });

  it('at level 0 every knob above the floor is pulled exactly to the floor', () => {
    expect(terrainDetailKnobs(ULTRA_REQUEST, 0)).toEqual(TERRAIN_DETAIL_FLOOR);
    expect(terrainDetailKnobs(INSANE_REQUEST, 0)).toEqual(TERRAIN_DETAIL_FLOOR);
  });

  it('interpolates linearly between the tier request and the floor', () => {
    const mid = terrainDetailKnobs(ULTRA_REQUEST, 0.5);
    expect(mid.relief).toBeCloseTo(2, 10);
    expect(mid.taps).toBeCloseTo(1.5, 10);
    expect(mid.clampK).toBeCloseTo(0.425, 10);
  });

  it('only ever sheds DOWN: never above the tier request, never below the floor', () => {
    for (let level = 0; level <= 1; level += 0.05) {
      const k = terrainDetailKnobs(ULTRA_REQUEST, level);
      expect(k.relief).toBeLessThanOrEqual(ULTRA_REQUEST.relief + 1e-9);
      expect(k.relief).toBeGreaterThanOrEqual(TERRAIN_DETAIL_FLOOR.relief - 1e-9);
      expect(k.taps).toBeLessThanOrEqual(ULTRA_REQUEST.taps + 1e-9);
      expect(k.taps).toBeGreaterThanOrEqual(TERRAIN_DETAIL_FLOOR.taps - 1e-9);
      expect(k.clampK).toBeLessThanOrEqual(ULTRA_REQUEST.clampK + 1e-9);
      expect(k.clampK).toBeGreaterThanOrEqual(TERRAIN_DETAIL_FLOOR.clampK - 1e-9);
    }
  });

  it('a tier at or below the floor (high, medium) is untouched at every level', () => {
    for (let level = 0; level <= 1; level += 0.1) {
      expect(terrainDetailKnobs(HIGH_REQUEST, level)).toEqual(HIGH_REQUEST);
      expect(terrainDetailKnobs(MEDIUM_REQUEST, level)).toEqual(MEDIUM_REQUEST);
    }
  });

  it('clamps an out-of-range level input to 0..1', () => {
    expect(terrainDetailKnobs(ULTRA_REQUEST, -5)).toEqual(TERRAIN_DETAIL_FLOOR);
    expect(terrainDetailKnobs(ULTRA_REQUEST, 5)).toEqual(ULTRA_REQUEST);
  });

  it('the per-knob helper is the mapping the tuple builds on', () => {
    for (const level of [0, 0.32, 0.66, 1]) {
      const k = terrainDetailKnobs(ULTRA_REQUEST, level);
      expect(shedTerrainDetailKnob(3, 1, level)).toBe(k.relief);
      expect(shedTerrainDetailKnob(3, 0, level)).toBe(k.taps);
      expect(shedTerrainDetailKnob(0.85, 0, level)).toBe(k.clampK);
    }
  });

  it('terrainDetailShedApplies admits only a request with a knob ABOVE the floor', () => {
    expect(
      terrainDetailShedApplies({
        terrainRelief: 3,
        surfaceDetailTaps: 3,
        surfaceDetailClampK: 0.85,
      }),
    ).toBe(true);
    // An Advanced session on tier high with only the terrain dial raised.
    expect(
      terrainDetailShedApplies({ terrainRelief: 2, surfaceDetailTaps: 0, surfaceDetailClampK: 0 }),
    ).toBe(true);
    // The high, medium and low table profiles (at or below the floor).
    expect(
      terrainDetailShedApplies({ terrainRelief: 1, surfaceDetailTaps: 0, surfaceDetailClampK: 0 }),
    ).toBe(false);
    expect(
      terrainDetailShedApplies({ terrainRelief: 0, surfaceDetailTaps: 0, surfaceDetailClampK: 0 }),
    ).toBe(false);
  });
});

describe('terrain detail shed core: uniform application', () => {
  it('writes the three refs in place (never replaces them) from the session request', () => {
    const u = uniforms();
    const refs = { relief: u.uReliefSteps, taps: u.uWornDetailTaps, clamp: u.uWornDetailClampK };
    applyTerrainDetailShed(
      { terrainRelief: 3, surfaceDetailTaps: 3, surfaceDetailClampK: 0.85 },
      0.5,
      u,
    );
    expect(u.uReliefSteps).toBe(refs.relief);
    expect(u.uWornDetailTaps).toBe(refs.taps);
    expect(u.uWornDetailClampK).toBe(refs.clamp);
    expect(u.uReliefSteps.value).toBeCloseTo(2, 10);
    expect(u.uWornDetailTaps.value).toBeCloseTo(1.5, 10);
    // The clamp uniform is a SHARE of the tier's own baked clamp, not the
    // absolute clampK, so 1 means exactly the tier's request on every tier.
    expect(u.uWornDetailClampK.value).toBeCloseTo(0.5, 10);
  });

  it('at level 1 the uniforms are the tier request and the clamp share is exactly 1', () => {
    for (const gfx of [
      { terrainRelief: 3, surfaceDetailTaps: 3, surfaceDetailClampK: 0.85 },
      { terrainRelief: 3, surfaceDetailTaps: 4, surfaceDetailClampK: 1 },
    ]) {
      const u = uniforms();
      applyTerrainDetailShed(gfx, 1, u);
      expect(u.uReliefSteps.value).toBe(gfx.terrainRelief);
      expect(u.uWornDetailTaps.value).toBe(gfx.surfaceDetailTaps);
      expect(u.uWornDetailClampK.value).toBe(1);
    }
  });

  it('at level 0 the uniforms are the floor: relief 1, 0 taps, clamp share 0', () => {
    const u = uniforms();
    applyTerrainDetailShed(
      { terrainRelief: 3, surfaceDetailTaps: 3, surfaceDetailClampK: 0.85 },
      0,
      u,
    );
    expect(u.uReliefSteps.value).toBe(1);
    expect(u.uWornDetailTaps.value).toBe(0);
    expect(u.uWornDetailClampK.value).toBe(0);
  });

  it('a high session writes its own request at every level (a no-op shed, clamp share 1)', () => {
    for (const level of [1, 0.66, 0.32, 0]) {
      const u = uniforms();
      applyTerrainDetailShed(
        { terrainRelief: 1, surfaceDetailTaps: 0, surfaceDetailClampK: 0 },
        level,
        u,
      );
      expect(u.uReliefSteps.value).toBe(1);
      expect(u.uWornDetailTaps.value).toBe(0);
      expect(u.uWornDetailClampK.value).toBe(1);
    }
  });
});

describe('terrain detail shed core: dwell hysteresis', () => {
  it('pins the tuning constants and their shadow-cadence-style asymmetry as literals', () => {
    expect(TERRAIN_DETAIL_ENTER_PRESSURE).toBe(1);
    expect(TERRAIN_DETAIL_EXIT_PRESSURE).toBe(0.85);
    expect(TERRAIN_DETAIL_ENTER_SECONDS).toBe(2.5);
    expect(TERRAIN_DETAIL_EXIT_SECONDS).toBe(6);
    expect(TERRAIN_DETAIL_LADDER).toEqual([1, 0.32, 0]);
    expect(nextTerrainDetailShedTarget(1)).toBe(0.32);
    expect(nextTerrainDetailShedTarget(0.32)).toBe(0);
    expect(nextTerrainDetailShedTarget(0)).toBe(0);
    expect(nextTerrainDetailRestoreTarget(0)).toBe(0.32);
    expect(nextTerrainDetailRestoreTarget(0.32)).toBe(1);
    expect(nextTerrainDetailRestoreTarget(1)).toBe(1);
    expect(TERRAIN_DETAIL_SLEW_PER_SECOND).toBe(0.5);
    expect(TERRAIN_DETAIL_EXIT_SECONDS).toBeGreaterThan(TERRAIN_DETAIL_ENTER_SECONDS);
    expect(TERRAIN_DETAIL_EXIT_PRESSURE).toBeLessThan(TERRAIN_DETAIL_ENTER_PRESSURE);
  });

  it('starts at level 1 with the plan at 1', () => {
    expect(createTerrainDetailShedState()).toEqual({
      level: 1,
      target: 1,
      overSeconds: 0,
      calmSeconds: 0,
    });
  });

  it('stays at level 1 under calm and dead-band pressure', () => {
    const state = createTerrainDetailShedState();
    run(state, 20, 0.4);
    expect(state.level).toBe(1);
    run(state, 20, (TERRAIN_DETAIL_ENTER_PRESSURE + TERRAIN_DETAIL_EXIT_PRESSURE) / 2);
    expect(state.level).toBe(1);
    expect(state.target).toBe(1);
  });

  it('sheds one step only after SUSTAINED over-pressure, never on a spike', () => {
    const state = createTerrainDetailShedState();
    run(state, TERRAIN_DETAIL_ENTER_SECONDS * 0.6, 1.4);
    expect(state.target).toBe(1);
    expect(state.level).toBe(1);
    // Calm resets the dwell clock, so a second short spike still does not shed.
    run(state, 1, 0.3);
    run(state, TERRAIN_DETAIL_ENTER_SECONDS * 0.6, 1.4);
    expect(state.target).toBe(1);
    // Sustained pressure from a cleared dwell clock sheds exactly ONE step of
    // the plan (a second dwell would need 2.5 s more than the settle window).
    run(state, 1, 0.3);
    run(state, STEP_SETTLE_SECONDS, 1.4);
    expect(state.target).toBeCloseTo(TERRAIN_DETAIL_LADDER[1], 10);
    expect(state.level).toBeCloseTo(TERRAIN_DETAIL_LADDER[1], 10);
  });

  it('crossfades a step: the applied level slews at the pinned rate, never jumps', () => {
    const state = createTerrainDetailShedState();
    run(state, TERRAIN_DETAIL_ENTER_SECONDS + DT * 2, 1.4);
    expect(state.target).toBeCloseTo(TERRAIN_DETAIL_LADDER[1], 10);
    // Two frames past the step the level has moved only two slew increments.
    expect(state.level).toBeGreaterThan(TERRAIN_DETAIL_LADDER[1]);
    expect(state.level).toBeCloseTo(1 - 2 * TERRAIN_DETAIL_SLEW_PER_SECOND * DT, 6);
    let previous = state.level;
    while (state.level > state.target) {
      updateTerrainDetailShed(state, DT, 1.4, true);
      expect(previous - state.level).toBeLessThanOrEqual(
        TERRAIN_DETAIL_SLEW_PER_SECOND * DT + 1e-9,
      );
      previous = state.level;
    }
    expect(state.level).toBe(state.target);
  });

  it('walks the full ladder to the floor under sustained pressure, one step per dwell', () => {
    const state = createTerrainDetailShedState();
    const targets: number[] = [state.target];
    for (let i = 0; i < 6; i++) {
      run(state, STEP_SETTLE_SECONDS, 1.5);
      targets.push(state.target);
    }
    for (let i = 1; i < targets.length; i++) expect(targets[i]).toBeLessThanOrEqual(targets[i - 1]);
    expect(targets.slice(0, 3)).toEqual([1, 0.32, 0]);
    expect(state.target).toBe(0);
    expect(state.level).toBe(0);
  });

  it('restores one step only after SUSTAINED calm (asymmetric recovery)', () => {
    const state = createTerrainDetailShedState();
    run(state, STEP_SETTLE_SECONDS, 2);
    const shed = state.target;
    expect(shed).toBeLessThan(1);
    expect(state.level).toBe(shed);
    // Calm shorter than the exit dwell holds the level.
    run(state, TERRAIN_DETAIL_EXIT_SECONDS * 0.5, 0.3);
    expect(state.level).toBe(shed);
    // A dead-band reading restarts the calm clock.
    run(state, 0.2, (TERRAIN_DETAIL_ENTER_PRESSURE + TERRAIN_DETAIL_EXIT_PRESSURE) / 2);
    run(state, TERRAIN_DETAIL_EXIT_SECONDS * 0.9, 0.3);
    expect(state.level).toBe(shed);
    // Sustained calm restores exactly one step.
    run(state, TERRAIN_DETAIL_EXIT_SECONDS + FIRST_STEP / 0.5 + 0.1, 0.3);
    expect(state.target).toBe(nextTerrainDetailRestoreTarget(shed));
    expect(state.level).toBe(state.target);
  });

  it('cannot flap when pressure hovers across a threshold boundary', () => {
    const state = createTerrainDetailShedState();
    for (let i = 0; i < 60 * 60; i++) {
      updateTerrainDetailShed(state, DT, i % 2 === 0 ? 1.05 : 0.95, true);
      expect(state.level).toBe(1);
    }
  });

  it('a disabled governor forces level 1 and clears the dwell clocks', () => {
    const state = createTerrainDetailShedState();
    run(state, STEP_SETTLE_SECONDS, 2);
    expect(state.level).toBeLessThan(1);
    updateTerrainDetailShed(state, DT, 2, false);
    expect(state).toEqual({ level: 1, target: 1, overSeconds: 0, calmSeconds: 0 });
  });

  it('a pinned level (a dev A/B pin) snaps immediately and ignores pressure', () => {
    const state = createTerrainDetailShedState();
    updateTerrainDetailShed(state, DT, 5, true, 0.5);
    expect(state.level).toBe(0.5);
    expect(state.target).toBe(0.5);
    for (let i = 0; i < 600; i++) updateTerrainDetailShed(state, DT, 5, true, 0.5);
    expect(state.level).toBe(0.5);
    for (let i = 0; i < 600; i++) updateTerrainDetailShed(state, DT, 0, true, 0.5);
    expect(state.level).toBe(0.5);
    // Clamped to 0..1.
    updateTerrainDetailShed(state, DT, 0, true, 2.5);
    expect(state.level).toBe(1);
    updateTerrainDetailShed(state, DT, 0, true, -2.5);
    expect(state.level).toBe(0);
  });

  it('holds the plan untouched on degenerate dt (neither dwell nor a wipe)', () => {
    const state = createTerrainDetailShedState();
    updateTerrainDetailShed(state, Number.NaN, 2, true);
    updateTerrainDetailShed(state, 0, 2, true);
    updateTerrainDetailShed(state, -1, 2, true);
    expect(state).toEqual({ level: 1, target: 1, overSeconds: 0, calmSeconds: 0 });
    run(state, STEP_SETTLE_SECONDS, 2);
    const before = { ...state };
    updateTerrainDetailShed(state, Number.NaN, 0.1, true);
    updateTerrainDetailShed(state, 0, 0.1, true);
    expect(state).toEqual(before);
  });

  it('mutates and returns the caller-owned state (per-frame path allocates nothing)', () => {
    const state = createTerrainDetailShedState();
    expect(updateTerrainDetailShed(state, DT, 0.4, true)).toBe(state);
  });

  it('resetTerrainDetailShed returns to the initial level-1 state', () => {
    const state = createTerrainDetailShedState();
    run(state, STEP_SETTLE_SECONDS, 2);
    resetTerrainDetailShed(state);
    expect(state).toEqual({ level: 1, target: 1, overSeconds: 0, calmSeconds: 0 });
  });
});
