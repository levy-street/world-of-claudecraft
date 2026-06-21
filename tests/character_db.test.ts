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
  markAccountQuestComplete, openPlaySession, reclaimDeactivatedName, redeemPurchase, renameCharacter, revokeAccountMechChroma, touchLogin,
  createBurnBatch, markBatchSwapped, markBatchBurning, markBatchBurned, markBatchFailed,
  openBurnBatches, lastBurnAt, burnLedger, getCreatorSkin, getMarketplaceQuote,
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
      ownedCreatorSkinIds: [],
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
      ownedCreatorSkinIds: [],
    });

    const [sql, params] = dbMock.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE accounts/);
    expect(sql).toMatch(/cosmetics/);
    expect(params[0]).toBe(7);
    expect(params[1]).toEqual({ completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['onyx_gold'], ownedCreatorSkinIds: [] });
  });

  it('persists mech chroma unlocks without replacing account quest lockouts', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: [] } }] } as any)
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['amber_crimson'] } }] } as any);

    await expect(grantAccountMechChroma(7, 'amber_crimson')).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson'],
      ownedCreatorSkinIds: [],
    });
  });

  it('persists mech chroma removal without replacing account quest lockouts', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['amber_crimson', 'onyx_gold'] } }] } as any)
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['onyx_gold'] } }] } as any);

    await expect(revokeAccountMechChroma(7, 'amber_crimson')).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['onyx_gold'],
      ownedCreatorSkinIds: [],
    });

    const [sql, params] = dbMock.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE accounts/);
    expect(params[1]).toEqual({ completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: ['onyx_gold'], ownedCreatorSkinIds: [] });
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

describe('redeemPurchase — atomic redeem-once + grant', () => {
  const params = {
    txSig: 'sig_abc', accountId: 42, quoteId: 'q_1', mint: 'MintXyz', skinId: 'skin_1',
    grossUsdc: 10_000_000n, creatorUsdc: 7_000_000n, burnUsdc: 3_000_000n,
  };
  const sqls = (client: { query: ReturnType<typeof vi.fn> }) => client.query.mock.calls.map((c) => String(c[0]).trim().split('\n')[0]);

  it('commits payment + sale + grant + quote-delete in one transaction and grants the skin', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT onchain_payments (fresh)
      .mockResolvedValueOnce({}) // INSERT marketplace_sales
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: [], mechChromaIds: [], ownedCreatorSkinIds: [] } }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({}) // UPDATE accounts cosmetics
      .mockResolvedValueOnce({}) // DELETE quote
      .mockResolvedValueOnce({}); // COMMIT
    dbMock.connect.mockResolvedValueOnce(client);

    await expect(redeemPurchase(params)).resolves.toBe(true);

    const order = sqls(client);
    expect(order[0]).toBe('BEGIN');
    expect(order).toContain('COMMIT');
    expect(order).not.toContain('ROLLBACK');
    // The grant writes the new skin id into the account's owned set (inspect data).
    const update = client.query.mock.calls.find((c) => /UPDATE accounts SET cosmetics/.test(String(c[0])));
    expect(update).toBeDefined();
    expect((update![1][1] as { ownedCreatorSkinIds: string[] }).ownedCreatorSkinIds).toContain('skin_1');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns false and rolls back when the signature is already consumed (replay)', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0 }); // INSERT onchain_payments hit ON CONFLICT
    dbMock.connect.mockResolvedValueOnce(client);

    await expect(redeemPurchase(params)).resolves.toBe(false);

    const order = sqls(client);
    expect(order).toContain('ROLLBACK');
    expect(order).not.toContain('COMMIT');
    // It must NOT have recorded a sale or granted anything after the conflict.
    expect(client.query.mock.calls.some((c) => /marketplace_sales|UPDATE accounts/.test(String(c[0])))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and rethrows if a downstream write fails — signature is NOT consumed', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT onchain_payments (fresh)
      .mockRejectedValueOnce(new Error('sale insert failed')); // INSERT marketplace_sales throws
    dbMock.connect.mockResolvedValueOnce(client);

    await expect(redeemPurchase(params)).rejects.toThrow('sale insert failed');

    const order = sqls(client);
    expect(order).toContain('ROLLBACK');
    expect(order).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns false (not throw) on a quote_id unique violation — concurrent same-quote second redeem', async () => {
    const client = clientStub();
    const dup = Object.assign(new Error('duplicate key value violates unique constraint "marketplace_sales_quote_id_key"'), { code: '23505' });
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT onchain_payments (fresh signature)
      .mockRejectedValueOnce(dup); // INSERT marketplace_sales -> quote_id already sold
    dbMock.connect.mockResolvedValueOnce(client);

    await expect(redeemPurchase(params)).resolves.toBe(false); // already_redeemed, not a 500

    const order = sqls(client);
    expect(order).toContain('ROLLBACK');
    expect(order).not.toContain('COMMIT');
    expect(client.query.mock.calls.some((c) => /UPDATE accounts/.test(String(c[0])))).toBe(false); // no grant
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('skips the cosmetics UPDATE when the buyer already owns the skin, but still commits', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // onchain_payments
      .mockResolvedValueOnce({}) // marketplace_sales
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: [], mechChromaIds: [], ownedCreatorSkinIds: ['skin_1'] } }] }) // SELECT FOR UPDATE — already owned
      .mockResolvedValueOnce({}) // DELETE quote
      .mockResolvedValueOnce({}); // COMMIT
    dbMock.connect.mockResolvedValueOnce(client);
    await expect(redeemPurchase(params)).resolves.toBe(true);
    const order = sqls(client);
    expect(order).toContain('COMMIT');
    expect(client.query.mock.calls.some((c) => /UPDATE accounts SET cosmetics/.test(String(c[0])))).toBe(false); // includes() guard skips the dup grant
  });

  it('rethrows (does NOT swallow to false) on a non-unique-violation mid-transaction error', async () => {
    const client = clientStub();
    const connErr = Object.assign(new Error('connection terminated'), { code: '08006' });
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // onchain_payments
      .mockResolvedValueOnce({}) // marketplace_sales
      .mockRejectedValueOnce(connErr); // SELECT FOR UPDATE blows up
    dbMock.connect.mockResolvedValueOnce(client);
    await expect(redeemPurchase(params)).rejects.toThrow('connection terminated'); // only 23505 maps to false
    expect(sqls(client)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('serializes the sale-insert params (bigints stringified, correct column order)', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ cosmetics: { completedQuestIds: [], mechChromaIds: [], ownedCreatorSkinIds: [] } }] })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({});
    dbMock.connect.mockResolvedValueOnce(client);
    await redeemPurchase(params);
    const sale = client.query.mock.calls.find((c) => /INSERT INTO marketplace_sales/.test(String(c[0])))!;
    expect(sale[1]).toEqual(['skin_1', 42, 'q_1', '10000000', '7000000', '3000000', 'sig_abc']);
  });
});

