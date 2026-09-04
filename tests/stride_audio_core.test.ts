// The stride accumulator core (RENDER_PURE_CORES): the distance trigger the
// renderer's movement-audio arm shares across footsteps, swim strokes, and
// mount gait beats. Node-only: no Three, no DOM.
import { describe, expect, it } from 'vitest';
import { strideHit } from '../src/render/stride_audio_core';

describe('strideHit', () => {
  it('fires exactly when accumulated travel crosses the stride and resets', () => {
    const view = { stepAccum: 0 };
    // 4.5 speed at 20 Hz: 0.225 travel per frame against a 0.95 walk stride.
    expect(strideHit(view, 4.5, 0.05, 0.95)).toBe(false);
    expect(strideHit(view, 4.5, 0.05, 0.95)).toBe(false);
    expect(strideHit(view, 4.5, 0.05, 0.95)).toBe(false);
    expect(strideHit(view, 4.5, 0.05, 0.95)).toBe(false); // 0.9, still short
    expect(strideHit(view, 4.5, 0.05, 0.95)).toBe(true); // 1.125 crosses
    expect(view.stepAccum).toBe(0); // hard reset, no carry-over remainder
  });

  it('respects a primed accumulator so the first step lands promptly', () => {
    // The renderer primes standing entities to 60% of a walk stride; the next
    // movement frame should fire after only the remaining 40% of travel.
    const view = { stepAccum: 0.95 * 0.6 };
    expect(strideHit(view, 4.5, 0.05, 0.95)).toBe(false); // 0.795
    expect(strideHit(view, 4.5, 0.05, 0.95)).toBe(true); // 1.02 crosses
  });

  it('never fires while stationary regardless of accumulated frames', () => {
    const view = { stepAccum: 0.5 };
    for (let i = 0; i < 100; i++) expect(strideHit(view, 0, 0.05, 0.95)).toBe(false);
    expect(view.stepAccum).toBe(0.5);
  });
});
