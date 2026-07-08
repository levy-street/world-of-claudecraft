import type * as http from 'node:http';
import * as net from 'node:net';
import { attackSignalSink } from './http/attack_signals';
import type { RateLimitOutcome, RateLimitStore } from './http/types';

// Simple in-memory rate limiter (per client IP, sliding minute window). Every
// limiter reports the frozen RateLimitOutcome (server/http/types): { allowed,
// remaining, resetSeconds }. allowed is the inverse of the old boolean return
// (true here means the attempt is under the limit and served), remaining is the
// attempts left in the window after this one, and resetSeconds is the whole
// seconds until the window clears (for a Retry-After header).
//
// Client IP resolution must work behind the production stack: nginx on the
// host proxies to the game CONTAINER, so connections arrive from the docker
// bridge gateway (e.g. 172.18.0.1), not loopback. The compose file publishes
// the port on 127.0.0.1 only, so any connection from a loopback/private
// address IS our reverse proxy (or LAN dev): trust its X-Forwarded-For.
// Direct internet clients have public addresses and are never trusted, so
// they can't spoof the header. Set TRUSTED_PROXY_IPS (comma-separated) to
// pin an explicit proxy list instead of the private-range default.
export const WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 10_000;
const BACKSTOP_EVICT_BATCH = 512;

// Injectable wall clock. Defaults to Date.now so every existing caller and test
// is unaffected; tests can pin a deterministic clock via setRateLimitClock and
// must restore the default with resetRateLimitClock. The two-tier pipeline
// middleware reads the same seam via rateLimitNow(), so the sliding-window math
// stays testable across a window boundary without real timers.
let clockNow: () => number = Date.now;

/** Pin the rate-limiter clock to a deterministic source (test-only). */
export function setRateLimitClock(now: () => number): void {
  // Hard guard: a pinned clock must never be installable in production, where a
  // frozen or backward clock could hold a limiter window open indefinitely and
  // defeat rate limiting. The default Date.now path is unaffected; tests run
  // outside NODE_ENV=production.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('setRateLimitClock is test-only and must not be called in production');
  }
  clockNow = now;
}

/** Restore the default Date.now clock (test-only). */
export function resetRateLimitClock(): void {
  clockNow = Date.now;
}

/**
 * The rate-limiter's current wall-clock reading. Exposed so other in-process
 * limiters that want the same testable clock seam (e.g. perf_report.ts) can read
 * time through setRateLimitClock instead of Date.now directly.
 */
export function rateLimitNow(): number {
  return clockNow();
}

// Tier-2 (pg-backed GLOBAL) rate-limit store injection slot. The two-tier
// resolver (server/http/middleware/rate_limit.ts) reads this getter once per
// request AFTER its in-memory tier-1 check passes; server/main.ts wires the pg
// store at boot via setRateLimitTier2Store. The slot lives HERE, not in the
// middleware module, so ratelimit.ts + main.ts stay self-contained for commit
// staging without pulling in the middleware file, and the type is imported
// type-only (RateLimitStore) so no runtime cycle forms. Default null: tier-2 is
// a no-op until wired, and the resolver treats a null store as tier-1-only.
let tier2Store: RateLimitStore | null = null;

/** Wire (or clear) the pg-backed tier-2 rate-limit store. main.ts calls this at boot. */
export function setRateLimitTier2Store(store: RateLimitStore | null): void {
  tier2Store = store;
}

/** The configured tier-2 store, or null when tier-2 is not wired (tier-1 only). */
export function rateLimitTier2Store(): RateLimitStore | null {
  return tier2Store;
}

