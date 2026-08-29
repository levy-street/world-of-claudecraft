// The admin economy-oversight limiters (server/ratelimit.ts) exist for ONE
// stated reason: isolation from the shared login/register map that
// rateLimited() serves, so dashboard polling and flag-workflow clicks can
// never burn anyone's login budget (and a login flood can never lock an
// operator out of the oversight pages). This pins that isolation in both
// directions, plus the two buckets' independence from each other and the
// per-account fusion each carries.
import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_FLAG_WRITE_MAX_PER_MINUTE,
  ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE,
  AUTH_MAX_PER_MINUTE,
  adminFlagWriteRateLimited,
  adminOversightReadRateLimited,
  rateLimited,
  resetAdminOversightRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../server/ratelimit';

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
});

afterEach(() => {
  resetRateLimits();
  resetAdminOversightRateLimits();
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
