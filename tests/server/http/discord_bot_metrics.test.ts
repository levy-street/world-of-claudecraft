// Unit coverage for the Discord-bot /metrics series (server/http/discord_bot_metrics.ts).
//
// Each test builds its OWN prom-client Registry (never the global default one) and
// drives time through the synthetic clock the register function takes, so the
// staleness boundary and the push age are exact and timer-free. The counters cache
// is module-global, so every test starts from a cold process.

import { Registry } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DISCORD_BOT_COUNTERS_STALE_MS,
  type DiscordBotCountersSnapshot,
  resetDiscordBotCountersForTests,
  setDiscordBotCounters,
} from '../../../server/discord_bot_counters';
import {
  registerDiscordBotMetrics,
  WOC_DISCORD_BOT_ACTIVE_QUEUES,
  WOC_DISCORD_BOT_BAN_PAUSES_TOTAL,
  WOC_DISCORD_BOT_BREAKER_BLOCKS_TOTAL,
  WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL,
  WOC_DISCORD_BOT_BREAKER_STATE,
  WOC_DISCORD_BOT_FORBIDDEN_BLOCKS_TOTAL,
  WOC_DISCORD_BOT_FORBIDDEN_ENTRIES,
  WOC_DISCORD_BOT_GLOBAL_PAUSES_TOTAL,
  WOC_DISCORD_BOT_PUSH_AGE_SECONDS,
  WOC_DISCORD_BOT_QUEUE_DEPTH,
  WOC_DISCORD_BOT_QUEUE_FULL_BLOCKS_TOTAL,
  WOC_DISCORD_BOT_RATE_LIMITED_TOTAL,
  WOC_DISCORD_BOT_REQUESTS_TOTAL,
  WOC_DISCORD_BOT_TRACKED_BUCKETS,
  WOC_DISCORD_BOT_TRACKED_ROUTES,
} from '../../../server/http/discord_bot_metrics';
import { syntheticClock } from '../../helpers/synthetic_clock';

/** A wall-clock-shaped origin, so no case leans on a zero timestamp. */
const T0 = 1_700_000_000_000;

function push(overrides: Partial<DiscordBotCountersSnapshot> = {}): DiscordBotCountersSnapshot {
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
    ...overrides,
  };
}

/** The rendered value of one series, by metric name and optional label set. */
function sample(text: string, metric: string, labels?: string): string | undefined {
  const selector = labels === undefined ? '' : `\\{${labels}\\}`;
  return text.match(new RegExp(`^${metric}${selector} ([^\\n]+)$`, 'm'))?.[1];
}

beforeEach(() => {
  resetDiscordBotCountersForTests();
});

afterEach(() => {
  resetDiscordBotCountersForTests();
});

