import { afterEach, describe, expect, it } from 'vitest';
import {
  authThrottled,
  RATE_LIMIT_ACCOUNT,
  RATE_LIMIT_IP,
  rateLimited,
  recordAuthFailure,
  resetAuthFailures,
  resetRateLimits,
} from '../server/ratelimit';

// A fresh, untrusted public IP: 127.0.0.1 / private ranges are treated as our
// own proxy and resolved via X-Forwarded-For, so tests must drive the limiter
// from a public address to key on the connection itself.
function reqFrom(ip: string): any {
  return { socket: { remoteAddress: ip }, headers: {} };
}

afterEach(() => {
  resetRateLimits();
  resetAuthFailures();
});

describe('rate-limit error codes', () => {
  it('exposes distinct, stable codes for the two auth limiters', () => {
    expect(RATE_LIMIT_IP.code).toBe('rate_limited_ip');
    expect(RATE_LIMIT_ACCOUNT.code).toBe('rate_limited_account');
    expect(RATE_LIMIT_IP.code).not.toBe(RATE_LIMIT_ACCOUNT.code);
  });

  // The client's userFacingApiError keeps a TEXT fallback for older servers /
  // deploy skew (it matches 'too many attempts' for the IP limit and 'too many
  // failed attempts' for the account lockout). These prefixes must not drift, and
  // the IP message must NOT be swallowed by the stricter 'too many failed' arm.
  it('keeps the English prefixes the client text-fallback matches', () => {
    const ip = RATE_LIMIT_IP.error.toLowerCase();
    const acct = RATE_LIMIT_ACCOUNT.error.toLowerCase();
    expect(ip.startsWith('too many attempts')).toBe(true);
    expect(acct.startsWith('too many failed attempts')).toBe(true);
    expect(ip.startsWith('too many failed attempts')).toBe(false);
  });

  it('per-IP limiter trips after the per-minute ceiling, and is scoped to one IP', () => {
    const req = reqFrom('203.0.113.50');
    // Default ceiling is 20/min; the 21st request from the same IP is limited.
    let limited = false;
    for (let i = 0; i < 21; i++) limited = rateLimited(req);
    expect(limited).toBe(true);
    // A different IP has its own budget (proves it is per-IP, not a shared bucket).
    expect(rateLimited(reqFrom('198.51.100.9'))).toBe(false);
  });

  it('per-account throttle trips after repeated failures, independent of IP and account', () => {
    const user = 'Aelwyn';
    expect(authThrottled(user)).toBe(false);
    for (let i = 0; i < 10; i++) recordAuthFailure(user);
    expect(authThrottled(user)).toBe(true);
    // A different account is unaffected (proves it is keyed per-account, not per-IP).
    expect(authThrottled('Someone-Else')).toBe(false);
  });
});
