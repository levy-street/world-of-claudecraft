import { beforeEach, describe, expect, it } from 'vitest';
import {
  awaitLinkFence,
  GL_SIGNALED,
  GL_SYNC_STATUS,
  LINK_FENCE_POLL_MS,
  LINK_FENCE_SLOW_MS,
  type LinkFenceGl,
  type LinkFenceScheduler,
  linkFenceStats,
  resetLinkFenceStatsForTests,
} from '../src/render/link_fence_proof';

/** A manual clock: `advance` runs every timer due by then, in order. */
function clock() {
  let now = 0;
  let timers: Array<{ at: number; cb: () => void }> = [];
  const scheduler: LinkFenceScheduler = {
    setTimeout: (cb, ms) => {
      timers.push({ at: now + ms, cb });
    },
    now: () => now,
  };
  const advance = async (ms: number): Promise<void> => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers = timers.slice(1);
      now = next.at;
      next.cb();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  };
  return { scheduler, advance };
}

/** A fence context: `signal()` flips every live fence; calls are logged. */
function fenceGl() {
  const log: string[] = [];
  let signalled = false;
  let lost = false;
  const gl: LinkFenceGl = {
    fenceSync: () => {
      log.push('fence');
      return { id: 1 };
    },
    getSyncParameter: (_sync, pname) => {
      log.push('status');
      expect(pname).toBe(GL_SYNC_STATUS);
      return signalled ? GL_SIGNALED : 0x9118;
    },
    deleteSync: () => {
      log.push('delete');
    },
    flush: () => {
      log.push('flush');
    },
    isContextLost: () => lost,
  };
  return {
    gl,
    log,
    signal: () => {
      signalled = true;
    },
    lose: () => {
      lost = true;
    },
  };
}

beforeEach(() => resetLinkFenceStatsForTests());

describe('link fence proof', () => {
  it('resolves proved only once the fence signals, and frees it', async () => {
    const c = clock();
    const f = fenceGl();
    let result: { proved: boolean; waitedMs: number } | null = null;
    void awaitLinkFence(f.gl, c.scheduler).then((r) => {
      result = r;
    });
    // issued and flushed synchronously, right behind the compile
    expect(f.log).toEqual(['fence', 'flush']);
    await c.advance(LINK_FENCE_POLL_MS * 5);
    expect(result).toBeNull();
    f.signal();
    await c.advance(LINK_FENCE_POLL_MS);
    expect(result).toEqual({ proved: true, waitedMs: LINK_FENCE_POLL_MS * 6 });
    expect(f.log.at(-1)).toBe('delete');
    expect(linkFenceStats()).toMatchObject({ fences: 1, proved: 1, unproved: 0 });
  });

  it('never polls synchronously: the first status read waits a timer', async () => {
    const c = clock();
    const f = fenceGl();
    f.signal();
    void awaitLinkFence(f.gl, c.scheduler);
    expect(f.log).not.toContain('status');
    await c.advance(LINK_FENCE_POLL_MS);
    expect(f.log).toContain('status');
  });

  it('a gate fence never gives up: it waits past the slow mark for the signal', async () => {
    // An unproved answer would let the gate record programs as linked that are
    // still queued; a gate's hold ends on evidence or its own watchdog.
    const c = clock();
    const f = fenceGl();
    let result: { proved: boolean } | null = null;
    void awaitLinkFence(f.gl, c.scheduler).then((r) => {
      result = r;
    });
    await c.advance(LINK_FENCE_SLOW_MS * 3);
    expect(result).toBeNull();
    expect(f.log).not.toContain('delete');
    // counted once as slow, for the readouts
    expect(linkFenceStats()).toMatchObject({ slow: 1, unproved: 0, proved: 0 });
    f.signal();
    await c.advance(LINK_FENCE_POLL_MS);
    expect(result).toMatchObject({ proved: true });
    expect(linkFenceStats()).toMatchObject({ slow: 1, proved: 1 });
  });

  it('with a caller deadline it resolves unproved at that deadline and frees the fence', async () => {
    const c = clock();
    const f = fenceGl();
    let result: { proved: boolean } | null = null;
    void awaitLinkFence(f.gl, c.scheduler, 100).then((r) => {
      result = r;
    });
    await c.advance(100 - LINK_FENCE_POLL_MS);
    expect(result).toBeNull();
    await c.advance(LINK_FENCE_POLL_MS * 2);
    expect(result).toMatchObject({ proved: false });
    expect(f.log.at(-1)).toBe('delete');
    expect(linkFenceStats()).toMatchObject({ unproved: 1, slow: 0 });
  });

  it('resolves unproved at once without fences (WebGL1, a stub)', async () => {
    await expect(awaitLinkFence({}, clock().scheduler)).resolves.toEqual({
      proved: false,
      waitedMs: 0,
    });
    await expect(awaitLinkFence(null, clock().scheduler)).resolves.toMatchObject({ proved: false });
    expect(linkFenceStats().fences).toBe(0);
  });

  it('a context lost while waiting resolves unproved', async () => {
    const c = clock();
    const f = fenceGl();
    let result: { proved: boolean } | null = null;
    void awaitLinkFence(f.gl, c.scheduler).then((r) => {
      result = r;
    });
    f.lose();
    await c.advance(LINK_FENCE_POLL_MS);
    expect(result).toMatchObject({ proved: false });
  });
});
