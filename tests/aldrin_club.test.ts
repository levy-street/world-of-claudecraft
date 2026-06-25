import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ALDRIN_PERKS,
  assertNoPowerPerks,
  buildQuote,
  daysRemaining,
  extendMembership,
  healMembership,
  isCryptoMethod,
  isPayMethod,
  membershipActive,
  type AldrinMembership,
  type AldrinQuote,
  type ParsedOnchainPayment,
  quoteExpired,
  splitAldrinAmount,
  usdCentsToAssetBase,
  verifyAldrinPayment,
} from '../server/aldrin_club';
import { grantFromStripeEvent, verifyStripeSignature } from '../server/aldrin_stripe';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

describe('aldrin split math', () => {
  it('splits 50/50 by default and the parts always cover the price', () => {
    expect(splitAldrinAmount(1000n, 5000)).toEqual({ splitBase: 500n, treasuryBase: 500n });
    // Odd amount: floor goes to the burn side, treasury gets the remainder; sum is exact.
    const odd = splitAldrinAmount(1001n, 5000);
    expect(odd.splitBase + odd.treasuryBase).toBe(1001n);
    expect(odd.splitBase).toBe(500n);
  });

  it('handles 0% and 100% burn', () => {
    expect(splitAldrinAmount(1000n, 0)).toEqual({ splitBase: 0n, treasuryBase: 1000n });
    expect(splitAldrinAmount(1000n, 10000)).toEqual({ splitBase: 1000n, treasuryBase: 0n });
  });
});

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

describe('aldrin quote', () => {
  it('builds a quote whose splits cover the price and whose memo binds the tx', () => {
    const q = buildQuote({
      quoteId: 'abc123',
      accountId: 7,
      method: 'usdc',
      usdCents: 2000,
      mint: 'USDCmint',
      decimals: 6,
      priceBase: 20_000_000n, // 20 USDC at 6 decimals
      treasury: 'TREASURY',
      buyback: 'VAULT',
      burnBps: 5000,
      nowMs: T0,
      ttlSeconds: 600,
    });
    expect(q.memo).toBe('abc123');
    expect(BigInt(q.treasuryBase) + BigInt(q.splitBase)).toBe(20_000_000n);
    expect(q.splitBase).toBe('10000000');
    expect(q.expiresAt).toBe(new Date(T0 + 600_000).toISOString());
  });

  it('detects expiry', () => {
    const q = { expiresAt: new Date(T0 + 600_000).toISOString() };
    expect(quoteExpired(q, T0 + 100_000)).toBe(false);
    expect(quoteExpired(q, T0 + 700_000)).toBe(true);
  });
});

describe('usd to asset base conversion', () => {
  it('prices USDC 1:1, ceils SOL and WOC so it never underprices', () => {
    expect(usdCentsToAssetBase(2000, 1, 6)).toBe(20_000_000n); // 20 USDC
    expect(usdCentsToAssetBase(2000, 150, 9)).toBe(133_333_334n); // 20/150 SOL, ceiled
    expect(usdCentsToAssetBase(2000, 0.0004, 6)).toBe(50_000_000_000n); // 50k WOC at 6 decimals
    expect(usdCentsToAssetBase(2000, 0, 6)).toBe(0n); // bad price -> 0
  });
});

