import { describe, expect, it } from 'vitest';
import {
  ALDRIN_PERKS,
  type AldrinMembership,
  assertNoPowerPerks,
  daysRemaining,
  extendMembership,
  healMembership,
  isCryptoMethod,
  isPayMethod,
  membershipActive,
  quoteExpired,
} from '../server/aldrin_club';

// SPLIT ARCHITECTURE (#938): the money logic (FX pricing, the 50/50 split, on-chain
// payment verification, and Stripe signature verification) MOVED to the economy
// service and is tested there (service/test/subscription.test.ts). This suite
// covers only what the GAME still owns: the membership clock, the quote expiry, the
// perk catalog (pay-to-win free), and the method guards.

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

describe('aldrin membership clock', () => {
  const base: AldrinMembership = {
    since: new Date(T0).toISOString(),
    until: new Date(T0 + 30 * DAY).toISOString(),
    lastMethod: 'usdc',
    autoRenew: false,
  };

  it('is active before expiry and inactive after', () => {
    expect(membershipActive(base, T0 + 10 * DAY)).toBe(true);
    expect(membershipActive(base, T0 + 40 * DAY)).toBe(false);
    expect(membershipActive(null, T0)).toBe(false);
  });

  it('reports whole days remaining', () => {
    expect(daysRemaining(base, T0)).toBe(30);
    expect(daysRemaining(base, T0 + 29.5 * DAY)).toBe(1);
    expect(daysRemaining(base, T0 + 40 * DAY)).toBe(0);
  });

  it('extends from current expiry when renewed early (no burned time)', () => {
    const renewed = extendMembership(base, T0 + 10 * DAY, 'sol', 30, false);
    expect(renewed.until).toBe(new Date(T0 + 60 * DAY).toISOString());
    expect(renewed.since).toBe(base.since); // since is preserved across renewals
    expect(renewed.lastMethod).toBe('sol');
  });

  it('restarts from now when renewed after lapse', () => {
    const renewed = extendMembership(base, T0 + 100 * DAY, 'woc', 30, false);
    expect(renewed.until).toBe(new Date(T0 + 130 * DAY).toISOString());
  });

  it('starts a fresh membership when there was none', () => {
    const fresh = extendMembership(null, T0, 'stripe', 30, true);
    expect(fresh.since).toBe(new Date(T0).toISOString());
    expect(fresh.until).toBe(new Date(T0 + 30 * DAY).toISOString());
    expect(fresh.autoRenew).toBe(true);
  });

  it('heals idempotently to a recorded grant without extending twice', () => {
    const grantedUntil = new Date(T0 + 30 * DAY).toISOString();
    // Grant write was lost (membership null): heal reconstructs it to the recorded expiry.
    const healed = healMembership(null, grantedUntil, 'usdc', 30);
    expect(healed?.until).toBe(grantedUntil);
    expect(healed?.since).toBe(new Date(T0).toISOString());
    // Already covered: nothing to do (no double extension on a retry).
    expect(healMembership(base, base.until, 'usdc', 30)).toBeNull();
    expect(healMembership(base, new Date(T0 + 10 * DAY).toISOString(), 'usdc', 30)).toBeNull();
    // Missing / bad recorded value: no-op.
    expect(healMembership(base, undefined, 'usdc', 30)).toBeNull();
  });
});

describe('aldrin quote expiry (the game still owns the local quote TTL)', () => {
  it('detects expiry against the injected clock', () => {
    const q = { expiresAt: new Date(T0 + 600_000).toISOString() };
    expect(quoteExpired(q, T0 + 100_000)).toBe(false);
    expect(quoteExpired(q, T0 + 700_000)).toBe(true);
  });
});

describe('perk catalog is pay-to-win free', () => {
  it('every perk is cosmetic / convenience / access', () => {
    expect(() => assertNoPowerPerks()).not.toThrow();
    for (const p of ALDRIN_PERKS) expect(['cosmetic', 'convenience', 'access']).toContain(p.kind);
  });

  it('throws if a power perk is ever added', () => {
    expect(() => assertNoPowerPerks([{ id: 'haste', kind: 'power' as any }])).toThrow(/pay-to-win/);
  });
});

describe('method guards', () => {
  it('recognizes the four rails and which are on-chain', () => {
    expect(isPayMethod('sol')).toBe(true);
    expect(isPayMethod('paypal')).toBe(false);
    expect(isCryptoMethod('stripe')).toBe(false);
    expect((['sol', 'usdc', 'woc'] as const).every((m) => isCryptoMethod(m))).toBe(true);
  });
});
