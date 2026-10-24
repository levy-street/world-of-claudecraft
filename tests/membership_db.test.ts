import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ pool: {} }));

import {
  extendPrepaidMembershipOnClient,
  membershipExpiresAtOnClient,
} from '../server/membership_db';
import { MEMBERSHIP_ITEM_DURATION_MS } from '../src/membership_contract';

describe('prepaid membership transaction primitives', () => {
  const query = vi.fn();
  const client = { query } as unknown as PoolClient;
  beforeEach(() => query.mockReset());

  it.each([
    { prepaid: null, recurring: null, expected: 1000 },
    { prepaid: new Date(2000), recurring: null, expected: 2000 },
    { prepaid: new Date(2000), recurring: 5000, expected: 5000 },
    { prepaid: new Date(500), recurring: 500, expected: 1000 },
  ])(
    'adds exactly 30 days after the latest unexpired source: $expected',
    async ({ prepaid, recurring, expected }) => {
      query
        .mockResolvedValueOnce({ rows: prepaid === null ? [] : [{ prepaid_until: prepaid }] })
        .mockResolvedValueOnce({ rows: [] });
      const expiry = await extendPrepaidMembershipOnClient(client, 7, recurring, 1000);
      expect(expiry).toBe(expected + MEMBERSHIP_ITEM_DURATION_MS);
      expect(query.mock.calls[1][1]).toEqual([7, new Date(expiry)]);
      expect(query.mock.calls.flat().join(' ')).not.toMatch(/COMMIT|BEGIN/);
    },
  );

  it('reads only the account membership row, using a bound account id', async () => {
    query.mockResolvedValue({ rows: [{ prepaid_until: '1970-01-01T00:00:05.000Z' }] });
    expect(await membershipExpiresAtOnClient(client, 7, Infinity)).toBe(5000);
    expect(query).toHaveBeenCalledWith(
      'SELECT prepaid_until FROM account_memberships WHERE account_id = $1',
      [7],
    );
  });
});
