// The queue-pop DM opt-in toggle: GET/POST /api/discord/queue-pings, the
// account setting behind the options-window row. Registry-only RouteDefs on the
// deeds broadcasts shape (server/deeds.ts): a read-tier bearer for the read so
// the row renders the persisted state before its first write, a mutation-tier
// bearer plus the body middleware for the write. The flag itself is read by the
// game loop's queue-pop observer (server/discord_queue_pops.ts), which the
// write busts so an opt-in mid-queue is honored on the next tick.
//
// Rate limiting: a valid bearer alone does not bound how often one account (or
// one IP fronting several accounts) can hit this route, and every GET costs a
// DB read while every valid POST costs a DB write PLUS an observer-cache bust.
// Both legs carry their own fused per-IP AND per-account sliding-window bucket
// (the wallet/steam/character-mutation shape in server/ratelimit.ts), kept
// self-contained here rather than promoted to the shared
// server/http/middleware/rate_limit.ts policy table: this route pair is the
// module's whole surface, so a dedicated shared policy would be a single-use
// abstraction. A rejection throws the SAME coded 429
// (server/http/error_codes.ts 'rate_limit.exceeded') the two-tier pipeline
// throws, so the client's existing matcher and Retry-After handling apply
// unchanged, and reuses the shared sliding-window primitives
// (windowedRateLimitOutcome, mergeFusedOutcomes, the injectable clock) so the
// math can't drift from every other limiter in the module it mirrors. The 429
// also carries the real draft-11 headers via the shared rateLimit429Headers
// (Retry-After, RateLimit, RateLimit-Policy), the same builder the two-tier
// pipeline's rateLimit() middleware uses, not just the Retry-After that
// HttpError's params-implied-header path alone would add.

import { bustQueuePingCache } from './discord_queue_ping_cache';
import { getDiscordQueuePings, setDiscordQueuePings } from './discord_queue_pings_db';
import { attackSignalSink } from './http/attack_signals';
import { ctxAccountId } from './http/context';
import { HttpError, rateLimit429Headers } from './http/errors';
import { withBody } from './http/middleware/body';
import { requireAccount } from './http/middleware/require_account';
import type { Ctx, RateLimitOutcome, RouteDef } from './http/types';
import { json } from './http_util';
import { mergeFusedOutcomes, rateLimitNow, WINDOW_MS, windowedRateLimitOutcome } from './ratelimit';

/** Every policy's window is the shared sliding-window size, in seconds. */
const WINDOW_SECONDS = WINDOW_MS / 1000;

/** The domain's stable invalid-input code (server/http/error_codes.ts). */
export const QUEUE_PINGS_INVALID_INPUT_CODE = 'discord.invalid_input';

/** GET (the options-window read): 20/min, fused per-IP AND per-account. */
export const QUEUE_PINGS_READ_MAX_PER_MINUTE = 20;
/** POST (the deliberate toggle click): 10/min, fused per-IP AND per-account. */
export const QUEUE_PINGS_WRITE_MAX_PER_MINUTE = 10;

// A small local backstop cap so a flood of distinct callers can't grow these
// maps without bound. Mirrors the SHAPE of server/ratelimit.ts's
// recordSlidingWindowAttempt (not itself exported) but skips its more
// elaborate currently-limited-aware eviction: that machinery exists for the
// login/register surface's much higher expected volume, which this settings
// toggle never approaches.
const QUEUE_PINGS_RATE_LIMIT_MAX_TRACKED = 2_000;

const readIpAttempts = new Map<string, number[]>();
const readAccountAttempts = new Map<number, number[]>();
const writeIpAttempts = new Map<string, number[]>();
const writeAccountAttempts = new Map<number, number[]>();

function recordAttempt<K>(
  bucket: Map<K, number[]>,
  key: K,
  maxPerMinute: number,
): RateLimitOutcome {
  const now = rateLimitNow();
  const windowStart = now - WINDOW_MS;
  const active = (bucket.get(key) ?? []).filter((t) => t > windowStart);
  // Bounded: once a key's in-window count already answers "over limit", stop
  // appending. QUEUE_PINGS_RATE_LIMIT_MAX_TRACKED bounds the number of DISTINCT
  // keys, never the size of any ONE key's array; without this a sustained
  // flood against a single key (the common case, since a flood hammers one IP
  // or one account) grew that key's array, and the per-call filter/copy cost
  // with it, without bound. Capping the push preserves the refusal window
  // exactly: `active[0]` (the oldest tracked timestamp, which resetSeconds is
  // computed from) never changes while the flood continues, so a flood can
  // never reset or delay its own reset time by generating more attempts.
  const updated = active.length <= maxPerMinute ? [...active, now] : active;
  bucket.set(key, updated);
  if (bucket.size > QUEUE_PINGS_RATE_LIMIT_MAX_TRACKED) {
    const oldest = bucket.keys().next().value;
    if (oldest !== undefined && oldest !== key) bucket.delete(oldest);
  }
  return windowedRateLimitOutcome(updated.length, maxPerMinute, updated[0] ?? now, WINDOW_MS, now);
}

