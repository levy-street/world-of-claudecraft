import { describe, expect, it } from 'vitest';
import {
  BASE_SNAP_DIST_SQ,
  MAX_PLAUSIBLE_ENTITY_SPEED,
  reanchorDecision,
  SNAP_GAP_CAP_MS,
} from '../src/net/entity_reanchor';

// Root cause A (net-interp jitter hitching): the ORIGINAL flat 40yd snap
// threshold ignored how much time had elapsed, so a fast-but-legitimate mover
// (mounted, or warrior Charge at 21 yd/s) crossed it during an ordinary
// network gap and got a hard pop instead of a glide. reanchorDecision widens
// the threshold with elapsed time, bounded by a plausible top speed, so only a
// distance no real movement could explain still snaps.
describe('reanchorDecision: snap threshold', () => {
  it('short gap, small delta: does not snap (identical to the original flat threshold)', () => {
    const d = reanchorDecision({
      gapMs: 100,
      deltaSq: 3 * 3, // 3yd, well under 40yd
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.snap).toBe(false);
  });

  it('short gap, delta just over the base 40yd floor: still snaps (floor preserved)', () => {
    const d = reanchorDecision({
      gapMs: 50,
      deltaSq: 41 * 41,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.snap).toBe(true);
  });

  it('long gap, plausible fast movement (~45yd over 2s, ~22.5 yd/s): glides instead of snapping', () => {
    // 45yd would have crossed the OLD flat 40yd threshold every time.
    expect(45 * 45).toBeGreaterThan(BASE_SNAP_DIST_SQ);
    const d = reanchorDecision({
      gapMs: 2000,
      deltaSq: 45 * 45,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.snap).toBe(false);
  });

  it('a genuine teleport in a short gap still snaps even with the widened window', () => {
    const d = reanchorDecision({
      gapMs: 100,
      deltaSq: 200 * 200,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.snap).toBe(true);
  });

  it('a life-state flip (release -> revive) always snaps, regardless of distance', () => {
    const d = reanchorDecision({
      gapMs: 100,
      deltaSq: 0,
      prevInterval: undefined,
      reviveEdge: true,
    });
    expect(d.snap).toBe(true);
  });

  it('the plausibility window is capped: an extreme gap does not waive the threshold to an unbounded distance', () => {
    const cappedAllowance = MAX_PLAUSIBLE_ENTITY_SPEED * (SNAP_GAP_CAP_MS / 1000) + 2;
    const d = reanchorDecision({
      gapMs: 60_000, // a full minute of "silence"
      deltaSq: (cappedAllowance + 20) * (cappedAllowance + 20),
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.snap).toBe(true);
  });

  it('an entity with no prior update (gapMs undefined) falls back to the base floor', () => {
    const d = reanchorDecision({
      gapMs: undefined,
      deltaSq: 3 * 3,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.snap).toBe(false);
    const dFar = reanchorDecision({
      gapMs: undefined,
      deltaSq: 100 * 100,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(dFar.snap).toBe(true);
  });
});

// Interval learning is UNCHANGED from before this module existed: a wider
// "maybe a long gap is jitter, not idleness" arm was tried and reverted
// (tests/interest.test.ts "keeps the cadence estimate clean across idle
// pauses" caught it as a real regression) because a single entity's own
// update history cannot tell a network stall apart from the entity simply
// going idle - a mover that WAS updating regularly can legitimately stop
// changing state, and the server sends no record either way.
describe('reanchorDecision: interval learning', () => {
  it('normal band, no prior interval: adopts the gap outright', () => {
    const d = reanchorDecision({
      gapMs: 100,
      deltaSq: 0,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.netInterval).toBe(100);
  });

  it('normal band, with a prior interval: blends 0.7/0.3', () => {
    const d = reanchorDecision({ gapMs: 200, deltaSq: 0, prevInterval: 100, reviveEdge: false });
    expect(d.netInterval).toBeCloseTo(100 * 0.7 + 200 * 0.3, 9);
  });

  it('below the band floor (<=5ms): leaves the interval unchanged', () => {
    const d = reanchorDecision({ gapMs: 3, deltaSq: 0, prevInterval: 120, reviveEdge: false });
    expect(d.netInterval).toBeUndefined();
  });

  it('an idle pause on a PREVIOUSLY regular mover does not smear the estimate (the reverted-fix regression)', () => {
    // a mover establishes a 100ms cadence, then goes idle (state unchanged)
    // for 800ms: the same shape tests/interest.test.ts pins at the
    // ClientWorld level, exercised here directly against the pure core
    const d = reanchorDecision({ gapMs: 800, deltaSq: 0, prevInterval: 100, reviveEdge: false });
    expect(d.netInterval).toBeUndefined();
  });

  it('an entity with no prior interval at all: an out-of-band gap still teaches nothing', () => {
    const d = reanchorDecision({
      gapMs: 700,
      deltaSq: 0,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.netInterval).toBeUndefined();
  });

  it('a brand new entity (gapMs undefined) never learns an interval', () => {
    const d = reanchorDecision({
      gapMs: undefined,
      deltaSq: 0,
      prevInterval: undefined,
      reviveEdge: false,
    });
    expect(d.netInterval).toBeUndefined();
  });
});
