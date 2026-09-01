// The admin economy-oversight limiters (server/ratelimit.ts) exist for ONE
// stated reason: isolation from the shared login/register map that
// rateLimited() serves, so dashboard polling and flag-workflow clicks can
// never burn anyone's login budget (and a login flood can never lock an
// operator out of the oversight pages). This pins that isolation in both
// directions, plus the buckets' independence from each other and the
// per-account fusion each carries. The analytics read bucket (the
// overview/activity/market-metrics dashboard family) is scoped the same way:
// its own pair, so the Overview landing page's default 5s poll can never burn
// the economy-oversight budget (whose exhaustion would 429 the moderation
// Flagged workflow), and an oversight burst can never blank the dashboards.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_ANALYTICS_ACCOUNT_TAB_BUDGET,
  ADMIN_ANALYTICS_IP_TAB_BUDGET,
  ADMIN_ANALYTICS_READ_IP_MAX_PER_MINUTE,
  ADMIN_ANALYTICS_READ_MAX_PER_MINUTE,
  ADMIN_ANALYTICS_READS_PER_TAB_PER_MINUTE,
  ADMIN_FLAG_WRITE_MAX_PER_MINUTE,
  ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE,
  AUTH_MAX_PER_MINUTE,
  adminAnalyticsReadRateLimited,
  adminFlagWriteRateLimited,
  adminOversightReadRateLimited,
  rateLimited,
  resetAdminAnalyticsRateLimits,
  resetAdminOversightRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../server/ratelimit';
import { ACTIVITY_REFRESH_MS, LIVE_REFRESH_MS } from '../src/admin/state/poll';

const FIXED_NOW_MS = 1_700_000_000_000;
const OPERATOR = 7;

// A direct (untrusted, non-proxy) client address, so the IP key is the socket
// address itself and no X-Forwarded-For parsing is in play.
function reqFrom(ip: string): http.IncomingMessage {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  };
  req.headers = {};
  req.socket = { remoteAddress: ip };
  return req as unknown as http.IncomingMessage;
}

function exhaust(limiter: () => { allowed: boolean }, max: number, label: string): void {
  for (let i = 0; i < max; i++) {
    expect(limiter().allowed, `${label} attempt ${i + 1} of ${max}`).toBe(true);
  }
  expect(limiter().allowed, `${label} attempt ${max + 1}`).toBe(false);
}

beforeEach(() => {
  setRateLimitClock(() => FIXED_NOW_MS);
  resetRateLimits();
  resetAdminOversightRateLimits();
  resetAdminAnalyticsRateLimits();
});

afterEach(() => {
  resetRateLimits();
  resetAdminOversightRateLimits();
  resetAdminAnalyticsRateLimits();
  resetRateLimitClock();
});

