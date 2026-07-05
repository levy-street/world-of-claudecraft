// Pure-view tests for the Aldrin Club membership panel (src/ui/aldrin_club_view.ts):
// member and non-member states, the fail-closed disabled state, per-method
// availability gating (signMessage-only wallet, unconfigured rails, Stripe
// advertisement), and the quote render model (amounts, split percents, static
// expiry countdown). The core is deterministic: nowMs is injected, so every
// assertion here is same-input-same-output.

import { describe, expect, it } from 'vitest';
import {
  ALDRIN_METHOD_ORDER,
  type AldrinQuoteInput,
  type AldrinStatusInput,
  type AldrinViewInput,
  buildAldrinClubModel,
} from '../src/ui/aldrin_club_view';

const NOW = Date.parse('2026-07-05T12:00:00Z');
const DAY_MS = 86_400_000;

function status(overrides: Partial<AldrinStatusInput> = {}): AldrinStatusInput {
  return {
    enabled: true,
    priceUsdCents: 2000,
    periodDays: 30,
    burnBps: 5000,
    methods: ['sol', 'usdc', 'woc', 'stripe'],
    perks: [
      { id: 'aura', kind: 'cosmetic' },
      { id: 'lounge', kind: 'access' },
      { id: 'queue', kind: 'convenience' },
    ],
    membership: null,
    ...overrides,
  };
}

function input(overrides: Partial<AldrinViewInput> = {}): AldrinViewInput {
  return {
    status: status(),
    quote: null,
    walletCanSignTransactions: false,
    stripeEnabled: true,
    nowMs: NOW,
    ...overrides,
  };
}

function quote(overrides: Partial<AldrinQuoteInput> = {}): AldrinQuoteInput {
  return {
    method: 'usdc',
    decimals: 6,
    priceBase: '20000000',
    treasuryBase: '10000000',
    splitBase: '10000000',
    memo: 'a1b2c3d4e5f60718a1b2c3d4e5f60718',
    expiresAt: new Date(NOW + 600_000).toISOString(),
    ...overrides,
  };
}

describe('membership state', () => {
  it('renders a non-member with the price, split, and perk list', () => {
    const m = buildAldrinClubModel(input());
    expect(m.enabled).toBe(true);
    expect(m.member).toBe(false);
    expect(m.memberUntilISO).toBeNull();
    expect(m.memberDaysRemaining).toBe(0);
    expect(m.priceUsdCents).toBe(2000);
    expect(m.periodDays).toBe(30);
    expect(m.burnPct).toBe(50);
    expect(m.treasuryPct).toBe(50);
    expect(m.perks.map((p) => p.id)).toEqual(['aura', 'lounge', 'queue']);
  });

  it('renders an active member with until date and remaining days from the injected clock', () => {
    const until = new Date(NOW + 10 * DAY_MS).toISOString();
    const m = buildAldrinClubModel(
      input({
        status: status({
          membership: {
            active: true,
            since: '2026-01-05T12:00:00Z',
            until,
            daysRemaining: 999, // stale server figure; the view recomputes
            autoRenew: true,
            lastMethod: 'stripe',
          },
        }),
      }),
    );
    expect(m.member).toBe(true);
    expect(m.memberUntilISO).toBe(until);
    expect(m.memberDaysRemaining).toBe(10);
    expect(m.autoRenew).toBe(true);
  });

  it('treats an expired membership as not a member even if the snapshot says active', () => {
    const m = buildAldrinClubModel(
      input({
        status: status({
          membership: {
            active: true, // stale
            since: '2026-01-05T12:00:00Z',
            until: new Date(NOW - 1000).toISOString(),
            daysRemaining: 1,
            autoRenew: false,
            lastMethod: 'usdc',
          },
        }),
      }),
    );
    expect(m.member).toBe(false);
    expect(m.memberUntilISO).toBeNull();
    expect(m.memberDaysRemaining).toBe(0);
  });
});

