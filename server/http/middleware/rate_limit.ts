// Two-tier rate-limit middleware for the API request pipeline onion. Each policy
// resolves in two ordered tiers:
//   tier-1: the in-process sliding-window limiter (server/ratelimit.ts), the
//           SAME per-realm memory buckets the legacy arms used, checked FIRST.
//   tier-2: a pg-backed GLOBAL fixed-window counter (server/ratelimit_db.ts),
//           shared across every realm process, checked ONLY when tier-1 allows.
// On a rejection the adapter increments the rate_limit_hits_total attack-signal
// counter (labeled by policy name and key class only) and throws HttpError(429,
// 'rate_limit.exceeded', { retryAfterSeconds }, <draft-11 headers>); the withErrors
// error boundary serializes it. The effective tier-1 behavior of every policy is bit-identical to
// its single-tier predecessor (same limiter fn, same named limit, same window), so a single
// process sees no change: tier-1 records first and the fixed window counts a
// subset of the sliding window, so tier-2 can never reject when tier-1 allowed.
//
// DISCORD_POLICY stays UNMOUNTED (no route attaches it); it exists for the
// client code-matcher wiring. PUBLIC_READ_POLICY is MOUNTED since the v0.20.0
// third-slice merge: GET /api/maps/public (maps_routes.ts) and the GET
// /api/assets/:file byte read (user_assets_routes.ts) attach it, sharing the
// legacy tier-1 bucket and adding the tier-2 global backstop on the new path.

import {
  ASSET_UPLOAD_MAX_PER_MINUTE,
  assetUploadRateLimited,
  CARD_UPLOAD_MAX_PER_MINUTE,
  CHARACTER_MUTATION_MAX_PER_MINUTE,
  type CharacterMutationAction,
  cardUploadRateLimited,
  characterMutationRateLimited,
  DISCORD_MAX_PER_MINUTE,
  discordRateLimited,
  MAP_MUTATION_MAX_PER_MINUTE,
  mapMutationRateLimited,
  mergeFusedOutcomes,
  PUBLIC_READ_MAX_PER_MINUTE,
  publicReadRateLimited,
  REPORTS_CREATE_MAX_PER_MINUTE,
  rateLimitNow,
  rateLimitTier2Store,
  reportsCreateRateLimited,
  STEAM_LINK_MAX_PER_MINUTE,
  steamLinkRateLimited,
  WALLET_LINK_MAX_PER_MINUTE,
  WINDOW_MS,
  WOC_BALANCE_MAX_PER_MINUTE,
  walletLinkRateLimited,
  wocBalanceRateLimited,
} from '../../ratelimit';
import { attackSignalSink } from '../attack_signals';
import { ctxAccountId } from '../context';
import { HttpError, rateLimit429Headers } from '../errors';
import { logger } from '../logger';
import type { Ctx, Middleware, Next, RateLimitOutcome, RateLimitStore } from '../types';

/** How a policy derives its rate-limit key: per client IP, or per (IP AND account). */
export type RateLimitKeyClass = 'ip' | 'ip+account';

/**
 * Whether a policy is backed by the pg-global tier-2 store, or tier-1 only.
 * Every current policy is 'global' (the derivation guard test pins that), so no
 * code constructs 'none' today. It is the deliberate per-policy opt-out the
 * two-tier resolver spec calls for: tier-2 costs one pg UPSERT per ALLOWED
 * request (two for 'ip+account'), so a future mounted high-volume policy (e.g.
 * public_read at 60/min per IP) can stay tier-1-only with a one-word policy
 * edit instead of a resolver change.
 */
export type RateLimitTier2 = 'global' | 'none';

/**
 * A named rate-limit policy. `limit` and `windowSeconds` are the advertised quota
 * (they MUST equal the limiter's own named constant and shared window, never a
 * re-typed literal; the derivation guard test enforces this), and drive the
 * draft-11 RateLimit-Policy header. `tier1` runs the in-process limiter and
 * returns its RateLimitOutcome; `tier2` selects the pg-global backstop.
 */
export interface RateLimitPolicy {
  readonly name: string;
  readonly keyClass: RateLimitKeyClass;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly tier1: (ctx: Ctx) => RateLimitOutcome;
  readonly tier2: RateLimitTier2;
}

// Every policy's window is the shared sliding-window size, in seconds. Single
// source of truth so a policy never re-types 60.
const WINDOW_SECONDS = WINDOW_MS / 1000;

/** Build the 429 for a rejected attempt, carrying the accurate per-request numbers. */
function rateLimit429(policy: RateLimitPolicy, outcome: RateLimitOutcome): HttpError {
  return new HttpError(
    429,
    'rate_limit.exceeded',
    { retryAfterSeconds: outcome.resetSeconds },
    rateLimit429Headers(policy, outcome),
  );
}