describe('admin oversight rate-limit buckets', () => {
  it('pins the two budgets (reads get polling headroom, writes are deliberate clicks)', () => {
    expect(ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE).toBe(120);
    expect(ADMIN_FLAG_WRITE_MAX_PER_MINUTE).toBe(30);
    expect(ADMIN_FLAG_WRITE_MAX_PER_MINUTE).toBeLessThan(ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE);
  });

  it('an oversight read burst never consumes the login bucket nor the flag-write bucket', () => {
    const ip = '203.0.113.10';
    exhaust(
      () => adminOversightReadRateLimited(reqFrom(ip), OPERATOR),
      ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE,
      'oversight read',
    );
    // The login/register map is untouched: a first login attempt from the
    // same IP is still allowed with its full budget minus this one attempt.
    const login = rateLimited(reqFrom(ip));
    expect(login.allowed).toBe(true);
    expect(login.remaining).toBe(AUTH_MAX_PER_MINUTE - 1);
    // The flag-write bucket is untouched too.
    const write = adminFlagWriteRateLimited(reqFrom(ip), OPERATOR);
    expect(write.allowed).toBe(true);
    expect(write.remaining).toBe(ADMIN_FLAG_WRITE_MAX_PER_MINUTE - 1);
  });

  it('a flag-write burst never consumes the login bucket nor the oversight read bucket', () => {
    const ip = '203.0.113.11';
    exhaust(
      () => adminFlagWriteRateLimited(reqFrom(ip), OPERATOR),
      ADMIN_FLAG_WRITE_MAX_PER_MINUTE,
      'flag write',
    );
    const login = rateLimited(reqFrom(ip));
    expect(login.allowed).toBe(true);
    expect(login.remaining).toBe(AUTH_MAX_PER_MINUTE - 1);
    const read = adminOversightReadRateLimited(reqFrom(ip), OPERATOR);
    expect(read.allowed).toBe(true);
    expect(read.remaining).toBe(ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE - 1);
  });

  it('an exhausted login bucket never locks the oversight reads or writes', () => {
    const ip = '203.0.113.12';
    exhaust(() => rateLimited(reqFrom(ip)), AUTH_MAX_PER_MINUTE, 'login');
    expect(rateLimited(reqFrom(ip)).allowed).toBe(false);
    const read = adminOversightReadRateLimited(reqFrom(ip), OPERATOR);
    expect(read.allowed).toBe(true);
    expect(read.remaining).toBe(ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE - 1);
    const write = adminFlagWriteRateLimited(reqFrom(ip), OPERATOR);
    expect(write.allowed).toBe(true);
    expect(write.remaining).toBe(ADMIN_FLAG_WRITE_MAX_PER_MINUTE - 1);
  });

  it('fuses a per-account key so one operator cannot dodge either bucket by rotating IPs', () => {
    // Each call from a fresh IP: the IP half is always fresh, so only the
    // account half can deny, and it must, at exactly the budget.
    let n = 0;
    exhaust(
      () => adminOversightReadRateLimited(reqFrom(`198.51.100.${(n++ % 200) + 1}`), OPERATOR),
      ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE,
      'rotating-ip oversight read',
    );
    let m = 0;
    exhaust(
      () => adminFlagWriteRateLimited(reqFrom(`198.51.100.${(m++ % 200) + 1}`), OPERATOR),
      ADMIN_FLAG_WRITE_MAX_PER_MINUTE,
      'rotating-ip flag write',
    );
    // A different operator behind one of those IPs is unaffected on both.
    expect(adminOversightReadRateLimited(reqFrom('198.51.100.1'), OPERATOR + 1).allowed).toBe(true);
    expect(adminFlagWriteRateLimited(reqFrom('198.51.100.1'), OPERATOR + 1).allowed).toBe(true);
  });

  it('releases both buckets once the sliding window has passed', () => {
    const ip = '203.0.113.13';
    exhaust(
      () => adminFlagWriteRateLimited(reqFrom(ip), OPERATOR),
      ADMIN_FLAG_WRITE_MAX_PER_MINUTE,
      'flag write',
    );
    exhaust(
      () => adminOversightReadRateLimited(reqFrom(ip), OPERATOR),
      ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE,
      'oversight read',
    );
    setRateLimitClock(() => FIXED_NOW_MS + 60_001);
    expect(adminFlagWriteRateLimited(reqFrom(ip), OPERATOR).allowed).toBe(true);
    expect(adminOversightReadRateLimited(reqFrom(ip), OPERATOR).allowed).toBe(true);
  });
});

