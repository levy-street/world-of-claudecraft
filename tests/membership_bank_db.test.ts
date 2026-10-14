import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  save: vi.fn(),
  journal: vi.fn(),
  release: vi.fn(),
  cancel: vi.fn(),
  events: [] as string[],
}));
vi.mock('../server/db', () => ({
  pool: { query: fake.query, connect: fake.connect },
  saveCharacterStateOnClient: fake.save,
}));
vi.mock('../server/character_material_sources_db', () => ({
  journalCharacterSaveSources: fake.journal,
}));
vi.mock('../server/character_lease_db', () => ({ PROCESS_LEASE_HOLDER: 'this-process' }));
vi.mock('../server/membership_service', () => ({ trustedRecurringMembershipExpiry: () => null }));
vi.mock('../server/db_backend_cancel', () => ({ cancelDetachedBackend: fake.cancel }));

import {
  listMembershipBanks,
  loadMembershipBank,
  type MembershipBankSave,
  transferMembershipBank,
} from '../server/membership_bank_db';
import type { CharacterState } from '../src/sim/character_state';

const item = { itemId: 'baked_bread', count: 3 };
function input(): MembershipBankSave {
  return {
    accountId: 1,
    characterId: 20,
    targetCharacterId: 10,
    leaseNonce: 'nonce',
    state: { level: 5, inventory: [item] } as CharacterState,
    membership: {
      active: true,
      expiresAt: Date.now() + 60_000,
      authorizedUntil: Date.now() + 30_000,
      recurringExpiresAt: null,
    },
    request: { direction: 'deposit', slotIndex: 0, expectedSlot: item },
    stillAuthorized: () => true,
  };
}
const rows = (values: object[], rowCount = values.length) => ({ rows: values, rowCount });
function answer(sql: string) {
  if (sql.startsWith('SELECT id FROM accounts')) return rows([{ id: 1 }]);
  if (sql.startsWith('SELECT prepaid_until'))
    return rows([{ prepaid_until: new Date(Date.now() + 60_000) }]);
  if (sql.startsWith('SELECT id, CASE'))
    return rows([
      {
        id: 10,
        bank: { inventory: [], purchasedSlots: 0, bonusSlots: 0 },
        oversized: false,
        has_state: true,
      },
      { id: 20, bank: null, oversized: false, has_state: true },
    ]);
  if (sql.includes('AND holder = $2 AND nonce = $3')) return rows([{ character_id: 20 }]);
  if (sql.startsWith('UPDATE characters')) return rows([], 1);
  return rows([]);
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.events.length = 0;
  fake.query.mockImplementation(async (sql: string) => {
    fake.events.push(sql);
    return answer(sql);
  });
  fake.connect.mockResolvedValue({
    query: fake.query,
    release: fake.release,
    on: vi.fn(),
    removeListener: vi.fn(),
  });
  fake.save.mockImplementation(async () => {
    fake.events.push('SAVE_ACTOR');
    return true;
  });
  fake.journal.mockImplementation(async () => {
    fake.events.push('JOURNAL_TARGET');
  });
});

