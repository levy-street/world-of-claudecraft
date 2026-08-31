import { describe, expect, it } from 'vitest';
import { InputEchoTracker } from '../src/net/input_echo_tracker';

const ALPHA = 0.2;

describe('InputEchoTracker', () => {
  it('starts at zero and stays there on an empty fold', () => {
    const t = new InputEchoTracker();
    t.fold([]);
    expect(t.echoMs).toBe(0);
    expect(t.jitterMs).toBe(0);
  });

  it('seeds the mean on the first sample instead of easing up from zero', () => {
    const t = new InputEchoTracker();
    t.fold([120]);
    expect(t.echoMs).toBe(120);
    // No prior mean, so there is no deviation to measure yet.
    expect(t.jitterMs).toBe(0);
  });

  it('eases the mean toward each later sample at alpha 0.2', () => {
    const t = new InputEchoTracker();
    t.fold([100, 200]);
    expect(t.echoMs).toBeCloseTo(100 + ALPHA * 100, 10);
    t.fold([200]);
    expect(t.echoMs).toBeCloseTo(120 + ALPHA * 80, 10);
  });

  it('measures jitter against the PRIOR mean, before the mean moves', () => {
    const t = new InputEchoTracker();
    t.fold([100, 200]);
    // Deviation is |200 - 100| = 100 against the prior mean, not |200 - 120|.
    expect(t.jitterMs).toBe(100);
    t.fold([140]);
    // Prior mean is 120, so dev = 20, folded at alpha 0.2 into 100.
    expect(t.jitterMs).toBeCloseTo(100 + ALPHA * (20 - 100), 10);
  });

  it('seeds jitter on its own first non-zero deviation', () => {
    const t = new InputEchoTracker();
    // Two identical samples keep jitter at 0, so the next deviation seeds it
    // outright rather than being eased in from zero.
    t.fold([100, 100, 150]);
    expect(t.echoMs).toBeCloseTo(110, 10);
    expect(t.jitterMs).toBe(50);
  });

  it('folds a batch in order, identically to one sample at a time', () => {
    const batch = new InputEchoTracker();
    batch.fold([80, 240, 100, 30]);
    const oneAtATime = new InputEchoTracker();
    for (const sample of [80, 240, 100, 30]) oneAtATime.fold([sample]);
    expect(batch.echoMs).toBeCloseTo(oneAtATime.echoMs, 10);
    expect(batch.jitterMs).toBeCloseTo(oneAtATime.jitterMs, 10);
  });

  it('ignores negative and non-finite samples so a bad frame cannot poison it', () => {
    const t = new InputEchoTracker();
    t.fold([100]);
    t.fold([-1, Number.NaN, Number.POSITIVE_INFINITY]);
    expect(t.echoMs).toBe(100);
    expect(t.jitterMs).toBe(0);
  });

  it('accepts a zero sample (a zero-RTT echo is a real reading)', () => {
    const t = new InputEchoTracker();
    t.fold([0, 50]);
    // The first sample seeds the mean at 0, which is also the "unseeded"
    // sentinel, so the 50 seeds it again rather than easing 0 -> 10.
    expect(t.echoMs).toBe(50);
    expect(t.jitterMs).toBe(0);
  });
});