/**
 * Record the tier-2 attempt(s) for `policy` and return the merged outcome. The
 * store key is `${policy.name}:ip:${ctx.ip}` for keyClass 'ip'; for 'ip+account'
 * BOTH that and `${policy.name}:acct:${accountId}` are recorded and merged via
 * the SAME mergeFusedOutcomes rule tier-1 uses (allowed = both, remaining = min,
 * resetSeconds = max). The store splits at the first ':' into its (policy, key)
 * columns, so an IPv6 address in the remainder is safe.
 */
async function tier2Outcome(
  store: RateLimitStore,
  policy: RateLimitPolicy,
  ctx: Ctx,
): Promise<RateLimitOutcome> {
  const ip = await store.hit(`${policy.name}:ip:${ctx.ip}`, policy.limit);
  if (policy.keyClass === 'ip') return ip;
  const account = await store.hit(`${policy.name}:acct:${ctxAccountId(ctx)}`, policy.limit);
  return mergeFusedOutcomes(ip, account);
}

// Log the tier-2 fail-open error at most once per window per process: during a
// pg outage EVERY tier-1-allowed request lands in the catch below, and one line
// per request would flood the ops log exactly when it is busiest. Reads the
// injected limiter clock (rateLimitNow) so tests stay deterministic.
let lastTier2ErrorLogMs = Number.NEGATIVE_INFINITY;

/** Reset the fail-open log throttle. Test-only: keeps log assertions isolated. */
export function resetTier2ErrorLogThrottle(): void {
  lastTier2ErrorLogMs = Number.NEGATIVE_INFINITY;
}

/**
 * Build the rate-limit middleware for `policy`. Runs tier-1 first; on a tier-1
 * rejection it throws the 429 WITHOUT touching tier-2 (a flood must never reach
 * pg, this ordering is an invariant). Otherwise, if the policy is tier-2 'global'
 * and a store is wired, it records the global counter and throws the 429 with the
 * tier-2 numbers on a global rejection. Tier-2 FAILS OPEN: any store error is
 * logged and treated as allowed, so a pg outage degrades to tier-1-only limiting
 * and never 500s the route or blocks traffic.
 */
export function rateLimit(policy: RateLimitPolicy): Middleware {
  return async (ctx: Ctx, next: Next) => {
    const t1 = policy.tier1(ctx);
    if (!t1.allowed) {
      // rate_limit_hits_total attack-signal series (source-spec 4.9): count every
      // 429 from BOTH tiers, labeled ONLY by the bounded policy name and key class,
      // never by ip or account. Emitted just before the throw so a flood rejected
      // here (tier-1) is recorded without ever touching tier-2.
      attackSignalSink().rateLimitHit(policy.name, policy.keyClass);
      throw rateLimit429(policy, t1);
    }

    if (policy.tier2 === 'global') {
      const store = rateLimitTier2Store();
      if (store) {
        let merged: RateLimitOutcome | null = null;
        try {
          merged = await tier2Outcome(store, policy, ctx);
        } catch (err) {
          // Fail open: a tier-2 (pg) outage degrades to tier-1-only limiting.
          const nowMs = rateLimitNow();
          if (nowMs - lastTier2ErrorLogMs >= WINDOW_MS) {
            lastTier2ErrorLogMs = nowMs;
            logger.error({ err }, 'ratelimit tier-2 store error, failing open');
          }
        }
        // Throw OUTSIDE the try so a deliberate tier-2 429 is never swallowed by
        // the fail-open catch.
        if (merged && !merged.allowed) {
          attackSignalSink().rateLimitHit(policy.name, policy.keyClass);
          throw rateLimit429(policy, merged);
        }
      }
    }

    await next();
  };
}

// An 'ip+account' policy reads the caller's account id via the shared ctxAccountId
// (server/http/context.ts) inside tier1, which 500s when ctx.account is unset (the
// policy was mounted ahead of the auth guard that populates it, a composition bug).

export const PUBLIC_READ_POLICY: RateLimitPolicy = {
  name: 'public_read',
  keyClass: 'ip',
  limit: PUBLIC_READ_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => publicReadRateLimited(ctx.req),
  tier2: 'global',
};

export const WOC_BALANCE_POLICY: RateLimitPolicy = {
  name: 'woc_balance',
  keyClass: 'ip',
  limit: WOC_BALANCE_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => wocBalanceRateLimited(ctx.req),
  tier2: 'global',
};

export const CARD_UPLOAD_POLICY: RateLimitPolicy = {
  name: 'card_upload',
  keyClass: 'ip+account',
  limit: CARD_UPLOAD_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => cardUploadRateLimited(ctx.req, ctxAccountId(ctx)),
  tier2: 'global',
};

// Steam link attempts (POST /api/steam/link). 'ip+account' (mounts BEHIND the
// route's auth guard) and deliberately tight: every allowed attempt is an
// upstream AuthenticateUserTicket call against the Steam Web API.
export const STEAM_LINK_POLICY: RateLimitPolicy = {
  name: 'steam_link',
  keyClass: 'ip+account',
  limit: STEAM_LINK_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => steamLinkRateLimited(ctx.req, ctxAccountId(ctx)),
  tier2: 'global',
};

