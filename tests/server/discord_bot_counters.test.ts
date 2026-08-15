// Unit coverage for the Discord bot counters cache (server/discord_bot_counters.ts).
//
// The module is a process-local slot with an injected clock, so every case here
// drives the staleness boundary by passing nowMs explicitly: no timers, real or
// fake. The cache is module-global state, so each test starts from a cold process
// via resetDiscordBotCountersForTests().

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCORD_BOT_COUNTERS_STALE_MS,
  type DiscordBotCountersSnapshot,
  discordBotCounters,
  onDiscordBotCountersPush,
  resetDiscordBotCountersForTests,
  setDiscordBotCounters,
} from '../../server/discord_bot_counters';

/** A wall-clock-shaped origin, so no case accidentally leans on a zero timestamp. */
const T0 = 1_700_000_000_000;

/** A push with a distinct value per field, so no assertion can pass by coincidence. */
function pushed(): DiscordBotCountersSnapshot {
  return {
    requests: 1000,
    rateLimited: 30,
    rateLimitedByScope: { user: 11, global: 7, shared: 9, unknown: 3 },
    globalPauses: 4,
    banPauses: 2,
    breakerState: 'half-open',
    breakerOpens: 5,
    queueDepth: 12,
    trackedBuckets: 40,
    trackedRoutes: 60,
    activeQueues: 6,
    forbiddenEntries: 8,
    forbiddenBlocks: 21,
    breakerBlocks: 13,
    queueFullBlocks: 17,
  };
}

beforeEach(() => {
  resetDiscordBotCountersForTests();
});

afterEach(() => {
  resetDiscordBotCountersForTests();
});

describe('discordBotCounters staleness', () => {
  it('serves an all-zero read with no breaker state before any push, and never calls it stale', () => {
    const empty = {
      requests: 0,
      rateLimited: 0,
      rateLimitedByScope: { user: 0, global: 0, shared: 0, unknown: 0 },
      globalPauses: 0,
      banPauses: 0,
      breakerState: null,
      breakerOpens: 0,
      queueDepth: 0,
      trackedBuckets: 0,
      trackedRoutes: 0,
      activeQueues: 0,
      forbiddenEntries: 0,
      forbiddenBlocks: 0,
      breakerBlocks: 0,
      queueFullBlocks: 0,
      updatedAt: 0,
    };
    expect(discordBotCounters(T0)).toEqual(empty);
    // Far past the staleness window with nothing ever written: still the same read,
    // never the stale branch (the presence cache's never-written guard).
    expect(discordBotCounters(T0 + DISCORD_BOT_COUNTERS_STALE_MS * 100)).toEqual(empty);
  });

  it('reads fresh AT the boundary and stale one millisecond past it', () => {
    setDiscordBotCounters(pushed(), T0);

    const atBoundary = discordBotCounters(T0 + DISCORD_BOT_COUNTERS_STALE_MS);
    expect(atBoundary).toEqual({ ...pushed(), updatedAt: T0 });

    const pastBoundary = discordBotCounters(T0 + DISCORD_BOT_COUNTERS_STALE_MS + 1);
    expect(pastBoundary).toEqual({
      // The nine cumulative fields survive: they count since bot start, and
      // zeroing them here would render as traffic the bot never served.
      requests: 1000,
      rateLimited: 30,
      rateLimitedByScope: { user: 11, global: 7, shared: 9, unknown: 3 },
      globalPauses: 4,
      banPauses: 2,
      breakerOpens: 5,
      forbiddenBlocks: 21,
      breakerBlocks: 13,
      queueFullBlocks: 17,
      // The five live gauges and the breaker state read as "nothing reporting".
      breakerState: null,
      queueDepth: 0,
      trackedBuckets: 0,
      trackedRoutes: 0,
      activeQueues: 0,
      forbiddenEntries: 0,
      updatedAt: 0,
    });
  });

  it('goes fresh again on the next push after a stale window', () => {
    setDiscordBotCounters(pushed(), T0);
    const stale = T0 + DISCORD_BOT_COUNTERS_STALE_MS + 1;
    expect(discordBotCounters(stale).breakerState).toBeNull();

    setDiscordBotCounters({ ...pushed(), queueDepth: 77, breakerState: 'open' }, stale);
    expect(discordBotCounters(stale)).toEqual({
      ...pushed(),
      queueDepth: 77,
      breakerState: 'open',
      updatedAt: stale,
    });
  });

  it('serves a stored NULL breaker state through a FRESH read as null', () => {
    // A push whose state field the sanitizer refused arrives as null. A fresh
    // read must pass it through as no-claim rather than reviving a default:
    // the null is data (an untrustworthy pusher), not an artifact of staleness.
    setDiscordBotCounters({ ...pushed(), breakerState: null }, T0);

    const read = discordBotCounters(T0 + 1000);
    expect(read.breakerState).toBeNull();
    expect(read.queueDepth).toBe(12);
    expect(read.updatedAt).toBe(T0);
  });
});