describe('disabled state (fail-closed default)', () => {
  it('a null status disables the club and every method', () => {
    const m = buildAldrinClubModel(input({ status: null, walletCanSignTransactions: true }));
    expect(m.enabled).toBe(false);
    expect(m.member).toBe(false);
    expect(m.perks).toEqual([]);
    expect(m.quote).toBeNull();
    expect(m.methods.map((mm) => mm.method)).toEqual([...ALDRIN_METHOD_ORDER]);
    for (const mm of m.methods) {
      expect(mm.available).toBe(false);
      expect(mm.reason).toBe('clubDisabled');
    }
  });

  it('an enabled:false status is treated exactly like a missing one', () => {
    const m = buildAldrinClubModel(
      input({ status: status({ enabled: false }), quote: quote(), stripeEnabled: true }),
    );
    expect(m.enabled).toBe(false);
    expect(m.quote).toBeNull();
    for (const mm of m.methods) expect(mm.reason).toBe('clubDisabled');
  });
});

describe('method gating', () => {
  it('blocks every crypto method when the wallet cannot sign transactions (this branch)', () => {
    const m = buildAldrinClubModel(input({ walletCanSignTransactions: false }));
    const by = Object.fromEntries(m.methods.map((mm) => [mm.method, mm]));
    for (const crypto of ['sol', 'usdc', 'woc'] as const) {
      expect(by[crypto].available).toBe(false);
      expect(by[crypto].reason).toBe('walletCannotSign');
    }
    expect(by.stripe.available).toBe(true);
    expect(by.stripe.reason).toBeNull();
  });

  it('offers crypto methods only when the wallet can sign AND the server configured them', () => {
    const m = buildAldrinClubModel(
      input({
        walletCanSignTransactions: true,
        status: status({ methods: ['usdc', 'woc'] }), // sol payees not configured
      }),
    );
    const by = Object.fromEntries(m.methods.map((mm) => [mm.method, mm]));
    expect(by.sol.available).toBe(false);
    expect(by.sol.reason).toBe('notConfigured');
    expect(by.usdc.available).toBe(true);
    expect(by.woc.available).toBe(true);
  });

  it('stripe needs both the server advertisement and the client flag (fail-closed AND)', () => {
    const advertisedOnly = buildAldrinClubModel(input({ stripeEnabled: false }));
    expect(advertisedOnly.methods.find((mm) => mm.method === 'stripe')).toMatchObject({
      available: false,
      reason: 'notConfigured',
    });
    const flagOnly = buildAldrinClubModel(
      input({ stripeEnabled: true, status: status({ methods: ['sol', 'usdc', 'woc'] }) }),
    );
    expect(flagOnly.methods.find((mm) => mm.method === 'stripe')).toMatchObject({
      available: false,
      reason: 'notConfigured',
    });
  });
});

describe('quote model', () => {
  it('scales base units by decimals and derives the split percents from the quote itself', () => {
    const m = buildAldrinClubModel(input({ quote: quote() }));
    expect(m.quote).not.toBeNull();
    expect(m.quote?.method).toBe('usdc');
    expect(m.quote?.amountUnits).toBeCloseTo(20, 9);
    expect(m.quote?.treasuryUnits).toBeCloseTo(10, 9);
    expect(m.quote?.burnUnits).toBeCloseTo(10, 9);
    expect(m.quote?.treasuryPct).toBe(50);
    expect(m.quote?.burnPct).toBe(50);
    expect(m.quote?.memo).toBe('a1b2c3d4e5f60718a1b2c3d4e5f60718');
  });

  it('reports the static countdown against the injected clock', () => {
    const m = buildAldrinClubModel(input({ quote: quote() }));
    expect(m.quote?.expired).toBe(false);
    expect(m.quote?.expiresInSeconds).toBe(600);
  });

  it('marks a past-expiry quote expired with a zero countdown', () => {
    const m = buildAldrinClubModel(
      input({ quote: quote({ expiresAt: new Date(NOW - 1).toISOString() }) }),
    );
    expect(m.quote?.expired).toBe(true);
    expect(m.quote?.expiresInSeconds).toBe(0);
  });

  it('drops a quote with an unknown method or when the club is disabled', () => {
    expect(buildAldrinClubModel(input({ quote: quote({ method: 'doge' }) })).quote).toBeNull();
    expect(buildAldrinClubModel(input({ status: null, quote: quote() })).quote).toBeNull();
  });

  it('is deterministic: the same input yields the same model', () => {
    const a = buildAldrinClubModel(input({ quote: quote() }));
    const b = buildAldrinClubModel(input({ quote: quote() }));
    expect(a).toEqual(b);
  });
});
