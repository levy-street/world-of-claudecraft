import { describe, expect, it } from 'vitest';
import {
  createGpuQueueWindow,
  type GpuQueueWindowSample,
} from '../src/render/gpu_queue_window_core';

const sample = (over: Partial<GpuQueueWindowSample> = {}): GpuQueueWindowSample => ({
  priority: 10,
  waitMs: 0,
  syncMs: 0,
  frameGapMs: 0,
  settledAtMs: 0,
  ...over,
});

describe('gpu queue recent window', () => {
  it('reports the interval, not the session, so a quiet lane reads as quiet', () => {
    const window = createGpuQueueWindow({ windowMs: 1000 });
    window.record(sample({ settledAtMs: 0, syncMs: 500, frameGapMs: 900 }));
    expect(window.stats(500)).toMatchObject({ units: 1, worstSyncMs: 500, worstFrameGapMs: 900 });
    // The whole point of the interval arm: a lifetime maximum would still be
    // reporting 900 ms here, and a pacing A/B reading it could never tell that
    // the lane went quiet.
    expect(window.stats(5000)).toMatchObject({
      units: 0,
      worstSyncMs: 0,
      worstFrameGapMs: 0,
      worstWaitMs: 0,
      lanes: [],
    });
  });

  it('drops only what fell out of the window', () => {
    const window = createGpuQueueWindow({ windowMs: 1000 });
    window.record(sample({ settledAtMs: 0, syncMs: 40 }));
    window.record(sample({ settledAtMs: 800, syncMs: 10 }));
    const stats = window.stats(1200);
    expect(stats.units).toBe(1);
    expect(stats.worstSyncMs).toBe(10);
    expect(stats.totalSyncMs).toBe(10);
  });

  it('breaks grant latency out per priority lane, highest first', () => {
    const window = createGpuQueueWindow({ windowMs: 10_000 });
    window.record(
      sample({ settledAtMs: 0, priority: 10, waitMs: 1200, syncMs: 4, frameGapMs: 300 }),
    );
    window.record(
      sample({ settledAtMs: 10, priority: 10, waitMs: 800, syncMs: 6, frameGapMs: 20 }),
    );
    window.record(
      sample({ settledAtMs: 20, priority: 40, waitMs: 950, syncMs: 2, frameGapMs: 18 }),
    );
    const { lanes } = window.stats(100);
    expect(lanes.map((lane) => lane.priority)).toEqual([40, 10]);
    // The check the whole lane breakdown exists for: an ACTIONABLE_VIEW unit
    // waiting most of a second is the shape of a cosmetic lane delaying a live
    // one, and the session-wide worst wait cannot say which lane paid it.
    expect(lanes[0]).toMatchObject({ priority: 40, units: 1, worstWaitMs: 950 });
    expect(lanes[1]).toMatchObject({
      priority: 10,
      units: 2,
      worstWaitMs: 1200,
      totalWaitMs: 2000,
      worstSyncMs: 6,
      worstFrameGapMs: 300,
    });
  });

  it('stays bounded on a burst that never gets read', () => {
    const window = createGpuQueueWindow({ windowMs: 10_000, sampleLimit: 4 });
    for (let index = 0; index < 50; index++) {
      window.record(sample({ settledAtMs: index, syncMs: index }));
    }
    const stats = window.stats(60);
    expect(stats.units).toBe(4);
    // Oldest-first eviction, the same direction the window prunes in.
    expect(stats.worstSyncMs).toBe(49);
    expect(stats.totalSyncMs).toBe(46 + 47 + 48 + 49);
  });

  it('derives lane rows from the retained samples, so lane count cannot outgrow the cap', () => {
    const window = createGpuQueueWindow({ windowMs: 10_000, sampleLimit: 3 });
    for (let index = 0; index < 30; index++) {
      window.record(sample({ settledAtMs: index, priority: index }));
    }
    expect(window.stats(40).lanes).toHaveLength(3);
  });
});
