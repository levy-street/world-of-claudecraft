process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_referral_redemption';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { accountForSlug, accountForReferralCode, insertReferralRedemption, referrerProgramFacts } =
  vi.hoisted(() => ({
    accountForSlug: vi.fn(async (_slug: string): Promise<number | null> => null),
    accountForReferralCode: vi.fn(async (_code: string): Promise<number | null> => null),
    insertReferralRedemption: vi.fn(async (_input: unknown) => {}),
    referrerProgramFacts: vi.fn(async () => ({
      accountAgeDays: 30,
      maxCharacterLevel: 20,
      activeReferrals: 0,
      completedThisSeason: 0,
      completedTotal: 0,
    })),
  }));

vi.mock('../../server/db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/db')>();
  return { ...actual, accountForSlug };
});
vi.mock('../../server/referrals_db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/referrals_db')>();
  return { ...actual, accountForReferralCode, insertReferralRedemption, referrerProgramFacts };
});

import { resetReferralProgramConfigForTests } from '../../server/referral_program';
import { redeemReferral } from '../../server/referral_redemption';
import { hashPresenceText } from '../../server/site_presence';

beforeEach(() => {
  vi.clearAllMocks();
  resetReferralProgramConfigForTests();
});

afterEach(() => {
  resetReferralProgramConfigForTests();
});

describe('redeemReferral', () => {
  it('binds via a referral code, storing hashes and the raw ip only for correlation', async () => {
    accountForReferralCode.mockResolvedValueOnce(42);
    await redeemReferral(7, 'abcd2345', { ip: '203.0.113.9', userAgent: 'UA/1.0' });
    expect(insertReferralRedemption).toHaveBeenCalledTimes(1);
    const input = insertReferralRedemption.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toEqual({
      refereeAccountId: 7,
      referrerAccountId: 42,
      redeemedToken: 'abcd2345',
      codeUsed: 'abcd2345',
      deviceFingerprint: hashPresenceText('UA/1.0'),
      ipHash: hashPresenceText('203.0.113.9'),
      rawRefereeIp: '203.0.113.9',
    });
    // The stored hashes never equal the raw values.
    expect(input.ipHash).not.toBe('203.0.113.9');
    expect(input.deviceFingerprint).not.toBe('UA/1.0');
  });

  it('falls back to the card slug channel when the token is not a code', async () => {
    accountForReferralCode.mockResolvedValueOnce(null);
    accountForSlug.mockResolvedValueOnce(42);
    await redeemReferral(7, 'my-card-slug', {});
    expect(insertReferralRedemption).toHaveBeenCalledTimes(1);
    const input = insertReferralRedemption.mock.calls[0][0] as Record<string, unknown>;
    expect(input.codeUsed).toBeNull();
    expect(input.redeemedToken).toBe('my-card-slug');
    expect(input.referrerAccountId).toBe(42);
    expect(input.deviceFingerprint).toBeNull();
    expect(input.ipHash).toBeNull();
  });

  it('normalizes the token like the client capture (trim + lowercase)', async () => {
    accountForReferralCode.mockResolvedValueOnce(42);
    await redeemReferral(7, '  ABCD2345  ', {});
    expect(accountForReferralCode).toHaveBeenCalledWith('abcd2345');
  });

  it('silently drops junk, unknown, and self-referral tokens', async () => {
    await redeemReferral(7, '', {});
    await redeemReferral(7, '-leading-hyphen', {});
    await redeemReferral(7, 42 as unknown as string, {});
    await redeemReferral(7, 'unknown-token', {});
    accountForReferralCode.mockResolvedValueOnce(7);
    await redeemReferral(7, 'abcd2345', {});
    expect(insertReferralRedemption).not.toHaveBeenCalled();
  });

  it('silently drops a redemption when the referrer is at the active cap', async () => {
    accountForReferralCode.mockResolvedValueOnce(42);
    referrerProgramFacts.mockResolvedValueOnce({
      accountAgeDays: 30,
      maxCharacterLevel: 20,
      activeReferrals: 10,
      completedThisSeason: 0,
      completedTotal: 0,
    });
    await redeemReferral(7, 'abcd2345', {});
    expect(insertReferralRedemption).not.toHaveBeenCalled();
  });
});
