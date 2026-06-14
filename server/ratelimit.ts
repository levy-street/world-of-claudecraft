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
  // Every forwarded hop is itself trusted (or the header is absent): there is
  // no untrusted client address to key on. Fall back to the real socket peer
  // rather than chain[0], which is client-supplied and spoofable.
  return remote;
}

// Drop expired/empty buckets. Called only when the map exceeds its cap so the
// common path stays O(1); avoids both the unbounded growth of stale buckets
// and the previous clear()-everything backstop, which reset every IP's window
// at once (an attacker spraying distinct IPs could wipe all rate-limit state).
function pruneExpired(now: number): void {
  const windowStart = now - WINDOW_MS;
  for (const [ip, times] of attempts) {
    const live = times.filter((t) => t > windowStart);
    if (live.length === 0) attempts.delete(ip);
    else attempts.set(ip, live);
  }
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

/** True once an account has hit the failed-attempt ceiling within the window. */
export function authThrottled(username: string): boolean {
  const key = authKey(username);
  const windowStart = Date.now() - AUTH_FAIL_WINDOW_MS;
  const recent = (authFailures.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length > 0) authFailures.set(key, recent); else authFailures.delete(key);
  return recent.length >= MAX_AUTH_FAILURES;
}

/** Record a failed login for an account (call on bad password / unknown user). */
export function recordAuthFailure(username: string): void {
  const key = authKey(username);
  const windowStart = Date.now() - AUTH_FAIL_WINDOW_MS;
  const recent = (authFailures.get(key) ?? []).filter((t) => t > windowStart);
  recent.push(Date.now());
  authFailures.set(key, recent);
  if (authFailures.size > MAX_TRACKED_IPS) authFailures.clear(); // memory backstop
}

/** Clear an account's failure history after a successful login. */
export function clearAuthFailures(username: string): void {
  authFailures.delete(authKey(username));
}
