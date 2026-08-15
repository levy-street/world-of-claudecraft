import { describe, expect, it } from 'vitest';
import {
  claimAvailableSeekerEntitlement,
  hasSeekerEntitlement,
  SEEKER_ENTITLEMENT_SCHEMA,
  seekerEntitlementForAccount,
} from '../server/seeker_entitlement_db';

function fakePool(results: Record<string, unknown>[][]) {
  const calls: { sql: string; params?: readonly unknown[] }[] = [];
  const client = {
    async query(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params });
      return { rows: results.shift() ?? [] };
    },
    release() {},
  };
  return {
    calls,
    pool: {
      query: client.query,
    },
  };
}

const claim = {
  candidates: [
    { mint: 'sgt-mint-a', verificationSlot: 123 },
    { mint: 'sgt-mint-b', verificationSlot: 124 },
  ],
  accountId: 42,
  claimantWallet: 'seeker-wallet',
  proofVersion: 'sgt-v1',
};

describe('Seeker entitlement persistence', () => {
  it('pins keep-forever uniqueness and preserves a tombstone on account deletion', () => {
    expect(SEEKER_ENTITLEMENT_SCHEMA).toContain('mint TEXT PRIMARY KEY');
    expect(SEEKER_ENTITLEMENT_SCHEMA).toContain('ON DELETE SET NULL');
    expect(SEEKER_ENTITLEMENT_SCHEMA).toContain('UNIQUE (account_id)');
    expect(SEEKER_ENTITLEMENT_SCHEMA).not.toContain('ON DELETE CASCADE');
  });

  it('claims the first available candidate with one ordered parameterized insert', async () => {
    const db = fakePool([[{ mint: 'sgt-mint-a' }]]);
    await expect(claimAvailableSeekerEntitlement(claim, db.pool)).resolves.toEqual({
      status: 'claimed',
      mint: 'sgt-mint-a',
    });
    expect(db.calls[0]?.params).toEqual([
      ['sgt-mint-a', 'sgt-mint-b'],
      [123, 124],
      claim.accountId,
      claim.claimantWallet,
      claim.proofVersion,
    ]);
    expect(db.calls[0]?.sql).toContain('WITH ORDINALITY');
    expect(db.calls[0]?.sql).toContain('ORDER BY candidate.ordinality');
    expect(db.calls[0]?.sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('classifies a same-account race only when its fixed mint was verified', async () => {
    const same = fakePool([[], [{ mint: 'sgt-mint-b' }]]);
    await expect(claimAvailableSeekerEntitlement(claim, same.pool)).resolves.toEqual({
      status: 'existing_same',
      mint: 'sgt-mint-b',
    });
    expect(same.calls).toHaveLength(2);

    const unverifiedExisting = fakePool([[], [{ mint: 'another-mint' }]]);
    await expect(claimAvailableSeekerEntitlement(claim, unverifiedExisting.pool)).resolves.toEqual({
      status: 'conflict',
      mint: null,
    });

    const consumed = fakePool([[], []]);
    await expect(claimAvailableSeekerEntitlement(claim, consumed.pool)).resolves.toEqual({
      status: 'conflict',
      mint: null,
    });
  });

  it('rejects invalid candidate bounds and ordering before querying', async () => {
    for (const candidates of [
      [],
      [
        { mint: 'b', verificationSlot: 1 },
        { mint: 'a', verificationSlot: 2 },
      ],
      Array.from({ length: 201 }, (_, index) => ({
        mint: `mint-${String(index).padStart(3, '0')}`,
        verificationSlot: index,
      })),
    ]) {
      const db = fakePool([]);
      await expect(
        claimAvailableSeekerEntitlement({ ...claim, candidates }, db.pool),
      ).resolves.toEqual({
        status: 'conflict',
        mint: null,
      });
      expect(db.calls).toHaveLength(0);
    }
  });

  it('reads account entitlement without joining mutable wallet links', async () => {
    const db = fakePool([[{ '?column?': 1 }]]);
    await expect(hasSeekerEntitlement(42, db.pool)).resolves.toBe(true);
    expect(db.calls[0]?.sql).not.toContain('wallet_links');
    expect(db.calls[0]?.params).toEqual([42]);

    const lookup = fakePool([[{ mint: 'sgt-mint', claimant_wallet: 'original-wallet' }]]);
    await expect(seekerEntitlementForAccount(42, lookup.pool)).resolves.toEqual({
      mint: 'sgt-mint',
      claimantWallet: 'original-wallet',
    });
  });
});
