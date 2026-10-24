import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ query: vi.fn(), membership: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: fake.query } }));
vi.mock('../server/membership_service', () => ({ getMembership: fake.membership }));

import { referralCapacityEarned } from '../server/referral_account_entitlements_db';
import { recordReferralOnClient, resolveReferralSignup } from '../server/referral_armour_db';
import { getOrCreateReferralInvite, referralInviteOwner } from '../server/referral_invites_db';

beforeEach(() => {
  fake.query.mockReset().mockResolvedValue({ rows: [] });
  fake.membership
    .mockReset()
    .mockResolvedValue({ active: false, authorizedUntil: 0, expiresAt: null });
});

describe('account referral invitations', () => {
  it('returns an existing lifetime token with one read', async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ token: 'a'.repeat(32) }] });
    expect(await getOrCreateReferralInvite(10)).toBe('a'.repeat(32));
    expect(fake.query).toHaveBeenCalledOnce();
  });
  it('creates an unguessable lowercase token without requiring a player card', async () => {
    fake.query.mockImplementation(async (sql, values) => ({
      rows: sql.startsWith('INSERT') ? [{ token: values[1] }] : [],
    }));
    expect(await getOrCreateReferralInvite(10)).toMatch(/^[a-f0-9]{32}$/);
    expect(fake.query.mock.calls[1][0]).toContain('ON CONFLICT (account_id) DO NOTHING');
    expect(fake.query.mock.calls.some(([sql]) => sql.includes('player_cards'))).toBe(false);
  });
  it('returns the winning lifetime token when two requests race', async () => {
    fake.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ token: 'b'.repeat(32) }] });
    expect(await getOrCreateReferralInvite(10)).toBe('b'.repeat(32));
  });
  it('resolves a token for an account with no characters and preserves existing membership armour eligibility', async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ account_id: 10, name: '' }] });
    const referral = await resolveReferralSignup('A'.repeat(32));
    expect(referral).toEqual({
      referrerAccountId: 10,
      slug: 'a'.repeat(32),
      memberEligible: false,
      inviterName: '',
    });
    expect(fake.query).toHaveBeenCalledOnce();
  });
  it('accepts a legacy published-card slug and rejects malformed attribution without DB reads', async () => {
    expect(await referralInviteOwner('not a token')).toBeNull();
    expect(await resolveReferralSignup('../private')).toBeNull();
    expect(fake.query).not.toHaveBeenCalled();
    fake.query.mockResolvedValueOnce({ rows: [{ account_id: 9, name: 'Aldric' }] });
    expect(await resolveReferralSignup('aldric')).toMatchObject({
      referrerAccountId: 9,
      slug: 'aldric',
    });
    expect(fake.query.mock.calls[0][0]).toContain('FROM player_cards');
  });
  it('uses the supplied registration transaction and never overwrites an attribution', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }));
    await recordReferralOnClient({ query } as never, 42, {
      referrerAccountId: 9,
      slug: 'aldric',
      memberEligible: false,
      inviterName: 'Aldric',
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT (referee_account_id) DO NOTHING');
    expect(fake.query).not.toHaveBeenCalled();
  });
  it('reads the delivered capacity reward by account PK independently of membership', async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ earned: true }] });
    expect(await referralCapacityEarned(9)).toBe(true);
    expect(fake.query.mock.calls[0][0]).toContain('rewarded_mask & 2');
    expect(fake.query.mock.calls[0][1]).toEqual([9]);
    expect(fake.membership).not.toHaveBeenCalled();
  });
});
