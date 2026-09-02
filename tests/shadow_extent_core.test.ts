import { describe, expect, it } from 'vitest';
import { SHADOW_CASTER_MARGIN } from '../src/render/foliage_shadow_core';
import {
  createShadowCadenceState,
  SHADOW_CADENCE_ENTER_SECONDS,
  SHADOW_CADENCE_EXIT_SECONDS,
  updateShadowCadence,
} from '../src/render/shadow_cadence_core';
import {
  createShadowExtent,
  resetShadowExtent,
  SHADOW_EXTENT_BASE_YARDS,
  SHADOW_EXTENT_CASTER_MARGIN_YARDS,
  SHADOW_EXTENT_ENTER_PRESSURE,
  SHADOW_EXTENT_ENTER_SECONDS,
  SHADOW_EXTENT_EXIT_PRESSURE,
  SHADOW_EXTENT_EXIT_SECONDS,
  SHADOW_EXTENT_FLOOR_YARDS,
  SHADOW_EXTENT_PROXY_RANGE_YARDS,
  SHADOW_EXTENT_RIG_RADIUS_YARDS,
  SHADOW_EXTENT_SCALES,
  type ShadowExtentState,
  shadowExtentHalf,
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

  it('lets the cadence both engage first and release first', () => {
    // The ORDER, stated the way it actually runs: the cadence engages before
    // the extent (1.5 s against 3 s) AND releases before it (4 s against 6 s),
    // so the extent is the deeper shed going down and the LAST thing given
    // back coming up. An earlier draft of the core header claimed the extent
    // was restored while the cadence was still engaged, which is the opposite
    // of what these constants do; this is the pin that keeps the header true.
    expect(SHADOW_EXTENT_ENTER_SECONDS).toBeGreaterThan(SHADOW_CADENCE_ENTER_SECONDS);
    expect(SHADOW_EXTENT_EXIT_SECONDS).toBeGreaterThan(SHADOW_CADENCE_EXIT_SECONDS);
  });

  it('walks the cadence and the extent together, and pins the release order', () => {
    // Both ladders driven off ONE pressure trace, so the claim above is proven
    // on behaviour and not just on the constants.
    const extent = createShadowExtent();
    const cadence = createShadowCadenceState();
    const step = (seconds: number, pressure: number) => {
      for (let t = 0; t < seconds; t += DT) {
        updateShadowExtent(extent, DT, pressure, true);
        updateShadowCadence(cadence, DT, pressure, true);
      }
    };
    // Going down: the cadence sheds while the extent is still at full.
    step(SHADOW_CADENCE_ENTER_SECONDS + 0.5, 2);
    expect(cadence.halfRate).toBe(true);
    expect(extent.step).toBe(0);
    step(30, 2);
    expect(extent.step).toBe(SHADOW_EXTENT_SCALES.length - 1);
    // Coming up: the cadence is back at full rate while the box is still shed.
    step(SHADOW_CADENCE_EXIT_SECONDS + 0.5, 0.2);
    expect(cadence.halfRate).toBe(false);
    expect(extent.step).toBeGreaterThan(0);
    step(60, 0.2);
    expect(extent.step).toBe(0);
  });

  it('floors the half-extent in WORLD space, so the lean base cannot undercut it', () => {
    // The floor is the range past which a character stops casting at all, plus
    // the margin the other shadow culls use, plus a rig radius.
    expect(SHADOW_EXTENT_FLOOR_YARDS).toBe(
      SHADOW_EXTENT_PROXY_RANGE_YARDS +
        SHADOW_EXTENT_CASTER_MARGIN_YARDS +
        SHADOW_EXTENT_RIG_RADIUS_YARDS,
    );
    // The outdoor base: the deepest step clamps UP to the floor rather than
    // taking the raw 0.6 multiplier.
    const deepest = SHADOW_EXTENT_SCALES.at(-1) ?? 0;
    expect(SHADOW_EXTENT_BASE_YARDS * deepest).toBeLessThan(SHADOW_EXTENT_FLOOR_YARDS);
    expect(shadowExtentHalf(SHADOW_EXTENT_BASE_YARDS, deepest)).toBe(SHADOW_EXTENT_FLOOR_YARDS);
    // The lean arm (renderer.ts's LOW_GFX base), which a pure scale floor
    // would have driven to 51 yd, well inside the proxy band.
    expect(85 * deepest).toBeLessThan(SHADOW_EXTENT_PROXY_RANGE_YARDS);
    expect(shadowExtentHalf(85, deepest)).toBe(SHADOW_EXTENT_FLOOR_YARDS);
    // Every step of every base clears the proxy band.
    for (const base of [85, 105]) {
      for (const scale of SHADOW_EXTENT_SCALES) {
        expect(shadowExtentHalf(base, scale)).toBeGreaterThan(SHADOW_EXTENT_PROXY_RANGE_YARDS);
      }
    }
  });

  it('never widens the box past the base, and answers 0 for a degenerate base', () => {
    // The clamp may only keep the box BIGGER than the scale alone would; a
    // base already at or under the floor is passed through unshed, never
    // inflated to the floor (that would make a shed cost MORE than no shed).
    for (const scale of SHADOW_EXTENT_SCALES) {
      for (const base of [10, 40, SHADOW_EXTENT_FLOOR_YARDS, 85, 105, 200]) {
        expect(shadowExtentHalf(base, scale)).toBeLessThanOrEqual(base);
      }
    }
    expect(shadowExtentHalf(0, 1)).toBe(0);
    expect(shadowExtentHalf(-5, 1)).toBe(0);
    expect(shadowExtentHalf(105, 1)).toBe(105);
  });

  it("restates foliage_shadow_core's caster margin without drifting from it", () => {
    // This core imports nothing (the wiring test scans it), so the margin is a
    // copy. The copy is only safe while this pin holds.
    expect(SHADOW_EXTENT_CASTER_MARGIN_YARDS).toBe(SHADOW_CASTER_MARGIN);
  });
});
