import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  const query = vi.fn();
  return {
    query,
    resolve: vi.fn(),
    existing: false,
    expired: false,
    client: { query, release: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: h.query, connect: async () => h.client };
  }),
}));
vi.mock('../server/referral_armour_db', async (original) => ({
  ...(await original<typeof import('../server/referral_armour_db')>()),
  resolveReferralSignup: h.resolve,
}));
vi.mock('../server/community_test_accounts', () => ({ communityTestAccountsEnabled: () => false }));

import { handleAppleLoginNew } from '../server/apple_auth';
import { handleDiscordLoginNew } from '../server/discord';
import { resetDiscordRateLimits, resetRateLimits } from '../server/ratelimit';
import { FakeRes } from './server/helpers';

const referral = {
  referrerAccountId: 9,
  slug: 'friend',
  inviterName: 'Friend',
  memberEligible: false,
};
beforeEach(() => {
  resetRateLimits();
  resetDiscordRateLimits();
  h.existing = false;
  h.expired = false;
  h.resolve.mockReset().mockResolvedValue(referral);
  h.query.mockReset().mockImplementation(async (sql: string) => {
    if (
      sql.includes('DELETE FROM apple_pending_logins') ||
      sql.includes('DELETE FROM discord_pending_logins')
    )
      return {
        rows: h.expired
          ? []
          : [
              {
                apple_subject: 'apple-id',
                display_name: 'New',
                apple_email: null,
                discord_user_id: '111111111111111111',
                discord_username: 'New',
                discord_avatar: null,
                discord_email: null,
                discord_email_verified: false,
                guild_member: false,
              },
            ],
        rowCount: h.expired ? 0 : 1,
      };
    if (
      sql.includes('SELECT account_id FROM apple_auth_links') ||
      sql.includes('SELECT account_id FROM discord_links')
    )
      return { rows: h.existing ? [{ account_id: 5 }] : [], rowCount: h.existing ? 1 : 0 };
    if (sql.includes('INSERT INTO accounts'))
      return { rows: [{ id: 5, username: 'New' }], rowCount: 1 };
    if (sql.includes('INSERT INTO reward_ledger')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('INSERT INTO reward_points'))
      return { rows: [{ points: '250', lifetime_points: '250' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
});
async function signup(provider: 'apple' | 'discord') {
  const body = { linkToken: 'verified-choice', ref: 'friend' };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    headers: { host: 'worldofclaudecraft.com' },
    socket: { remoteAddress: '127.0.0.1' },
  });
  const res = new FakeRes();
  if (provider === 'apple') await handleAppleLoginNew(req as never, res as never, body);
  else await handleDiscordLoginNew(req as never, res as never, () => false);
  return res;
}
describe.each(['apple', 'discord'] as const)('%s referred new account', (provider) => {
  it('commits attribution with the fresh account after consuming the verified identity', async () => {
    const res = await signup(provider);
    expect(res.statusCode).toBe(200);
    expect(h.resolve).toHaveBeenCalledExactlyOnceWith('friend');
    const calls = h.query.mock.calls.map(([sql]) => sql as string);
    const account = calls.findIndex((sql) => sql.includes('INSERT INTO accounts'));
    const attribution = calls.findIndex((sql) => sql.includes('INSERT INTO referrals'));
    expect(calls.indexOf('BEGIN')).toBeLessThan(account);
    expect(attribution).toBeGreaterThan(account);
    expect(calls.indexOf('COMMIT')).toBeGreaterThan(attribution);
    expect(h.query.mock.calls[attribution][1]).toEqual([5, 9, 'friend', false, 'Friend']);
  });
  it('never resolves or applies a referral to an existing provider account', async () => {
    h.existing = true;
    expect((await signup(provider)).statusCode).toBe(200);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.query.mock.calls.some(([sql]) => /INSERT INTO (accounts|referrals)/.test(sql))).toBe(
      false,
    );
  });
  it('never creates an unlinked account when attribution resolution fails', async () => {
    h.resolve.mockRejectedValueOnce(new Error('attribution unavailable'));
    await signup(provider).catch(() => undefined);
    expect(h.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO accounts'))).toBe(false);
  });
  it('rejects expired identity tokens before resolving a referral', async () => {
    h.expired = true;
    expect((await signup(provider)).statusCode).toBe(400);
    expect(h.resolve).not.toHaveBeenCalled();
  });
});
