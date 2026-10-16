import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: fake.query, connect: fake.connect } }));
vi.mock('../server/membership_service', () => ({ getMembership: vi.fn() }));
vi.mock('../server/community_test_accounts', () => ({ communityTestAccountsEnabled: () => false }));
vi.mock('../server/discord_link_changes', () => ({ enqueueLinkChange: vi.fn() }));

import { createAccount } from '../server/account_create_db';

const referral = {
  referrerAccountId: 9,
  slug: 'a'.repeat(32),
  memberEligible: false,
  inviterName: '',
};
beforeEach(() => {
  fake.query.mockReset().mockImplementation(async (sql) => ({
    rows: sql.startsWith('INSERT INTO accounts') ? [{ id: 42, username: 'New' }] : [],
  }));
  fake.release.mockReset();
  fake.connect.mockReset().mockResolvedValue({
    query: fake.query,
    release: fake.release,
    on: vi.fn(),
    removeListener: vi.fn(),
  });
});

describe('atomic referred registration', () => {
  it('commits the new account and immutable referral together before returning the account', async () => {
    expect(await createAccount('New', 'hash', {}, { referral })).toMatchObject({ id: 42 });
    const statements = fake.query.mock.calls.map(([sql]) => sql as string);
    const account = statements.findIndex((sql) => sql.startsWith('INSERT INTO accounts'));
    const attribution = statements.findIndex((sql) => sql.startsWith('INSERT INTO referrals'));
    expect(statements[0]).toBe('BEGIN');
    expect(attribution).toBeGreaterThan(account);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(fake.query.mock.calls[attribution][1]).toEqual([42, 9, 'a'.repeat(32), false, '']);
    expect(fake.release).toHaveBeenCalledOnce();
  });
  it('rolls account creation back if referral persistence fails', async () => {
    fake.query.mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT INTO referrals'))
        throw Object.assign(new Error('failed attribution'), { code: '23503' });
      return { rows: sql.startsWith('INSERT INTO accounts') ? [{ id: 42 }] : [] };
    });
    await expect(createAccount('New', 'hash', {}, { referral })).rejects.toThrow(
      'failed attribution',
    );
    expect(fake.query).toHaveBeenLastCalledWith('ROLLBACK', undefined);
    expect(fake.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(fake.release).toHaveBeenCalledOnce();
  });
  it('preserves the ordinary single-statement account create when no referral was supplied', async () => {
    expect(await createAccount('New', 'hash')).toMatchObject({ id: 42 });
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.query).toHaveBeenCalledOnce();
  });
});