// Pure outcome math shared by EVERY window limiter: `count` attempts recorded
// against `limit` in a window that clears at `windowRefMs + windowMs`
// (`windowRefMs` is the oldest in-window attempt for a sliding window, the
// window start for the pg fixed window). One helper so its three consumers
// (slidingWindowOutcome below, rateLimitedPerfReport in perf_report.ts, and the
// pg tier-2 store in ratelimit_db.ts) can never drift apart. authThrottled
// deliberately does NOT use it: its ceiling check is `count < limit` (checking
// is read-only, the failure is recorded separately) and its resetSeconds is 0
// when no failure is in the window.
export function windowedRateLimitOutcome(
  count: number,
  limit: number,
  windowRefMs: number,
  windowMs: number,
  now: number,
): RateLimitOutcome {
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetSeconds: Math.max(0, Math.ceil((windowRefMs + windowMs - now) / 1000)),
  };
}

// Build the outcome for a record-then-judge sliding-window limiter from the
// updated timestamp list (already pruned to the window and with `now` pushed).
// The list always holds at least `now`, so updated[0] is the oldest in-window
// timestamp and the window clears once it ages out.
function slidingWindowOutcome(
  updated: number[],
  maxPerMinute: number,
  now: number,
): RateLimitOutcome {
  return windowedRateLimitOutcome(updated.length, maxPerMinute, updated[0], WINDOW_MS, now);
}

// Merge two fused-bucket (IP AND account) outcomes into one, mirroring the old
// `ipLimited || accountLimited` boolean OR: a fused request is allowed only if
// BOTH buckets allow, remaining is the tighter (min) of the two, and resetSeconds
// the longer (max) wait so a retry clears whichever bucket is more backed up.
// Exported because the two-tier resolver's tier-2 merge (server/http/middleware/
// rate_limit.ts) applies the SAME rule to its pg bucket outcomes.
export function mergeFusedOutcomes(
  ip: RateLimitOutcome,
  account: RateLimitOutcome,
): RateLimitOutcome {
  return {
    allowed: ip.allowed && account.allowed,
    remaining: Math.min(ip.remaining, account.remaining),
    resetSeconds: Math.max(ip.resetSeconds, account.resetSeconds),
  };
}

// The strictest (lowest) limit any caller passes to rateLimited(). The `attempts`
// map is SHARED across routes: game login/register use the default 20, admin
// login uses 10 (ADMIN_LOGIN_MAX_PER_MINUTE in server/admin.ts). The memory
// backstop must judge "is this IP currently limited" by the strictest policy, or
// a flood on a lenient route (limit 20) could evict an IP that is already limited
// under a stricter route (e.g. 11 admin-login attempts) and reset it mid-window.
// MUST stay <= the lowest maxPerMinute of any rateLimited() caller.
const STRICTEST_RATE_LIMIT = 10;

const attempts = new Map<string, number[]>();

function backstopTargetSize(): number {
  return Math.max(0, MAX_TRACKED_IPS - BACKSTOP_EVICT_BATCH);
}

// Canonicalize so the connect side (requestIp) and the stored side (cleanIp)
// agree by construction: lowercase, drop the IPv4-mapped prefix, and compress
// IPv6 via the WHATWG serializer (gated on net.isIP so only a valid literal
// reaches new URL). Anything net.isIP rejects passes through unchanged.
export function normalizeIp(ip: string): string {
  let s = ip.toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice('::ffff:'.length);
  if (net.isIP(s) === 6) {
    try {
      return new URL(`http://[${s}]`).hostname.slice(1, -1);
    } catch {
      return s;
    }
  }
  return s;
}

// loopback, RFC1918, link-local, IPv6 ULA: the only sources our reverse
// proxy (or a dev setup) can connect from given the loopback-only publish
function isPrivateOrLoopback(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const oct172 = /^172\.(\d{1,3})\./.exec(ip);
  if (oct172) {
    const o = Number(oct172[1]);
    return o >= 16 && o <= 31;
  }
  const lower = ip.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
}

function isTrustedProxy(ip: string): boolean {
  const configured = process.env.TRUSTED_PROXY_IPS;
  if (configured) {
    return configured
      .split(',')
      .map((s) => normalizeIp(s.trim()))
      .filter(Boolean)
      .includes(ip);
  }
  return isPrivateOrLoopback(ip);
}

