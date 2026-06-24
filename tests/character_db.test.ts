import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the module loads and every query goes through a spy we can assert against.
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import {
  createAccount, createCharacterCapped, deleteCharacter, grantAccountMechChroma, loadAccountCosmetics,
  markAccountQuestComplete, openPlaySession, reclaimDeactivatedName, renameCharacter, revokeAccountMechChroma, touchLogin,
} from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

function clientStub() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as any);
  const release = vi.fn();
  return { query, release };
}

describe('deleteCharacter', () => {
  it('scopes the delete to the current realm so cross-realm characters are safe', async () => {
    dbMock.query.mockResolvedValueOnce({ rowCount: 1 } as any);

    await deleteCharacter(7, 42);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/realm/i);
    expect(params).toContain(REALM);
    // id + account + realm — the same three predicates getCharacter/renameCharacter use
    expect(params).toEqual(expect.arrayContaining([42, 7, REALM]));
  });

  it('reports whether a row was actually deleted', async () => {
    dbMock.query.mockResolvedValueOnce({ rowCount: 0 } as any);
    expect(await deleteCharacter(7, 42)).toBe(false);

    dbMock.query.mockResolvedValueOnce({ rowCount: 1 } as any);
    expect(await deleteCharacter(7, 42)).toBe(true);
  });
});

describe('renameCharacter', () => {
  // A rename is a moderator-driven action: the admin "Force name change" sets
  // force_rename, and the rename must be allowed ONLY while that flag is set.
  // The UI only shows a rename control when force_rename is set, but the server
  // is authoritative, so the gate must live in the UPDATE itself (a normal owner
  // calling the API directly must not be able to rename a non-flagged character).
  it('gates the UPDATE on force_rename so an un-flagged character cannot be renamed', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await renameCharacter(7, 42, 'Newname');

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE characters/i);
    expect(sql).toMatch(/force_rename\s*=\s*TRUE/i);
    // still scoped to the owning account, the id, and the current realm
    expect(params).toEqual(expect.arrayContaining([42, 7, 'Newname', REALM]));
  });

  it('returns the updated row on success and null when no row matched the gate', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ id: 42, account_id: 7, name: 'Newname', class: 'mage', level: 5, state: null, is_gm: false, force_rename: false }],
      rowCount: 1,
    } as any);
    expect((await renameCharacter(7, 42, 'Newname'))?.name).toBe('Newname');

    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    expect(await renameCharacter(7, 42, 'Newname')).toBeNull();
  });
});

describe('reclaimDeactivatedName', () => {
  // A character name held only by a deactivated ("invalid") account must be
  // reclaimable: classic MMOs free the names of deactivated/deleted accounts.
  // The orphaned character is archived (suffixed name + force_rename) so its row
  // stays valid and the original owner is force-renamed if they ever reactivate.
  it('archives the orphaned character and reports success when the holder is deactivated', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 99, name: 'SturdyStubs', deactivated_at: '2026-01-01T00:00:00Z', banned_at: null }], rowCount: 1 } as any) // holder lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // archive-name clash check: free
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any) // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // COMMIT

    await expect(reclaimDeactivatedName('SturdyStubs')).resolves.toBe(true);

    const calls = client.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[1][0]).toMatch(/deactivated_at/);
    expect(calls[1][0]).toMatch(/FOR UPDATE/);
    expect(calls[1][1]).toEqual([REALM, 'SturdyStubs']);
    const updateCall = calls.find((c) => /UPDATE characters/i.test(c[0]));
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toMatch(/force_rename\s*=\s*TRUE/i);
    expect(updateCall![1][0]).toBe(99); // scoped to the orphaned character id
    expect(updateCall![1][1]).toBe('SturdyStubsa'); // archival placeholder
    expect(calls.map((c) => c[0])).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does nothing and reports false when the name is held by a live account', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 99, name: 'SturdyStubs', deactivated_at: null, banned_at: null }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(reclaimDeactivatedName('SturdyStubs')).resolves.toBe(false);
    const verbs = client.query.mock.calls.map((c) => c[0]);
    expect(verbs).not.toContain('COMMIT');
    expect(verbs).toContain('ROLLBACK');
    expect(verbs.some((s) => /UPDATE characters/i.test(s))).toBe(false);
  });

  it('does nothing when the name is not held at all', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // no holder
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(reclaimDeactivatedName('Nobody')).resolves.toBe(false);
    expect(client.query.mock.calls.map((c) => c[0])).not.toContain('COMMIT');
  });

  it('leaves a banned account\'s name reserved even when the account is deactivated', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 99, name: 'SturdyStubs', deactivated_at: '2026-01-01T00:00:00Z', banned_at: '2026-01-01T00:00:00Z' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(reclaimDeactivatedName('SturdyStubs')).resolves.toBe(false);
    expect(client.query.mock.calls.map((c) => c[0]).some((s) => /UPDATE characters/i.test(s))).toBe(false);
  });
});