describe('burn_batches + ledger db helpers (real SQL + param shape over a mocked pool)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    batch_id: 'b1', source: 'marketplace', usdc_in: '250000000', woc_bought: '0', woc_burned: '0',
    buy_tx_sig: null, burn_tx_sig: null, status: 'swapping', fail_reason: null,
    created_at: new Date('2026-06-21T00:00:00.000Z'), burn_broadcast_at: null, executed_at: null, ...over,
  });

  it('createBurnBatch: true on fresh insert, false on conflict; target-less ON CONFLICT + params', async () => {
    dbMock.query.mockResolvedValueOnce({ rowCount: 1 });
    await expect(createBurnBatch({ batchId: 'b1', source: 'marketplace', usdcIn: 250_000_000n, buyTxSig: 'sig' })).resolves.toBe(true);
    const [sql, args] = dbMock.query.mock.calls[0];
    expect(String(sql)).toMatch(/ON CONFLICT DO NOTHING/);
    expect(args).toEqual(['b1', 'marketplace', '250000000', 'sig']);
    dbMock.query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(createBurnBatch({ batchId: 'b1', source: 'marketplace', usdcIn: 1n, buyTxSig: 'sig' })).resolves.toBe(false);
  });

  it('markBatch* write the right status, timestamp column, and stringified amount', async () => {
    dbMock.query.mockResolvedValue({});
    await markBatchSwapped('b1', 700n);
    await markBatchBurning('b1', 'burnsig');
    await markBatchBurned('b1', 640n);
    await markBatchFailed('b1', 'x'.repeat(600));
    const calls = dbMock.query.mock.calls;
    expect(String(calls[0][0])).toMatch(/status = 'swapped', woc_bought = \$2/);
    expect(calls[0][1]).toEqual(['b1', '700']);
    expect(String(calls[1][0])).toMatch(/status = 'burning'.*burn_broadcast_at = now\(\)/s); // staleness anchored to burn broadcast
    expect(calls[1][1]).toEqual(['b1', 'burnsig']);
    expect(String(calls[2][0])).toMatch(/status = 'burned', woc_burned = \$2, executed_at = now\(\)/);
    expect(calls[2][1]).toEqual(['b1', '640']);
    expect((calls[3][1] as string[])[1]).toHaveLength(500); // fail_reason capped
  });

  it('openBurnBatches selects only the non-terminal set, oldest-first, mapped to bigints', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [row({ usdc_in: '250000000', woc_bought: '5', woc_burned: '0' })] });
    const open = await openBurnBatches();
    expect(String(dbMock.query.mock.calls[0][0])).toMatch(/status IN \('swapping','swapped','burning'\) ORDER BY created_at/);
    expect(open[0]).toMatchObject({ batchId: 'b1', usdcIn: 250_000_000n, wocBought: 5n, status: 'swapping', createdAt: '2026-06-21T00:00:00.000Z', burnBroadcastAt: null });
  });

  it('mapBurnBatch passes through an already-string timestamp unchanged', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [row({ created_at: '2026-01-02T03:04:05.000Z', executed_at: '2026-01-02T04:00:00.000Z', status: 'burned' })] });
    const [b] = await openBurnBatches();
    expect(b.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(b.executedAt).toBe('2026-01-02T04:00:00.000Z');
  });

  it('lastBurnAt: null when never burned, epoch-ms when present', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ at: null }] });
    expect(await lastBurnAt()).toBeNull();
    dbMock.query.mockResolvedValueOnce({ rows: [{ at: '2026-06-21T00:00:00.000Z' }] });
    expect(await lastBurnAt()).toBe(Date.parse('2026-06-21T00:00:00.000Z'));
  });

  it('burnLedger clamps the limit and returns bigint cumulative totals', async () => {
    for (const [input, expected] of [[0, 1], [99999, 500], [50.7, 50], [undefined, 100]] as const) {
      dbMock.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ woc: '0', usdc: '0' }] });
      await burnLedger(input as number | undefined);
      expect(dbMock.query.mock.calls.at(-2)![1]).toEqual([expected]); // the rows-query LIMIT param
      dbMock.query.mockReset();
    }
    dbMock.query.mockResolvedValueOnce({ rows: [row({ status: 'burned', woc_burned: '640', usdc_in: '250000000' })] })
      .mockResolvedValueOnce({ rows: [{ woc: '12000000', usdc: '9000000' }] });
    const led = await burnLedger(10);
    expect(led.cumulativeWocBurned).toBe(12_000_000n);
    expect(led.cumulativeUsdcIn).toBe(9_000_000n);
    expect(led.batches[0].wocBurned).toBe(640n);
  });

  it('getCreatorSkin returns null when no row matches, and coerces field types when present', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });
    expect(await getCreatorSkin('nope')).toBeNull();
    dbMock.query.mockResolvedValueOnce({ rows: [{
      id: 'skin_1', creator_account_id: '7', creator_wallet: 'W', name: 'N', description: 'D',
      skin_catalog: 'mech', fallback_skin: '3', target_class: null, asset_url: 'u', emissive_url: null, price_usdc: '10000000', status: 'live', sha256: null,
    }] });
    expect(await getCreatorSkin('skin_1')).toMatchObject({ creatorAccountId: 7, skinCatalog: 'mech', fallbackSkin: 3, targetClass: null, emissiveUrl: null, priceUsdc: 10_000_000n });
  });

  it('getMarketplaceQuote coerces bigints + ISO expiry and returns null when absent', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });
    expect(await getMarketplaceQuote('q')).toBeNull();
    dbMock.query.mockResolvedValueOnce({ rows: [{
      quote_id: 'q_1', skin_id: 'skin_1', buyer_account_id: '42', creator_owner: 'C', burn_owner: 'V',
      creator_usdc: '7000000', burn_usdc: '3000000', mint: 'M', expires_at: new Date('2026-06-21T00:05:00.000Z'),
    }] });
    expect(await getMarketplaceQuote('q_1')).toMatchObject({ buyerAccountId: 42, creatorUsdc: 7_000_000n, burnUsdc: 3_000_000n, expiresAt: '2026-06-21T00:05:00.000Z' });
  });
});
