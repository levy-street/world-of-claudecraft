import { describe, expect, it } from 'vitest';
import {
  LOOK_SPIKE_FIRST_DT_MS,
  LOOK_SPIKE_FLOOR_PX,
  LOOK_SPIKE_HISTORY,
  LOOK_SPIKE_MIN_DT_MS,
  LOOK_SPIKE_RATIO,
  LookDeltaGuard,
  normalizePointerLookDelta,
} from '../src/game/pointer_look_delta';

describe('normalizePointerLookDelta', () => {
  it('is identity on Chromium (physical pixels already, any devicePixelRatio)', () => {
    // Chrome parity: the deltas must pass through untouched no matter the ratio.
    expect(
      normalizePointerLookDelta({
        movementX: 12,
        movementY: -7,
        isGecko: false,
        devicePixelRatio: 2,
      }),
    ).toEqual({ dx: 12, dy: -7 });
    expect(
      normalizePointerLookDelta({
        movementX: 12,
        movementY: -7,
        isGecko: false,
        devicePixelRatio: 1,
      }),
    ).toEqual({ dx: 12, dy: -7 });
  });

  it('leaves Gecko unchanged at devicePixelRatio 1 (CSS pixel == physical pixel there)', () => {
    expect(
      normalizePointerLookDelta({
        movementX: 12,
        movementY: -7,
        isGecko: true,
        devicePixelRatio: 1,
      }),
    ).toEqual({ dx: 12, dy: -7 });
  });

  it('scales Gecko CSS-pixel deltas up to Chromium physical pixels on a 2x display', () => {
    // The reported Firefox bug: on a retina/HiDPI display Firefox reports half
    // the delta Chrome does, so multiplying by the ratio restores parity.
    expect(
      normalizePointerLookDelta({ movementX: 5, movementY: 3, isGecko: true, devicePixelRatio: 2 }),
    ).toEqual({ dx: 10, dy: 6 });
  });

  it('scales Gecko by fractional page-zoom ratios too', () => {
    expect(
      normalizePointerLookDelta({
        movementX: 4,
        movementY: 4,
        isGecko: true,
        devicePixelRatio: 1.5,
      }),
    ).toEqual({ dx: 6, dy: 6 });
  });

  it('reaches Chrome parity: same physical motion yields the same normalized delta on both engines', () => {
    const dpr = 2;
    const physical = 20; // what Chrome reports for a given physical mouse motion
    const chrome = normalizePointerLookDelta({
      movementX: physical,
      movementY: 0,
      isGecko: false,
      devicePixelRatio: dpr,
    });
    const firefox = normalizePointerLookDelta({
      movementX: physical / dpr, // Firefox reports CSS pixels for the same motion
      movementY: 0,
      isGecko: true,
      devicePixelRatio: dpr,
    });
    expect(firefox.dx).toBe(chrome.dx);
  });

  it('falls back to identity on a non-finite or non-positive ratio (never freezes or blows up the camera)', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        normalizePointerLookDelta({
          movementX: 9,
          movementY: 2,
          isGecko: true,
          devicePixelRatio: bad,
        }),
      ).toEqual({ dx: 9, dy: 2 });
    }
  });
});

