// Accuracy tests for the RateLimitOutcome shape returned by server/ratelimit.
// Where ratelimit_clock.test focuses on the allowed flip across a window
// boundary, this file pins the injected clock and asserts the exact { allowed,
// remaining, resetSeconds } numbers: the record-then-judge counters (rateLimited),
// the fused IP-AND-account merge (walletLinkRateLimited), and the read-only
// per-account failed-login throttle (authThrottled). Every case pins the clock
// with setRateLimitClock and restores it (plus the shared maps) in afterEach, so
// the suite is deterministic and leaves global state clean.
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttackSignalSink, AuthFailureKind } from '../../server/http/attack_signals';
import { noopAttackSignalSink, setAttackSignalSink } from '../../server/http/attack_signals';
import {
  authThrottled,
  clearAuthFailures,
  rateLimited,
  recordAuthFailure,
  resetAuthFailures,
  resetRateLimitClock,
  resetRateLimits,
  resetWalletLinkRateLimits,
  setRateLimitClock,
  WALLET_LINK_MAX_PER_MINUTE,
  WINDOW_MS,
  walletLinkRateLimited,
} from '../../server/ratelimit';

// Mirror the un-exported per-account failed-login constants in server/ratelimit.
const AUTH_FAIL_WINDOW_MS = 15 * 60_000; // 15 minutes
const MAX_AUTH_FAILURES = 10;

// requestIp only reads req.socket.remoteAddress and the x-forwarded-for header; a
// loopback/private remote with an empty forwarded chain resolves to the socket IP.
function reqFrom(remoteAddress: string): http.IncomingMessage {
  return { headers: {}, socket: { remoteAddress } } as unknown as http.IncomingMessage;
}

let fakeTime = 0;
function pinClock(start: number) {
  fakeTime = start;
  setRateLimitClock(() => fakeTime);
}

function resetAll() {
  resetRateLimits();
  resetWalletLinkRateLimits();
  resetAuthFailures();
  resetRateLimitClock();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('rateLimited: RateLimitOutcome accuracy', () => {
  it('counts remaining down, flips allowed at max + 1, and reports resetSeconds', () => {
    const T = 1_000_000;
    pinClock(T);
    const req = reqFrom('10.1.1.1');
    const max = 3;
    const full = WINDOW_MS / 1000; // 60s, the wait when the only entry is `now`

    expect(rateLimited(req, max)).toEqual({ allowed: true, remaining: 2, resetSeconds: full });
    expect(rateLimited(req, max)).toEqual({ allowed: true, remaining: 1, resetSeconds: full });
    expect(rateLimited(req, max)).toEqual({ allowed: true, remaining: 0, resetSeconds: full });
    // The (max + 1)th call in the same window is over the limit; remaining stays 0.
    expect(rateLimited(req, max)).toEqual({ allowed: false, remaining: 0, resetSeconds: full });
  });

  it('reports resetSeconds against the oldest in-window entry after a partial advance', () => {
    const T = 2_000_000;
    pinClock(T);
    const req = reqFrom('10.1.1.2');
    const max = 5;

    // First hit at T: oldest entry is T, so the window clears a full 60s later.
    expect(rateLimited(req, max)).toEqual({ allowed: true, remaining: 4, resetSeconds: 60 });

    // 25s later the oldest entry (T) is still in window; it now clears in 35s.
    fakeTime = T + 25_000;
    expect(rateLimited(req, max)).toEqual({ allowed: true, remaining: 3, resetSeconds: 35 });
  });

  it('restores allowed and remaining once the window rolls', () => {
    const T = 3_000_000;
    pinClock(T);
    const req = reqFrom('10.1.1.3');
    const max = 2;

    expect(rateLimited(req, max).allowed).toBe(true); // count 1 @ T
    expect(rateLimited(req, max).allowed).toBe(true); // count 2 @ T
    expect(rateLimited(req, max).allowed).toBe(false); // count 3 @ T, over the limit

    // A full window later every t=T entry ages out (windowStart = T prunes them),
    // so the counter starts fresh and remaining is back to max - 1.
    fakeTime = T + WINDOW_MS;
    expect(rateLimited(req, max)).toEqual({ allowed: true, remaining: 1, resetSeconds: 60 });
    expect(rateLimited(req, max)).toEqual({ allowed: true, remaining: 0, resetSeconds: 60 });
    expect(rateLimited(req, max)).toEqual({ allowed: false, remaining: 0, resetSeconds: 60 });
  });
});

describe('walletLinkRateLimited: fused IP-AND-account merge', () => {
  it('keeps the IP and account buckets independent', () => {
    const T = 4_000_000;
    pinClock(T);
    // Drain the account bucket for account 1 across DISTINCT IPs. Each call records a
    // fresh IP bucket (always allowed) but shares account 1, so account 1 is what caps.
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      expect(walletLinkRateLimited(reqFrom(`10.2.0.${i + 1}`), 1).allowed).toBe(true);
    }
    // The (cap + 1)th call from a brand-new IP is still limited: the account bucket
    // disallows, and the fused outcome is allowed only when BOTH buckets allow.
    expect(walletLinkRateLimited(reqFrom('10.2.0.250'), 1)).toEqual({
      allowed: false,
      remaining: 0,
      resetSeconds: 60,
    });

    // The mirror: drain ONE IP across distinct accounts. Now the IP bucket caps even
    // though each account bucket is fresh.
    resetWalletLinkRateLimits();
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      expect(walletLinkRateLimited(reqFrom('10.2.9.9'), 1000 + i).allowed).toBe(true);
    }
    expect(walletLinkRateLimited(reqFrom('10.2.9.9'), 9999).allowed).toBe(false);
  });

  it('merges remaining (min) and resetSeconds (max) from the two buckets independently', () => {
    const T = 5_000_000;
    pinClock(T);
    // Seed account X (and a throwaway IP) at T so account X's oldest entry is T.
    expect(walletLinkRateLimited(reqFrom('10.3.0.1'), 42)).toEqual({
      allowed: true,
      remaining: WALLET_LINK_MAX_PER_MINUTE - 1,
      resetSeconds: 60,
    });

    // 20s later, hit account X again from a FRESH IP. The fresh IP bucket has 9
    // remaining and a full 60s reset (its only entry is at T + 20s). Account X now
    // has 8 remaining and its oldest entry (T) clears in 40s. The merge takes the
    // tighter remaining (8, account) and the longer reset (60, IP), from DIFFERENT
    // buckets, proving min/max are applied independently.
    fakeTime = T + 20_000;
    expect(walletLinkRateLimited(reqFrom('10.3.0.2'), 42)).toEqual({
      allowed: true,
      remaining: WALLET_LINK_MAX_PER_MINUTE - 2,
      resetSeconds: 60,
    });
  });
});

