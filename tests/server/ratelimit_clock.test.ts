// Deterministic tests for the rate-limiter clock seam in server/ratelimit. The
// module's sliding-window functions read time through an injectable clock
// (setRateLimitClock / resetRateLimitClock), so a fixed fake time drives the
// per-IP limiter and the per-account failed-login throttle across their window
// boundaries with no real timers and no flake. Every case restores the default
// clock and clears the shared maps so the suite is isolated and leaves global
// state clean for the rest of the run. The limiters now report RateLimitOutcome
// (server/http/types): outcome.allowed is the inverse of the old boolean, so a
// served request is allowed=true and a limited one is allowed=false.
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authThrottled,
  rateLimited,
  recordAuthFailure,
  resetAuthFailures,
  resetCardUploadRateLimits,
  resetDiscordRateLimits,
  resetPublicReadRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  resetWalletLinkRateLimits,
  resetWocBalanceRateLimits,
  setRateLimitClock,
  WINDOW_MS,
} from '../../server/ratelimit';

// The per-account failed-login window and ceiling mirror the (un-exported)
// constants in server/ratelimit: AUTH_FAIL_WINDOW_MS = 15 minutes,
// MAX_AUTH_FAILURES = 10 failures per account per window.
const AUTH_FAIL_WINDOW_MS = 15 * 60_000;
const MAX_AUTH_FAILURES = 10;

// A minimal fake request: rateLimited -> requestIp only reads req.socket
// .remoteAddress and req.headers['x-forwarded-for']. A loopback remote with no
// X-Forwarded-For resolves to the loopback IP itself (a trusted proxy with an
// empty forwarded chain falls back to the socket address).
function fakeReq(remoteAddress = '127.0.0.1'): http.IncomingMessage {
  return { headers: {}, socket: { remoteAddress } } as unknown as http.IncomingMessage;
}

// A settable fake clock shared by setRateLimitClock.
let fakeTime = 0;
function installClock(start = 0) {
  fakeTime = start;
  setRateLimitClock(() => fakeTime);
}