describe('discordBotCounters copy semantics', () => {
  it('stores a copy, so mutating the pushed object afterwards cannot change the cache', () => {
    const snapshot = pushed();
    setDiscordBotCounters(snapshot, T0);
    snapshot.requests = 999_999;
    snapshot.rateLimitedByScope.user = 999_999;
    expect(discordBotCounters(T0)).toEqual({ ...pushed(), updatedAt: T0 });
  });

  it('returns a copy, so mutating one read cannot change the next one', () => {
    setDiscordBotCounters(pushed(), T0);
    const first = discordBotCounters(T0);
    first.queueDepth = 999_999;
    first.rateLimitedByScope.user = 999_999;
    expect(discordBotCounters(T0)).toEqual({ ...pushed(), updatedAt: T0 });
  });

  it('returns a copy on the STALE branch too, not an alias of the cached record', () => {
    // The stale read builds a different object than the fresh one (zeroed
    // gauges, null state), so its scope record needs its own spread; dropping
    // that one spread would alias the cache out through every stale scrape.
    setDiscordBotCounters(pushed(), T0);
    const stale = discordBotCounters(T0 + DISCORD_BOT_COUNTERS_STALE_MS + 1);
    stale.rateLimitedByScope.user = 999_999;
    expect(discordBotCounters(T0).rateLimitedByScope.user).toBe(pushed().rateLimitedByScope.user);
  });
});

describe('onDiscordBotCountersPush', () => {
  it('fires with a copy AFTER the push is stored, so the listener can read the cache', () => {
    const seen: { arg: DiscordBotCountersSnapshot; nowMs: number; cached: number }[] = [];
    onDiscordBotCountersPush((snapshot, nowMs) => {
      seen.push({ arg: snapshot, nowMs, cached: discordBotCounters(nowMs).requests });
    });

    setDiscordBotCounters(pushed(), T0);

    expect(seen).toHaveLength(1);
    expect(seen[0].arg).toEqual(pushed());
    expect(seen[0].nowMs).toBe(T0);
    // Stored BEFORE the notify: the getter already serves the pushed value.
    expect(seen[0].cached).toBe(1000);

    // The listener's copy is private: mutating it cannot reach the cache.
    seen[0].arg.requests = 999_999;
    seen[0].arg.rateLimitedByScope.global = 999_999;
    expect(discordBotCounters(T0)).toEqual({ ...pushed(), updatedAt: T0 });
  });

  it('swallows a throwing listener so a metrics bug cannot fail the presence push', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    onDiscordBotCountersPush(() => {
      throw new Error('metrics exploded');
    });

    expect(() => setDiscordBotCounters(pushed(), T0)).not.toThrow();
    // The push still landed: the listener runs after the store, so its failure
    // cannot cost the cache its update.
    expect(discordBotCounters(T0)).toEqual({ ...pushed(), updatedAt: T0 });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('keeps one listener slot: a second registration replaces the first', () => {
    const first = vi.fn();
    const second = vi.fn();
    onDiscordBotCountersPush(first);
    onDiscordBotCountersPush(second);

    setDiscordBotCounters(pushed(), T0);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
