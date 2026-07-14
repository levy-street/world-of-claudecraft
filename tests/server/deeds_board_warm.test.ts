// Demand gate for the Renown (deeds) board warm loop (server/deeds_board_warm.ts).
// The board is a full-table roll-up of character_deeds, so the 30s warm loop must
// re-read it only while someone is viewing. These pin the decision helper's window
// logic and the wiring gate, with a spy standing in for the full-table read so a
// regression that drops the gate (warming an idle board) fails decisively.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEEDS_BOARD_DEMAND_TTL_MS,
  shouldWarmDeedsBoard,
  singleFlight,
  warmDeedsBoardIfDemanded,
} from '../../server/deeds_board_warm';

// A fixed, realistic wall clock so `now - 0` for an unrequested board is the full
// epoch distance (far past any window), exactly as at runtime.
const NOW = Date.parse('2026-07-11T12:00:00.000Z');

describe('DEEDS_BOARD_DEMAND_TTL_MS', () => {
  it('is ten minutes', () => {
    // Pinned as a literal, not re-derived from the export: the window is a
    // deliberate balance (longer than a viewer's gaps between clicks, short enough
    // that an abandoned board stops costing the read within one window).
    expect(DEEDS_BOARD_DEMAND_TTL_MS).toBe(600_000);
    expect(DEEDS_BOARD_DEMAND_TTL_MS).toBe(10 * 60_000);
  });
});

describe('shouldWarmDeedsBoard', () => {
  it('is false before any request (lastRequestAt 0), so an untouched board never warms', () => {
    expect(shouldWarmDeedsBoard(0, NOW, DEEDS_BOARD_DEMAND_TTL_MS)).toBe(false);
  });

  it('is true when the last request is inside the window', () => {
    const recent = NOW - (DEEDS_BOARD_DEMAND_TTL_MS - 1);
    expect(shouldWarmDeedsBoard(recent, NOW, DEEDS_BOARD_DEMAND_TTL_MS)).toBe(true);
  });

  it('is false once demand has lapsed past the window', () => {
    const lapsed = NOW - (DEEDS_BOARD_DEMAND_TTL_MS + 1);
    expect(shouldWarmDeedsBoard(lapsed, NOW, DEEDS_BOARD_DEMAND_TTL_MS)).toBe(false);
  });

  it('treats exactly at the window edge as lapsed (exclusive upper bound)', () => {
    expect(
      shouldWarmDeedsBoard(NOW - DEEDS_BOARD_DEMAND_TTL_MS, NOW, DEEDS_BOARD_DEMAND_TTL_MS),
    ).toBe(false);
  });

  it('defaults to DEEDS_BOARD_DEMAND_TTL_MS when no ttl is passed', () => {
    expect(shouldWarmDeedsBoard(NOW - 1_000, NOW)).toBe(true);
    expect(shouldWarmDeedsBoard(NOW - (DEEDS_BOARD_DEMAND_TTL_MS + 1), NOW)).toBe(false);
  });
});

describe('warmDeedsBoardIfDemanded', () => {
  it('skips the board read when there has been no request within the window', () => {
    // `read` stands in for refreshDeedsBoard, whose one job is the deedsBoardRanked
    // full-table pull. Under no demand the gate must never invoke it.
    const read = vi.fn();
    const warmed = warmDeedsBoardIfDemanded(read, 0, NOW, DEEDS_BOARD_DEMAND_TTL_MS);
    expect(warmed).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('runs the board read exactly once when a request landed within the window', () => {
    const read = vi.fn();
    const recent = NOW - (DEEDS_BOARD_DEMAND_TTL_MS - 1);
    const warmed = warmDeedsBoardIfDemanded(read, recent, NOW, DEEDS_BOARD_DEMAND_TTL_MS);
    expect(warmed).toBe(true);
    expect(read).toHaveBeenCalledOnce();
  });

  it('skips the board read again once demand has lapsed', () => {
    const read = vi.fn();
    const lapsed = NOW - (DEEDS_BOARD_DEMAND_TTL_MS + 1);
    const warmed = warmDeedsBoardIfDemanded(read, lapsed, NOW, DEEDS_BOARD_DEMAND_TTL_MS);
    expect(warmed).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('honors a caller-supplied ttl override', () => {
    const read = vi.fn();
    // A 1s request is inside a 60s window but outside a 500ms one.
    expect(warmDeedsBoardIfDemanded(read, NOW - 1_000, NOW, 60_000)).toBe(true);
    expect(warmDeedsBoardIfDemanded(read, NOW - 1_000, NOW, 500)).toBe(false);
    expect(read).toHaveBeenCalledOnce();
  });
});

describe('singleFlight', () => {
  it('shares one run across callers racing the same cold window', async () => {
    // `run` stands in for refreshDeedsBoard (the full-table board read): three
    // requests racing a cold cache must cost ONE read, and all three must see
    // that read's value.
    let release: (value: string) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const shared = singleFlight(run);
    const [a, b, c] = [shared(), shared(), shared()];
    expect(run).toHaveBeenCalledOnce();
    release('board');
    await expect(a).resolves.toBe('board');
    await expect(b).resolves.toBe('board');
    await expect(c).resolves.toBe('board');
  });

  it('runs again after the shared flight settles (no forever-cached promise)', async () => {
    const run = vi.fn(async () => 'fresh');
    const shared = singleFlight(run);
    await shared();
    await shared();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a rejected flight rejects every sharer once, then the next call retries fresh', async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce('recovered');
    const shared = singleFlight(run);
    const first = shared();
    const second = shared(); // shares the failing flight
    await expect(first).rejects.toThrow('db down');
    await expect(second).rejects.toThrow('db down');
    await expect(shared()).resolves.toBe('recovered');
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('server/main.ts wiring: both board read paths share one flight', () => {
  // Source scan (like the architecture guards): the warm loop fires every
  // LEADERBOARD_TTL_MS, the same interval as the cache TTL, so under demand a
  // warm tick and an inline read race the same cold window. A raw (unwrapped)
  // refresh on either path runs a second concurrent full-table roll-up, and the
  // slower flight can overwrite a newer snapshot with a fresher timestamp.
  const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');

  it('the demand-warm callback invokes the single-flight wrapper', () => {
    const callSite = src.indexOf('warmDeedsBoardIfDemanded(');
    expect(callSite).toBeGreaterThan(-1);
    // The callback is the first argument, so the shared call must sit in the
    // opening lines of the call site.
    expect(src.slice(callSite, callSite + 400)).toContain('refreshDeedsBoardShared()');
  });

  it('no caller bypasses the wrapper with a bare refreshDeedsBoard call', () => {
    expect(src).not.toContain('void refreshDeedsBoard().catch');
    // Exactly two bare references may exist: the function definition and its
    // wrap into the shared flight. Anything else is a bypass.
    expect(src.match(/\brefreshDeedsBoard\b/g)).toHaveLength(2);
    expect(src).toContain('async function refreshDeedsBoard(');
    expect(src).toContain('singleFlight(refreshDeedsBoard)');
  });
});