describe('authThrottled: read-only per-account failed-login outcome', () => {
  it('does not consume: repeated checks with no failures stay at full remaining', () => {
    pinClock(6_000_000);
    for (let i = 0; i < 5; i++) {
      expect(authThrottled('nobody')).toEqual({
        allowed: true,
        remaining: MAX_AUTH_FAILURES,
        resetSeconds: 0,
      });
    }
  });

  it('remaining reflects the recorded failure count and resetSeconds tracks the oldest', () => {
    const T = 7_000_000;
    pinClock(T);
    const user = 'brute';

    recordAuthFailure(user);
    recordAuthFailure(user);
    recordAuthFailure(user);
    // Three failures at T: 7 attempts remain and the oldest clears a full window later.
    expect(authThrottled(user)).toEqual({
      allowed: true,
      remaining: MAX_AUTH_FAILURES - 3,
      resetSeconds: AUTH_FAIL_WINDOW_MS / 1000,
    });
    // Re-checking does not consume: the numbers are unchanged.
    expect(authThrottled(user)).toEqual({
      allowed: true,
      remaining: MAX_AUTH_FAILURES - 3,
      resetSeconds: AUTH_FAIL_WINDOW_MS / 1000,
    });

    // 5 minutes on, the oldest failure (still T) clears 10 minutes from now.
    fakeTime = T + 5 * 60_000;
    expect(authThrottled(user).resetSeconds).toBe(10 * 60);
  });

  it('flips allowed to false at the ceiling and clearAuthFailures restores it', () => {
    const T = 8_000_000;
    pinClock(T);
    const user = 'locked';

    for (let i = 0; i < MAX_AUTH_FAILURES; i++) recordAuthFailure(user);
    expect(authThrottled(user)).toEqual({
      allowed: false,
      remaining: 0,
      resetSeconds: AUTH_FAIL_WINDOW_MS / 1000,
    });

    clearAuthFailures(user);
    expect(authThrottled(user)).toEqual({
      allowed: true,
      remaining: MAX_AUTH_FAILURES,
      resetSeconds: 0,
    });
  });
});

describe('attack-signal auth-failure emissions', () => {
  // A recording fake sink installed for this block only; the outer resetAll
  // beforeEach still clears the maps and clock first, then we install the sink.
  let records: AuthFailureKind[];

  beforeEach(() => {
    records = [];
    const sink: AttackSignalSink = {
      rateLimitHit() {},
      authFailure(kind) {
        records.push(kind);
      },
      bolaDenied() {},
      pgLimiterWrite() {},
    };
    setAttackSignalSink(sink);
  });

  afterEach(() => {
    setAttackSignalSink(noopAttackSignalSink);
  });

  // Driving an account to the lockout ceiling calls recordAuthFailure, which each
  // time emits a 'bad_credentials' record; filter by kind to isolate the signal
  // the assertion is about.
  const countOf = (k: AuthFailureKind) => records.filter((r) => r === k).length;

  it('recordAuthFailure emits exactly one bad_credentials signal per call', () => {
    pinClock(9_000_000);
    recordAuthFailure('someuser');
    expect(records).toEqual(['bad_credentials']);
  });

  it('authThrottled below the failure ceiling emits nothing', () => {
    pinClock(9_100_000);
    const user = 'under';
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) recordAuthFailure(user);
    const before = records.length;
    expect(authThrottled(user).allowed).toBe(true);
    // The check itself added no record: it stays read-only when not a lockout.
    expect(records.length).toBe(before);
  });

  it('authThrottled emits one throttled signal per lockout-outcome check', () => {
    pinClock(9_200_000);
    const user = 'locked';
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) recordAuthFailure(user);
    expect(countOf('bad_credentials')).toBe(MAX_AUTH_FAILURES);

    // Each lockout-outcome (allowed false) check emits exactly one 'throttled'.
    expect(authThrottled(user).allowed).toBe(false);
    expect(countOf('throttled')).toBe(1);
    expect(authThrottled(user).allowed).toBe(false);
    expect(countOf('throttled')).toBe(2);
  });

  it('clearAuthFailures emits nothing (successful-path helper)', () => {
    pinClock(9_300_000);
    const user = 'cleared';
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) recordAuthFailure(user);
    const before = records.length;
    clearAuthFailures(user);
    expect(records.length).toBe(before);
  });
});
