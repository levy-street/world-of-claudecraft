import { describe, expect, it } from 'vitest';
import { SelfSpiritPrewarmer } from '../src/render/self_spirit_prewarm';

// Deferred-resolution fake: lets a test hold a warm "in flight" and settle it
// on demand, so the coalescing across an overlapping look change is observable.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const visualA = { id: 'A' };
const visualB = { id: 'B' };

describe('SelfSpiritPrewarmer', () => {
  it('warms once on first sight and never again for an identical look', async () => {
    let warms = 0;
    const p = new SelfSpiritPrewarmer({
      warm: async () => {
        warms++;
        return true;
      },
      idle: async () => {},
    });
    p.observe(visualA, 0, 'sword', null, null);
    p.observe(visualA, 0, 'sword', null, null);
    p.observe(visualA, 0, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(1);
  });

  it('re-warms when the visual instance changes (a recompose)', async () => {
    const looks: string[] = [];
    const p = new SelfSpiritPrewarmer({
      warm: async () => {
        looks.push('warm');
        return true;
      },
      idle: async () => {},
    });
    p.observe(visualA, 0, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    p.observe(visualB, 0, 'sword', null, null); // rebuilt -> new instance
    await new Promise((r) => setTimeout(r, 0));
    expect(looks.length).toBe(2);
  });

  it('re-warms on a skin or weapon swap without a rebuild', async () => {
    let warms = 0;
    const p = new SelfSpiritPrewarmer({
      warm: async () => {
        warms++;
        return true;
      },
      idle: async () => {},
    });
    p.observe(visualA, 0, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    p.observe(visualA, 1, 'sword', null, null); // skin swap
    await new Promise((r) => setTimeout(r, 0));
    p.observe(visualA, 1, 'axe', 'shield', null); // weapon swap
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(3);
  });

  it('re-warms when a weapon cosmetic changes without a held-item swap', async () => {
    let warms = 0;
    const p = new SelfSpiritPrewarmer({
      warm: async () => {
        warms++;
        return true;
      },
      idle: async () => {},
    });
    p.observe(visualA, 0, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    p.observe(visualA, 0, 'sword', null, 'cinderbrand_sword');
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(2);
  });

  it('never overlaps two warms and coalesces a burst during one in-flight warm', async () => {
    const gate = deferred();
    let started = 0;
    let finished = 0;
    const p = new SelfSpiritPrewarmer({
      warm: async () => {
        started++;
        await gate.promise; // hold the first warm in flight
        finished++;
        return true;
      },
      idle: async () => {},
    });
    p.observe(visualA, 0, 'sword', null, null); // starts warm #1 (in flight)
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toBe(1);
    // Three look changes while the first warm is still running: must NOT start a
    // second warm yet, and must collapse to exactly ONE follow-up warm.
    p.observe(visualA, 1, 'sword', null, null);
    p.observe(visualA, 2, 'sword', null, null);
    p.observe(visualB, 2, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toBe(1); // still only the in-flight one
    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // The three overlapping look changes collapsed to exactly ONE follow-up warm
    // (started 1 -> 2, not 1 -> 4), and both warms ran to completion.
    expect(started).toBe(2);
    expect(finished).toBe(2);
  });

  it('a failed warm never wedges the lane: a later look change still warms', async () => {
    let warms = 0;
    let failNext = true;
    const p = new SelfSpiritPrewarmer({
      warm: async () => {
        warms++;
        if (failNext) {
          failNext = false;
          throw new Error('context lost');
        }
        return true;
      },
      idle: async () => {},
    });
    p.observe(visualA, 0, 'sword', null, null); // throws
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(1);
    p.observe(visualB, 0, 'sword', null, null); // lane not wedged
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(2);
  });

  it('retries the same look after a warm no-op leaves the player ghosted', async () => {
    let warms = 0;
    let playerGhost = true;
    const p = new SelfSpiritPrewarmer({
      warm: async () => {
        warms++;
        return !playerGhost;
      },
      idle: async () => {},
    });
    p.observe(visualA, 0, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(1);

    playerGhost = false;
    p.observe(visualA, 0, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(2);

    p.observe(visualA, 0, 'sword', null, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(warms).toBe(2);
  });
});