/**
 * Record one attempt against BOTH the per-IP and per-account bucket for this
 * leg and throw the shared coded 429 on a rejection; a caller under the limit
 * returns normally having paid no DB or cache cost yet (this runs before any
 * of it). `policyName` is an attack-signal label only (bounded, no ip/account).
 */
function enforceQueuePingsRateLimit(
  ctx: Ctx,
  accountId: number,
  policyName: string,
  maxPerMinute: number,
  ipAttempts: Map<string, number[]>,
  accountAttempts: Map<number, number[]>,
): void {
  const ip = recordAttempt(ipAttempts, ctx.ip, maxPerMinute);
  const account = recordAttempt(accountAttempts, accountId, maxPerMinute);
  const outcome = mergeFusedOutcomes(ip, account);
  if (outcome.allowed) return;
  attackSignalSink().rateLimitHit(policyName, 'ip+account');
  throw new HttpError(
    429,
    'rate_limit.exceeded',
    { retryAfterSeconds: outcome.resetSeconds },
    rateLimit429Headers(
      { name: policyName, limit: maxPerMinute, windowSeconds: WINDOW_SECONDS },
      outcome,
    ),
  );
}

/** Reset the route's rate-limit buckets. Test-only: keeps scoped buckets isolated. */
export function resetQueuePingsRateLimitsForTests(): void {
  readIpAttempts.clear();
  readAccountAttempts.clear();
  writeIpAttempts.clear();
  writeAccountAttempts.clear();
}

/**
 * The current tracked-timestamp count for the read-leg per-IP bucket. Test-only:
 * proves a sustained flood against one key never grows that key's array past
 * maxPerMinute + 1 (see recordAttempt), independent of the distinct-key cap.
 */
export function queuePingsReadIpBucketSizeForTests(ip: string): number {
  return readIpAttempts.get(ip)?.length ?? 0;
}

/**
 * GET /api/discord/queue-pings: `{ enabled }`, the account's current opt-in.
 * A missing row reads as the column default FALSE.
 */
async function queuePingsReadHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  enforceQueuePingsRateLimit(
    ctx,
    accountId,
    'discord_queue_pings_read',
    QUEUE_PINGS_READ_MAX_PER_MINUTE,
    readIpAttempts,
    readAccountAttempts,
  );
  json(ctx.res, 200, { enabled: await getDiscordQueuePings(accountId) });
}

/**
 * POST /api/discord/queue-pings { enabled: boolean }: set the opt-in
 * (accounts.discord_queue_pings) and forget the game loop's cached answer for
 * this account. The strict boolean check answers the domain's stable
 * invalid-input code.
 */
async function queuePingsHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  enforceQueuePingsRateLimit(
    ctx,
    accountId,
    'discord_queue_pings_write',
    QUEUE_PINGS_WRITE_MAX_PER_MINUTE,
    writeIpAttempts,
    writeAccountAttempts,
  );
  const enabled = (ctx.body as Record<string, unknown> | null | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    json(ctx.res, 400, { error: 'invalid input', code: QUEUE_PINGS_INVALID_INPUT_CODE });
    return;
  }
  await setDiscordQueuePings(accountId, enabled);
  bustQueuePingCache(accountId);
  json(ctx.res, 200, { enabled });
}

/** The mutation-tier bearer gate the toggle route mounts. */
const activeAccount = requireAccount({ scope: 'active' });
/** Read-tier bearer gate for the settings read. */
const readAccount = requireAccount({ scope: 'read' });

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/discord/queue-pings',
    surface: 'api',
    middleware: [readAccount],
    handler: queuePingsReadHandler,
  },
  {
    method: 'POST',
    path: '/api/discord/queue-pings',
    surface: 'api',
    middleware: [activeAccount, withBody()],
    handler: queuePingsHandler,
  },
];
