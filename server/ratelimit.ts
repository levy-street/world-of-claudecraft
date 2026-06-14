import * as http from 'node:http';

// Simple in-memory rate limiter (per client IP, sliding minute window).
//
// Client IP resolution must work behind the production stack: nginx on the
// host proxies to the game CONTAINER, so connections arrive from the docker
// bridge gateway (e.g. 172.18.0.1), not loopback. The compose file publishes
// the port on 127.0.0.1 only, so any connection from a loopback/private
// address IS our reverse proxy (or LAN dev) — trust its X-Forwarded-For.
// Direct internet clients have public addresses and are never trusted, so
// they can't spoof the header. Set TRUSTED_PROXY_IPS (comma-separated) to
// pin an explicit proxy list instead of the private-range default.
const WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 10_000;

const attempts = new Map<string, number[]>();

function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  return ip;
}

// loopback, RFC1918, link-local, IPv6 ULA — the only sources our reverse
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
    return configured.split(',').map((s) => normalizeIp(s.trim())).filter(Boolean).includes(ip);
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

export function rateLimited(req: http.IncomingMessage, maxPerMinute = 20): boolean {
  const ip = requestIp(req);
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const list = (attempts.get(ip) ?? []).filter((t) => t > windowStart);
  const updated = [...list, now];
  attempts.set(ip, updated);
  // Memory backstop: when the map grows too large, evict entries whose window
  // has fully expired rather than clearing everything. A blanket clear() would
  // also wipe the counter we just recorded, so every IP would perpetually see
  // a single attempt and rate limiting would silently stop working under load.
  if (attempts.size > MAX_TRACKED_IPS) {
    for (const [key, times] of attempts) {
      if (key === ip) continue;
      if (times.length === 0 || times[times.length - 1] <= windowStart) {
        attempts.delete(key);
      }
      if (attempts.size <= MAX_TRACKED_IPS) break;
    }
  }
  return updated.length > maxPerMinute;
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

// Single source of truth for "is this account at/over the failure ceiling right
// now". Both authThrottled() and the memory backstop's eviction skip-check call
// this, so the two can never drift apart — if they did, the backstop could evict
// a still-throttled account and silently re-open the flood-reset bypass (#147).
function isThrottled(times: number[], windowStart: number): boolean {
  return times.filter((t) => t > windowStart).length >= MAX_AUTH_FAILURES;
}

/** True once an account has hit the failed-attempt ceiling within the window. */
export function authThrottled(username: string): boolean {
  const key = authKey(username);
  const windowStart = Date.now() - AUTH_FAIL_WINDOW_MS;
  const recent = (authFailures.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length > 0) authFailures.set(key, recent); else authFailures.delete(key);
  return isThrottled(recent, windowStart);
}

/** Record a failed login for an account (call on bad password / unknown user). */
export function recordAuthFailure(username: string): void {
  const key = authKey(username);
  const windowStart = Date.now() - AUTH_FAIL_WINDOW_MS;
  const recent = (authFailures.get(key) ?? []).filter((t) => t > windowStart);
  recent.push(Date.now());
  authFailures.set(key, recent);
  // Memory backstop: keep the map bounded without a blanket clear(), which would
  // also wipe the counter we just recorded — letting an attacker bypass the
  // throttle by flooding the map with failures against many distinct usernames
  // to force the overflow. First evict accounts whose window has fully expired.
  if (authFailures.size > MAX_TRACKED_IPS) {
    for (const [k, times] of authFailures) {
      if (k === key) continue;
      if (times.length === 0 || times[times.length - 1] <= windowStart) {
        authFailures.delete(k);
      }
      if (authFailures.size <= MAX_TRACKED_IPS) break;
    }
    // A pure flood is all in-window, so nothing above is expired and the map
    // would grow unbounded (and each call would re-scan it). Fall back to
    // evicting the least-recently-active account until back under the cap.
    //
    // Critically, NEVER evict a currently-throttled account (isThrottled) or the
    // account just recorded. In the real flow (server/main.ts) a throttled
    // account is rejected BEFORE recordAuthFailure runs, so its timestamps go
    // stale and it would otherwise look "oldest" — letting an attacker reset a
    // victim's throttle simply by flooding the map with newer one-off failures.
    // Only non-throttled idle entries (the flood's count-of-1 buckets) are
    // sacrificed — the cost of a memory bound.
    while (authFailures.size > MAX_TRACKED_IPS) {
      let oldestKey: string | undefined;
      let oldestSeen = Infinity;
      for (const [k, times] of authFailures) {
        if (k === key) continue;
        // Currently throttled? Same predicate authThrottled uses; never evict it.
        if (isThrottled(times, windowStart)) continue;
        const last = times.length === 0 ? 0 : times[times.length - 1];
        if (last < oldestSeen) {
          oldestSeen = last;
          oldestKey = k;
        }
      }
      // Nothing evictable means every remaining account is either the current
      // one or currently throttled. Accept a SOFT cap and stop rather than
      // reset any throttle. This only happens once an attacker has genuinely
      // locked out >MAX_TRACKED_IPS distinct accounts (100k+ failed logins);
      // we fail toward protection (map grows) instead of toward bypass.
      if (oldestKey === undefined) break;
      authFailures.delete(oldestKey);
    }
  }
}

/** Number of accounts currently tracked. Exposed for the backstop-bound test. */
export function authFailureCount(): number {
  return authFailures.size;
}

/** Reset all tracked failures. Test-only — keeps the shared map isolated per test. */
export function resetAuthFailures(): void {
  authFailures.clear();
}

/** Clear an account's failure history after a successful login. */
export function clearAuthFailures(username: string): void {
  authFailures.delete(authKey(username));
}