export const WALLET_LINK_POLICY: RateLimitPolicy = {
  name: 'wallet_link',
  keyClass: 'ip+account',
  limit: WALLET_LINK_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => walletLinkRateLimited(ctx.req, ctxAccountId(ctx)),
  tier2: 'global',
};

// The character-mutation policies. Each is 'ip+account' (so it must be
// mounted BEHIND the route's auth guard, which populates ctx.account) and runs the
// per-action limiter keyed on its OWN bucket, so create/rename/delete/takeover never
// share a window. These are NEW limiters (character mutations had none before): a 429
// is now possible where none was, recorded as the newLimiterCharacterMutations known
// deviation. They reuse the existing 'rate_limit.exceeded' code (no catalog append).
// The four differ ONLY by name + action (same limiter fn, key class, limit, window,
// tier2), so one factory builds them; the other policies each call a distinct limiter
// fn and stay longhand.
function characterMutationPolicy(name: string, action: CharacterMutationAction): RateLimitPolicy {
  return {
    name,
    keyClass: 'ip+account',
    limit: CHARACTER_MUTATION_MAX_PER_MINUTE,
    windowSeconds: WINDOW_SECONDS,
    tier1: (ctx) => characterMutationRateLimited(ctx.req, ctxAccountId(ctx), action),
    tier2: 'global',
  };
}

export const CHARACTER_CREATE_POLICY: RateLimitPolicy = characterMutationPolicy(
  'character_create',
  'create',
);
export const CHARACTER_RENAME_POLICY: RateLimitPolicy = characterMutationPolicy(
  'character_rename',
  'rename',
);
export const CHARACTER_DELETE_POLICY: RateLimitPolicy = characterMutationPolicy(
  'character_delete',
  'delete',
);
export const CHARACTER_TAKEOVER_POLICY: RateLimitPolicy = characterMutationPolicy(
  'character_takeover',
  'takeover',
);

// The report-creation limiter. 'ip+account' (so it mounts BEHIND the
// route's auth guard, which populates ctx.account), running the fused per-IP AND
// per-account limiter keyed on the caller. It is a NEW limiter (report creation had
// none before): a 429 is now possible where none was, recorded as the
// newLimiterReportsCreate known deviation. It reuses the existing
// 'rate_limit.exceeded' code (no catalog append).
// The map editor mutation limiter (v0.20.0 merge migration). 'ip+account' (mounts
// BEHIND the route's auth guard) running the SAME fused mapMutationRateLimited
// bucket the legacy /api/maps arms check, so both dispatch paths share one window.
// The legacy arm answers a prose 429 { error: 'rate_limited' }; this policy's 429
// is the coded rate_limit.exceeded problem (the wallet-family coded-vs-prose 429
// deviation class, recorded in known_deviations.ts).
export const MAP_MUTATION_POLICY: RateLimitPolicy = {
  name: 'map_mutation',
  keyClass: 'ip+account',
  limit: MAP_MUTATION_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => mapMutationRateLimited(ctx.req, ctxAccountId(ctx)),
  tier2: 'global',
};

// The GLB asset upload limiter (v0.20.0 merge migration). Same posture as
// MAP_MUTATION_POLICY: fused bucket shared with the legacy POST /api/assets arm,
// coded 429 on the new path recorded as the same deviation class.
export const ASSET_UPLOAD_POLICY: RateLimitPolicy = {
  name: 'asset_upload',
  keyClass: 'ip+account',
  limit: ASSET_UPLOAD_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => assetUploadRateLimited(ctx.req, ctxAccountId(ctx)),
  tier2: 'global',
};

export const REPORTS_CREATE_POLICY: RateLimitPolicy = {
  name: 'reports_create',
  keyClass: 'ip+account',
  limit: REPORTS_CREATE_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => reportsCreateRateLimited(ctx.req, ctxAccountId(ctx)),
  tier2: 'global',
};

// AUTHENTICATED Discord legs only (link / status / reward). It requires
// ctx.account (ctxAccountId 500s without it), so it must mount BEHIND requireAccount.
// UNMOUNTED today (the Discord family migrated parity-first with legacy prose
// bodies; wiring the coded adapter waits on the client code-matcher). The
// UNAUTHENTICATED start/callback legs run the same underlying limiter IP-only via
// discordRateLimited(req, 0).
export const DISCORD_POLICY: RateLimitPolicy = {
  name: 'discord',
  keyClass: 'ip+account',
  limit: DISCORD_MAX_PER_MINUTE,
  windowSeconds: WINDOW_SECONDS,
  tier1: (ctx) => discordRateLimited(ctx.req, ctxAccountId(ctx)),
  tier2: 'global',
};
