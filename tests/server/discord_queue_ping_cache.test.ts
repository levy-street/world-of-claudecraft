// The queue-pop opt-in cache's pure primitives (server/discord_queue_ping_cache.ts):
// the shared (observer-wide, not per-account) failure backoff clock, and the
// realm-cap-derived cache capacity resolver. Integration-level behavior (how
// these wire into a tick) lives in discord_queue_pops.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import {
  QUEUE_PING_CACHE_FLOOR,
  QUEUE_PING_FAILURE_BACKOFF_MS,
  queuePingReadBackedOff,
  recordQueuePingReadFailure,
  resetQueuePingCacheForTests,
  resolveQueuePingCacheMax,
} from '../../server/discord_queue_ping_cache';

const NOW = 1_700_000_000_000;

afterEach(() => {
  resetQueuePingCacheForTests();
});

describe('resolveQueuePingCacheMax', () => {
  it('floors at QUEUE_PING_CACHE_FLOOR for unset, empty, or a cap the floor already covers', () => {
    expect(resolveQueuePingCacheMax(undefined)).toBe(QUEUE_PING_CACHE_FLOOR);
    expect(resolveQueuePingCacheMax('')).toBe(QUEUE_PING_CACHE_FLOOR);
    expect(resolveQueuePingCacheMax('  ')).toBe(QUEUE_PING_CACHE_FLOOR);
    expect(resolveQueuePingCacheMax('5000')).toBe(QUEUE_PING_CACHE_FLOOR);
    expect(resolveQueuePingCacheMax('not-a-number')).toBe(QUEUE_PING_CACHE_FLOOR);
  });

  it('sizes past a raised MAX_PLAYERS_PER_REALM with 128 headroom', () => {
    expect(resolveQueuePingCacheMax('20000')).toBe(20_128);
    expect(resolveQueuePingCacheMax(' 9000 ')).toBe(9_128);
  });

  it('never shrinks below the floor even for a tiny positive cap', () => {
    expect(resolveQueuePingCacheMax('10')).toBe(QUEUE_PING_CACHE_FLOOR);
  });

  it('a disabled cap (0 or negative) has no cap to size from, so the floor stands', () => {
    expect(resolveQueuePingCacheMax('0')).toBe(QUEUE_PING_CACHE_FLOOR);
    expect(resolveQueuePingCacheMax('-1')).toBe(QUEUE_PING_CACHE_FLOOR);
  });
});

describe('queuePingReadBackedOff / recordQueuePingReadFailure', () => {
  it('is not backed off before any failure', () => {
    expect(queuePingReadBackedOff(NOW)).toBe(false);
  });

  it('backs off every caller for exactly QUEUE_PING_FAILURE_BACKOFF_MS from the recorded time', () => {
    recordQueuePingReadFailure(NOW);
    expect(queuePingReadBackedOff(NOW)).toBe(true);
    expect(queuePingReadBackedOff(NOW + QUEUE_PING_FAILURE_BACKOFF_MS - 1)).toBe(true);
    expect(queuePingReadBackedOff(NOW + QUEUE_PING_FAILURE_BACKOFF_MS)).toBe(false);
  });

  it('is shared: it takes no account id, so one failure backs off every account uniformly', () => {
    recordQueuePingReadFailure(NOW);
    // The signature itself proves this (no accountId parameter), but assert
    // the observable shape too: the SAME verdict at the SAME instant,
    // independent of which account is asking.
    expect(queuePingReadBackedOff(NOW + 1)).toBe(true);
    expect(queuePingReadBackedOff(NOW + 1)).toBe(true);
  });

  it('resetQueuePingCacheForTests clears the backoff window', () => {
    recordQueuePingReadFailure(NOW);
    expect(queuePingReadBackedOff(NOW)).toBe(true);
    resetQueuePingCacheForTests();
    expect(queuePingReadBackedOff(NOW)).toBe(false);
  });
});
