import { describe, expect, it } from 'vitest';

import { WS_KEEPALIVE_PING_MS } from '../server/game';
import {
  KEEPALIVE_STALL_FACTOR,
  noteClientFrame,
  socketSilentPastDeadline,
  WS_SILENCE_DEADLINE_MS,
} from '../server/keepalive_sweep';

describe('keepalive silence deadline', () => {
  it('is ten minutes, and spans many ping intervals so a live client has answered several pings inside it', () => {
    expect(WS_SILENCE_DEADLINE_MS).toBe(10 * 60 * 1000);
    expect(WS_SILENCE_DEADLINE_MS).toBeGreaterThan(KEEPALIVE_STALL_FACTOR * WS_KEEPALIVE_PING_MS);
    expect(WS_SILENCE_DEADLINE_MS / WS_KEEPALIVE_PING_MS).toBeGreaterThanOrEqual(4);
  });

  it('counts silence only up to the previous sweep, never into the interval frames may still be queued for', () => {
    const ws = {};
    const t0 = 1_000_000;
    noteClientFrame(ws, t0);
    // Previous sweep ran one deadline after the frame: proven silent.
    expect(socketSilentPastDeadline(ws, t0 + WS_SILENCE_DEADLINE_MS)).toBe(true);
    // One millisecond short of the deadline at the previous sweep: not yet.
    expect(socketSilentPastDeadline(ws, t0 + WS_SILENCE_DEADLINE_MS - 1)).toBe(false);
    // A frame processed AFTER the previous sweep (it was queued behind a stall)
    // makes the gap negative: that is evidence of life, never of death.
    noteClientFrame(ws, t0 + 10);
    expect(socketSilentPastDeadline(ws, t0)).toBe(false);
  });

  it('does not reap across a long stall: silence is measured to the previous sweep, not to now', () => {
    const ws = {};
    const t0 = 2_000_000;
    // Last frame processed just before sweep A.
    noteClientFrame(ws, t0 - 100);
    const sweepA = t0;
    // The process then stalls for longer than the whole deadline. Sweep B fires
    // late; measured against sweep A the socket has been silent for 100 ms, so
    // it must NOT be reaped, however long ago sweep A was in wall-clock terms.
    expect(socketSilentPastDeadline(ws, sweepA)).toBe(false);
    // The naive rule (measure to now) would reap here; pin that it is not used.
    const now = sweepA + WS_SILENCE_DEADLINE_MS + 60_000;
    expect(now - (t0 - 100)).toBeGreaterThan(WS_SILENCE_DEADLINE_MS);
    expect(socketSilentPastDeadline(ws, sweepA)).toBe(false);
    // Queued pongs drain after the stall and stamp the socket past sweep B.
    noteClientFrame(ws, now + 5);
    expect(socketSilentPastDeadline(ws, now)).toBe(false);
  });

  it('never judges a socket it has no frame timestamp for', () => {
    expect(socketSilentPastDeadline({}, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('keys on socket identity so a replaced (resumed) socket starts its own clock', () => {
    const oldWs = {};
    const newWs = {};
    const t0 = 5_000_000;
    noteClientFrame(oldWs, t0);
    noteClientFrame(newWs, t0 + WS_SILENCE_DEADLINE_MS);
    const sweepAt = t0 + WS_SILENCE_DEADLINE_MS;
    expect(socketSilentPastDeadline(oldWs, sweepAt)).toBe(true);
    expect(socketSilentPastDeadline(newWs, sweepAt)).toBe(false);
  });
});