export function requestIp(req: http.IncomingMessage): string {
  const remote = normalizeIp(String(req.socket?.remoteAddress ?? 'unknown').trim());
  if (!isTrustedProxy(remote)) return remote;

  // Walk X-Forwarded-For from the right (the end our own proxies append to),
  // past any trusted hops; the first address we don't control is the real
  // client. Everything left of it is client-supplied and spoofable.
  const chain = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => normalizeIp(s.trim()))
    .filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(chain[i])) return chain[i];
  }
  return chain[0] ?? remote;
}

// The default per-IP budget (attempts per minute) for the game auth endpoints:
// login, register, and the desktop-login handoff all inherit it. Admin login
// passes a stricter 10 (ADMIN_LOGIN_MAX_PER_MINUTE in server/admin.ts); this is
// the lenient default every other rateLimited() caller uses. Kept >= the
// STRICTEST_RATE_LIMIT above by construction (20 >= 10).
export const AUTH_MAX_PER_MINUTE = 20;

export function rateLimited(
  req: http.IncomingMessage,
  maxPerMinute = AUTH_MAX_PER_MINUTE,
): RateLimitOutcome {
  const ip = requestIp(req);
  const now = clockNow();
  const windowStart = now - WINDOW_MS;
  const list = (attempts.get(ip) ?? []).filter((t) => t > windowStart);
  const updated = [...list, now];
  attempts.set(ip, updated);

  // Memory backstop. A blanket clear() would also wipe the counter we just
  // recorded, so every IP would perpetually see a single attempt and rate
  // limiting would silently stop working under load, which is exactly when a
  // flood of distinct IPs inflates this map past the cap. So bound the map
  // without clearing it. Mirrors recordAuthFailure() below.
  if (attempts.size > MAX_TRACKED_IPS) {
    // Never evict an IP that is currently limited, nor the one just recorded. A
    // burst-then-idle IP ages while a flood of newer one-off IPs arrives, so a
    // naive least-recently-active eviction would pick it as "oldest" and reset
    // its live limit before the window expires, the eviction-path version of
    // the bypass. Judge "currently limited" by the STRICTEST policy sharing this
    // map (not this call's maxPerMinute): a flood on a lenient route must not
    // evict an IP that a stricter route has already limited. count >= L+1 means
    // a call at limit L is over its limit (its outcome.allowed is false). Shares
    // atOrOverLimit() with authThrottled() so the predicate can't drift.
    const isLimited = (times: number[]) =>
      atOrOverLimit(times, windowStart, STRICTEST_RATE_LIMIT + 1);

    // Stage 1: evict IPs whose window has fully expired (cheap, harmless).
    for (const [key, times] of attempts) {
      if (key === ip) continue;
      if (times.length === 0 || times[times.length - 1] <= windowStart) {
        attempts.delete(key);
      }
      if (attempts.size <= MAX_TRACKED_IPS) break;
    }

    // Stage 2: a pure flood is all in-window, so stage 1 evicts nothing and
    // the map would grow unbounded (and every call would re-scan it, O(n^2)).
    // Fall back to evicting the least-recently-active IP, skipping the current
    // one and any currently-limited IP. If everything left is current or
    // limited, accept a soft over-cap rather than reset a live limit.
    const targetSize = backstopTargetSize();
    while (attempts.size > targetSize) {
      let oldestKey: string | undefined;
      let oldestSeen = Infinity;
      for (const [key, times] of attempts) {
        if (key === ip) continue;
        if (isLimited(times)) continue;
        const last = times.length === 0 ? 0 : times[times.length - 1];
        if (last < oldestSeen) {
          oldestSeen = last;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) break;
      attempts.delete(oldestKey);
    }
  }
  return slidingWindowOutcome(updated, maxPerMinute, now);
}

/** Number of IPs currently tracked. Exposed for the backstop-bound test. */
export function trackedIpCount(): number {
  return attempts.size;
}

/** Reset all tracked IPs. Test-only: keeps the shared map isolated per test. */
export function resetRateLimits(): void {
  attempts.clear();
}

export const CARD_UPLOAD_MAX_PER_MINUTE = 10;
export const WALLET_LINK_MAX_PER_MINUTE = 10;

const cardUploadIpAttempts = new Map<string, number[]>();
const cardUploadAccountAttempts = new Map<number, number[]>();
const walletLinkIpAttempts = new Map<string, number[]>();
const walletLinkAccountAttempts = new Map<number, number[]>();

function recordSlidingWindowAttempt<K>(
  attemptsByKey: Map<K, number[]>,
  key: K,
  maxPerMinute: number,
): RateLimitOutcome {
  const now = clockNow();
  const windowStart = now - WINDOW_MS;
  const list = (attemptsByKey.get(key) ?? []).filter((t) => t > windowStart);
  const updated = [...list, now];
  attemptsByKey.set(key, updated);

  if (attemptsByKey.size > MAX_TRACKED_IPS) {
    for (const [k, times] of attemptsByKey) {
      if (k === key) continue;
      if (times.length === 0 || times[times.length - 1] <= windowStart) {
        attemptsByKey.delete(k);
      }
      if (attemptsByKey.size <= MAX_TRACKED_IPS) break;
    }

    const targetSize = backstopTargetSize();
    while (attemptsByKey.size > targetSize) {
      let oldest: { key: K; seen: number } | null = null;
      for (const [k, times] of attemptsByKey) {
        if (k === key) continue;
        if (atOrOverLimit(times, windowStart, maxPerMinute + 1)) continue;
        const last = times.length === 0 ? 0 : times[times.length - 1];
        if (!oldest || last < oldest.seen) oldest = { key: k, seen: last };
      }
      if (!oldest) break;
      attemptsByKey.delete(oldest.key);
    }
  }

  return slidingWindowOutcome(updated, maxPerMinute, now);
}

export function cardUploadRateLimited(
  req: http.IncomingMessage,
  accountId: number,
): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(
    cardUploadIpAttempts,
    requestIp(req),
    CARD_UPLOAD_MAX_PER_MINUTE,
  );
  const account = recordSlidingWindowAttempt(
    cardUploadAccountAttempts,
    accountId,
    CARD_UPLOAD_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset player-card upload throttles. Test-only: keeps scoped buckets isolated. */
export function resetCardUploadRateLimits(): void {
  cardUploadIpAttempts.clear();
  cardUploadAccountAttempts.clear();
}

// GLB asset uploads (POST /api/assets) get their own per-IP AND per-account
// bucket, mirroring the player-card upload throttle above: an upload flood can
// never burn a player's login budget (these maps are separate from the shared
// `attempts` map, so STRICTEST_RATE_LIMIT is unaffected), and a single account
// spraying uploads through many IPs is still capped by the account key.
export const ASSET_UPLOAD_MAX_PER_MINUTE = 10;
// Map saves are bigger writes (up to 2 MiB JSONB) but honest editors autosave;
// 30/min leaves headroom for rapid save-as/fork flows while bounding floods.
export const MAP_MUTATION_MAX_PER_MINUTE = 30;
const mapMutationIpAttempts = new Map<string, number[]>();
const mapMutationAccountAttempts = new Map<number, number[]>();

/** Per-IP AND per-account throttle shared by every /api/maps mutation
 * (create/save/fork/publish/unpublish/delete). */
export function mapMutationRateLimited(
  req: http.IncomingMessage,
  accountId: number,
): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(
    mapMutationIpAttempts,
    requestIp(req),
    MAP_MUTATION_MAX_PER_MINUTE,
  );
  const account = recordSlidingWindowAttempt(
    mapMutationAccountAttempts,
    accountId,
    MAP_MUTATION_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset map-mutation throttles. Test-only. */
export function resetMapMutationRateLimits(): void {
  mapMutationIpAttempts.clear();
  mapMutationAccountAttempts.clear();
}

const assetUploadIpAttempts = new Map<string, number[]>();
const assetUploadAccountAttempts = new Map<number, number[]>();

export function assetUploadRateLimited(
  req: http.IncomingMessage,
  accountId: number,
): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(
    assetUploadIpAttempts,
    requestIp(req),
    ASSET_UPLOAD_MAX_PER_MINUTE,
  );
  const account = recordSlidingWindowAttempt(
    assetUploadAccountAttempts,
    accountId,
    ASSET_UPLOAD_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset asset upload throttles. Test-only: keeps scoped buckets isolated. */
export function resetAssetUploadRateLimits(): void {
  assetUploadIpAttempts.clear();
  assetUploadAccountAttempts.clear();
}

export function walletLinkRateLimited(
  req: http.IncomingMessage,
  accountId: number,
): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(
    walletLinkIpAttempts,
    requestIp(req),
    WALLET_LINK_MAX_PER_MINUTE,
  );
  const account = recordSlidingWindowAttempt(
    walletLinkAccountAttempts,
    accountId,
    WALLET_LINK_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset wallet-link verification throttles. Test-only: keeps scoped buckets isolated. */
export function resetWalletLinkRateLimits(): void {
  walletLinkIpAttempts.clear();
  walletLinkAccountAttempts.clear();
}

// Discord link/status/reward endpoints share one dedicated bucket (per IP AND
// per account), separate from login/register so an OAuth-link or reward-claim
// flood can't lock a user out of logging in. accountId 0 keys the unauthenticated
// start/callback legs on IP only (the account isn't resolved yet).
export const DISCORD_MAX_PER_MINUTE = 15;
const discordIpAttempts = new Map<string, number[]>();
const discordAccountAttempts = new Map<number, number[]>();

export function discordRateLimited(req: http.IncomingMessage, accountId: number): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(discordIpAttempts, requestIp(req), DISCORD_MAX_PER_MINUTE);
  // accountId 0 (unauthenticated start/callback) records IP only, so the IP
  // outcome IS the result; a positive account fuses its own bucket in.
  if (accountId <= 0) return ip;
  const account = recordSlidingWindowAttempt(
    discordAccountAttempts,
    accountId,
    DISCORD_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset Discord throttles. Test-only: keeps scoped buckets isolated. */
export function resetDiscordRateLimits(): void {
  discordIpAttempts.clear();
  discordAccountAttempts.clear();
}

// GitHub link/status endpoints share one dedicated bucket (per IP AND per
// account), separate from login so an OAuth-link flood can't lock a user out of
// logging in. accountId 0 keys the unauthenticated callback leg on IP only.
export const GITHUB_MAX_PER_MINUTE = 15;
const githubIpAttempts = new Map<string, number[]>();
const githubAccountAttempts = new Map<number, number[]>();

export function githubRateLimited(req: http.IncomingMessage, accountId: number): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(githubIpAttempts, requestIp(req), GITHUB_MAX_PER_MINUTE);
  // accountId 0 (unauthenticated callback) records IP only, so the IP outcome IS
  // the result; a positive account fuses its own bucket in.
  if (accountId <= 0) return ip;
  const account = recordSlidingWindowAttempt(
    githubAccountAttempts,
    accountId,
    GITHUB_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset GitHub throttles. Test-only: keeps scoped buckets isolated. */
export function resetGithubRateLimits(): void {
  githubIpAttempts.clear();
  githubAccountAttempts.clear();
}

export const WOC_BALANCE_MAX_PER_MINUTE = 20;
const wocBalanceIpAttempts = new Map<string, number[]>();

/**
 * Throttle the public /api/woc/balance proxy per IP on its OWN bucket. The proxy
 * is unauthenticated (on-chain balances are public), so it keys on IP only, but
 * NOT the shared register/login `attempts` map, so a player opening their card/bag
 * (each a fresh RPC read) can't burn their login budget, and a balance flood can't
 * lock them out of logging in (or vice-versa).
 */
export function wocBalanceRateLimited(req: http.IncomingMessage): RateLimitOutcome {
  return recordSlidingWindowAttempt(
    wocBalanceIpAttempts,
    requestIp(req),
    WOC_BALANCE_MAX_PER_MINUTE,
  );
}

/** Reset the balance-proxy throttle. Test-only: keeps scoped buckets isolated. */
export function resetWocBalanceRateLimits(): void {
  wocBalanceIpAttempts.clear();
}

// Public, unauthenticated read endpoints (the public character sheet, the /c/
// profile page) get a generous per-IP bucket on their OWN map, decoupled from
// login/register, to deter scraping without ever spilling into the auth
// limiter. Higher ceiling than auth since legitimate companion apps and crawlers
// poll these far more often than anyone logs in.
export const PUBLIC_READ_MAX_PER_MINUTE = 60;
const publicReadIpAttempts = new Map<string, number[]>();

export function publicReadRateLimited(req: http.IncomingMessage): RateLimitOutcome {
  return recordSlidingWindowAttempt(
    publicReadIpAttempts,
    requestIp(req),
    PUBLIC_READ_MAX_PER_MINUTE,
  );
}

/** Reset the public-read throttle. Test-only: keeps scoped buckets isolated. */
export function resetPublicReadRateLimits(): void {
  publicReadIpAttempts.clear();
}

// Per-account character-mutation throttle (create / rename / delete / takeover).
// These deliberate, rare actions had NO dedicated limiter before the API-pipeline
// migration (they were gated only by the full session). A new per-action, per-(IP
// AND account) bucket bounds a burst without spilling into the login/register budget
// (its own maps, decoupled from `attempts`). Keyed BY ACTION so one action's flood
// cannot exhaust another's allowance, and generous (a real player never creates or
// renames twenty characters a minute); the two-tier pipeline policies
// (server/http/middleware/rate_limit.ts CHARACTER_*_POLICY) run this limiter as tier-1.
export const CHARACTER_MUTATION_MAX_PER_MINUTE = 20;

/** The character mutations that each carry a dedicated per-account limiter bucket. */
export type CharacterMutationAction = 'create' | 'rename' | 'delete' | 'takeover';

const characterMutationIpAttempts = new Map<string, number[]>();
const characterMutationAccountAttempts = new Map<string, number[]>();

/**
 * Throttle a character mutation per action on its OWN (IP AND account) buckets. The
 * key is prefixed with the action so create/rename/delete/takeover never share a
 * window. Mirrors cardUploadRateLimited: an IP flood OR an account flood limits.
 */
export function characterMutationRateLimited(
  req: http.IncomingMessage,
  accountId: number,
  action: CharacterMutationAction,
): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(
    characterMutationIpAttempts,
    `${action}:${requestIp(req)}`,
    CHARACTER_MUTATION_MAX_PER_MINUTE,
  );
  const account = recordSlidingWindowAttempt(
    characterMutationAccountAttempts,
    `${action}:${accountId}`,
    CHARACTER_MUTATION_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset character-mutation throttles. Test-only: keeps scoped buckets isolated. */
export function resetCharacterMutationRateLimits(): void {
  characterMutationIpAttempts.clear();
  characterMutationAccountAttempts.clear();
}

// Player-report creation had no dedicated limiter (it was gated only by the full
// session plus the per-target 12h duplicate-report window in moderation_db). This
// adds a coarse per-account create limiter so a single account cannot flood the
// moderation queue with reports against many different targets. Conservative cap;
// the window is the shared 60s WINDOW_MS (single-sourced above), and the pipeline
// limiter policy table (server/http/middleware/rate_limit.ts) derives from these
// same consts, so the two dispatch arms cannot drift. Mirrors cardUpload: an IP
// flood OR an account flood limits.
export const REPORTS_CREATE_MAX_PER_MINUTE = 10;
const reportsCreateIpAttempts = new Map<string, number[]>();
const reportsCreateAccountAttempts = new Map<number, number[]>();

export function reportsCreateRateLimited(
  req: http.IncomingMessage,
  accountId: number,
): RateLimitOutcome {
  const ip = recordSlidingWindowAttempt(
    reportsCreateIpAttempts,
    requestIp(req),
    REPORTS_CREATE_MAX_PER_MINUTE,
  );
  const account = recordSlidingWindowAttempt(
    reportsCreateAccountAttempts,
    accountId,
    REPORTS_CREATE_MAX_PER_MINUTE,
  );
  return mergeFusedOutcomes(ip, account);
}

/** Reset report-creation throttles. Test-only: keeps scoped buckets isolated. */
export function resetReportsCreateRateLimits(): void {
  reportsCreateIpAttempts.clear();
  reportsCreateAccountAttempts.clear();
}

// ---------------------------------------------------------------------------
// Per-account failed-login throttle (#93)
//
// The per-IP limiter above can't stop credential stuffing: a botnet spreads
// guesses for one account across thousands of IPs, each well under the IP cap.
// This tracks FAILED login attempts keyed by username, so brute-forcing a
// single account is throttled regardless of source IP. Successful logins clear
// the counter, so a legitimate user who finally types the right password isn't
// punished for earlier typos.
const AUTH_FAIL_WINDOW_MS = 15 * 60_000; // 15 minutes
const MAX_AUTH_FAILURES = 10; // per account per window
const authFailures = new Map<string, number[]>();

// Normalize so 'Alice', 'alice', and ' alice ' share one bucket and can't be
// used to multiply the allowance against the same account.
function authKey(username: string): string {
  return username.trim().toLowerCase();
}

// Single source of truth for "are there at least `limit` timestamps still inside
// the window". Both limiters' active-check AND their memory-backstop eviction
// skip-check route through this, so the "is this key currently limited" question
// can never drift between the two: a future edit to one can't silently re-open
// the flood-reset bypass this module exists to prevent. (See isThrottled and the
// rateLimited skip-check, which pass MAX_AUTH_FAILURES and maxPerMinute+1.)
function atOrOverLimit(times: number[], windowStart: number, limit: number): boolean {
  return times.filter((t) => t > windowStart).length >= limit;
}

// An account is throttled once its in-window failures reach MAX_AUTH_FAILURES.
function isThrottled(times: number[], windowStart: number): boolean {
  return atOrOverLimit(times, windowStart, MAX_AUTH_FAILURES);
}

/**
 * The failed-login outcome for an account. READ-ONLY on LIMITER state: it prunes
 * stale failures but records NONE (only recordAuthFailure does). It DOES emit the
 * auth_failures_total{kind="throttled"} observability signal when the outcome is a
 * lockout rejection (allowed false), so /metrics can count throttled attempts.
 * That count is exact only under an assumption every current caller honors: the
 * three callers (server/auth_routes.ts, server/discord.ts, server/main.ts) all
 * gate on the result and reject the request when allowed is false, so one
 * lockout-outcome check equals one rejected attempt. A future caller that only
 * inspects the status without rejecting must split this predicate instead of
 * reusing it, or the metric would over-count. allowed is false once the account
 * has hit the failed-attempt ceiling within the window; remaining counts the
 * attempts left before the lockout, and resetSeconds is the wait until the oldest
 * failure ages out (0 when there are no failures in the window).
 */
export function authThrottled(username: string): RateLimitOutcome {
  const key = authKey(username);
  const now = clockNow();
  const windowStart = now - AUTH_FAIL_WINDOW_MS;
  const recent = (authFailures.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length > 0) authFailures.set(key, recent);
  else authFailures.delete(key);
  const count = recent.length;
  const outcome: RateLimitOutcome = {
    allowed: count < MAX_AUTH_FAILURES,
    remaining: Math.max(0, MAX_AUTH_FAILURES - count),
    resetSeconds:
      count > 0 ? Math.max(0, Math.ceil((recent[0] + AUTH_FAIL_WINDOW_MS - now) / 1000)) : 0,
  };
  // A lockout rejection is one throttled auth-failure attack signal. Emitting only
  // on allowed === false relies on the caller-rejects assumption in the doc above.
  if (!outcome.allowed) attackSignalSink().authFailure('throttled');
  return outcome;
}

/** Record a failed login for an account (call on bad password / unknown user). */
export function recordAuthFailure(username: string): void {
  // Every caller is recording a failed credential check (bad password, unknown
  // user, wrong current password): the brute-force bad-credentials signal series.
  attackSignalSink().authFailure('bad_credentials');
  const key = authKey(username);
  const windowStart = clockNow() - AUTH_FAIL_WINDOW_MS;
  const recent = (authFailures.get(key) ?? []).filter((t) => t > windowStart);
  recent.push(clockNow());
  authFailures.set(key, recent);
  if (authFailures.size <= MAX_TRACKED_IPS) return;

  // Memory backstop. A blanket clear() would also wipe the live lockout
  // counters we are accumulating against accounts under attack, which is
  // exactly when a credential-stuffing flood inflates this map past the cap,
  // silently disabling the per-account throttle. Mirrors rateLimited() above.
  //
  // Stage 1: evict accounts whose window has fully expired (cheap, harmless).
  for (const [k, times] of authFailures) {
    if (k === key) continue;
    if (times.length === 0 || times[times.length - 1] <= windowStart) {
      authFailures.delete(k);
    }
    if (authFailures.size <= MAX_TRACKED_IPS) break;
  }

  // Stage 2: a pure flood is all in-window, so stage 1 evicts nothing and the
  // map would grow unbounded (and every subsequent call would re-scan it,
  // O(n^2)). Fall back to evicting the least-recently-active account until
  // back under the cap.
  //
  // Critically, NEVER evict a currently-throttled account (isThrottled) or the
  // account just recorded. On the live login path (server/main.ts) a throttled
  // account is rejected BEFORE recordAuthFailure runs, so its timestamps go
  // stale and it would otherwise look "oldest", letting an attacker reset a
  // victim's throttle simply by flooding the map with newer one-off failures.
  // Only non-throttled idle entries (the flood's count-of-1 buckets) are
  // sacrificed, the cost of a memory bound.
  const targetSize = backstopTargetSize();
  while (authFailures.size > targetSize) {
    let oldestKey: string | undefined;
    let oldestSeen = Infinity;
    for (const [k, times] of authFailures) {
      if (k === key) continue;
      if (isThrottled(times, windowStart)) continue;
      const last = times.length === 0 ? 0 : times[times.length - 1];
      if (last < oldestSeen) {
        oldestSeen = last;
        oldestKey = k;
      }
    }
    // Nothing evictable means every remaining account is either the current one
    // or currently throttled. Accept a SOFT cap and stop rather than reset any
    // throttle. This only happens once an attacker has genuinely locked out
    // >MAX_TRACKED_IPS distinct accounts (100k+ failed logins); we fail toward
    // protection (the map grows) instead of toward bypass.
    if (oldestKey === undefined) break;
    authFailures.delete(oldestKey);
  }
}

/** Clear an account's failure history after a successful login. */
export function clearAuthFailures(username: string): void {
  authFailures.delete(authKey(username));
}

/** Number of accounts currently tracked. Exposed for the backstop-bound test. */
export function authFailureCount(): number {
  return authFailures.size;
}

/** Reset all tracked failures. Test-only: keeps the shared map isolated per test. */
export function resetAuthFailures(): void {
  authFailures.clear();
}
