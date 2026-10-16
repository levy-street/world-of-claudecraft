// The pure silent-stall decision behind ClientWorld's dead-socket detection
// (src/net/socket_stall_watchdog.ts). The ClientWorld wiring is pinned in
// tests/net_online_visibility_reconnect.test.ts.
import { describe, expect, it } from 'vitest';
import {
  drawStallWindowMs,
  SocketStallWatchdog,
  STALL_MAX_POLL_GAP_MS,
  STALL_WINDOW_MS,
  STALL_WINDOW_SPREAD_MS,
} from '../src/net/socket_stall_watchdog';

// Poll on the real 50 ms input beat from `fromMs` up to and including `toMs`,
// returning the poll times at which the watchdog fired.
function pollRange(
  w: SocketStallWatchdog,
  fromMs: number,
  toMs: number,
  opts: { hidden?: boolean; live?: boolean; frameEveryMs?: number; arms?: boolean } = {},
): number[] {
  const fired: number[] = [];
  for (let t = fromMs; t <= toMs; t += 50) {
    if (opts.frameEveryMs !== undefined && t % opts.frameEveryMs === 0) {
      w.noteFrame(t, opts.arms ?? true);
    }
    if (w.poll(t, opts.hidden ?? false, opts.live ?? true)) fired.push(t);
  }
  return fired;
}

describe('SocketStallWatchdog', () => {
  it('pins the window well above the measured server stall and the poll-gap guard', () => {
    expect(STALL_WINDOW_MS).toBe(8_000);
    expect(STALL_WINDOW_SPREAD_MS).toBe(4_000);
    expect(STALL_MAX_POLL_GAP_MS).toBe(1_000);
  });

  it('draws a per-client window across the spread, so a realm-wide silence never fires in lockstep', () => {
    expect(drawStallWindowMs(() => 0)).toBe(8_000);
    expect(drawStallWindowMs(() => 0.5)).toBe(10_000);
    const top = drawStallWindowMs(() => 0.999999);
    expect(top).toBeLessThan(12_000);
    expect(top).toBeGreaterThan(11_999);
  });

  it('only a snapshot arms it: hello and other frames never arm a disarmed watchdog', () => {
    const w = new SocketStallWatchdog();
    // a server that sends hello and other frames but never streams snapshots
    w.noteFrame(0, false);
    expect(pollRange(w, 50, 30_000, { frameEveryMs: 1_000, arms: false })).toEqual([]);
    expect(pollRange(w, 30_050, 60_000)).toEqual([]);
    // the first snapshot arms it
    w.noteFrame(60_000, true);
    expect(pollRange(w, 60_050, 60_000 + STALL_WINDOW_MS)).toEqual([60_000 + STALL_WINDOW_MS]);
  });

  it('a non-snapshot frame still proves the path alive once armed', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    expect(pollRange(w, 50, 60_000, { frameEveryMs: 1_000, arms: false })).toEqual([]);
  });

  it('fires once the window passes with no frame, not a beat earlier', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    expect(pollRange(w, 50, STALL_WINDOW_MS - 50)).toEqual([]);
    expect(w.poll(STALL_WINDOW_MS, false, true)).toBe(true);
  });

  it('fires exactly once per stall, then stays quiet until a new frame re-arms it', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    expect(pollRange(w, 50, 30_000)).toEqual([STALL_WINDOW_MS]);
    // the next transport's first frame re-arms a full window
    w.noteFrame(30_000, true);
    expect(pollRange(w, 30_050, 30_000 + STALL_WINDOW_MS)).toEqual([30_000 + STALL_WINDOW_MS]);
  });

  it('never fires while frames keep arriving, even across long but sub-window gaps', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    expect(pollRange(w, 50, 120_000, { frameEveryMs: 50 })).toEqual([]);
    // a 7.5 s silence (beyond any measured server stall) is still not a stall
    expect(pollRange(w, 120_050, 127_500, { frameEveryMs: 7_500 })).toEqual([]);
    expect(pollRange(w, 127_550, 135_000, { frameEveryMs: 7_500 })).toEqual([]);
  });

  it('never fires before the first frame on a transport', () => {
    const w = new SocketStallWatchdog();
    expect(pollRange(w, 0, 60_000)).toEqual([]);
  });

  it('never fires while the tab is hidden, and the hidden time never counts', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    // a minute in the background with no frames at all
    expect(pollRange(w, 50, 60_000, { hidden: true })).toEqual([]);
    // back in the foreground: the window counts from the last hidden poll, so
    // it takes a full fresh window of silence to fire
    expect(pollRange(w, 60_050, 60_000 + STALL_WINDOW_MS - 50)).toEqual([]);
    expect(w.poll(60_000 + STALL_WINDOW_MS, false, true)).toBe(true);
  });

  it('a throttled hidden-tab poll gap does not count once the tab is visible again', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    // background timers throttled to one poll a minute
    expect(w.poll(60_000, true, true)).toBe(false);
    expect(w.poll(120_000, true, true)).toBe(false);
    // first visible poll lands long after the last hidden one: a frozen-client
    // gap, so the window restarts here rather than firing on stale time
    expect(w.poll(185_000, false, true)).toBe(false);
    expect(pollRange(w, 185_050, 185_000 + STALL_WINDOW_MS - 50)).toEqual([]);
    expect(w.poll(185_000 + STALL_WINDOW_MS, false, true)).toBe(true);
  });

  it('a frozen client (a long main-thread task) restarts the window instead of firing', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    expect(pollRange(w, 50, 2_000)).toEqual([]);
    // a 10 s long task: frames may be queued unread behind this very poll
    expect(w.poll(12_000, false, true)).toBe(false);
    expect(pollRange(w, 12_050, 12_000 + STALL_WINDOW_MS - 50)).toEqual([]);
    expect(w.poll(12_000 + STALL_WINDOW_MS, false, true)).toBe(true);
  });

  it('a poll gap at the guard is still a normal beat, one past it restarts the window', () => {
    const atGuard = new SocketStallWatchdog();
    atGuard.noteFrame(0, true);
    expect(atGuard.poll(STALL_WINDOW_MS - STALL_MAX_POLL_GAP_MS, false, true)).toBe(false);
    expect(atGuard.poll(STALL_WINDOW_MS, false, true)).toBe(true);
    const pastGuard = new SocketStallWatchdog();
    pastGuard.noteFrame(0, true);
    expect(pastGuard.poll(STALL_WINDOW_MS - STALL_MAX_POLL_GAP_MS - 1, false, true)).toBe(false);
    expect(pastGuard.poll(STALL_WINDOW_MS, false, true)).toBe(false);
  });

  it('does not fire on top of a close path that already ran (session no longer live)', () => {
    const w = new SocketStallWatchdog();
    w.noteFrame(0, true);
    // the socket closed for real at 3 s: the consumer's live flag drops
    expect(pollRange(w, 50, 3_000)).toEqual([]);
    expect(pollRange(w, 3_050, 30_000, { live: false })).toEqual([]);
    // the live flag coming back without a new frame (it cannot in ClientWorld,
    // which only goes live on a hello frame) still does not fire on stale time
    expect(pollRange(w, 30_050, 60_000)).toEqual([]);
  });

  it('honors an injected window and poll-gap guard', () => {
    const w = new SocketStallWatchdog(500, 200);
    w.noteFrame(0, true);
    expect(pollRange(w, 50, 450)).toEqual([]);
    expect(w.poll(500, false, true)).toBe(true);
  });
});