describe('account and session request metadata', () => {
  it('stores account creation IP and user agent when registering', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ id: 7, username: 'alice', password_hash: 'hash' }] } as any);

    await createAccount('alice', 'hash', { ip: '203.0.113.4', userAgent: 'Mozilla/5.0' });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/created_ip/);
    expect(sql).toMatch(/created_user_agent/);
    expect(params).toEqual(['alice', 'hash', '203.0.113.4', 'Mozilla/5.0']);
  });

  it('updates last login IP and user agent when logging in', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] } as any);

    await touchLogin(7, { ip: '203.0.113.5', userAgent: 'Mozilla/5.0' });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/last_login_ip/);
    expect(sql).toMatch(/last_login_user_agent/);
    expect(params).toEqual([7, '203.0.113.5', 'Mozilla/5.0']);
  });

  it('stores play session IP and user agent when entering the world', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ id: 99 }] } as any);

    await openPlaySession(7, 42, 'Alice', { ip: '203.0.113.6', userAgent: 'Mozilla/5.0' });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/ip_address/);
    expect(sql).toMatch(/user_agent/);
    expect(params).toEqual([7, 42, 'Alice', '203.0.113.6', 'Mozilla/5.0']);
  });
});

describe('account cosmetics', () => {
  it('loads normalized account cosmetic unlocks', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{
        cosmetics: {
          completedQuestIds: ['q_aldrics_fallen_star', 4, 'q_aldrics_fallen_star'],
          mechChromaIds: ['amber_crimson', null, 'onyx_gold'],
        },
      }],
    } as any);

    await expect(loadAccountCosmetics(7)).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson', 'onyx_gold'],
    });

    expect(dbMock.query.mock.calls[0][0]).toContain('cosmetics');
    expect(dbMock.query.mock.calls[0][1]).toEqual([7]);
  });

  it('persists account-wide quest completion without replacing existing cosmetic unlocks', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: [], mechChromaIds: ['onyx_gold'] } }] } as any)
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['onyx_gold'] } }] } as any);

    await expect(markAccountQuestComplete(7, 'q_aldrics_fallen_star')).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['onyx_gold'],
    });

    const [sql, params] = dbMock.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE accounts/);
    expect(sql).toMatch(/cosmetics/);
    expect(params[0]).toBe(7);
    expect(params[1]).toEqual({ completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['onyx_gold'] });
  });

  it('persists mech chroma unlocks without replacing account quest lockouts', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: [] } }] } as any)
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['amber_crimson'] } }] } as any);

    await expect(grantAccountMechChroma(7, 'amber_crimson')).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson'],
    });
  });

  it('persists mech chroma removal without replacing account quest lockouts', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['amber_crimson', 'onyx_gold'] } }] } as any)
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['onyx_gold'] } }] } as any);

    await expect(revokeAccountMechChroma(7, 'amber_crimson')).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['onyx_gold'],
    });

    const [sql, params] = dbMock.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE accounts/);
    expect(params[1]).toEqual({ completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['onyx_gold'] });
  });
});

describe('createCharacterCapped', () => {
  it('locks the account row and checks the realm-scoped character count before inserting', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ n: 9 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{
        id: 42, account_id: 7, name: 'Captest', class: 'mage', level: 1, state: null, is_gm: false, force_rename: false,
      }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // COMMIT

    const row = await createCharacterCapped(7, 'Captest', 'mage', 10);

    expect(row?.id).toBe(42);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][1]).toEqual([7]);
    expect(client.query.mock.calls[2][0]).toContain('count(*)::int');
    expect(client.query.mock.calls[2][1]).toEqual([7, REALM]);
    expect(client.query.mock.calls[3][0]).toMatch(/INSERT INTO characters/);
    expect(client.query.mock.calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns null and skips the insert when the account is already at the realm cap', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ n: 10 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(createCharacterCapped(7, 'Overflow', 'warrior', 10)).resolves.toBeNull();

    expect(client.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      'SELECT id FROM accounts WHERE id = $1 FOR UPDATE',
      'SELECT count(*)::int AS n FROM characters WHERE account_id = $1 AND realm = $2',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the client when the insert fails', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ n: 3 }], rowCount: 1 } as any)
      .mockRejectedValueOnce(new Error('duplicate name'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(createCharacterCapped(7, 'Taken', 'rogue', 10)).rejects.toThrow(/duplicate name/);

    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(client.query.mock.calls.map((c) => c[0])).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
