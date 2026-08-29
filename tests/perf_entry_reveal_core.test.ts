import { describe, expect, it } from 'vitest';
import { ENTRY_REVEAL_WAIT_LIMIT, entryRevealSummary } from '../src/game/perf_entry_reveal_core';
import type { GpuPrepEvent } from '../src/render/gpu_prep_events';

const reveal = {
  keysHeld: 84,
  rootsHeld: 315,
  rootsPiecewise: 2,
  rootsReach: 0,
  rootsAtWatchdog: 31,
  imminentHolds: 36,
};
const event = (partial: Partial<GpuPrepEvent>): GpuPrepEvent => ({
  kind: 'arrival',
  key: 'entry-wait',
  ageMs: 0,
  atMs: 0,
  readyRoots: 0,
  totalRoots: 0,
  units: 0,
  ...partial,
});

describe('entryRevealSummary', () => {
  it('is null without gpu-prep stats', () => {
    expect(entryRevealSummary(null)).toBeNull();
    expect(entryRevealSummary(undefined)).toBeNull();
  });

  it('copies the reveal counters and lists the entry waits with their bound and held keys', () => {
    const summary = entryRevealSummary({
      events: {
        reveal,
        events: [
          event({ key: 'cover', ageMs: 0, units: 17, totalRoots: 3 }),
          event({ key: 'entry-wait:establishing-shot', ageMs: 3712.6, units: 6000, totalRoots: 4 }),
          event({ kind: 'reveal-watchdog', key: 'eastbrook-town-static', ageMs: 10000 }),
          event({ key: 'entry-wait', ageMs: 0.4, units: 3000, totalRoots: 0 }),
        ],
      },
    });
    expect(summary).toEqual({
      keysHeld: 84,
      rootsHeld: 315,
      rootsAtWatchdog: 31,
      imminentHolds: 36,
      waits: [
        { key: 'entry-wait:establishing-shot', waitedMs: 3713, boundMs: 6000, heldAtLift: 4 },
        { key: 'entry-wait', waitedMs: 0, boundMs: 3000, heldAtLift: 0 },
      ],
    });
  });

  it('bounds the wait list', () => {
    const events = Array.from({ length: ENTRY_REVEAL_WAIT_LIMIT + 3 }, (_, i) =>
      event({ key: 'entry-wait', ageMs: i }),
    );
    expect(entryRevealSummary({ events: { reveal, events } })?.waits).toHaveLength(
      ENTRY_REVEAL_WAIT_LIMIT,
    );
  });
});
