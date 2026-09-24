import { describe, expect, it } from 'vitest';
import { createVaultRewardsDb } from '../../server/vault_rewards_db';

const outcome = {
  attemptId: '42:7',
  ownerCharacterId: 42,
  claims: [
    {
      characterId: 42,
      recipientName: 'Owner',
      items: [{ itemId: 'rusty_hatchet', count: 1 }],
      copper: 25,
      mailDueAt: new Date('2026-09-24T00:00:00.000Z'),
    },
  ],
};

describe('vault rewards database boundary', () => {
  it('rejects duplicate recipients before starting a transaction', async () => {
    let connects = 0;
    const db = createVaultRewardsDb(
      {
        async connect() {
          connects++;
          throw new Error('should not connect');
        },
        async query() {
          throw new Error('should not query');
        },
      },
      'TestRealm',
    );
    await expect(
      db.commitVaultOutcome({ ...outcome, claims: [outcome.claims[0], outcome.claims[0]] }),
    ).rejects.toThrow('duplicate character');
    expect(connects).toBe(0);
  });

  it('caps completion to one party of five before starting a transaction', async () => {
    const db = createVaultRewardsDb(
      {
        async connect() {
          throw new Error('should not connect');
        },
        async query() {
          throw new Error('should not query');
        },
      },
      'TestRealm',
    );
    await expect(
      db.commitVaultOutcome({
        ...outcome,
        claims: Array.from({ length: 6 }, (_, i) => ({
          ...outcome.claims[0],
          characterId: i + 1,
        })),
      }),
    ).rejects.toThrow('1 to 5');
  });
});
