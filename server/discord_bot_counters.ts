// Process-local cache for the Discord bot's own rate-limit and circuit-breaker
// counters, pushed by the bot on the SAME /internal/discord/presence request that
// carries the online/voice roster (server/internal.ts sanitizes the block before
// it reaches here). It is a sibling of the presence cache in server/discord.ts and
// deliberately follows the same shape: one process-local slot, a staleness rule in
// the getter, no DB and no route of its own.
//
// STALENESS MIRRORS PRESENCE, WITH A SPLIT: a bot that stops pushing must not leave
// a frozen live reading on the dashboard, so the five live GAUGE fields (queue
// depth, tracked buckets, tracked routes, active queues, forbidden entries) and the
// breaker state read as "nothing is reporting" once a push is older than
// DISCORD_BOT_COUNTERS_STALE_MS. The CUMULATIVE fields persist through staleness:
// they are counters-since-bot-start, and zeroing them at the staleness boundary
// would render as a rate spike the bot never served.
//
// TIME IS INJECTED. Every entry point takes nowMs from its caller rather than
// reading the clock itself, so the staleness boundary is testable in both
// directions without timers (the presence cache stamps Date.now() internally and
// cannot be; that flaw is not copied here).
//
// Server-side and language-agnostic: no t(), no DOM, no sim/client imports.

/** The three circuit-breaker states the bot can report. */
export const DISCORD_BOT_BREAKER_STATES = ['closed', 'open', 'half-open'] as const;

export type DiscordBotBreakerState = (typeof DISCORD_BOT_BREAKER_STATES)[number];

/**
 * The FIXED rate-limit scopes. This list is the only source of scope names the
 * server ever iterates: a bot-supplied key is never read back out, so nothing the
 * bot sends can become a Prometheus label value or grow the series count.
 */
export const DISCORD_BOT_RATE_LIMIT_SCOPES = ['user', 'global', 'shared', 'unknown'] as const;

export type DiscordBotRateLimitScope = (typeof DISCORD_BOT_RATE_LIMIT_SCOPES)[number];

/**
 * One sanitized counters push. Cumulative-since-bot-start: requests, rateLimited,
 * the four scope buckets, globalPauses, banPauses, breakerOpens, forbiddenBlocks,
 * breakerBlocks, queueFullBlocks. Live gauges: queueDepth, trackedBuckets,
 * trackedRoutes, activeQueues, forbiddenEntries. A bot restart makes the
 * cumulative values go DOWN (a fresh process starts at 0); consumers must expect
 * that. A null breakerState is a push whose state field was unrecognized: the
 * sanitizer refuses to invent a claim, and the exporter renders no state at all.
 */
export interface DiscordBotCountersSnapshot {
  requests: number;
  rateLimited: number;
  rateLimitedByScope: Record<DiscordBotRateLimitScope, number>;
  globalPauses: number;
  banPauses: number;
  breakerState: DiscordBotBreakerState | null;
  breakerOpens: number;
  queueDepth: number;
  trackedBuckets: number;
  trackedRoutes: number;
  activeQueues: number;
  forbiddenEntries: number;
  forbiddenBlocks: number;
  breakerBlocks: number;
  queueFullBlocks: number;
}

/** What a read returns: the stored snapshot plus its age, staleness applied. */
export interface DiscordBotCountersRead extends Omit<DiscordBotCountersSnapshot, 'breakerState'> {
  /**
   * null when no bot is currently reporting a state: never pushed, stale, or the
   * last push's state field was unrecognized and stored as no-claim.
   */
  breakerState: DiscordBotBreakerState | null;
  /** Epoch millis of the last push; 0 when never pushed or stale. */
  updatedAt: number;
}

/**
 * How long a push stays live. Mirrors the presence cache's 5 minute rule so the
 * two halves of one request age out together; deliberately NOT env-configurable,
 * since a per-deployment window would let the two drift apart.
 */
export const DISCORD_BOT_COUNTERS_STALE_MS = 5 * 60_000;

/** Called after a push is stored, with a private copy of it. */
export type DiscordBotCountersPushListener = (
  snapshot: DiscordBotCountersSnapshot,
  nowMs: number,
) => void;

let counters: DiscordBotCountersSnapshot | null = null;
let updatedAt = 0;
let pushListener: DiscordBotCountersPushListener | null = null;

function copySnapshot(snapshot: DiscordBotCountersSnapshot): DiscordBotCountersSnapshot {
  return { ...snapshot, rateLimitedByScope: { ...snapshot.rateLimitedByScope } };
}

/** The read every not-yet-pushed process serves: all zero, nothing reporting. */
function emptyRead(): DiscordBotCountersRead {
  return {
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
}

/**
 * Store a sanitized push stamped at `nowMs`, then notify the single push listener.
 * The listener runs inside a try/catch: an observability bug must never be what
 * fails the bot's presence request.
 */
export function setDiscordBotCounters(snapshot: DiscordBotCountersSnapshot, nowMs: number): void {
  counters = copySnapshot(snapshot);
  updatedAt = nowMs;
  if (pushListener === null) return;
  try {
    pushListener(copySnapshot(counters), nowMs);
  } catch (err) {
    console.error('discord bot counters push listener failed:', err);
  }
}

/**
 * Read the cached counters as of `nowMs`. A never-pushed cache is NOT stale (the
 * presence cache expresses that as its `updatedAt &&` guard; here the stored slot
 * says it directly, which also lets a push stamped at epoch 0 age normally).
 */
export function discordBotCounters(nowMs: number): DiscordBotCountersRead {
  if (counters === null) return emptyRead();
  if (nowMs - updatedAt > DISCORD_BOT_COUNTERS_STALE_MS) {
    return {
      requests: counters.requests,
      rateLimited: counters.rateLimited,
      rateLimitedByScope: { ...counters.rateLimitedByScope },
      globalPauses: counters.globalPauses,
      banPauses: counters.banPauses,
      breakerState: null,
      breakerOpens: counters.breakerOpens,
      queueDepth: 0,
      trackedBuckets: 0,
      trackedRoutes: 0,
      activeQueues: 0,
      forbiddenEntries: 0,
      forbiddenBlocks: counters.forbiddenBlocks,
      breakerBlocks: counters.breakerBlocks,
      queueFullBlocks: counters.queueFullBlocks,
      updatedAt: 0,
    };
  }
  return { ...copySnapshot(counters), updatedAt };
}

/**
 * Install the one push listener (the metrics registration owns it). A second call
 * replaces the first: this is a single slot on purpose, matching the process-wide
 * metric sinks in server/http/.
 */
export function onDiscordBotCountersPush(listener: DiscordBotCountersPushListener): void {
  pushListener = listener;
}

/** Clear the cache and the listener so a unit test starts from a cold process. */
export function resetDiscordBotCountersForTests(): void {
  counters = null;
  updatedAt = 0;
  pushListener = null;
}
