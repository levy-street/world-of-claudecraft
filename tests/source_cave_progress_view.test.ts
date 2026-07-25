// Pure change-detection for the Source Cave kill-progress banner
// (src/ui/source_cave_progress_view.ts).

import { describe, expect, it } from 'vitest';
import { sourceCaveProgressEvent } from '../src/ui/source_cave_progress_view';
import type { SourceCaveInfo } from '../src/world_api/dungeons';

function info(over: Partial<SourceCaveInfo> = {}): SourceCaveInfo {
  return {
    moduleCount: 4,
    modules: [
      'reliquary_sunken_ossuary',
      'reliquary_bell_niche',
      'reliquary_saintless_hall',
      'reliquary_finale',
    ],
    mobs: [],
    totalMobs: 40,
    killed: 0,
    cleared: false,
    sealState: 'idle',
    playersInsideSeal: 0,
    playersInInstance: 0,
    activeWave: 0,
    totalWaves: 0,
    ...over,
  };
}

describe('sourceCaveProgressEvent', () => {
  it('announces nothing on the very first observation (no stale flash)', () => {
    expect(sourceCaveProgressEvent(null, info({ killed: 12 }))).toBeNull();
  });

  it('announces nothing when the cave does not exist', () => {
    expect(sourceCaveProgressEvent({ killed: 0, cleared: false }, null)).toBeNull();
  });

  it('announces a kill event when killed increases past the last-seen baseline', () => {
    const ev = sourceCaveProgressEvent({ killed: 3, cleared: false }, info({ killed: 4 }));
    expect(ev).toEqual({ kind: 'killed', percent: 10 });
  });

  it('floors the percentage so it cannot announce 100% before the clear', () => {
    const ev = sourceCaveProgressEvent({ killed: 38, cleared: false }, info({ killed: 39 }));
    expect(ev).toEqual({ kind: 'killed', percent: 97 });
  });

  it('announces nothing when killed is unchanged', () => {
    expect(sourceCaveProgressEvent({ killed: 4, cleared: false }, info({ killed: 4 }))).toBeNull();
  });

  it('announces nothing when killed goes DOWN (a lockout reset), not a regression flash', () => {
    expect(sourceCaveProgressEvent({ killed: 10, cleared: false }, info({ killed: 0 }))).toBeNull();
  });

  it('announces cleared once, winning over a same-call kill uptick', () => {
    const ev = sourceCaveProgressEvent(
      { killed: 39, cleared: false },
      info({ killed: 40, cleared: true }),
    );
    expect(ev).toEqual({ kind: 'cleared' });
  });

  it('announces nothing once cleared has already been seen (fires only on the transition)', () => {
    expect(
      sourceCaveProgressEvent({ killed: 40, cleared: true }, info({ killed: 40, cleared: true })),
    ).toBeNull();
  });
});
