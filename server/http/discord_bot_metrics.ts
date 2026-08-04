// The Discord-bot half of the /metrics exporter: the bot's own rate-limit and
// circuit-breaker health, pushed in on the presence request and cached in
// server/discord_bot_counters.ts. Registered on the SAME prom-client registry as
// the RED, game-state and business exporters (main.ts wires it at boot); there is
// no new route and no database read anywhere on this path.
//
// TWO SOURCE PATTERNS, ONE PER SEMANTIC:
//  - COUNTERS are pushed at PUSH time. The bot reports cumulative totals, so each
//    push increments by the delta against the last value this process saw (kept in
//    the closure below). A bot RESTART makes those totals go DOWN; a Prometheus
//    counter cannot, so the restart guard increments by the whole pushed value
//    instead of computing a negative delta, which is what a fresh process's
//    first-window traffic actually was.
//  - GAUGES are read at SCRAPE time through the cache getter, exactly like the
//    game-state gauges, so a bot that stopped pushing renders its live readings as
//    0 (the getter's staleness rule) rather than freezing at its last value.
//
// CARDINALITY IS BOUNDED BY DESIGN, and nothing the bot sends is ever a label: the
// only label values are the fixed DISCORD_BOT_RATE_LIMIT_SCOPES and
// DISCORD_BOT_BREAKER_STATES lists, iterated here in server code. A hostile scope
// key in a push is dropped by the sanitizer long before this module sees it and
// could not become a series even if it were not.
//
// TRUST MODEL, stated because the restart guard is not an anti-abuse bound: a
// caller holding DISCORD_BOT_SECRET is trusted for METRIC INTEGRITY. Such a
// caller can inflate the counters without bound by alternating high and low
// pushes through the restart guard, and equally by just pushing honestly huge
// totals; the sanitizer's clamp bounds one push, not the accumulated series.
// What stays hard-bounded regardless of the caller is memory (a fixed set of
// float64 counters), series count, and label values. If the secret is
// compromised, the counters lie; nothing else degrades.
//
// Server-side and language-agnostic: no t(), no DOM, no sim/client imports.

import { Counter, Gauge, type Registry } from 'prom-client';
import {
  DISCORD_BOT_BREAKER_STATES,
  DISCORD_BOT_RATE_LIMIT_SCOPES,
  type DiscordBotRateLimitScope,
  discordBotCounters,
  onDiscordBotCountersPush,
} from '../discord_bot_counters';

/** Total Discord REST requests the bot has issued since it started. */
export const WOC_DISCORD_BOT_REQUESTS_TOTAL = 'woc_discord_bot_requests_total';

/** Total 429s the bot received, by the scope Discord attributed them to. */
export const WOC_DISCORD_BOT_RATE_LIMITED_TOTAL = 'woc_discord_bot_rate_limited_total';

/** Total global rate-limit pauses the bot took. */
export const WOC_DISCORD_BOT_GLOBAL_PAUSES_TOTAL = 'woc_discord_bot_global_pauses_total';

/** Total Cloudflare-ban pauses the bot took (the severe arm of a 429). */
export const WOC_DISCORD_BOT_BAN_PAUSES_TOTAL = 'woc_discord_bot_ban_pauses_total';

/** Total times the bot's circuit breaker opened. */
export const WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL = 'woc_discord_bot_breaker_opens_total';

/** Total requests the bot skipped because the route was known-forbidden. */
export const WOC_DISCORD_BOT_FORBIDDEN_BLOCKS_TOTAL = 'woc_discord_bot_forbidden_blocks_total';

/** Total requests the bot refused while its breaker was open. */
export const WOC_DISCORD_BOT_BREAKER_BLOCKS_TOTAL = 'woc_discord_bot_breaker_blocks_total';

/** Total requests the bot refused because a bucket queue was at its cap. */
export const WOC_DISCORD_BOT_QUEUE_FULL_BLOCKS_TOTAL = 'woc_discord_bot_queue_full_blocks_total';

/** Requests currently queued behind the bot's rate-limit scheduler. */
export const WOC_DISCORD_BOT_QUEUE_DEPTH = 'woc_discord_bot_queue_depth';

/** Rate-limit buckets the bot is currently tracking. */
export const WOC_DISCORD_BOT_TRACKED_BUCKETS = 'woc_discord_bot_tracked_buckets';

