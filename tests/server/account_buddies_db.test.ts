import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), save: vi.fn() }));
vi.mock('../../server/db', () => ({
  pool: { query: db.query, connect: db.connect },
  saveCharacterStateOnClient: db.save,
}));

import {
  ACCOUNT_BUDDIES_SCHEMA,
  type BuddyPurchaseSnapshot,
  grantAccountBuddies,
  loadAccountBuddies,
  normalizeAccountBuddies,
  purchaseAccountBuddy,
  readAccountBuddyBatch,
} from '../../server/account_buddies_db';

beforeEach(() => {
  db.query.mockReset();
  db.connect.mockReset();
  db.save.mockReset();
});

function connection(owned: string[] = []) {
  const calls: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      return { rows: sql.startsWith('SELECT owned') ? [{ owned }] : [], rowCount: 1 };
    }),
    release: vi.fn(),
  });
  db.connect.mockResolvedValue(client);
  db.save.mockImplementation(async () => {
    calls.push('CHARACTER SAVE');
    return true;
  });
  return { client, calls };
}

const snapshot = {
  characterId: 11,
  leaseNonce: 'test-lease',
  state: { level: 20, honor: 0, buddies: { owned: ['horse'] } },
} as unknown as BuddyPurchaseSnapshot;

describe('account buddy persistence', () => {
  it('accepts only active unique keys and caps the durable row by the catalog', () => {
    expect(normalizeAccountBuddies(['horse', 'horse', 'sapling', 'forgemaw', 17])).toEqual([
      'forgemaw',
      'horse',
      'sapling',
    ]);
    expect(ACCOUNT_BUDDIES_SCHEMA).toContain(
      'PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE',
    );
    expect(ACCOUNT_BUDDIES_SCHEMA).toContain('cardinality(owned) <= 4');
  });

  it('coalesces concurrent joins, projects legacy keys in SQL, and releases the flight after failure', async () => {
    let reject!: (reason: Error) => void;
    db.query.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const first = loadAccountBuddies(7);
    expect(loadAccountBuddies(7)).toBe(first);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain("state->'buddies'->'owned'");
    expect(sql).toContain('WHERE c.account_id = $1');
    expect(sql).toContain('DELETE FROM character_buddy_grants');
    expect(sql).toContain('ON CONFLICT (account_id) DO UPDATE');
    expect(values[0]).toBe(7);
    expect(values[1]).toEqual(['horse', 'crystal_lich', 'forgemaw', 'sapling']);
    reject(new Error('temporary'));
    await expect(first).rejects.toThrow('temporary');
    db.query.mockResolvedValueOnce({ rows: [{ owned: ['horse'] }] });
    await expect(loadAccountBuddies(7)).resolves.toEqual(['horse']);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('makes additive grants and bounds cross-realm reads to 256 account IDs', async () => {
    db.query.mockResolvedValue({ rows: [{ account_id: 7, owned: ['horse'] }] });
    await grantAccountBuddies(7, ['horse', 'penny', 'horse']);
    expect(db.query.mock.calls[0][1]).toEqual([7, ['horse']]);
    await expect(readAccountBuddyBatch(Array.from({ length: 257 }, (_, i) => i))).rejects.toThrow(
      '256',
    );
    const observer = vi.fn();
    expect(await readAccountBuddyBatch([7], observer)).toEqual(new Map([[7, ['horse']]]));
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('holds the account lock before the fenced character save and commits ownership with payment', async () => {
    const x = connection();
    await expect(purchaseAccountBuddy(7, 'horse', () => snapshot)).resolves.toEqual(['horse']);
    const lock = x.calls.findIndex((sql) => sql.includes('FOR NO KEY UPDATE'));
    const save = x.calls.indexOf('CHARACTER SAVE');
    const union = x.calls.findIndex((sql) => sql.startsWith('UPDATE account_buddies'));
    expect(lock).toBeLessThan(save);
    expect(save).toBeLessThan(union);
    expect(x.calls.at(-1)).toBe('COMMIT');
    expect(db.save.mock.calls[0].slice(1, 5)).toEqual([11, 20, snapshot.state, 'test-lease']);
    expect(x.client.release).toHaveBeenCalledTimes(1);
  });

  it('does not save or charge when the locked account already owns the buddy', async () => {
    const x = connection(['horse']);
    await expect(purchaseAccountBuddy(7, 'horse', () => null)).resolves.toEqual(['horse']);
    expect(db.save).not.toHaveBeenCalled();
    expect(x.calls.at(-1)).toBe('ROLLBACK');
    expect(x.calls.some((sql) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('rolls back a lease-fenced character save and never commits account ownership', async () => {
    const x = connection();
    db.save.mockResolvedValue(false);
    await expect(purchaseAccountBuddy(7, 'horse', () => snapshot)).rejects.toThrow('fenced');
    expect(x.calls.at(-1)).toBe('ROLLBACK');
    expect(x.calls.some((sql) => sql.startsWith('UPDATE account_buddies'))).toBe(false);
    expect(x.client.release).toHaveBeenCalledTimes(1);
  });
});
