import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../server/db', () => ({ pool: db }));

import {
  recordReferral,
  referralArmourForAccount,
  referralInviterForSlug,
} from '../../server/referral_armour_db';

beforeEach(() => db.query.mockReset().mockResolvedValue({ rows: [] }));

describe('referral armour storage boundary', () => {
  it('reads one account PK and carries no membership or character reads at join', async () => {
    db.query.mockResolvedValue({ rows: [{ referrer_account_id: 10, inviter_name: 'Aldric' }] });
    expect(await referralArmourForAccount(42)).toEqual({
      inviterAccountId: 10,
      inviterName: 'Aldric',
    });
    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE referee_account_id = $1 AND member_eligible = true');
    expect(sql).not.toMatch(/JOIN|characters|membership/);
    expect(params).toEqual([42]);
  });

  it('treats unknown and legacy ineligible accounts as no entitlement', async () => {
    expect(await referralArmourForAccount(42)).toBeNull();
  });

  it('bounds the stored name and preserves first attribution with insert-only conflict handling', async () => {
    await recordReferral(42, 10, 'aldric', true, 'a'.repeat(100));
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (referee_account_id) DO NOTHING');
    expect(sql).not.toContain('DO UPDATE');
    expect(params).toEqual([42, 10, 'aldric', true, 'a'.repeat(32)]);
  });

  it('resolves only a verified card owner and bounded character name', async () => {
    db.query.mockResolvedValue({ rows: [{ account_id: 10, name: 'a'.repeat(60) }] });
    expect(await referralInviterForSlug('aldric')).toEqual({
      inviterAccountId: 10,
      inviterName: 'a'.repeat(32),
    });
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('c.id = p.character_id AND c.account_id = p.account_id');
    expect(sql).not.toMatch(/png|state/);
  });
});