/** Routes the bot currently has a bucket mapping for. */
export const WOC_DISCORD_BOT_TRACKED_ROUTES = 'woc_discord_bot_tracked_routes';

/** Per-bucket queues the bot currently has work in. */
export const WOC_DISCORD_BOT_ACTIVE_QUEUES = 'woc_discord_bot_active_queues';

/** Route entries the bot currently remembers as forbidden. */
export const WOC_DISCORD_BOT_FORBIDDEN_ENTRIES = 'woc_discord_bot_forbidden_entries';

/** The bot's circuit-breaker state as a one-hot series over the fixed states. */
export const WOC_DISCORD_BOT_BREAKER_STATE = 'woc_discord_bot_breaker_state';

/** Seconds since the bot's last counters push; 0 before the first one. */
export const WOC_DISCORD_BOT_PUSH_AGE_SECONDS = 'woc_discord_bot_push_age_seconds';

/**
 * The unlabeled cumulative fields, each exported as its own `_total` counter. The
 * plain `rateLimited` field is deliberately NOT among them: the four
 * woc_discord_bot_rate_limited_total scope series already sum to it, and a second
 * series carrying the same number invites the two to disagree after a restart.
 */
const CUMULATIVE_FIELDS = [
  'requests',
  'globalPauses',
  'banPauses',
  'breakerOpens',
  'forbiddenBlocks',
  'breakerBlocks',
  'queueFullBlocks',
] as const;

type CumulativeField = (typeof CUMULATIVE_FIELDS)[number];

/** Milliseconds per second, for the push-age millis to seconds conversion. */
const MS_PER_SECOND = 1000;

/**
 * How much to add to a cumulative counter for a newly pushed total. A bot restart
 * resets its totals to 0, so a pushed value BELOW the last one seen is a new
 * process reporting its own traffic, not a decrease: add the pushed value whole.
 */
function counterDelta(lastSeen: number, pushed: number): number {
  return pushed >= lastSeen ? pushed - lastSeen : pushed;
}

/**
 * Register the Discord-bot gauges and counters on `registry`, and install the
 * cache's push listener that feeds the counters. `now` is injected so a test can
 * drive the staleness boundary and the push age without timers.
 *
 * Every series renders at its zero state from registration onward: the counters
 * from prom-client's zero-valued default series (the labeled one is touched once
 * per fixed scope), the gauges from their scrape-time collect() over a
 * never-pushed cache.
 */
