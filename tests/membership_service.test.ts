import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/membership_db', () => ({ prepaidMembershipExpiresAt: vi.fn() }));
vi.mock('../server/subscription_proxy', () => ({ gameSubscriptionSnapshot: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: vi.fn() } }));

import {
  createMembershipService,
  MEMBERSHIP_AUTHORIZATION_MS,
  MEMBERSHIP_CACHE_MAX_ENTRIES,
  MEMBERSHIP_CACHE_TTL_MS,
  trustedRecurringMembershipExpiry,
} from '../server/membership_service';
import { membershipCharacterLimit, membershipCharacterLocked } from '../src/membership_contract';
import { SUBSCRIPTION_OFF } from '../src/subscription_contract';

describe('account membership authority', () => {
  it('retains an unavailable batch subscription only to its original deadline independently of fresh prepaid time', async () => {
    let now = 1000;
    let prepaid: number | null = null;
    const service = createMembershipService({
      now: () => now,
      prepaid: async () => null,
      recurring: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        status: 'active',
        currentPeriodEnd: 1000,
      }),
      batch: async (ids) => new Map(ids.map((id) => [id, { prepaid, recurring: null }])),
    });
    expect((await service.get(1)).active).toBe(true);
    now = 20_000;
    expect((await service.getBatch([1])).get(1)).toMatchObject({
      active: true,
      authorizedUntil: 61_000,
    });
    now = 40_000;
    prepaid = 1_000_000;
    const refreshed = (await service.getBatch([1])).get(1);
    expect(refreshed).toMatchObject({
      active: true,
      authorizedUntil: 100_000,
      recurringAuthorizedUntil: 61_000,
    });
    expect(trustedRecurringMembershipExpiry(refreshed!, 62_000)).toBeNull();
    now = 70_000;
    prepaid = null;
    expect((await service.getBatch([1])).get(1)?.active).toBe(false);
  });
  it('accepts paid subscriptions and verified trials with a finite future period end', async () => {
    for (const status of ['active', 'trialing', 'past_due', 'canceled'] as const) {
      const service = createMembershipService({
        now: () => 1000,
        prepaid: async () => null,
        recurring: async () => ({
          ...SUBSCRIPTION_OFF,
          available: true,
          status,
          currentPeriodEnd: 100,
        }),
      });
      expect((await service.get(1)).active).toBe(status === 'active' || status === 'trialing');
    }
    for (const currentPeriodEnd of [null, Infinity, 1]) {
      const service = createMembershipService({
        now: () => 1000,
        prepaid: async () => null,
        recurring: async () => ({
          ...SUBSCRIPTION_OFF,
          available: true,
          status: 'active',
          currentPeriodEnd,
        }),
      });
      expect((await service.get(1)).active).toBe(false);
    }
  });

  it('ends trial authority at its exact deadline and honors a verified cancellation', async () => {
    let now = 1000;
    let status: 'trialing' | 'canceled' = 'trialing';
    const service = createMembershipService({
      now: () => now,
      prepaid: async () => null,
      recurring: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        status,
        currentPeriodEnd: 40,
      }),
    });
    expect((await service.get(1)).active).toBe(true);
    now = 40_000;
    expect((await service.get(1)).active).toBe(false);
    now = 1000;
    expect((await service.get(2)).active).toBe(true);
    status = 'canceled';
    service.bust(2);
    expect((await service.get(2)).active).toBe(false);
  });

  it('keeps prepaid time available during billing outages and uses the later end', async () => {
    const service = createMembershipService({
      now: () => 1000,
      prepaid: async () => 90_000,
      recurring: async () => {
        throw new Error('unavailable');
      },
    });
    expect(await service.get(1)).toMatchObject({ active: true, expiresAt: 90_000 });
    const both = createMembershipService({
      now: () => 1000,
      prepaid: async () => 90_000,
      recurring: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        status: 'active',
        currentPeriodEnd: 100,
      }),
    });
    expect((await both.get(1)).expiresAt).toBe(100_000);
  });

  it('single-flights reads, expires benefits on time, and refuses stale authority on failure', async () => {
    let now = 1000;
    const prepaid = vi.fn(async () => 5000);
    const service = createMembershipService({
      now: () => now,
      prepaid,
      recurring: async () => SUBSCRIPTION_OFF,
    });
    await Promise.all([service.get(1), service.get(1)]);
    expect(prepaid).toHaveBeenCalledTimes(1);
    now = 5000;
    expect((await service.get(1)).active).toBe(false);
    expect(prepaid).toHaveBeenCalledTimes(1);
    now = 1000 + MEMBERSHIP_CACHE_TTL_MS;
    prepaid.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await service.get(1)).active).toBe(false);
    warn.mockRestore();
  });

  it('bounds cached authority to one minute even when the purchased period is much longer', async () => {
    let now = 1000;
    const prepaid = vi.fn(async () => 1_000_000);
    const service = createMembershipService({
      now: () => now,
      prepaid,
      recurring: async () => SUBSCRIPTION_OFF,
    });
    expect((await service.get(1)).active).toBe(true);
    prepaid.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      now = 1000 + MEMBERSHIP_CACHE_TTL_MS;
      expect((await service.get(1)).active).toBe(true);
      now = 1000 + MEMBERSHIP_AUTHORIZATION_MS;
      expect((await service.get(1)).active).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not authorize an in-flight snapshot after a membership bust', async () => {
    let resolve!: (value: number) => void;
    const prepaid = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(null);
    const service = createMembershipService({
      now: () => 1000,
      prepaid,
      recurring: async () => SUBSCRIPTION_OFF,
    });
    const old = service.get(1);
    service.bust(1);
    expect((await service.get(1)).active).toBe(false);
    resolve(100_000);
    expect((await old).active).toBe(false);
    expect((await service.get(1)).active).toBe(false);
  });

  it('bounds cache retention under an account scan', async () => {
    const service = createMembershipService({
      now: () => 1000,
      prepaid: async () => null,
      recurring: async () => SUBSCRIPTION_OFF,
    });
    for (let account = 0; account <= MEMBERSHIP_CACHE_MAX_ENTRIES; account++)
      await service.get(account);
    expect(service.stats().entries).toBe(MEMBERSHIP_CACHE_MAX_ENTRIES);
    expect(service.stats().evictions).toBe(1);
  });

  it('keeps extra character identity locked after expiry and permits renewal', () => {
    const paid = { active: true, expiresAt: 5000 };
    expect(membershipCharacterLimit(paid, 1000)).toBe(20);
    expect(membershipCharacterLimit(paid, 5000)).toBe(10);
    expect(membershipCharacterLocked(true, paid, 5000)).toBe(true);
    expect(membershipCharacterLocked(false, paid, 5000)).toBe(false);
    expect(membershipCharacterLocked(true, paid, 1000)).toBe(false);
  });

  it('shares one bulk hydration with individual readers and does not renew stale authority', async () => {
    let now = 1000;
    let resolve!: (
      value: Map<number, { prepaid: number; recurring: typeof SUBSCRIPTION_OFF }>,
    ) => void;
    const batch = vi.fn(
      () =>
        new Promise<Map<number, { prepaid: number; recurring: typeof SUBSCRIPTION_OFF }>>(
          (done) => {
            resolve = done;
          },
        ),
    );
    const prepaid = vi.fn(async () => null);
    const service = createMembershipService({
      now: () => now,
      prepaid,
      recurring: async () => SUBSCRIPTION_OFF,
      batch,
    });
    const bulk = service.getBatch([1, 2]);
    const individual = service.get(1);
    resolve(new Map([1, 2].map((id) => [id, { prepaid: 1_000_000, recurring: SUBSCRIPTION_OFF }])));
    expect((await bulk).get(2)?.active).toBe(true);
    expect((await individual).active).toBe(true);
    expect(prepaid).not.toHaveBeenCalled();
    now += MEMBERSHIP_CACHE_TTL_MS;
    batch.mockRejectedValue(new Error('offline'));
    expect((await service.getBatch([1, 2])).get(1)?.active).toBe(true);
    now = 1000 + MEMBERSHIP_AUTHORIZATION_MS;
    expect((await service.getBatch([1, 2])).get(1)?.active).toBe(false);
  });

  it('invalidates a bulk flight after a targeted bust without touching another account', async () => {
    let resolve!: (
      value: Map<number, { prepaid: number; recurring: typeof SUBSCRIPTION_OFF }>,
    ) => void;
    const service = createMembershipService({
      now: () => 1000,
      prepaid: async () => null,
      recurring: async () => SUBSCRIPTION_OFF,
      batch: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const bulk = service.getBatch([1, 2]);
    service.bust(1);
    resolve(new Map([1, 2].map((id) => [id, { prepaid: 1_000_000, recurring: SUBSCRIPTION_OFF }])));
    const result = await bulk;
    expect(result.get(1)?.active).toBe(false);
    expect(result.get(2)?.active).toBe(true);
    expect((await service.get(1)).active).toBe(false);
  });
});
