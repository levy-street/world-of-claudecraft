import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  membership: vi.fn(),
  prepaid: vi.fn(),
  metric: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock('../server/db', () => ({
  pool: { connect: async () => ({ query: fake.query, release: fake.release }) },
}));
vi.mock('../server/membership_service', () => ({
  getMembership: fake.membership,
  trustedRecurringMembershipExpiry: (value: { recurringExpiresAt: number | null }) =>
    value.recurringExpiresAt,
}));
vi.mock('../server/membership_db', () => ({ membershipExpiresAtOnClient: fake.prepaid }));
vi.mock('../server/player_metrics_db', () => ({ recordCharacterCreation: fake.metric }));
vi.mock('../server/discord_link_changes', () => ({ enqueueLinkChange: fake.enqueue }));

import { createCharacterCapped } from '../server/character_create_db';

describe('account-locked membership character slots', () => {
  let total: number;
  let base: number;
  beforeEach(() => {
    vi.clearAllMocks();
    total = base = 10;
    fake.membership.mockResolvedValue({
      active: false,
      expiresAt: null,
      authorizedUntil: 0,
      recurringExpiresAt: null,
    });
    fake.prepaid.mockResolvedValue(null);
    fake.query.mockImplementation(async (sql: string, args?: unknown[]) => {
      if (sql.startsWith('SELECT id FROM accounts')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.startsWith('SELECT count')) return { rows: [{ n: total, base }] };
      if (sql.startsWith('INSERT INTO characters'))
        return { rows: [{ id: 20, membership_slot: args?.[6] }] };
      return { rows: [] };
    });
  });

  it('refuses the eleventh character without membership', async () => {
    expect(await createCharacterCapped(1, 'Hero', 'mage')).toBeNull();
    expect(fake.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it('creates the twentieth character as a durable member slot, then refuses the twenty-first', async () => {
    total = 19;
    fake.prepaid.mockResolvedValue(Date.now() + 100_000);
    expect(await createCharacterCapped(1, 'Hero', 'mage')).toMatchObject({ membership_slot: true });
    const lock = fake.query.mock.calls.findIndex(([sql]) => sql.includes('FOR UPDATE'));
    const count = fake.query.mock.calls.findIndex(([sql]) => sql.startsWith('SELECT count'));
    expect(lock).toBeLessThan(count);
    expect(fake.membership.mock.invocationCallOrder[0]).toBeLessThan(
      fake.query.mock.invocationCallOrder[0],
    );
    total = 20;
    expect(await createCharacterCapped(1, 'Another', 'mage')).toBeNull();
  });

  it('permits replacement of a deleted base character without converting the premium slots', async () => {
    total = 19;
    base = 9;
    expect(await createCharacterCapped(1, 'Hero', 'mage')).toMatchObject({
      membership_slot: false,
    });
    expect(fake.prepaid).not.toHaveBeenCalled();
  });

  it('rolls back the insertion and releases the connection on a persistence failure', async () => {
    total = base = 9;
    fake.metric.mockRejectedValueOnce(new Error('failed'));
    await expect(createCharacterCapped(1, 'Hero', 'mage')).rejects.toThrow('failed');
    expect(fake.query).toHaveBeenCalledWith('ROLLBACK');
    expect(fake.enqueue).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
