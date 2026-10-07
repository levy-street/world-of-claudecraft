import { afterEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ query: vi.fn(), remote: vi.fn() }));
vi.mock('../../server/db', () => ({ pool: { query: io.query } }));
vi.mock('../../server/claudium_proxy', () => ({ callService: io.remote }));

import {
  configureMembershipBatchDatabase,
  loadMembershipBatch,
  membershipBatchAccountIds,
  parseMembershipSubscriptionBatch,
} from '../../server/membership_batch';
import { GAME_SUBSCRIPTION_PLAN, GAME_SUBSCRIPTION_PRICE } from '../../src/subscription_contract';

const row = (accountId: number) => ({
  accountId,
  available: true,
  plan: GAME_SUBSCRIPTION_PLAN,
  price: GAME_SUBSCRIPTION_PRICE,
  status: 'active',
  currentPeriodEnd: 100,
  cancelAtPeriodEnd: false,
  canCheckout: false,
  canManage: true,
});
afterEach(() => {
  configureMembershipBatchDatabase(null);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('bounded membership batch hydration', () => {
  it('rejects malformed batches and repeated or unrequested response identities', () => {
    expect(() => membershipBatchAccountIds(Array.from({ length: 251 }, (_, i) => i + 1))).toThrow();
    expect(() => membershipBatchAccountIds([0])).toThrow();
    expect(membershipBatchAccountIds([1, 1, 2])).toEqual([1, 2]);
    for (const subscriptions of [[row(1)], [row(1), row(1)], [row(1), row(3)]]) {
      expect(
        parseMembershipSubscriptionBatch({ available: true, subscriptions }, [1, 2]),
      ).toBeNull();
    }
  });

  it('serves 250 accounts with one admitted SQL query and one remote batch request', async () => {
    vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '1');
    const admit = vi.fn();
    configureMembershipBatchDatabase(async (job) => {
      admit();
      return job();
    });
    io.query.mockResolvedValue({ rows: [{ account_id: 1, prepaid_until: new Date(200_000) }] });
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    io.remote.mockResolvedValue({ available: true, subscriptions: ids.map(row) });
    const values = await loadMembershipBatch(ids);
    expect(values.size).toBe(250);
    expect(values.get(1)?.prepaid).toBe(200_000);
    expect(values.get(250)?.recurring?.status).toBe('active');
    expect(admit).toHaveBeenCalledOnce();
    expect(io.query).toHaveBeenCalledWith(expect.stringContaining('account_id = ANY($1::int[])'), [
      ids,
    ]);
    expect(io.remote).toHaveBeenCalledWith({
      method: 'POST',
      path: 'subscriptions/batch',
      body: { accountIds: ids },
      timeoutMs: 5000,
    });
    expect(io.query).toHaveBeenCalledOnce();
  });

  it('keeps locally prepaid grants when the external service is unavailable', async () => {
    vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '1');
    configureMembershipBatchDatabase(async (job) => job());
    io.query.mockResolvedValue({ rows: [{ account_id: 1, prepaid_until: new Date(200_000) }] });
    io.remote.mockResolvedValue(null);
    expect((await loadMembershipBatch([1])).get(1)).toMatchObject({
      prepaid: 200_000,
      recurring: null,
    });
  });

  it('cannot bypass the shared database gate when boot wiring is missing', async () => {
    await expect(loadMembershipBatch([1])).rejects.toThrow('admission');
    expect(io.query).not.toHaveBeenCalled();
  });
});