export function registerDiscordBotMetrics(registry: Registry, now: () => number = Date.now): void {
  const requests = new Counter({
    name: WOC_DISCORD_BOT_REQUESTS_TOTAL,
    help: 'Total Discord REST requests issued by the bot.',
    registers: [registry],
  });
  const globalPauses = new Counter({
    name: WOC_DISCORD_BOT_GLOBAL_PAUSES_TOTAL,
    help: 'Total global rate-limit pauses taken by the bot.',
    registers: [registry],
  });
  const banPauses = new Counter({
    name: WOC_DISCORD_BOT_BAN_PAUSES_TOTAL,
    help: 'Total Cloudflare-ban pauses taken by the bot.',
    registers: [registry],
  });
  const breakerOpens = new Counter({
    name: WOC_DISCORD_BOT_BREAKER_OPENS_TOTAL,
    help: "Total times the bot's circuit breaker opened.",
    registers: [registry],
  });
  const forbiddenBlocks = new Counter({
    name: WOC_DISCORD_BOT_FORBIDDEN_BLOCKS_TOTAL,
    help: 'Total requests the bot skipped because the route was known-forbidden.',
    registers: [registry],
  });
  const breakerBlocks = new Counter({
    name: WOC_DISCORD_BOT_BREAKER_BLOCKS_TOTAL,
    help: 'Total requests the bot refused while its circuit breaker was open.',
    registers: [registry],
  });
  const queueFullBlocks = new Counter({
    name: WOC_DISCORD_BOT_QUEUE_FULL_BLOCKS_TOTAL,
    help: 'Total requests the bot refused because a bucket queue was at its cap.',
    registers: [registry],
  });
  const cumulative: Record<CumulativeField, Counter<string>> = {
    requests,
    globalPauses,
    banPauses,
    breakerOpens,
    forbiddenBlocks,
    breakerBlocks,
    queueFullBlocks,
  };

  const rateLimited = new Counter({
    name: WOC_DISCORD_BOT_RATE_LIMITED_TOTAL,
    help: 'Total rate-limit responses received by the bot, by scope.',
    labelNames: ['scope'],
    registers: [registry],
  });
  // Touch each fixed scope at registration so all four series always render,
  // starting at 0, rather than appearing only once that scope is first hit.
  for (const scope of DISCORD_BOT_RATE_LIMIT_SCOPES) rateLimited.inc({ scope }, 0);

  // The last cumulative totals this process saw, so each push increments by its
  // delta. Kept in the closure: the exporter owns its own bookkeeping, and the
  // cache stays a plain snapshot holder.
  const lastSeen: Record<CumulativeField, number> = {
    requests: 0,
    globalPauses: 0,
    banPauses: 0,
    breakerOpens: 0,
    forbiddenBlocks: 0,
    breakerBlocks: 0,
    queueFullBlocks: 0,
  };
  const lastSeenByScope: Record<DiscordBotRateLimitScope, number> = {
    user: 0,
    global: 0,
    shared: 0,
    unknown: 0,
  };
  // The push time the age gauge measures against. Held here rather than read from
  // the cache because the getter zeroes updatedAt once a push goes stale, which is
  // exactly when the age matters most.
  let lastPushAtMs: number | null = null;

  onDiscordBotCountersPush((snapshot, nowMs) => {
    for (const field of CUMULATIVE_FIELDS) {
      const pushed = snapshot[field];
      cumulative[field].inc(counterDelta(lastSeen[field], pushed));
      lastSeen[field] = pushed;
    }
    for (const scope of DISCORD_BOT_RATE_LIMIT_SCOPES) {
      const pushed = snapshot.rateLimitedByScope[scope];
      rateLimited.inc({ scope }, counterDelta(lastSeenByScope[scope], pushed));
      lastSeenByScope[scope] = pushed;
    }
    lastPushAtMs = nowMs;
  });

  new Gauge({
    name: WOC_DISCORD_BOT_QUEUE_DEPTH,
    help: "Requests currently queued behind the bot's rate-limit scheduler.",
    registers: [registry],
    collect() {
      this.set(discordBotCounters(now()).queueDepth);
    },
  });

  new Gauge({
    name: WOC_DISCORD_BOT_TRACKED_BUCKETS,
    help: 'Rate-limit buckets the bot is currently tracking.',
    registers: [registry],
    collect() {
      this.set(discordBotCounters(now()).trackedBuckets);
    },
  });

  new Gauge({
    name: WOC_DISCORD_BOT_TRACKED_ROUTES,
    help: 'Routes the bot currently has a rate-limit bucket mapping for.',
    registers: [registry],
    collect() {
      this.set(discordBotCounters(now()).trackedRoutes);
    },
  });

  new Gauge({
    name: WOC_DISCORD_BOT_ACTIVE_QUEUES,
    help: 'Per-bucket queues the bot currently has work in.',
    registers: [registry],
    collect() {
      this.set(discordBotCounters(now()).activeQueues);
    },
  });

  new Gauge({
    name: WOC_DISCORD_BOT_FORBIDDEN_ENTRIES,
    help: 'Route entries the bot currently remembers as forbidden.',
    registers: [registry],
    collect() {
      this.set(discordBotCounters(now()).forbiddenEntries);
    },
  });

  new Gauge({
    name: WOC_DISCORD_BOT_BREAKER_STATE,
    help: "The bot's circuit-breaker state: 1 on the reported state, 0 on the others.",
    labelNames: ['state'],
    registers: [registry],
    collect() {
      // Null (never pushed, stale, or a push whose state field the sanitizer
      // refused) leaves every state at 0: nothing is reporting, which is not
      // the same claim as "the breaker is closed".
      const state = discordBotCounters(now()).breakerState;
      for (const candidate of DISCORD_BOT_BREAKER_STATES) {
        this.set({ state: candidate }, candidate === state ? 1 : 0);
      }
    },
  });

  new Gauge({
    name: WOC_DISCORD_BOT_PUSH_AGE_SECONDS,
    help: 'Seconds since the last counters push from the Discord bot.',
    registers: [registry],
    collect() {
      // Before the first push there is no age to report, so nothing is set and the
      // series renders at its 0 registration value (the same shape the business
      // collector's snapshot-age gauge uses for a not-yet-refreshed collector).
      if (lastPushAtMs === null) return;
      this.set(Math.max(0, (now() - lastPushAtMs) / MS_PER_SECOND));
    },
  });
}
