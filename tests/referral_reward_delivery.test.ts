import { describe, expect, it, vi } from 'vitest';
import {
  ReferralRewardDelivery,
  type ReferralRewardDeliveryHost,
} from '../server/referral_reward_delivery';
import type { PgReferralStore } from '../server/referral_store_db';

describe('referral reward delivery', () => {
  it('consumes durable first-payment feed while no referred account is online', async () => {
    const receipts = [
      {
        cursor: '1',
        accountId: 20,
        firstPaid: {
          receiptId: 'offline_paid',
          paidAtMs: 1,
          plan: 'game_monthly' as const,
          reversed: false,
        },
      },
    ];
    const bookMembershipFeed = vi.fn(async () => true);
    const store = {
      membershipFeedCursor: async () => '0',
      bookMembershipFeed,
      claimRewards: async () => [],
      claimBonds: async () => [],
    };
    let permits = 0;
    const host: ReferralRewardDeliveryHost = {
      realm: 'test',
      membershipRecipient: () => null,
      withPermit: async (run) => {
        permits++;
        try {
          return await run();
        } finally {
          permits--;
        }
      },
      applyEntitlements: () => {},
      deliverMembershipBond: async () => false,
      observeCost: () => {},
      onError: vi.fn(),
    };
    const firstPaidFeed = vi.fn(async () => {
      expect(permits).toBe(0);
      return { nextCursor: '1', receipts };
    });
    const delivery = new ReferralRewardDelivery(host, store as unknown as PgReferralStore, {
      firstPaidFeed,
      firstPaidBatch: async () => null,
      grantClaudium: async () => false,
    });
    try {
      await delivery.pump();
      expect(firstPaidFeed).toHaveBeenCalledWith('0', 25);
      expect(bookMembershipFeed).toHaveBeenCalledWith('test', '0', '1', receipts);
    } finally {
      await delivery.stop();
    }
  });
  it('retries unavailable currency without marking delivered or granting a different policy', async () => {
    const grantClaudium = vi.fn(async () => false);
    const store = {
      membershipCandidates: vi.fn(async () => []),
      claimRewards: vi.fn(async () => [
        { accountId: 123, tier: 3, receipt: 'referral:123:tier:3' },
      ]),
      settleReward: vi.fn(async () => 4),
      claimBonds: vi.fn(async () => []),
    };
    const host: ReferralRewardDeliveryHost = {
      realm: 'test',
      membershipRecipient: () => null,
      withPermit: async (run) => run(),
      applyEntitlements: vi.fn(),
      deliverMembershipBond: async () => false,
      observeCost: () => {},
      onError: vi.fn(),
    };
    const delivery = new ReferralRewardDelivery(host, store as unknown as PgReferralStore, {
      grantClaudium,
      firstPaidBatch: async () => null,
    });
    try {
      await delivery.pump();
      expect(grantClaudium).toHaveBeenCalledWith(123, 3, 'referral_123_tier_3');
      expect(store.settleReward).not.toHaveBeenCalled();
      grantClaudium.mockResolvedValue(true);
      await delivery.pump();
      expect(store.settleReward).toHaveBeenCalledOnce();
      expect(host.applyEntitlements).toHaveBeenCalledWith(123, 4);
    } finally {
      delivery.stop();
    }
  });
  it('never holds a database permit across HTTP or membership delivery and books first paid before issuing a bond', async () => {
    let permits = 0;
    const calls: string[] = [];
    const host: ReferralRewardDeliveryHost = {
      realm: 'test',
      membershipRecipient: () => ({ characterId: 100, name: 'Inviter', realm: 'test' }),
      withPermit: async (run) => {
        permits++;
        try {
          return await run();
        } finally {
          permits--;
        }
      },
      applyEntitlements: () => {},
      deliverMembershipBond: async (account, receipt) => {
        expect(permits).toBe(0);
        calls.push(`deliver:${account}:${receipt}`);
        return true;
      },
      observeCost: () => {},
      onError: vi.fn(),
    };
    const store = {
      membershipCandidates: async () => [20],
      bookMembershipBond: async () => {
        calls.push('book');
      },
      claimRewards: async () => [],
      claimBonds: async () => [
        { linkId: 20, accountId: 10, receipt: 'referral_membership_bond_20', recipient: null },
      ],
      bindBondRecipient: async () => ({ characterId: 100, name: 'Inviter', realm: 'test' }),
      settleBond: async () => {
        calls.push('settle');
      },
    };
    const delivery = new ReferralRewardDelivery(host, store as unknown as PgReferralStore, {
      firstPaidBatch: async () => {
        expect(permits).toBe(0);
        return new Map([
          [
            20,
            {
              receiptId: 'paid_receipt',
              paidAtMs: 1,
              plan: 'game_monthly' as const,
              reversed: false,
            },
          ],
        ]);
      },
      grantClaudium: async () => true,
    });
    try {
      delivery.attach(20);
      await delivery.pump();
      expect(calls).toEqual(['book', 'deliver:10:referral_membership_bond_20', 'settle']);
    } finally {
      delivery.stop();
    }
  });
  it.each(['unavailable', 'missing', 'reversed'] as const)(
    'does not book membership from %s first payment evidence',
    async (kind) => {
      const bookMembershipBond = vi.fn();
      const host: ReferralRewardDeliveryHost = {
        realm: 'test',
        membershipRecipient: () => null,
        withPermit: async (run) => run(),
        applyEntitlements: () => {},
        deliverMembershipBond: async () => false,
        observeCost: () => {},
        onError: vi.fn(),
      };
      const store = {
        membershipCandidates: async () => [20],
        bookMembershipBond,
        claimRewards: async () => [],
        claimBonds: async () => [],
      };
      const delivery = new ReferralRewardDelivery(host, store as unknown as PgReferralStore, {
        firstPaidBatch: async () =>
          kind === 'unavailable'
            ? null
            : kind === 'missing'
              ? new Map()
              : new Map([
                  [
                    20,
                    { receiptId: 'r', paidAtMs: 1, plan: 'game_monthly' as const, reversed: true },
                  ],
                ]),
        grantClaudium: async () => false,
      });
      try {
        delivery.attach(20);
        await delivery.pump();
        expect(bookMembershipBond).not.toHaveBeenCalled();
      } finally {
        delivery.stop();
      }
    },
  );
  it('waits for an in-flight network call at shutdown and leaves its reward retryable', async () => {
    let resolve: (value: boolean) => void = () => {};
    let began: () => void = () => {};
    const called = new Promise<void>((done) => {
      began = done;
    });
    const store = {
      claimRewards: async () => [{ accountId: 123, tier: 3, receipt: 'referral:123:tier:3' }],
      settleReward: vi.fn(),
      claimBonds: vi.fn(),
    };
    const host: ReferralRewardDeliveryHost = {
      realm: 'test',
      membershipRecipient: () => null,
      withPermit: async (run) => run(),
      applyEntitlements: () => {},
      deliverMembershipBond: async () => false,
      observeCost: () => {},
      onError: vi.fn(),
    };
    const delivery = new ReferralRewardDelivery(host, store as unknown as PgReferralStore, {
      firstPaidBatch: async () => null,
      grantClaudium: () =>
        new Promise((done) => {
          resolve = done;
          began();
        }),
    });
    const running = delivery.pump();
    await called;
    let stopped = false;
    const stop = delivery.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolve(true);
    await running;
    await stop;
    expect(store.settleReward).not.toHaveBeenCalled();
    expect(store.claimBonds).not.toHaveBeenCalled();
  });
});