describe('admin analytics read bucket', () => {
  it('derives both arms from tab-equivalents of the real dashboard poll cadence', () => {
    // One open tab: overview at LIVE_REFRESH_MS, activity at ACTIVITY_REFRESH_MS
    // (src/admin/state/poll.ts), online history riding that same activity fetch,
    // and market metrics at the page's own AUTO_REFRESH_MS (MarketMetrics.svelte,
    // read from source since a .svelte module has no node import).
    // 12 + 1 + 1 + 2 = 16 requests per tab per minute.
    const svelte = readFileSync(
      resolve(process.cwd(), 'src/admin/pages/MarketMetrics.svelte'),
      'utf8',
    );
    const metricsMs = Number(
      /const AUTO_REFRESH_MS = ([\d_]+);/.exec(svelte)?.[1]?.replace(/_/g, ''),
    );
    expect(metricsMs).toBe(30_000);
    // ONLINE HISTORY is the fourth term, and it is the one this derivation
    // missed when the bucket was first sized: Overview's refreshActivity fetches
    // /admin/api/online-history in the SAME Promise.all as /admin/api/activity,
    // so it has no poll constant of its own and rides the activity cadence. The
    // arm below reads it out of the page rather than trusting the comment, so a
    // future edit that moves it onto its own timer, or drops it, fails here
    // instead of silently under-sizing the bucket by a whole surface.
    const overview = readFileSync(
      resolve(process.cwd(), 'src/admin/pages/Overview.svelte'),
      'utf8',
    );
    expect(overview).toMatch(/online-history/);
    const onlineHistoryPerMinute = 60_000 / ACTIVITY_REFRESH_MS;
    const perTab =
      60_000 / LIVE_REFRESH_MS +
      60_000 / ACTIVITY_REFRESH_MS +
      onlineHistoryPerMinute +
      60_000 / metricsMs;
    expect(perTab).toBe(16);
    expect(ADMIN_ANALYTICS_READS_PER_TAB_PER_MINUTE).toBe(perTab);
    // The account arm is one operator's own tabs; the IP arm a whole NAT.
    expect(ADMIN_ANALYTICS_ACCOUNT_TAB_BUDGET).toBe(8);
    expect(ADMIN_ANALYTICS_IP_TAB_BUDGET).toBe(40);
    expect(ADMIN_ANALYTICS_READ_MAX_PER_MINUTE).toBe(8 * 16);
    expect(ADMIN_ANALYTICS_READ_IP_MAX_PER_MINUTE).toBe(40 * 16);
    expect(ADMIN_ANALYTICS_READ_IP_MAX_PER_MINUTE).toBeGreaterThan(
      ADMIN_ANALYTICS_READ_MAX_PER_MINUTE,
    );
  });

  it('three operators with three tabs each behind one NAT all stay under the IP arm', () => {
    // The hot-path review's failing scenario for the first cut (an IP arm equal
    // to the account arm): 9 tabs x 15/min = 135/min from one address, which
    // 429'd the Overview live cards. Now every one of those requests passes.
    const ip = '203.0.113.30';
    for (let minuteRequest = 0; minuteRequest < 3 * 3 * 15; minuteRequest++) {
      const operator = OPERATOR + (minuteRequest % 3);
      expect(adminAnalyticsReadRateLimited(reqFrom(ip), operator).allowed).toBe(true);
    }
  });

  it('the IP arm still closes at its own budget when many operators share one address', () => {
    // Rotating accounts so the account arm never trips: only the IP arm can
    // deny, and it must, at exactly the derived budget.
    const ip = '203.0.113.31';
    let n = 0;
    exhaust(
      () => adminAnalyticsReadRateLimited(reqFrom(ip), 10_000 + n++),
      ADMIN_ANALYTICS_READ_IP_MAX_PER_MINUTE,
      'shared-ip analytics read',
    );
    // A different address is unaffected.
    expect(adminAnalyticsReadRateLimited(reqFrom('203.0.113.32'), 10_000 + n).allowed).toBe(true);
  });

  it('an analytics burst never consumes the oversight, flag-write, or login buckets', () => {
    const ip = '203.0.113.20';
    exhaust(
      () => adminAnalyticsReadRateLimited(reqFrom(ip), OPERATOR),
      ADMIN_ANALYTICS_READ_MAX_PER_MINUTE,
      'analytics read',
    );
    const read = adminOversightReadRateLimited(reqFrom(ip), OPERATOR);
    expect(read.allowed).toBe(true);
    expect(read.remaining).toBe(ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE - 1);
    const write = adminFlagWriteRateLimited(reqFrom(ip), OPERATOR);
    expect(write.allowed).toBe(true);
    expect(write.remaining).toBe(ADMIN_FLAG_WRITE_MAX_PER_MINUTE - 1);
    const login = rateLimited(reqFrom(ip));
    expect(login.allowed).toBe(true);
    expect(login.remaining).toBe(AUTH_MAX_PER_MINUTE - 1);
  });

  it('an oversight burst never locks the analytics dashboards', () => {
    const ip = '203.0.113.21';
    exhaust(
      () => adminOversightReadRateLimited(reqFrom(ip), OPERATOR),
      ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE,
      'oversight read',
    );
    const analytics = adminAnalyticsReadRateLimited(reqFrom(ip), OPERATOR);
    expect(analytics.allowed).toBe(true);
    expect(analytics.remaining).toBe(ADMIN_ANALYTICS_READ_MAX_PER_MINUTE - 1);
  });

  it('an exhausted login bucket never locks the analytics reads', () => {
    const ip = '203.0.113.22';
    exhaust(() => rateLimited(reqFrom(ip)), AUTH_MAX_PER_MINUTE, 'login');
    const analytics = adminAnalyticsReadRateLimited(reqFrom(ip), OPERATOR);
    expect(analytics.allowed).toBe(true);
    expect(analytics.remaining).toBe(ADMIN_ANALYTICS_READ_MAX_PER_MINUTE - 1);
  });

  it('fuses a per-account key so one operator cannot dodge the bucket by rotating IPs', () => {
    let n = 0;
    exhaust(
      () => adminAnalyticsReadRateLimited(reqFrom(`198.51.100.${(n++ % 200) + 1}`), OPERATOR),
      ADMIN_ANALYTICS_READ_MAX_PER_MINUTE,
      'rotating-ip analytics read',
    );
    // A different operator behind one of those IPs is unaffected.
    expect(adminAnalyticsReadRateLimited(reqFrom('198.51.100.1'), OPERATOR + 1).allowed).toBe(true);
  });

  it('releases the bucket once the sliding window has passed', () => {
    const ip = '203.0.113.23';
    exhaust(
      () => adminAnalyticsReadRateLimited(reqFrom(ip), OPERATOR),
      ADMIN_ANALYTICS_READ_MAX_PER_MINUTE,
      'analytics read',
    );
    setRateLimitClock(() => FIXED_NOW_MS + 60_001);
    expect(adminAnalyticsReadRateLimited(reqFrom(ip), OPERATOR).allowed).toBe(true);
  });
});