function resetAll() {
  resetRateLimits();
  resetAuthFailures();
  resetCardUploadRateLimits();
  resetWalletLinkRateLimits();
  resetDiscordRateLimits();
  resetWocBalanceRateLimits();
  resetPublicReadRateLimits();
  resetRateLimitClock();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('rateLimited: per-IP sliding window driven by the injected clock', () => {
  it('flips from allowed to limited on the (max + 1)th call at a fixed time', () => {
    installClock(1_000_000); // arbitrary fixed T
    const req = fakeReq();
    const max = 3;

    // The first `max` calls are under the limit (allowed).
    expect(rateLimited(req, max).allowed).toBe(true); // count 1
    expect(rateLimited(req, max).allowed).toBe(true); // count 2
    expect(rateLimited(req, max).allowed).toBe(true); // count 3
    // The (max + 1)th call within the same window is limited.
    expect(rateLimited(req, max).allowed).toBe(false); // count 4 > 3
    // It stays limited for further calls inside the window.
    expect(rateLimited(req, max).allowed).toBe(false);
  });

  it('rolls the window so the count resets once the clock passes WINDOW_MS', () => {
    installClock(0);
    const req = fakeReq();
    const max = 2;

    expect(rateLimited(req, max).allowed).toBe(true); // count 1 @ t=0
    expect(rateLimited(req, max).allowed).toBe(true); // count 2 @ t=0
    expect(rateLimited(req, max).allowed).toBe(false); // count 3 @ t=0, over limit

    // Advance a full window past the t=0 entries with no intervening hit. At
    // t = WINDOW_MS the windowStart is 0, so prune keeps only t > 0 and drops
    // every t=0 entry: the window rolls and the count starts fresh.
    fakeTime = WINDOW_MS;
    expect(rateLimited(req, max).allowed).toBe(true); // count 1 in the new window
    expect(rateLimited(req, max).allowed).toBe(true); // count 2
    expect(rateLimited(req, max).allowed).toBe(false); // count 3, over again
  });

  it('asserts the exact boundary: an entry counts at WINDOW_MS-1 but ages out at WINDOW_MS', () => {
    installClock(0);
    const max = 1;
    // Two independent IPs each record one entry at t=0, on one monotonic
    // timeline. Probing each at a different instant isolates the boundary
    // without a probe hit polluting the other IP's window.
    const near = fakeReq('10.0.0.1');
    const far = fakeReq('10.0.0.2');
    expect(rateLimited(near, max).allowed).toBe(true); // near entry @ t=0
    expect(rateLimited(far, max).allowed).toBe(true); // far entry @ t=0

    // One millisecond before the window closes, near's t=0 entry is still in
    // window (windowStart = -1 < 0), so a second hit trips the limit.
    fakeTime = WINDOW_MS - 1;
    expect(rateLimited(near, max).allowed).toBe(false);

    // Exactly at WINDOW_MS, far's t=0 entry ages out (windowStart = 0 prunes it),
    // so far's next hit starts a fresh window and is allowed.
    fakeTime = WINDOW_MS;
    expect(rateLimited(far, max).allowed).toBe(true);
  });

  it('keys windows by client IP independently', () => {
    installClock(500);
    const max = 1;
    const a = fakeReq('10.0.0.1');
    const b = fakeReq('10.0.0.2');

    expect(rateLimited(a, max).allowed).toBe(true);
    expect(rateLimited(a, max).allowed).toBe(false); // a is now limited
    // A different IP has its own window and is unaffected.
    expect(rateLimited(b, max).allowed).toBe(true);
  });
});

describe('authThrottled / recordAuthFailure: per-account window driven by the clock', () => {
  it('throttles on the MAX_AUTH_FAILURES-th failure and rolls past AUTH_FAIL_WINDOW_MS', () => {
    installClock(2_000_000); // arbitrary fixed T
    const user = 'Alice';

    // The first MAX_AUTH_FAILURES - 1 failures do not trip the throttle.
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) {
      recordAuthFailure(user);
      expect(authThrottled(user).allowed).toBe(true);
    }
    // The MAX_AUTH_FAILURES-th failure reaches the ceiling and throttles.
    recordAuthFailure(user);
    expect(authThrottled(user).allowed).toBe(false);

    // Just before the window fully ages out the failures still count.
    fakeTime += AUTH_FAIL_WINDOW_MS - 1;
    expect(authThrottled(user).allowed).toBe(false);

    // At exactly AUTH_FAIL_WINDOW_MS past the failures, every entry ages out and
    // the account is no longer throttled.
    fakeTime = 2_000_000 + AUTH_FAIL_WINDOW_MS;
    expect(authThrottled(user).allowed).toBe(true);
  });

  it('keys the throttle per normalized account name', () => {
    installClock(0);
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) recordAuthFailure('Bob');
    expect(authThrottled('Bob').allowed).toBe(false);
    // ' bob ' normalizes to the same bucket; a different account is untouched.
    expect(authThrottled(' bob ').allowed).toBe(false);
    expect(authThrottled('Carol').allowed).toBe(true);
  });
});

describe('default (un-injected) clock: the seam is a no-op without setRateLimitClock', () => {
  // These cases deliberately do NOT call installClock, so clockNow stays the
  // default Date.now restored by resetAll. They prove directly (not just via the
  // other suites that happen to skip the clock) that the seam is a no-op by
  // default: a burst that completes well inside the 60s/15min windows trips the
  // limiter exactly as it did before the clock seam existed.
  it('limits a per-IP burst on the real Date.now clock', () => {
    const req = fakeReq('198.51.100.9'); // TEST-NET, a fresh per-IP bucket
    const max = 3;
    expect(rateLimited(req, max).allowed).toBe(true); // count 1
    expect(rateLimited(req, max).allowed).toBe(true); // count 2
    expect(rateLimited(req, max).allowed).toBe(true); // count 3
    expect(rateLimited(req, max).allowed).toBe(false); // count 4 > 3
  });

  it('throttles a per-account burst on the real Date.now clock', () => {
    const user = 'DefaultClockUser';
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) recordAuthFailure(user);
    expect(authThrottled(user).allowed).toBe(false);
  });
});
