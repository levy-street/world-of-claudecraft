import { describe, expect, it } from 'vitest';
import {
  createPortraitCaptureLane,
  PORTRAIT_CAPTURE_RETRY_BASE_MS,
  PORTRAIT_CAPTURE_RETRY_MAX_MS,
} from '../src/render/characters/portrait_capture_lane_core';

/** A capture whose settlement the test drives. `settle(err)` rejects it,
 *  `settle()` resolves it as a capture that CACHED a portrait. */
function deferred() {
  let settle!: (err?: unknown) => void;
  const promise = new Promise<boolean>((resolve, reject) => {
    settle = (err) => (err ? reject(err) : resolve(true));
  });
  return { promise, settle };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('portrait capture lane', () => {
  it('runs one capture per key and drops the asks that arrive while it is in flight', async () => {
    const lane = createPortraitCaptureLane();
    const first = deferred();
    let starts = 0;
    const start = () => {
      starts++;
      return first.promise;
    };

    lane.request('player_mage:0:headshot', 0, start);
    lane.request('player_mage:0:headshot', 0, start);
    await flush();
    lane.request('player_mage:0:headshot', 0, start);
    await flush();

    expect(starts).toBe(1);
    expect(lane.pending('player_mage:0:headshot')).toBe(true);
  });

  it('keys the dedupe, so a different skin or framing still captures', async () => {
    const lane = createPortraitCaptureLane();
    const keys: string[] = [];
    for (const key of [
      'player_mage:0:headshot',
      'player_mage:1:headshot',
      'player_mage:0:body',
      'player_mage:0:headshot',
    ]) {
      lane.request(key, 0, async () => {
        keys.push(key);
        await new Promise<boolean>(() => {});
        return true;
      });
    }
    await flush();

    expect(keys).toEqual([
      'player_mage:0:headshot',
      'player_mage:1:headshot',
      'player_mage:0:body',
    ]);
  });

  it('retires the key once the capture lands, so a later miss captures again', async () => {
    const lane = createPortraitCaptureLane();
    const first = deferred();
    let starts = 0;

    lane.request('k', 0, () => {
      starts++;
      return first.promise;
    });
    await flush();
    first.settle();
    await flush();

    expect(lane.pending('k')).toBe(false);
    lane.request('k', 0, () => {
      starts++;
      return Promise.resolve(true);
    });
    await flush();
    expect(starts).toBe(2);
  });

  it('clears the key on a REJECTED capture without throwing into the caller', async () => {
    const lane = createPortraitCaptureLane();
    const failing = deferred();
    const unhandled: unknown[] = [];
    const record = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', record);

    expect(() =>
      lane.request('k', 0, () => {
        throw new Error('context lost');
      }),
    ).not.toThrow();
    lane.request('k2', 0, () => failing.promise);
    await flush();
    failing.settle(new Error('encode failed'));
    await flush();

    expect(lane.pending('k')).toBe(false);
    expect(lane.pending('k2')).toBe(false);
    expect(unhandled).toEqual([]);

    // A rejected capture is a failure, so the retry waits out its cooldown.
    let retried = false;
    const retry = async (): Promise<boolean> => {
      retried = true;
      return true;
    };
    lane.request('k2', 0, retry);
    await flush();
    expect(retried).toBe(false);
    lane.request('k2', PORTRAIT_CAPTURE_RETRY_BASE_MS, retry);
    await flush();
    expect(retried).toBe(true);
    // Only OUR listener: removeAllListeners would strip the runner's own.
    process.off('unhandledRejection', record);
  });

  it('lets a fresh ask start after clear(), and the superseded capture retires nothing', async () => {
    const lane = createPortraitCaptureLane();
    const stale = deferred();
    lane.request('k', 0, () => stale.promise);
    await flush();

    lane.clear();
    expect(lane.pending('k')).toBe(false);
    const fresh = deferred();
    lane.request('k', 0, () => fresh.promise);
    await flush();
    expect(lane.pending('k')).toBe(true);

    // The pre-clear capture settling must not free the key the new one holds.
    stale.settle();
    await flush();
    expect(lane.pending('k')).toBe(true);
    fresh.settle();
    await flush();
    expect(lane.pending('k')).toBe(false);
  });

  it('backs a key that cached nothing off, doubling per failure up to the cap', async () => {
    const lane = createPortraitCaptureLane();
    let starts = 0;
    const miss = async (): Promise<boolean> => {
      starts++;
      return false;
    };

    lane.request('k', 0, miss);
    await flush();
    expect(starts).toBe(1);

    // Inside the first cooldown the ask starts nothing at all: the key is
    // asked again by the very next frame, and the capture it would run costs
    // 43 to 201 ms every time.
    expect(lane.coolingDown('k', PORTRAIT_CAPTURE_RETRY_BASE_MS - 1)).toBe(true);
    lane.request('k', PORTRAIT_CAPTURE_RETRY_BASE_MS - 1, miss);
    await flush();
    expect(starts).toBe(1);

    // Past it, exactly one more attempt, whose miss doubles the wait.
    expect(lane.coolingDown('k', PORTRAIT_CAPTURE_RETRY_BASE_MS)).toBe(false);
    lane.request('k', PORTRAIT_CAPTURE_RETRY_BASE_MS, miss);
    await flush();
    expect(starts).toBe(2);
    expect(lane.coolingDown('k', PORTRAIT_CAPTURE_RETRY_BASE_MS * 2)).toBe(true);
    expect(lane.coolingDown('k', PORTRAIT_CAPTURE_RETRY_BASE_MS * 3)).toBe(false);
  });

  it('caps the cooldown, so a permanently failing key still retries eventually', async () => {
    const lane = createPortraitCaptureLane();
    let now = 0;
    let starts = 0;
    for (let i = 0; i < 20; i++) {
      lane.request('k', now, async () => {
        starts++;
        return false;
      });
      await flush();
      // Walk to the end of whatever cooldown that attempt armed.
      now += PORTRAIT_CAPTURE_RETRY_MAX_MS;
    }
    expect(starts).toBe(20);
    expect(lane.coolingDown('k', now)).toBe(false);
    expect(lane.coolingDown('k', now - PORTRAIT_CAPTURE_RETRY_MAX_MS)).toBe(true);
  });

  it('a capture that CACHED clears the backoff, so the next miss starts over', async () => {
    const lane = createPortraitCaptureLane();
    let starts = 0;
    const attempt = (cached: boolean) => async (): Promise<boolean> => {
      starts++;
      return cached;
    };

    lane.request('k', 0, attempt(false));
    await flush();
    lane.request('k', PORTRAIT_CAPTURE_RETRY_BASE_MS, attempt(true));
    await flush();
    expect(starts).toBe(2);
    expect(lane.coolingDown('k', PORTRAIT_CAPTURE_RETRY_BASE_MS)).toBe(false);

    // The counter reset with it: the next failure waits the BASE cooldown, not
    // the doubled one.
    lane.request('k', PORTRAIT_CAPTURE_RETRY_BASE_MS, attempt(false));
    await flush();
    expect(lane.coolingDown('k', PORTRAIT_CAPTURE_RETRY_BASE_MS * 2)).toBe(false);
  });

  it('clear() drops the cooldowns too: a new rig deserves a fresh attempt', async () => {
    const lane = createPortraitCaptureLane();
    let starts = 0;
    const miss = async (): Promise<boolean> => {
      starts++;
      return false;
    };
    lane.request('k', 0, miss);
    await flush();
    expect(lane.coolingDown('k', 1)).toBe(true);

    lane.clear();
    expect(lane.coolingDown('k', 1)).toBe(false);
    lane.request('k', 1, miss);
    await flush();
    expect(starts).toBe(2);
  });

  it('a capture superseded by clear() neither retires nor backs off the new key', async () => {
    const lane = createPortraitCaptureLane();
    const stale = deferred();
    lane.request('k', 0, () => stale.promise);
    await flush();
    lane.clear();
    const fresh = deferred();
    lane.request('k', 0, () => fresh.promise);
    await flush();

    // The pre-clear capture fails: it must not back off the key its successor
    // is still working on.
    stale.settle(new Error('context lost'));
    await flush();
    expect(lane.pending('k')).toBe(true);
    expect(lane.coolingDown('k', 1)).toBe(false);
    fresh.settle();
    await flush();
    expect(lane.pending('k')).toBe(false);
  });
});