describe('registerDiscordBotMetrics', () => {
  it('pins every exported series name to its literal', () => {
    // Every other assertion in this file reads the names through the same
    // constants production uses, so renaming a constant's VALUE moves both
    // sides together and the suite stays green while DEPLOY.md's documented
    // series and every dashboard query break. The literals are the ops
    // contract; this block is the game_metrics.test.ts convention applied here.
    expect(WOC_DISCORD_BOT_REQUESTS_TOTAL).toBe('woc_discord_bot_requests_total');
    expect(WOC_DISCORD_BOT_RATE_LIMITED_TOTAL).toBe('woc_discord_bot_rate_limited_total');
    expect(WOC_DISCORD_BOT_GLOBAL_PAUSES_TOTAL).toBe('woc_discord_bot_global_pauses_total');
    expect(WOC_DISCORD_BOT_BAN_PAUSES_TOTAL).toBe('woc_discord_bot_ban_pauses_total');
    expect(WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL).toBe('woc_discord_bot_breaker_opens_total');
    expect(WOC_DISCORD_BOT_FORBIDDEN_BLOCKS_TOTAL).toBe('woc_discord_bot_forbidden_blocks_total');
    expect(WOC_DISCORD_BOT_BREAKER_BLOCKS_TOTAL).toBe('woc_discord_bot_breaker_blocks_total');
    expect(WOC_DISCORD_BOT_QUEUE_FULL_BLOCKS_TOTAL).toBe('woc_discord_bot_queue_full_blocks_total');
    expect(WOC_DISCORD_BOT_QUEUE_DEPTH).toBe('woc_discord_bot_queue_depth');
    expect(WOC_DISCORD_BOT_TRACKED_BUCKETS).toBe('woc_discord_bot_tracked_buckets');
    expect(WOC_DISCORD_BOT_TRACKED_ROUTES).toBe('woc_discord_bot_tracked_routes');
    expect(WOC_DISCORD_BOT_ACTIVE_QUEUES).toBe('woc_discord_bot_active_queues');
    expect(WOC_DISCORD_BOT_FORBIDDEN_ENTRIES).toBe('woc_discord_bot_forbidden_entries');
    expect(WOC_DISCORD_BOT_BREAKER_STATE).toBe('woc_discord_bot_breaker_state');
    expect(WOC_DISCORD_BOT_PUSH_AGE_SECONDS).toBe('woc_discord_bot_push_age_seconds');
  });

  it('renders every series at its zero state before the bot has pushed anything', async () => {
    const registry = new Registry();
    const clock = syntheticClock(T0);
    registerDiscordBotMetrics(registry, clock.now);

    const text = await registry.metrics();
    for (const metric of [
      WOC_DISCORD_BOT_REQUESTS_TOTAL,
      WOC_DISCORD_BOT_GLOBAL_PAUSES_TOTAL,
      WOC_DISCORD_BOT_BAN_PAUSES_TOTAL,
      WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL,
      WOC_DISCORD_BOT_FORBIDDEN_BLOCKS_TOTAL,
      WOC_DISCORD_BOT_BREAKER_BLOCKS_TOTAL,
      WOC_DISCORD_BOT_QUEUE_FULL_BLOCKS_TOTAL,
      WOC_DISCORD_BOT_QUEUE_DEPTH,
      WOC_DISCORD_BOT_TRACKED_BUCKETS,
      WOC_DISCORD_BOT_TRACKED_ROUTES,
      WOC_DISCORD_BOT_ACTIVE_QUEUES,
      WOC_DISCORD_BOT_FORBIDDEN_ENTRIES,
      WOC_DISCORD_BOT_PUSH_AGE_SECONDS,
    ]) {
      expect(text).toContain(`${metric} 0\n`);
    }
    // All four fixed scopes and all three fixed breaker states render from
    // registration, so a dashboard never waits for a first occurrence.
    for (const scope of ['user', 'global', 'shared', 'unknown']) {
      expect(text).toContain(`${WOC_DISCORD_BOT_RATE_LIMITED_TOTAL}{scope="${scope}"} 0\n`);
    }
    for (const state of ['closed', 'open', 'half-open']) {
      expect(text).toContain(`${WOC_DISCORD_BOT_BREAKER_STATE}{state="${state}"} 0\n`);
    }
  });

  it('renders the pushed values, one-hot breaker state, and the push age', async () => {
    const registry = new Registry();
    const clock = syntheticClock(T0);
    registerDiscordBotMetrics(registry, clock.now);

    setDiscordBotCounters(push(), clock.now());
    await clock.advanceBy(30_000);

    const text = await registry.metrics();
    expect(sample(text, WOC_DISCORD_BOT_REQUESTS_TOTAL)).toBe('1000');
    expect(sample(text, WOC_DISCORD_BOT_GLOBAL_PAUSES_TOTAL)).toBe('4');
    expect(sample(text, WOC_DISCORD_BOT_BAN_PAUSES_TOTAL)).toBe('2');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL)).toBe('5');
    expect(sample(text, WOC_DISCORD_BOT_FORBIDDEN_BLOCKS_TOTAL)).toBe('21');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_BLOCKS_TOTAL)).toBe('13');
    expect(sample(text, WOC_DISCORD_BOT_QUEUE_FULL_BLOCKS_TOTAL)).toBe('17');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="user"')).toBe('11');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="global"')).toBe('7');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="shared"')).toBe('9');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="unknown"')).toBe('3');
    expect(sample(text, WOC_DISCORD_BOT_QUEUE_DEPTH)).toBe('12');
    expect(sample(text, WOC_DISCORD_BOT_TRACKED_BUCKETS)).toBe('40');
    expect(sample(text, WOC_DISCORD_BOT_TRACKED_ROUTES)).toBe('60');
    expect(sample(text, WOC_DISCORD_BOT_ACTIVE_QUEUES)).toBe('6');
    expect(sample(text, WOC_DISCORD_BOT_FORBIDDEN_ENTRIES)).toBe('8');
    expect(sample(text, WOC_DISCORD_BOT_PUSH_AGE_SECONDS)).toBe('30');
    // Exactly the pushed state carries the 1.
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_STATE, 'state="half-open"')).toBe('1');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_STATE, 'state="closed"')).toBe('0');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_STATE, 'state="open"')).toBe('0');

    // The plain rateLimited field is cached but deliberately not its own series:
    // the four scope series already sum to it.
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL)).toBeUndefined();
  });

  it('accumulates cumulative counters by delta across pushes', async () => {
    const registry = new Registry();
    const clock = syntheticClock(T0);
    registerDiscordBotMetrics(registry, clock.now);

    setDiscordBotCounters(push(), clock.now());
    await clock.advanceBy(60_000);
    setDiscordBotCounters(
      push({
        requests: 1750,
        rateLimitedByScope: { user: 20, global: 7, shared: 9, unknown: 3 },
        breakerOpens: 6,
        breakerState: 'open',
      }),
      clock.now(),
    );

    const text = await registry.metrics();
    // 1000 then +750: the counter tracks the bot's total, not the last push.
    expect(sample(text, WOC_DISCORD_BOT_REQUESTS_TOTAL)).toBe('1750');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="user"')).toBe('20');
    // A scope that did not move stays where it was rather than double-counting.
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="global"')).toBe('7');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL)).toBe('6');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_STATE, 'state="open"')).toBe('1');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_STATE, 'state="half-open"')).toBe('0');
    expect(sample(text, WOC_DISCORD_BOT_PUSH_AGE_SECONDS)).toBe('0');
  });

  it('adds the whole total of a restarted bot instead of rendering a decrease', async () => {
    const registry = new Registry();
    const clock = syntheticClock(T0);
    registerDiscordBotMetrics(registry, clock.now);

    setDiscordBotCounters(push(), clock.now());
    await clock.advanceBy(60_000);
    setDiscordBotCounters(
      push({ requests: 1750, rateLimitedByScope: { user: 20, global: 7, shared: 9, unknown: 3 } }),
      clock.now(),
    );
    await clock.advanceBy(60_000);
    // The bot restarted: its cumulative totals start over from a fresh process.
    setDiscordBotCounters(
      push({
        requests: 40,
        rateLimitedByScope: { user: 2, global: 0, shared: 0, unknown: 0 },
        globalPauses: 0,
        banPauses: 0,
        breakerOpens: 0,
        forbiddenBlocks: 0,
        breakerBlocks: 0,
        queueFullBlocks: 0,
      }),
      clock.now(),
    );

    const text = await registry.metrics();
    // 1750 carried forward plus the new process's own 40, never 1750 - 40.
    expect(sample(text, WOC_DISCORD_BOT_REQUESTS_TOTAL)).toBe('1790');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="user"')).toBe('22');
    // A scope that restarted at 0 adds nothing rather than subtracting.
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="global"')).toBe('7');
    expect(sample(text, WOC_DISCORD_BOT_GLOBAL_PAUSES_TOTAL)).toBe('4');
    expect(sample(text, WOC_DISCORD_BOT_BAN_PAUSES_TOTAL)).toBe('2');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL)).toBe('5');
    expect(sample(text, WOC_DISCORD_BOT_FORBIDDEN_BLOCKS_TOTAL)).toBe('21');
    expect(sample(text, WOC_DISCORD_BOT_BREAKER_BLOCKS_TOTAL)).toBe('13');
    expect(sample(text, WOC_DISCORD_BOT_QUEUE_FULL_BLOCKS_TOTAL)).toBe('17');

    // A SECOND restart behaves like the first: the guard is per-push
    // bookkeeping, not a one-shot latch. 40 up to 55 is an ordinary +15 delta,
    // then 55 down to 3 is another restart adding its whole 3.
    await clock.advanceBy(60_000);
    setDiscordBotCounters(
      push({ requests: 55, rateLimitedByScope: { user: 2, global: 0, shared: 0, unknown: 0 } }),
      clock.now(),
    );
    await clock.advanceBy(60_000);
    setDiscordBotCounters(
      push({ requests: 3, rateLimitedByScope: { user: 0, global: 0, shared: 0, unknown: 0 } }),
      clock.now(),
    );
    const after = await registry.metrics();
    expect(sample(after, WOC_DISCORD_BOT_REQUESTS_TOTAL)).toBe('1808');
  });

  it('zeroes the live gauges and the breaker state once the push goes stale, keeping the totals', async () => {
    const registry = new Registry();
    const clock = syntheticClock(T0);
    registerDiscordBotMetrics(registry, clock.now);

    setDiscordBotCounters(push(), clock.now());
    await clock.advanceBy(DISCORD_BOT_COUNTERS_STALE_MS);
    const atBoundary = await registry.metrics();
    expect(sample(atBoundary, WOC_DISCORD_BOT_QUEUE_DEPTH)).toBe('12');
    expect(sample(atBoundary, WOC_DISCORD_BOT_BREAKER_STATE, 'state="half-open"')).toBe('1');

    await clock.advanceBy(1);
    const text = await registry.metrics();
    for (const metric of [
      WOC_DISCORD_BOT_QUEUE_DEPTH,
      WOC_DISCORD_BOT_TRACKED_BUCKETS,
      WOC_DISCORD_BOT_TRACKED_ROUTES,
      WOC_DISCORD_BOT_ACTIVE_QUEUES,
      WOC_DISCORD_BOT_FORBIDDEN_ENTRIES,
    ]) {
      expect(sample(text, metric)).toBe('0');
    }
    for (const state of ['closed', 'open', 'half-open']) {
      expect(sample(text, WOC_DISCORD_BOT_BREAKER_STATE, `state="${state}"`)).toBe('0');
    }
    // The cumulative totals are untouched by staleness, and the age keeps growing
    // (it is measured from the push, not from the cache's zeroed updatedAt).
    expect(sample(text, WOC_DISCORD_BOT_REQUESTS_TOTAL)).toBe('1000');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="user"')).toBe('11');
    expect(sample(text, WOC_DISCORD_BOT_PUSH_AGE_SECONDS)).toBe('300.001');

    // A push arriving AFTER the stale window increments by DELTA and revives the
    // gauges. The exporter's lastSeen bookkeeping lives in its closure, so
    // staleness (which zeroes the cache READ) must not reset it: a refactor that
    // re-derived lastSeen from the stale read would render 1000 + 1200 here.
    setDiscordBotCounters(push({ requests: 1200 }), clock.now());
    const revived = await registry.metrics();
    expect(sample(revived, WOC_DISCORD_BOT_REQUESTS_TOTAL)).toBe('1200');
    expect(sample(revived, WOC_DISCORD_BOT_QUEUE_DEPTH)).toBe('12');
    expect(sample(revived, WOC_DISCORD_BOT_BREAKER_STATE, 'state="half-open"')).toBe('1');
    expect(sample(revived, WOC_DISCORD_BOT_PUSH_AGE_SECONDS)).toBe('0');
  });

  it('renders NO breaker claim for a stored null state', async () => {
    // The sanitizer stores null for an unrecognized pushed state; the one-hot
    // gauge must answer exactly like staleness does, all three series 0, rather
    // than inventing an affirmative closed.
    const registry = new Registry();
    const clock = syntheticClock(T0);
    registerDiscordBotMetrics(registry, clock.now);

    setDiscordBotCounters(push({ breakerState: null }), clock.now());

    const text = await registry.metrics();
    for (const state of ['closed', 'open', 'half-open']) {
      expect(sample(text, WOC_DISCORD_BOT_BREAKER_STATE, `state="${state}"`)).toBe('0');
    }
    // The rest of the push still renders: no-claim is per-field, not per-push.
    expect(sample(text, WOC_DISCORD_BOT_QUEUE_DEPTH)).toBe('12');
    expect(sample(text, WOC_DISCORD_BOT_REQUESTS_TOTAL)).toBe('1000');
  });

  it('never turns a pushed scope key into a label: only the fixed four render', async () => {
    const registry = new Registry();
    const clock = syntheticClock(T0);
    registerDiscordBotMetrics(registry, clock.now);

    // A scope key the fixed list does not carry, forced past the type to prove the
    // exporter iterates ITS OWN list rather than the pushed object's keys.
    setDiscordBotCounters(
      push({
        rateLimitedByScope: {
          user: 11,
          global: 7,
          shared: 9,
          unknown: 3,
          evil: 5,
        } as unknown as DiscordBotCountersSnapshot['rateLimitedByScope'],
      }),
      clock.now(),
    );

    const text = await registry.metrics();
    expect(text).not.toContain('scope="evil"');
    expect(text).not.toContain('evil');
    expect(sample(text, WOC_DISCORD_BOT_RATE_LIMITED_TOTAL, 'scope="user"')).toBe('11');
  });

  it('works on the DEFAULT clock, the one production actually runs on', async () => {
    // main.ts calls registerDiscordBotMetrics(registry) with no clock, so the
    // default `now = Date.now` is the production path; every other case here
    // injects the synthetic clock. Decisive only through the STALE branch: a
    // fresh-push assertion is satisfied by a broken default too (`() => 0`
    // reads any real epoch stamp as fresh and an age of max(0, negative) = 0),
    // so the arm plants a push stamped just past the window and demands the
    // stale render, which only a real clock can produce.
    const registry = new Registry();
    registerDiscordBotMetrics(registry);

    setDiscordBotCounters(push(), Date.now() - DISCORD_BOT_COUNTERS_STALE_MS - 1);

    const stale = await registry.metrics();
    expect(sample(stale, WOC_DISCORD_BOT_QUEUE_DEPTH)).toBe('0');
    for (const state of ['closed', 'open', 'half-open']) {
      expect(sample(stale, WOC_DISCORD_BOT_BREAKER_STATE, `state="${state}"`)).toBe('0');
    }
    const age = Number(sample(stale, WOC_DISCORD_BOT_PUSH_AGE_SECONDS));
    // The floor carries the decisiveness (a () => 0 default reads age 0); the
    // ceiling is deliberately loose so a GC pause between the stamp and the
    // scrape cannot flake the arm.
    expect(age).toBeGreaterThanOrEqual(300);
    expect(age).toBeLessThan(305);

    // And a fresh push on the same default clock reads live again.
    setDiscordBotCounters(push(), Date.now());
    const fresh = await registry.metrics();
    expect(sample(fresh, WOC_DISCORD_BOT_QUEUE_DEPTH)).toBe('12');
    const freshAge = Number(sample(fresh, WOC_DISCORD_BOT_PUSH_AGE_SECONDS));
    expect(freshAge).toBeGreaterThanOrEqual(0);
    expect(freshAge).toBeLessThan(5);
  });
});
