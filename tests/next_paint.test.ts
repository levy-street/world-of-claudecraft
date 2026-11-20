// The entry's paint wait (src/game/next_paint.ts). Two animation frames prove
// the loading screen painted before the synchronous scene build; but a browser
// draws no frames at all for a hidden page (a minimized or fully covered
// window), so a wait on frames alone held "Entering the world..." up for as long
// as the window stayed hidden, before any of the world was built (the Smith's
// Heart night of 2026-11-20: five minutes and more in an Edge window behind
// another, until it was brought forward). A hidden page has nothing to paint,
// so the wait lets the entry go on; a visible one keeps waiting for its frames.
import { describe, expect, it } from 'vitest';
import { NEXT_PAINT_HIDDEN_CHECK_MS, nextPaint, type PaintScheduler } from '../src/game/next_paint';

function harness(hidden: boolean) {
  const frames: Array<() => void> = [];
  const timers: Array<{ cb: () => void; ms: number }> = [];
  const state = { hidden };
  const scheduler: PaintScheduler = {
    requestFrame: (cb) => {
      frames.push(cb);
    },
    setTimer: (cb, ms) => {
      timers.push({ cb, ms });
    },
    pageHidden: () => state.hidden,
  };
  return {
    scheduler,
    state,
    frame() {
      const cb = frames.shift();
      if (!cb) throw new Error('no pending frame');
      cb();
    },
    timer() {
      const t = timers.shift();
      if (!t) throw new Error('no pending timer');
      t.cb();
      return t.ms;
    },
    timers: () => timers.length,
  };
}

const settled = async (p: Promise<void>) => {
  let done = false;
  void p.then(() => {
    done = true;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return done;
};

describe('nextPaint', () => {
  it('resolves after two animation frames on a visible page', async () => {
    const h = harness(false);
    const p = nextPaint(h.scheduler);
    h.frame();
    expect(await settled(p)).toBe(false);
    h.frame();
    expect(await settled(p)).toBe(true);
  });

  it('goes on without frames while the page is hidden (no frame ever comes)', async () => {
    const h = harness(true);
    const p = nextPaint(h.scheduler);
    expect(await settled(p)).toBe(false);
    expect(h.timer()).toBe(NEXT_PAINT_HIDDEN_CHECK_MS);
    expect(await settled(p)).toBe(true);
  });

  it('keeps waiting for its frames on a visible page, however slow they are', async () => {
    const h = harness(false);
    const p = nextPaint(h.scheduler);
    h.timer();
    h.timer();
    expect(await settled(p)).toBe(false);
    expect(h.timers()).toBe(1);
    h.frame();
    h.frame();
    expect(await settled(p)).toBe(true);
  });

  it('a page hidden mid-wait goes on at the next check', async () => {
    const h = harness(false);
    const p = nextPaint(h.scheduler);
    h.timer();
    expect(await settled(p)).toBe(false);
    h.state.hidden = true;
    h.timer();
    expect(await settled(p)).toBe(true);
  });

  it('resolves once even when the frames and the check both land', async () => {
    const h = harness(true);
    let n = 0;
    const p = nextPaint(h.scheduler).then(() => {
      n++;
    });
    h.timer();
    h.frame();
    h.frame();
    await p;
    expect(n).toBe(1);
    expect(h.timers()).toBe(0);
  });
});