describe('membership bank transactional durability', () => {
  it('cancels an expired backend through the dedicated side pool instead of the saturated main pool', async () => {
    vi.useFakeTimers();
    try {
      let rejectSocket!: (error: Error) => void;
      fake.query.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectSocket = reject;
          }),
      );
      fake.release.mockImplementation(() => rejectSocket(new Error('socket closed')));
      fake.cancel.mockResolvedValue(undefined);
      fake.connect.mockResolvedValue({
        query: fake.query,
        release: fake.release,
        on: vi.fn(),
        removeListener: vi.fn(),
        processID: 321,
      });
      const result = transferMembershipBank(input()).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await result).toMatchObject({ name: 'DbTransactionDeadlineExceeded' });
      expect(fake.cancel).toHaveBeenCalledExactlyOnceWith(321);
      expect(fake.query).toHaveBeenCalledExactlyOnceWith('BEGIN', undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks account then ordered character rows, saves both containers with journals and ledger, then commits', async () => {
    const result = await transferMembershipBank(input());
    expect(result).toMatchObject({
      ok: true,
      value: { moved: 3, inventory: [], inventoryBefore: [item], bank: { slots: [item] } },
    });
    const text = fake.events.join('\n');
    expect(text.indexOf('FROM accounts')).toBeLessThan(text.indexOf('ORDER BY id FOR UPDATE'));
    expect(text.indexOf('ORDER BY id FOR UPDATE')).toBeLessThan(
      text.indexOf('AND holder = $2 AND nonce = $3'),
    );
    expect(text.indexOf('DELETE FROM character_leases')).toBeLessThan(text.indexOf('SAVE_ACTOR'));
    expect(text.indexOf('SAVE_ACTOR')).toBeLessThan(
      text.indexOf('UPDATE characters SET state = jsonb_set'),
    );
    expect(text.indexOf('JOURNAL_TARGET')).toBeLessThan(text.indexOf('INSERT INTO bank_ledger'));
    expect(fake.events.at(-1)).toBe('COMMIT');
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY id FOR UPDATE'), [
      [10, 20],
      10,
      1,
      expect.any(String),
      262144,
    ]);
    expect(fake.save).toHaveBeenCalledWith(
      expect.anything(),
      20,
      5,
      expect.objectContaining({ inventory: [] }),
      'nonce',
      undefined,
      undefined,
      expect.objectContaining({ accountId: 1 }),
    );
    expect(fake.journal).toHaveBeenCalledWith(
      expect.anything(),
      10,
      { bank: { inventory: [], purchasedSlots: 0, bonusSlots: 0 }, vault: undefined },
      expect.objectContaining({ rowCount: 1 }),
      { bank: { inventory: [item], purchasedSlots: 0, bonusSlots: 0 } },
    );
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it.each(['online', 'lease_lost', 'membership_required', 'not_found', 'too_large'] as const)(
    'refuses %s before either durable blob changes',
    async (error) => {
      fake.query.mockImplementation(async (sql: string) => {
        fake.events.push(sql);
        if (
          error === 'online' &&
          sql === 'SELECT character_id FROM character_leases WHERE character_id = $1'
        )
          return rows([{ character_id: 10 }]);
        if (error === 'lease_lost' && sql.includes('AND holder = $2 AND nonce = $3'))
          return rows([]);
        if (error === 'membership_required' && sql.startsWith('SELECT prepaid_until'))
          return rows([{ prepaid_until: new Date(0) }]);
        if (error === 'not_found' && sql.startsWith('SELECT id, CASE')) return rows([{ id: 20 }]);
        if (error === 'too_large' && sql.startsWith('SELECT id, CASE'))
          return rows([{ id: 10, oversized: true, has_state: true }, { id: 20 }]);
        return answer(sql);
      });
      expect(await transferMembershipBank(input())).toEqual({ ok: false, error });
      expect(fake.save).not.toHaveBeenCalled();
      expect(fake.events.at(-1)).toBe('ROLLBACK');
      expect(fake.events).not.toContain('COMMIT');
    },
  );

  it('rolls back the actor update when target fence is lost', async () => {
    fake.query.mockImplementation(async (sql: string) => {
      fake.events.push(sql);
      return sql.startsWith('UPDATE characters') ? rows([], 0) : answer(sql);
    });
    expect(await transferMembershipBank(input())).toEqual({ ok: false, error: 'online' });
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.journal).not.toHaveBeenCalled();
    expect(fake.events.at(-1)).toBe('ROLLBACK');
  });

  it('a journal error rolls back both updates and never sends COMMIT', async () => {
    fake.journal.mockRejectedValue(new Error('source journal refused'));
    await expect(transferMembershipBank(input())).rejects.toThrow('source journal refused');
    expect(fake.events.at(-1)).toBe('ROLLBACK');
    expect(fake.events.some((sql) => sql.startsWith('INSERT INTO bank_ledger'))).toBe(false);
  });

  it('a lost COMMIT acknowledgement is uncertain even if cleanup attempts rollback', async () => {
    fake.query.mockImplementation(async (sql: string) => {
      fake.events.push(sql);
      if (sql === 'COMMIT') throw new Error('connection closed');
      return answer(sql);
    });
    expect(await transferMembershipBank(input())).toEqual({ ok: false, error: 'uncertain' });
    expect(fake.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('checks live authority again immediately before COMMIT', async () => {
    const save = input();
    let valid = true;
    save.stillAuthorized = () => valid;
    fake.journal.mockImplementation(async () => {
      valid = false;
    });
    expect(await transferMembershipBank(save)).toEqual({ ok: false, error: 'membership_required' });
    expect(fake.events).not.toContain('COMMIT');
    expect(fake.events.at(-1)).toBe('ROLLBACK');
  });

  it('bounds metadata reads and selects only the requested bank subtree', async () => {
    fake.query.mockResolvedValueOnce(rows([{ id: 10, name: 'Alt' }]));
    expect(await listMembershipBanks(1)).toEqual([{ characterId: 10, name: 'Alt' }]);
    expect(fake.query).toHaveBeenLastCalledWith(expect.stringContaining('ORDER BY id LIMIT $3'), [
      1,
      expect.any(String),
      20,
    ]);
    fake.query.mockResolvedValueOnce(
      rows([
        {
          bank: { inventory: [item], purchasedSlots: 0, bonusSlots: 0 },
          online: false,
          oversized: false,
        },
      ]),
    );
    expect(await loadMembershipBank(1, 10)).toMatchObject({ ok: true, value: { slots: [item] } });
    expect(fake.query).toHaveBeenLastCalledWith(
      expect.stringContaining("THEN state->'bank' ELSE NULL"),
      [10, 1, expect.any(String), 262144],
    );
  });
});