describe('on-chain payment verdict', () => {
  const usdcQuote: AldrinQuote = {
    quoteId: 'q1',
    accountId: 1,
    method: 'usdc',
    usdCents: 2000,
    mint: 'USDCmint',
    decimals: 6,
    priceBase: '20000000',
    treasury: 'TREASURY',
    buyback: 'VAULT',
    treasuryBase: '10000000',
    splitBase: '10000000',
    memo: 'q1',
    expiresAt: new Date(T0 + 600_000).toISOString(),
  };
  const good: ParsedOnchainPayment = {
    finalized: true,
    succeeded: true,
    usesToken2022: false,
    memoMatches: true,
    payerSpentBase: 20_000_000n,
    treasuryCreditedBase: 10_000_000n,
    buybackCreditedBase: 10_000_000n,
    burnedBase: 0n,
  };

  it('accepts a correct USDC split payment', () => {
    expect(verifyAldrinPayment(usdcQuote, good)).toEqual({ ok: true });
  });

  it('rejects each failure mode', () => {
    expect(verifyAldrinPayment(usdcQuote, { ...good, finalized: false }).ok).toBe(false);
    expect(verifyAldrinPayment(usdcQuote, { ...good, finalized: false })).toMatchObject({ reason: 'not_finalized' });
    expect(verifyAldrinPayment(usdcQuote, { ...good, succeeded: false })).toMatchObject({ reason: 'tx_failed' });
    expect(verifyAldrinPayment(usdcQuote, { ...good, usesToken2022: true })).toMatchObject({ reason: 'token_2022' });
    expect(verifyAldrinPayment(usdcQuote, { ...good, memoMatches: false })).toMatchObject({ reason: 'memo_mismatch' });
    expect(verifyAldrinPayment(usdcQuote, { ...good, payerSpentBase: 19_000_000n })).toMatchObject({ reason: 'underpaid' });
    expect(verifyAldrinPayment(usdcQuote, { ...good, treasuryCreditedBase: 9_000_000n })).toMatchObject({ reason: 'treasury_short' });
    expect(verifyAldrinPayment(usdcQuote, { ...good, buybackCreditedBase: 9_000_000n })).toMatchObject({ reason: 'buyback_short' });
  });

  it('requires an in-tx burn for a $WOC payment instead of a buyback credit', () => {
    const wocQuote: AldrinQuote = { ...usdcQuote, method: 'woc', mint: 'WOCmint', buyback: null };
    const wocGood: ParsedOnchainPayment = { ...good, buybackCreditedBase: 0n, burnedBase: 10_000_000n };
    expect(verifyAldrinPayment(wocQuote, wocGood)).toEqual({ ok: true });
    expect(verifyAldrinPayment(wocQuote, { ...wocGood, burnedBase: 0n })).toMatchObject({ reason: 'burn_missing' });
  });

  it('verifies a native SOL payment (network fee makes payer outflow larger, still valid)', () => {
    const solQuote: AldrinQuote = {
      ...usdcQuote,
      method: 'sol',
      mint: null,
      priceBase: '133333334',
      treasuryBase: '66666667',
      splitBase: '66666667',
    };
    const solGood: ParsedOnchainPayment = {
      finalized: true,
      succeeded: true,
      usesToken2022: false,
      memoMatches: true,
      payerSpentBase: 133_338_334n, // includes ~5000 lamport fee
      treasuryCreditedBase: 66_666_667n,
      buybackCreditedBase: 66_666_667n,
      burnedBase: 0n,
    };
    expect(verifyAldrinPayment(solQuote, solGood)).toEqual({ ok: true });
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

describe('stripe webhook verification', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const nowSec = Math.floor(T0 / 1000);
  const sign = (ts: number, payload: string) =>
    `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex')}`;

  it('accepts a correctly signed, fresh webhook', () => {
    expect(verifyStripeSignature(body, sign(nowSec, body), secret, nowSec)).toEqual({ ok: true });
  });

  it('rejects a tampered body, wrong secret, stale timestamp, and missing secret', () => {
    expect(verifyStripeSignature(body + 'x', sign(nowSec, body), secret, nowSec).ok).toBe(false);
    expect(verifyStripeSignature(body, sign(nowSec, body), 'whsec_other', nowSec).ok).toBe(false);
    expect(verifyStripeSignature(body, sign(nowSec - 10_000, body), secret, nowSec)).toMatchObject({
      reason: 'timestamp_out_of_tolerance',
    });
    expect(verifyStripeSignature(body, sign(nowSec, body), '', nowSec)).toMatchObject({ reason: 'no_secret' });
  });
});

describe('stripe event -> grant', () => {
  it('grants on a paid checkout session with our account ref', () => {
    const event = {
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', mode: 'subscription', client_reference_id: '42' } },
    };
    expect(grantFromStripeEvent(event)).toEqual({ accountId: 42, eventId: 'evt_2', autoRenew: true });
  });

  it('ignores unpaid sessions and unrelated events', () => {
    expect(
      grantFromStripeEvent({
        id: 'evt_3',
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'unpaid', client_reference_id: '42' } },
      }),
    ).toBeNull();
    expect(grantFromStripeEvent({ id: 'evt_4', type: 'customer.created', data: { object: {} } })).toBeNull();
  });
});
