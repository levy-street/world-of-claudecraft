// The offline-writer lease-fence refusal counters
// (server/offline_fence_refusals.ts, the Phase 18 security review's INFO on the
// persistence unit): a refusal is a LOGGED line today, and a log line is not a
// signal an operator can watch, so each of the three offline character-blob
// writers counts its own refusals beside the line it already writes. This suite
// pins the module's own contract; the per-writer increments are pinned at the
// writers themselves (tests/server/characters.test.ts for the two sweeps,
// tests/server/pbe_boost_save_fence.test.ts for the roster save), because a
// counter that only its own unit test increments proves nothing about the
// production path.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  countOfflineFenceRefusal,
  OFFLINE_FENCE_WRITERS,
  offlineFenceRefusals,
  resetOfflineFenceRefusalsForTests,
} from '../../server/offline_fence_refusals';

beforeEach(() => {
  resetOfflineFenceRefusalsForTests();
});

describe('offline fence refusal counters', () => {
  it('starts every writer family at zero and names exactly the three offline writers', () => {
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 0,
      reclaim_sweep: 0,
      pbe_roster: 0,
    });
    // The family list is the metric's label vocabulary; a NEW offline writer
    // joins it here and at the readout, never as an ad-hoc string.
    expect([...OFFLINE_FENCE_WRITERS]).toEqual(['rename_sweep', 'reclaim_sweep', 'pbe_roster']);
    expect(Object.keys(offlineFenceRefusals()).sort()).toEqual([...OFFLINE_FENCE_WRITERS].sort());
  });

  it('counts per family and never leaks a count into a sibling family', () => {
    countOfflineFenceRefusal('rename_sweep');
    countOfflineFenceRefusal('rename_sweep');
    countOfflineFenceRefusal('pbe_roster');

    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 2,
      reclaim_sweep: 0,
      pbe_roster: 1,
    });
  });

  it('hands back a SNAPSHOT: mutating the read never moves the live counters', () => {
    countOfflineFenceRefusal('reclaim_sweep');
    const snapshot = offlineFenceRefusals() as Record<string, number>;
    snapshot.reclaim_sweep = 999;
    snapshot.rename_sweep = 999;
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 0,
      reclaim_sweep: 1,
      pbe_roster: 0,
    });
  });

  it('the test-only reset clears every family at once', () => {
    for (const writer of OFFLINE_FENCE_WRITERS) countOfflineFenceRefusal(writer);
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 1,
      reclaim_sweep: 1,
      pbe_roster: 1,
    });
    resetOfflineFenceRefusalsForTests();
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 0,
      reclaim_sweep: 0,
      pbe_roster: 0,
    });
  });

  it('counts monotonically across many refusals (the counter is a total, never a gauge)', () => {
    for (let i = 0; i < 50; i++) countOfflineFenceRefusal('pbe_roster');
    expect(offlineFenceRefusals().pbe_roster).toBe(50);
  });
});