describe('LookDeltaGuard', () => {
  // A steady stream at `mag` px every `dtMs`, starting at `t0`; returns the next time.
  function stream(guard: LookDeltaGuard, mag: number, dtMs: number, count: number, t0: number) {
    let t = t0;
    for (let i = 0; i < count; i++) {
      t += dtMs;
      expect(guard.filter(mag, 0, t)).toEqual({ dx: mag, dy: 0 });
    }
    return t;
  }

  it('pins the tuning constants the spike rule is reasoned against', () => {
    expect(LOOK_SPIKE_FLOOR_PX).toBe(250);
    expect(LOOK_SPIKE_RATIO).toBe(8);
    expect(LOOK_SPIKE_HISTORY).toBe(8);
    expect(LOOK_SPIKE_MIN_DT_MS).toBe(1);
    expect(LOOK_SPIKE_FIRST_DT_MS).toBeCloseTo(16.667, 2);
  });

  it('passes ordinary motion through unchanged, including a zero delta', () => {
    const guard = new LookDeltaGuard();
    expect(guard.filter(0, 0, 0)).toEqual({ dx: 0, dy: 0 });
    expect(guard.filter(3, -2, 1)).toEqual({ dx: 3, dy: -2 });
    expect(guard.filter(-40, 25, 17)).toEqual({ dx: -40, dy: 25 });
    expect(guard.dropped).toBe(0);
  });

  it('drops an isolated spike out of a calm 1000 Hz stream', () => {
    // The reported bug: single-digit deltas every millisecond, then one bogus
    // reading of several hundred pixels.
    const guard = new LookDeltaGuard();
    let t = stream(guard, 4, 1, 8, 0);
    expect(guard.filter(900, -300, ++t)).toBeNull();
    // Held for one event; calm motion after it marks it as a spike.
    expect(guard.filter(4, 0, ++t)).toEqual({ dx: 4, dy: 0 });
    expect(guard.dropped).toBe(1);
  });

  it('drops an isolated spike out of a frame-coalesced 60 Hz stream', () => {
    const guard = new LookDeltaGuard();
    let t = stream(guard, 30, 16, 8, 0);
    t += 16;
    expect(guard.filter(-1200, 0, t)).toBeNull();
    t += 16;
    expect(guard.filter(30, 0, t)).toEqual({ dx: 30, dy: 0 });
    expect(guard.dropped).toBe(1);
  });

  it('keeps a big delta that built up over a frame hitch at the usual speed', () => {
    // Browsers merge the moves queued during a long task into one event. At the
    // usual 30 px per 16 ms that is ~280 px over a 150 ms stall: real motion.
    const guard = new LookDeltaGuard();
    const t = stream(guard, 30, 16, 8, 0);
    expect(guard.filter(280, 0, t + 150)).toEqual({ dx: 280, dy: 0 });
    expect(guard.dropped).toBe(0);
  });

  it('applies a fast flick from rest, one event late, rather than losing it', () => {
    // A high-DPI flick: the first coalesced frame is already over the floor
    // with only jitter before it, so it is held, then the next frame confirms.
    const guard = new LookDeltaGuard();
    let t = stream(guard, 1, 16, 4, 0);
    t += 16;
    expect(guard.filter(400, 0, t)).toBeNull();
    t += 16;
    expect(guard.filter(1000, 20, t)).toEqual({ dx: 1400, dy: 20 });
    // The flick is now the recent motion, so it keeps flowing.
    t += 16;
    expect(guard.filter(1200, 0, t)).toEqual({ dx: 1200, dy: 0 });
    expect(guard.dropped).toBe(0);
  });

  it('applies a warp and its immediate counter-warp together, which cancel out', () => {
    const guard = new LookDeltaGuard();
    let t = stream(guard, 3, 1, 8, 0);
    expect(guard.filter(800, 0, ++t)).toBeNull();
    expect(guard.filter(-800, 0, ++t)).toEqual({ dx: 0, dy: 0 });
  });

  it('never treats a delta at or under the absolute floor as a spike', () => {
    const guard = new LookDeltaGuard();
    const t = stream(guard, 1, 1, 8, 0);
    expect(guard.filter(LOOK_SPIKE_FLOOR_PX, 0, t + 1)).toEqual({
      dx: LOOK_SPIKE_FLOOR_PX,
      dy: 0,
    });
  });

  it('holds a delta just over RATIO times the recent speed, passes one at the limit', () => {
    // Timestamp-less mode makes the limit exact: RATIO times the recent average size.
    const at = new LookDeltaGuard();
    for (let i = 0; i < 8; i++) at.filter(50, 0);
    expect(at.filter(50 * LOOK_SPIKE_RATIO, 0)).toEqual({ dx: 50 * LOOK_SPIKE_RATIO, dy: 0 });
    const over = new LookDeltaGuard();
    for (let i = 0; i < 8; i++) over.filter(50, 0);
    expect(over.filter(50 * LOOK_SPIKE_RATIO + 1, 0)).toBeNull();
  });

  it('measures the size on both axes, not just X', () => {
    const guard = new LookDeltaGuard();
    const t = stream(guard, 4, 1, 8, 0);
    expect(guard.filter(0, 600, t + 1)).toBeNull();
  });

  it('only keeps the last HISTORY deltas in the recent speed', () => {
    // Timestamp-less, so recent speed is the average size of the window.
    const feed = (guard: LookDeltaGuard, sizes: number[]) => {
      for (const m of sizes) guard.filter(m, 0);
    };
    const fast = Array<number>(8).fill(2000);
    // One 2000 px sample still inside the window lifts the limit over 1000.
    const inWindow = new LookDeltaGuard();
    feed(inWindow, [250, ...fast, ...Array<number>(LOOK_SPIKE_HISTORY - 1).fill(2)]);
    expect(inWindow.filter(1000, 0)).toEqual({ dx: 1000, dy: 0 });
    // One more calm sample pushes the last fast one out: 1000 px is suspect.
    const pushedOut = new LookDeltaGuard();
    feed(pushedOut, [250, ...fast, ...Array<number>(LOOK_SPIKE_HISTORY).fill(2)]);
    expect(pushedOut.filter(1000, 0)).toBeNull();
  });

  it('confirms a held suspect at exactly 1/RATIO of its speed, drops it just below', () => {
    const confirmed = new LookDeltaGuard();
    for (let i = 0; i < 8; i++) confirmed.filter(4, 0);
    expect(confirmed.filter(800, 0)).toBeNull();
    expect(confirmed.filter(800 / LOOK_SPIKE_RATIO, 0)).toEqual({ dx: 900, dy: 0 });

    const dropped = new LookDeltaGuard();
    for (let i = 0; i < 8; i++) dropped.filter(4, 0);
    expect(dropped.filter(800, 0)).toBeNull();
    expect(dropped.filter(800 / LOOK_SPIKE_RATIO - 1, 0)).toEqual({ dx: 99, dy: 0 });
    expect(dropped.dropped).toBe(1);
  });

  it('a suspect held before the lock engaged is never summed into a move after it', () => {
    const guard = new LookDeltaGuard();
    let t = stream(guard, 4, 1, 8, 0);
    expect(guard.filter(900, 0, ++t)).toBeNull();
    guard.skipNextDelta();
    expect(guard.filter(900, 0, ++t)).toBeNull();
    // Had the stale suspect survived, this would confirm it and return 1800.
    expect(guard.filter(900, 0, ++t)).toBeNull();
  });

  it('reset alone discards a held suspect', () => {
    const guard = new LookDeltaGuard();
    let t = stream(guard, 4, 1, 8, 0);
    expect(guard.filter(900, 0, ++t)).toBeNull();
    guard.reset();
    // A fresh press: had the suspect survived, this would confirm it (1800).
    expect(guard.filter(900, 0, ++t)).toBeNull();
  });

  it('reset restarts the clock, so a new press is not timed from the last drag', () => {
    const guard = new LookDeltaGuard();
    const t = stream(guard, 4, 1, 8, 0);
    guard.reset();
    // First event of the new press counts as one 60 Hz frame (12 px/ms), not
    // the 5 s gap since the last drag, so a 300 px move 4 ms later (75 px/ms)
    // is within RATIO of it and applies.
    expect(guard.filter(200, 0, t + 5000)).toEqual({ dx: 200, dy: 0 });
    expect(guard.filter(300, 0, t + 5004)).toEqual({ dx: 300, dy: 0 });
  });

  it('without timestamps, judges by size against the recent average', () => {
    const guard = new LookDeltaGuard();
    for (let i = 0; i < 8; i++) expect(guard.filter(4, 0)).toEqual({ dx: 4, dy: 0 });
    expect(guard.filter(900, 0)).toBeNull();
    expect(guard.filter(4, 0)).toEqual({ dx: 4, dy: 0 });
    expect(guard.dropped).toBe(1);
  });

  it('skips exactly the next non-zero delta after the lock engages', () => {
    const guard = new LookDeltaGuard();
    let t = stream(guard, 4, 1, 8, 0);
    guard.skipNextDelta();
    // A zero delta does not consume the skip.
    expect(guard.filter(0, 0, ++t)).toEqual({ dx: 0, dy: 0 });
    // Even a small post-lock delta is dropped: it may carry the cursor warp.
    expect(guard.filter(3, 0, ++t)).toBeNull();
    expect(guard.filter(3, 0, ++t)).toEqual({ dx: 3, dy: 0 });
    expect(guard.dropped).toBe(1);
  });

  it('a lock engaging while a suspect is held drops the suspect too', () => {
    const guard = new LookDeltaGuard();
    let t = stream(guard, 4, 1, 8, 0);
    expect(guard.filter(900, 0, ++t)).toBeNull();
    guard.skipNextDelta();
    expect(guard.filter(900, 0, ++t)).toBeNull();
    expect(guard.dropped).toBe(2);
    expect(guard.filter(4, 0, ++t)).toEqual({ dx: 4, dy: 0 });
  });

  it('reset forgets the recent motion, a held suspect and a pending skip', () => {
    const guard = new LookDeltaGuard();
    let t = stream(guard, 4, 1, 8, 0);
    expect(guard.filter(900, 0, ++t)).toBeNull();
    guard.skipNextDelta();
    guard.reset();
    // No skip pending and nothing held: the next small delta applies as-is.
    expect(guard.filter(10, 0, ++t)).toEqual({ dx: 10, dy: 0 });
    // With history forgotten only the floor applies: 251 px straight away is suspect.
    const fresh = new LookDeltaGuard();
    t = stream(fresh, 200, 1, 8, 0);
    fresh.reset();
    expect(fresh.filter(LOOK_SPIKE_FLOOR_PX + 1, 0, t + 1)).toBeNull();
  });

  it('drops a non-finite delta', () => {
    const guard = new LookDeltaGuard();
    expect(guard.filter(Number.NaN, 0, 1)).toBeNull();
    expect(guard.filter(Number.POSITIVE_INFINITY, 0, 2)).toBeNull();
    expect(guard.dropped).toBe(2);
  });
});
