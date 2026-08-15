import { describe, expect, it } from 'vitest';
import {
  createStepSmooth,
  resetStepSmooth,
  STEP_SMOOTH_MAX_LAG,
  STEP_SMOOTH_SNAP,
  stepSmoothHeight,
} from '../src/render/step_smooth_core';
import { MAX_STEP_HEIGHT } from '../src/sim/physics';

// Display-only vertical smoothing: the visual half of step-up. The physical
// height must stay authoritative; only what is DRAWN is eased.

const DT = 1 / 60;

describe('step smoothing', () => {
  it('passes flat ground through untouched', () => {
    const s = createStepSmooth();
    expect(stepSmoothHeight(s, 5, true, DT)).toBe(5);
    for (let i = 0; i < 60; i++) expect(stepSmoothHeight(s, 5, true, DT)).toBe(5);
  });

  it('eases a full step-up instead of popping, and lands exactly on it', () => {
    const s = createStepSmooth();
    stepSmoothHeight(s, 0, true, DT);
    // The solver moves the feet a whole step height in one tick.
    const first = stepSmoothHeight(s, MAX_STEP_HEIGHT, true, DT);
    expect(first).toBeLessThan(MAX_STEP_HEIGHT * 0.6); // did not pop
    expect(first).toBeGreaterThan(0); // but did begin to rise
    let prev = first;
    for (let i = 0; i < 60; i++) {
      const y = stepSmoothHeight(s, MAX_STEP_HEIGHT, true, DT);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9); // monotone, never dips
      prev = y;
    }
    expect(prev).toBeCloseTo(MAX_STEP_HEIGHT, 5); // settles on the truth
  });

  it('never lags further than a step, even against a staircase of them', () => {
    const s = createStepSmooth();
    let y = 0;
    stepSmoothHeight(s, y, true, DT);
    for (let i = 0; i < 40; i++) {
      y += MAX_STEP_HEIGHT; // absurd: a step every single frame
      const drawn = stepSmoothHeight(s, y, true, DT);
      expect(y - drawn).toBeLessThanOrEqual(STEP_SMOOTH_MAX_LAG + 1e-9);
    }
  });

  it('leaves jumps and falls exact', () => {
    const s = createStepSmooth();
    stepSmoothHeight(s, 0, true, DT);
    // Airborne: every frame must draw the physical height.
    let y = 0;
    for (let i = 0; i < 30; i++) {
      y += 0.25;
      expect(stepSmoothHeight(s, y, false, DT)).toBeCloseTo(y, 6);
    }
    for (let i = 0; i < 30; i++) {
      y -= 0.3;
      expect(stepSmoothHeight(s, y, false, DT)).toBeCloseTo(y, 6);
    }
  });

  it('absorbs a mantle catch: a flight ending on a surface ABOVE the feet', () => {
    // Jumping onto a boulder ends the arc by being pulled UP onto the top.
    // Gravity never does that, so it is the mantle, and drawing it raw is the
    // teleport-onto-the-rock jank this rule exists to remove.
    const s = createStepSmooth();
    stepSmoothHeight(s, 0, true, DT);
    let y = 0;
    for (let i = 0; i < 6; i++) {
      y += 0.1; // rising through the arc, airborne: exact
      expect(stepSmoothHeight(s, y, false, DT)).toBeCloseTo(y, 6);
    }
    // The catch: feet snap up onto the ledge as the body becomes grounded.
    const top = y + 0.7;
    const drawn = stepSmoothHeight(s, top, true, DT);
    expect(drawn).toBeLessThan(top - 0.2); // eased, not teleported
    expect(drawn).toBeGreaterThan(y - 1e-9); // and never dips below the arc
    let prev = drawn;
    for (let i = 0; i < 60; i++) {
      const next = stepSmoothHeight(s, top, true, DT);
      expect(next).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = next;
    }
    expect(prev).toBeCloseTo(top, 5);
  });

  it('keeps a real landing exact: a flight ending on a surface BELOW', () => {
    // The impact is the point; damping it would make gravity feel like syrup.
    const s = createStepSmooth();
    stepSmoothHeight(s, 10, true, DT);
    let y = 10;
    for (let i = 0; i < 8; i++) {
      y -= 0.28;
      expect(stepSmoothHeight(s, y, false, DT)).toBeCloseTo(y, 6);
    }
    const floor = y - 0.28;
    expect(stepSmoothHeight(s, floor, true, DT)).toBeCloseTo(floor, 6);
  });

  it('snaps on a teleport rather than gliding across the world', () => {
    const s = createStepSmooth();
    stepSmoothHeight(s, 0, true, DT);
    const drawn = stepSmoothHeight(s, STEP_SMOOTH_SNAP + 50, true, DT);
    expect(drawn).toBeCloseTo(STEP_SMOOTH_SNAP + 50, 4);
  });

  it('is frame-rate independent', () => {
    const a = createStepSmooth();
    const b = createStepSmooth();
    stepSmoothHeight(a, 0, true, 1 / 60);
    stepSmoothHeight(b, 0, true, 1 / 240);
    let ya = 0;
    let yb = 0;
    for (let i = 0; i < 12; i++) ya = stepSmoothHeight(a, 0.9, true, 1 / 60); // 0.2 s
    for (let i = 0; i < 48; i++) yb = stepSmoothHeight(b, 0.9, true, 1 / 240); // 0.2 s
    expect(Math.abs(ya - yb)).toBeLessThan(0.02);
  });

  it('re-seats after a reset', () => {
    const s = createStepSmooth();
    stepSmoothHeight(s, 0, true, DT);
    stepSmoothHeight(s, 0.9, true, DT);
    resetStepSmooth(s);
    expect(stepSmoothHeight(s, 12, true, DT)).toBe(12);
  });
});
