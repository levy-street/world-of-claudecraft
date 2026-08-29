import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the module loads and every query goes through a spy we can assert against.
const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  bustGuildList: vi.fn(),
}));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));
vi.mock('../server/admin_guilds_read', () => ({
  bustAdminGuildListReads: dbMock.bustGuildList,
}));

import {
  CHARACTER_DELETE_PERMIT_SUB_CAP,
  CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS,
  CHARACTER_DELETE_VERIFY_SQL,
  CharacterDeleteClientGone,
  CharacterDeleteQueueSaturated,
  CharacterStoragePurchaseOpen,
  characterDeleteGateStats,
  configureCharacterDeleteBackgroundGate,
  DELETE_RESTORE_STATEMENT_TIMEOUT_MS,
} from '../server/character_delete_db';
import { CHARACTER_SAVE_STATEMENT_TIMEOUT_MS } from '../server/character_save_transaction';
import { configureCommunityTestAccounts } from '../server/community_test_accounts';
import {
  backfillAccountEmailIfEmpty,
  bankBonusFactsForAccount,
  consumeAppearanceReroll,
  createAccount,
  createCharacterCapped,
  deleteCharacter,
  grantAccountMechChroma,
  grantAccountWeaponSkins,
  loadAccountCosmetics,
  markAccountQuestComplete,
  openPlaySession,
  reclaimDeactivatedName,
  renameCharacter,
  SCHEMA,
  setAccountWeaponSkinLoadout,
  touchLogin,
} from '../server/db';
import { drainLinkChanges } from '../server/discord_link_changes';
import { REALM } from '../server/realm';

beforeEach(() => {
  configureCommunityTestAccounts(false);
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
  // The roster/create/delete sites write into the module-global linked-member
  // change feed, so start every test with an empty queue.
  drainLinkChanges();
  dbMock.bustGuildList.mockReset();
});

describe('community test account transaction', () => {
  it('atomically inserts the account and all nine level-20 character states when enabled', async () => {
    configureCommunityTestAccounts(true);
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO accounts/i.test(sql)) {
        return { rows: [{ id: 42, username: 'tester', password_hash: 'hash' }], rowCount: 1 };
      }
      if (/INSERT INTO characters/i.test(sql)) {
        return { rows: [{ id: 100, name: params?.[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      createAccount('tester', 'hash', { ip: '203.0.113.4' }, { passwordSet: false }),
    ).resolves.toMatchObject({ id: 42, username: 'tester' });

    const calls = client.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(dbMock.query).not.toHaveBeenCalled();
    const accountInsert = calls.find((call) => /INSERT INTO accounts/i.test(call[0]));
    expect(accountInsert?.[1]?.[4]).toBe(false);
    const characterInserts = calls.filter((call) => /INSERT INTO characters/i.test(call[0]));
    expect(characterInserts).toHaveLength(9);
    expect(new Set(characterInserts.map((call) => call[1]?.[1]))).toHaveLength(9);
    for (const [, params] of characterInserts) {
      expect(params?.[0]).toBe(42);
      expect(params?.[3]).toBe(REALM);
      expect(params?.[4]).toBe(20);
      expect(JSON.parse(String(params?.[5])).level).toBe(20);
    }
  });

  it('retries a generated name collision without aborting the transaction', async () => {
    configureCommunityTestAccounts(true);
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    let characterInsert = 0;
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO accounts/i.test(sql)) {
        return { rows: [{ id: 42, username: 'tester', password_hash: 'hash' }], rowCount: 1 };
      }
      if (/INSERT INTO characters/i.test(sql)) {
        characterInsert++;
        if (characterInsert === 1) return { rows: [], rowCount: 0 };
        return { rows: [{ id: 100, name: params?.[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await createAccount('tester', 'hash');

    const characterInserts = client.query.mock.calls.filter((call) =>
      /INSERT INTO characters/i.test(call[0]),
    );
    expect(characterInserts).toHaveLength(10);
    expect(characterInserts[0][1]?.[2]).toBe('warrior');
    expect(characterInserts[1][1]?.[2]).toBe('warrior');
    expect(characterInserts[1][1]?.[1]).not.toBe(characterInserts[0][1]?.[1]);
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('rolls back the account and every character when any character insert fails', async () => {
    configureCommunityTestAccounts(true);
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    let characterInsert = 0;
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO accounts/i.test(sql)) {
        return { rows: [{ id: 42, username: 'tester', password_hash: 'hash' }], rowCount: 1 };
      }
      if (/INSERT INTO characters/i.test(sql) && ++characterInsert === 4) {
        throw new Error('character write failed');
      }
      return { rows: [{ id: 100 }], rowCount: 1 };
    });

    await expect(createAccount('tester', 'hash')).rejects.toThrow('character write failed');

    expect(client.query.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
    expect(client.query.mock.calls.map((call) => call[0])).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

function clientStub() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as any);
  const release = vi.fn();
  return { query, release, on: vi.fn(), removeListener: vi.fn() };
}

function deleteClient(
  options: {
    account?: boolean;
    character?: boolean;
    openStatus?: 'pending' | 'unresolved';
    deleted?: boolean;
    deleteError?: Error;
  } = {},
) {
  const client = clientStub();
  client.query.mockImplementation(async (sql: string) => {
    if (/SELECT id FROM accounts/i.test(sql)) {
      return options.account === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: 7 }], rowCount: 1 };
    }
    if (/SELECT id FROM characters/i.test(sql)) {
      return options.character === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: 42 }], rowCount: 1 };
    }
    if (/FROM storage_purchases/i.test(sql)) {
      return options.openStatus
        ? { rows: [{ status: options.openStatus }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/DELETE FROM characters/i.test(sql)) {
      if (options.deleteError) throw options.deleteError;
      return { rows: [], rowCount: options.deleted === false ? 0 : 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return client;
}

describe('deleteCharacter', () => {
  it('scopes the delete to the current realm so cross-realm characters are safe', async () => {
    const client = deleteClient();
    dbMock.connect.mockResolvedValueOnce(client);

    await deleteCharacter(7, 42);

    const deletionCall = client.query.mock.calls.find((call) =>
      /DELETE FROM characters/i.test(call[0]),
    );
    expect(deletionCall).toBeDefined();
    const [sql, params] = deletionCall ?? [];
    expect(sql).toMatch(/realm/i);
    expect(params).toContain(REALM);
    // id + account + realm: the same three predicates getCharacter/renameCharacter use
    expect(params).toEqual(expect.arrayContaining([42, 7, REALM]));
    expect(dbMock.bustGuildList).toHaveBeenCalledOnce();
  });

  it('reports whether a row was actually deleted', async () => {
    dbMock.connect.mockResolvedValueOnce(deleteClient({ character: false }));
    expect(await deleteCharacter(7, 42)).toBe(false);
    expect(dbMock.bustGuildList).not.toHaveBeenCalled();

    dbMock.connect.mockResolvedValueOnce(deleteClient());
    expect(await deleteCharacter(7, 42)).toBe(true);
    expect(dbMock.bustGuildList).toHaveBeenCalledOnce();
  });

  it('takes parent, character, and fresh open-purchase locks in lifecycle order', async () => {
    const client = deleteClient();
    dbMock.connect.mockResolvedValueOnce(client);

    await deleteCharacter(7, 42);

    const sql = client.query.mock.calls.map((call) => String(call[0]));
    const account = sql.findIndex((statement) => /FROM accounts/.test(statement));
    const character = sql.findIndex((statement) => /FROM characters/.test(statement));
    const purchase = sql.findIndex((statement) => /FROM storage_purchases/.test(statement));
    const deletion = sql.findIndex((statement) => /DELETE FROM characters/.test(statement));
    expect(sql).toHaveLength(9);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('statement_timeout = 15000');
    expect(sql[1]).toContain("lock_timeout = '2s'");
    expect(sql[1]).toContain("idle_in_transaction_session_timeout = '2s'");
    expect(account).toBeLessThan(character);
    expect(character).toBeLessThan(purchase);
    expect(purchase).toBeLessThan(deletion);
    // The keep-forever bank_ledger / bank_ledger_batch_receipts cascade rides
    // ONLY the DELETE under the widened 60s bound (the shared character-save
    // allowance); the tighter 15s bound is restored immediately after so
    // COMMIT keeps the transaction's ceiling. Literal ms pins beside the
    // identity checks, so a drifted constant is a conscious edit here.
    expect(sql[deletion - 1]).toBe('SET LOCAL statement_timeout = 60000');
    expect(sql[deletion + 1]).toBe('SET LOCAL statement_timeout = 15000');
    expect(CHARACTER_SAVE_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(DELETE_RESTORE_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(sql.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each(['pending', 'unresolved'] as const)(
    'refuses deletion while a %s storage purchase remains open',
    async (openStatus) => {
      const client = deleteClient({ openStatus });
      dbMock.connect.mockResolvedValueOnce(client);

      await expect(deleteCharacter(7, 42)).rejects.toMatchObject({
        name: CharacterStoragePurchaseOpen.name,
        code: 'CHARACTER_STORAGE_PURCHASE_OPEN',
        characterId: 42,
        status: openStatus,
      });

      expect(client.query.mock.calls.some((call) => /DELETE FROM characters/.test(call[0]))).toBe(
        false,
      );
      expect(client.query.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
      expect(dbMock.bustGuildList).not.toHaveBeenCalled();
    },
  );

  it('does not invalidate the guild directory when the delete fails', async () => {
    const error = Object.assign(new Error('delete failed'), { code: 'XX000' });
    const client = deleteClient({ deleteError: error });
    dbMock.connect.mockResolvedValueOnce(client);

    await expect(deleteCharacter(7, 42)).rejects.toThrow('delete failed');

    expect(client.query.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
    expect(dbMock.bustGuildList).not.toHaveBeenCalled();
    // A NON-ambiguous rollback skips the verify checkout entirely: the one
    // connect is the transaction's own. Dropping the ambiguity guard on the
    // resolver would double pool checkouts under exactly the saturation the
    // delete gate exists to bound, and only this count sees it.
    expect(dbMock.connect).toHaveBeenCalledTimes(1);
  });

  it('composes under the registered background gate: permit before checkout, released after the client', async () => {
    const client = deleteClient();
    const order: string[] = [];
    const release = vi.fn(() => order.push('permit_released'));
    const acquire = vi.fn(async () => {
      order.push('permit_acquired');
      return { release };
    });
    // Record the CLIENT release into the same order stream, so the
    // permit-outlives-the-client contract is a real ordering pin rather than
    // an unobserved claim (swapping the two finally arms must red here).
    client.release.mockImplementation(() => {
      order.push('client_released');
    });
    dbMock.connect.mockImplementationOnce(async () => {
      order.push('connect');
      return client;
    });
    configureCharacterDeleteBackgroundGate(acquire);
    try {
      expect(await deleteCharacter(7, 42)).toBe(true);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
    }
    // Gate-then-checkout, and the permit outlives the client (the
    // clientWithPermit lifetime contract from the paid-guild sibling).
    expect(order).toEqual(['permit_acquired', 'connect', 'client_released', 'permit_released']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('refuses promptly with a retryable saturation error when the gate has no permit, touching no pool client', async () => {
    const acquire = vi.fn(async () => null);
    configureCharacterDeleteBackgroundGate(acquire);
    try {
      // Three sequential refusals, one past the sub-cap of 2: a refusal that
      // leaked its sub-cap slot would park the third call on the delete sub
      // gate (a test timeout here) instead of refusing promptly through the
      // realm gate again.
      for (let round = 0; round < 3; round++) {
        await expect(deleteCharacter(7, 42)).rejects.toMatchObject({
          name: CharacterDeleteQueueSaturated.name,
          code: 'CHARACTER_DELETE_QUEUE_SATURATED',
          characterId: 42,
        });
      }
      expect(acquire).toHaveBeenCalledTimes(3);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
    }
    expect(dbMock.connect).not.toHaveBeenCalled();
    expect(dbMock.bustGuildList).not.toHaveBeenCalled();
  });

  it('sub-caps concurrent deletes on the realm gate, FIFO-parking the overflow', async () => {
    // Deletes hold the longest walls the realm gate admits (65s), and its
    // other consumers wait UNBOUNDED (autosave, market/mail, shutdown), so a
    // stampede must never claim more than the sub-cap of the gate's permits.
    let held = 0;
    let maxHeld = 0;
    const acquire = vi.fn(async () => {
      held++;
      maxHeld = Math.max(maxHeld, held);
      return {
        release: () => {
          held--;
        },
      };
    });
    configureCharacterDeleteBackgroundGate(acquire);
    const connects: Array<(client: ReturnType<typeof deleteClient>) => void> = [];
    dbMock.connect.mockImplementation(() => new Promise((resolve) => connects.push(resolve)));
    try {
      const deletes = [deleteCharacter(7, 42), deleteCharacter(7, 43), deleteCharacter(7, 44)];
      await new Promise((resolve) => setImmediate(resolve));
      // Two deletes hold realm permits inside their checkouts; the third is
      // parked on the sub-cap and never reached the realm gate at all.
      expect(CHARACTER_DELETE_PERMIT_SUB_CAP).toBe(2);
      expect(acquire).toHaveBeenCalledTimes(2);
      expect(connects).toHaveLength(2);
      connects[0](deleteClient());
      connects[1](deleteClient());
      await new Promise((resolve) => setImmediate(resolve));
      // A finished delete frees its sub slot, admitting the parked one.
      expect(acquire).toHaveBeenCalledTimes(3);
      expect(connects).toHaveLength(3);
      connects[2](deleteClient());
      await expect(Promise.all(deletes)).resolves.toEqual([true, true, true]);
      expect(maxHeld).toBeLessThanOrEqual(CHARACTER_DELETE_PERMIT_SUB_CAP);
      expect(held).toBe(0);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
      dbMock.connect.mockReset();
    }
  });

  it('a sub-cap-parked delete refuses within the 15s bound without touching the realm gate', async () => {
    vi.useFakeTimers();
    const acquire = vi.fn(async () => ({ release: vi.fn() }));
    configureCharacterDeleteBackgroundGate(acquire);
    const connects: Array<(client: ReturnType<typeof deleteClient>) => void> = [];
    dbMock.connect.mockImplementation(() => new Promise((resolve) => connects.push(resolve)));
    try {
      const first = deleteCharacter(7, 42);
      const second = deleteCharacter(7, 43);
      await vi.advanceTimersByTimeAsync(0);
      expect(acquire).toHaveBeenCalledTimes(2);
      // Attach the rejection handler BEFORE advancing the clock: the refusal
      // fires inside the awaited timer flush, and a handler attached after
      // that flush leaves the rejection momentarily unhandled on CI.
      const refused = expect(deleteCharacter(7, 44)).rejects.toMatchObject({
        code: 'CHARACTER_DELETE_QUEUE_SATURATED',
        characterId: 44,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await refused;
      // The parked delete claimed no realm permit and no pool client.
      expect(acquire).toHaveBeenCalledTimes(2);
      expect(connects).toHaveLength(2);
      // Land the two held deletes so no sub slot leaks into later tests.
      connects[0](deleteClient());
      connects[1](deleteClient());
      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(true);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
      dbMock.connect.mockReset();
      vi.useRealTimers();
    }
  });

  it('bounds the permit wait at 15s and lets the caller signal cut it shorter', async () => {
    vi.useFakeTimers();
    try {
      // The gate acquirer receives ONE composed signal (the caller's, if any,
      // joined with the wait timer): resolve null only when it aborts, the
      // real majorBackgroundDbGate contract.
      const seenSignals: AbortSignal[] = [];
      const acquire = vi.fn(
        (signal: AbortSignal) =>
          new Promise<null>((resolve) => {
            seenSignals.push(signal);
            signal.addEventListener('abort', () => resolve(null), { once: true });
          }),
      );
      configureCharacterDeleteBackgroundGate(acquire as never);
      const busyBefore = characterDeleteGateStats().busyRefusals;
      // Attach the rejection handler BEFORE advancing the clock: the refusal
      // fires inside the awaited timer flush, and a handler attached after
      // that flush leaves the rejection momentarily unhandled, which CI's
      // runner rightly reports as an unhandled error.
      const refused = expect(deleteCharacter(7, 42)).rejects.toMatchObject({
        code: 'CHARACTER_DELETE_QUEUE_SATURATED',
      });
      // Under the wall, the wait holds; AT the wall it aborts and refuses.
      await vi.advanceTimersByTimeAsync(14_999);
      expect(seenSignals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await refused;
      expect(dbMock.connect).not.toHaveBeenCalled();
      // The wall refusal is real saturation and books the busy counter.
      expect(characterDeleteGateStats().busyRefusals).toBe(busyBefore + 1);

      // A caller-side abort composes in and cuts the wait short of the wall,
      // but it is an ABANDONMENT (the socket is gone), never saturation: the
      // distinct error keeps the 503 and its counter meaning saturation.
      const controller = new AbortController();
      const early = expect(deleteCharacter(7, 42, controller.signal)).rejects.toMatchObject({
        name: CharacterDeleteClientGone.name,
        code: 'CHARACTER_DELETE_CLIENT_GONE',
        characterId: 42,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      controller.abort();
      await early;
      expect(seenSignals[1]?.aborted).toBe(true);
      // The abandonment never books the saturation counter.
      expect(characterDeleteGateStats().busyRefusals).toBe(busyBefore + 1);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
      vi.useRealTimers();
    }
  });

  it('releases the permit when the checkout itself rejects', async () => {
    const release = vi.fn();
    configureCharacterDeleteBackgroundGate(async () => ({ release }));
    dbMock.connect.mockRejectedValueOnce(new Error('pool exhausted'));
    try {
      await expect(deleteCharacter(7, 42)).rejects.toThrow('pool exhausted');
    } finally {
      configureCharacterDeleteBackgroundGate(null);
    }
    expect(release).toHaveBeenCalledOnce();
  });

  it('applies the sub-cap even when no realm gate is registered', async () => {
    vi.useFakeTimers();
    // Deliberately NO configureCharacterDeleteBackgroundGate call: the
    // delete-local bound must hold on its own, so an unregistered realm gate
    // (tests, a boot window) can never admit an unbounded delete stampede.
    const connects: Array<(client: ReturnType<typeof deleteClient>) => void> = [];
    dbMock.connect.mockImplementation(() => new Promise((resolve) => connects.push(resolve)));
    try {
      const first = deleteCharacter(7, 42);
      const second = deleteCharacter(7, 43);
      await vi.advanceTimersByTimeAsync(0);
      expect(connects).toHaveLength(2);
      // Attach the rejection handler BEFORE advancing the clock (the CI
      // unhandled-rejection rule the sibling tests follow).
      const refused = expect(deleteCharacter(7, 44)).rejects.toMatchObject({
        code: 'CHARACTER_DELETE_QUEUE_SATURATED',
        characterId: 44,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await refused;
      // The parked third delete never touched the pool.
      expect(connects).toHaveLength(2);
      connects[0](deleteClient());
      connects[1](deleteClient());
      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(true);
    } finally {
      dbMock.connect.mockReset();
      vi.useRealTimers();
    }
  });

  it('releases the sub slot when the realm gate acquire rejects, keeping later deletes admitted', async () => {
    configureCharacterDeleteBackgroundGate(async () => {
      throw new Error('realm gate exploded');
    });
    try {
      await expect(deleteCharacter(7, 42)).rejects.toThrow('realm gate exploded');
      await expect(deleteCharacter(7, 43)).rejects.toThrow('realm gate exploded');
      // The decisive leak check (mutation-proven gap: dropping the
      // subPermit.release() from the acquire catch leaves in_flight pinned at
      // the sub-cap here, and every later delete would park forever).
      expect(characterDeleteGateStats().inFlight).toBe(0);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
    }
    // A restored gate admits the next deletes: both slots really came back.
    const release = vi.fn();
    configureCharacterDeleteBackgroundGate(async () => ({ release }));
    dbMock.connect.mockResolvedValueOnce(deleteClient()).mockResolvedValueOnce(deleteClient());
    try {
      await expect(deleteCharacter(7, 44)).resolves.toBe(true);
      await expect(deleteCharacter(7, 45)).resolves.toBe(true);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
    }
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('releases the sub slot even when the realm permit release throws', async () => {
    configureCharacterDeleteBackgroundGate(async () => ({
      release: () => {
        throw new Error('realm release failed');
      },
    }));
    dbMock.connect.mockResolvedValueOnce(deleteClient());
    try {
      // The composed release runs in the checkout finally, so the throw
      // surfaces to the caller; the guarded ordering must still return the
      // delete slot (unguarded, the throw skips subSlot.release()).
      await expect(deleteCharacter(7, 42)).rejects.toThrow('realm release failed');
      expect(characterDeleteGateStats().inFlight).toBe(0);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
    }
  });

  it('a client disconnect after BEGIN no longer tears the transaction: the DELETE still commits', async () => {
    const client = clientStub();
    const deleteReleases: Array<(result: { rows: unknown[]; rowCount: number }) => void> = [];
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id FROM accounts/i.test(sql)) return { rows: [{ id: 7 }], rowCount: 1 };
      if (/SELECT id FROM characters/i.test(sql)) return { rows: [{ id: 42 }], rowCount: 1 };
      if (/FROM storage_purchases/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/DELETE FROM characters/i.test(sql)) {
        return new Promise((resolve) => {
          deleteReleases.push(resolve);
        });
      }
      return { rows: [], rowCount: 0 };
    });
    dbMock.connect.mockResolvedValueOnce(client);
    const controller = new AbortController();
    const done = deleteCharacter(7, 42, controller.signal);
    await vi.waitFor(() => {
      if (deleteReleases.length === 0) throw new Error('the DELETE has not started yet');
    });
    // The client tears the connection while the cascade is mid-flight. The
    // request signal is spent at the permit wait; threaded into the deadline
    // it destroyed the socket HERE, and an abort landing during COMMIT could
    // commit the DELETE while the caller skipped the world-state purge.
    controller.abort();
    deleteReleases[0]({ rows: [], rowCount: 1 });
    await expect(done).resolves.toBe(true);
    expect(client.query.mock.calls.map((call) => String(call[0]))).toContain('COMMIT');
    expect(dbMock.bustGuildList).toHaveBeenCalledOnce();
  });

  /** A delete client whose COMMIT hangs until the wall deadline destroys the
   * socket; release(error) then rejects the hung COMMIT the way pg rejects
   * the active query of a destroyed connection. */
  function hungCommitClient() {
    const client = clientStub();
    let rejectCommit: ((error: Error) => void) | null = null;
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id FROM accounts/i.test(sql)) return { rows: [{ id: 7 }], rowCount: 1 };
      if (/SELECT id FROM characters/i.test(sql)) return { rows: [{ id: 42 }], rowCount: 1 };
      if (/FROM storage_purchases/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/DELETE FROM characters/i.test(sql)) return { rows: [], rowCount: 1 };
      if (sql === 'COMMIT') {
        return new Promise((_resolve, reject) => {
          rejectCommit = reject;
        });
      }
      return { rows: [], rowCount: 0 };
    });
    client.release.mockImplementation(() => {
      rejectCommit?.(new Error('Connection terminated unexpectedly'));
    });
    return client;
  }

  it('verifies an ambiguous COMMIT and reports success when the row is gone', async () => {
    vi.useFakeTimers();
    try {
      const txClient = hungCommitClient();
      const verifyClient = clientStub();
      const landedBefore = characterDeleteGateStats().verifyLanded;
      // The fresh verification read finds no row: the COMMIT landed, so the
      // delete must report success (link change, busts, and the HTTP arms'
      // world-state purge all key off it) instead of stranding the escrow.
      dbMock.connect.mockResolvedValueOnce(txClient).mockResolvedValueOnce(verifyClient);
      const done = deleteCharacter(7, 42);
      await vi.advanceTimersByTimeAsync(0);
      // The 65s transaction wall expires while COMMIT is in flight: the one
      // remaining ambiguity carrier now that no caller signal reaches it.
      await vi.advanceTimersByTimeAsync(65_000);
      await expect(done).resolves.toBe(true);
      // The verify WAITS the hung COMMIT out instead of racing it: its read
      // runs row-locked inside its own bounded transaction (a plain SELECT's
      // READ COMMITTED snapshot sees the deleted-but-uncommitted row as
      // present and answers "not landed" for a delete that then commits).
      const sql = verifyClient.query.mock.calls.map((call) => String(call[0]));
      expect(sql[0]).toBe('BEGIN');
      expect(sql[1]).toContain(`lock_timeout = ${CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS}`);
      expect(sql[1]).toContain(`statement_timeout = ${DELETE_RESTORE_STATEMENT_TIMEOUT_MS}`);
      expect(sql[1]).toContain("idle_in_transaction_session_timeout = '2s'");
      const read = verifyClient.query.mock.calls.find((call) =>
        /SELECT 1 FROM characters/.test(String(call[0])),
      );
      expect(String(read?.[0])).toBe(CHARACTER_DELETE_VERIFY_SQL);
      // Literal pins on the constant itself (never a self-comparison): the
      // lock clause and the whole identity predicate are load-bearing. KEY
      // SHARE, not FOR UPDATE: it queues behind the in-flight DELETE
      // identically, but in the not-landed case it briefly holds a LIVE
      // character's row, where FOR UPDATE blocked a concurrent character
      // save into its 2s lock_timeout (measured; see the SQL's doc).
      expect(CHARACTER_DELETE_VERIFY_SQL).toContain('FOR KEY SHARE');
      expect(CHARACTER_DELETE_VERIFY_SQL).toContain(
        'WHERE id = $1 AND account_id = $2 AND realm = $3',
      );
      expect(read?.[1]).toEqual([42, 7, REALM]);
      expect(sql.at(-1)).toBe('ROLLBACK');
      expect(verifyClient.release).toHaveBeenCalledOnce();
      // A clean verify returns the client to the pool, never discards it.
      expect(verifyClient.release.mock.calls[0]).toEqual([]);
      // The FATAL guard wraps the whole checkout window (pg-pool detaches
      // its own idle listener on acquire) and detaches before release.
      expect(verifyClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(verifyClient.removeListener).toHaveBeenCalledWith('error', expect.any(Function));
      // The landed outcome is counted (the resolver was production-invisible
      // without it).
      expect(characterDeleteGateStats().verifyLanded).toBe(landedBefore + 1);
      expect(dbMock.bustGuildList).toHaveBeenCalledOnce();
      expect(drainLinkChanges()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates an ambiguous COMMIT when the verification still finds the row', async () => {
    vi.useFakeTimers();
    try {
      const txClient = hungCommitClient();
      const verifyClient = clientStub();
      const notLandedBefore = characterDeleteGateStats().verifyNotLanded;
      // Row present ONLY on the verify read: BEGIN/SET LOCAL/ROLLBACK keep
      // their empty results, so the present answer is the SELECT's own.
      verifyClient.query.mockImplementation(async (sql: string) =>
        /SELECT 1 FROM characters/.test(sql)
          ? { rows: [{ found: 1 }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
      );
      dbMock.connect.mockResolvedValueOnce(txClient).mockResolvedValueOnce(verifyClient);
      // Attach the rejection handler BEFORE advancing the clock (the CI
      // unhandled-rejection rule the sibling tests follow).
      const failed = expect(deleteCharacter(7, 42)).rejects.toMatchObject({
        name: 'DbTransactionDeadlineExceeded',
        commitMayHaveSucceeded: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(65_000);
      await failed;
      // The row survived, so the failure stands and no success side runs.
      expect(verifyClient.release).toHaveBeenCalledOnce();
      expect(dbMock.bustGuildList).not.toHaveBeenCalled();
      expect(drainLinkChanges()).toHaveLength(0);
      expect(characterDeleteGateStats().verifyNotLanded).toBe(notLandedBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds the verify lock wait UNDER its statement bound', () => {
    // The wait must expire as a coded 55P03 lock_not_available, which the
    // resolver's catch maps to honest ambiguity; with the statement bound at
    // or under the lock bound, statement_timeout fires first and cancels the
    // read without saying WHY (measured: a blocked locked read under the
    // inverted ordering dies 57014). The pg suite drives the live
    // semantics; this ordering is the always-run half, and the literal makes
    // a drifted wait a conscious edit.
    expect(CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS).toBe(10_000);
    expect(CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS).toBeLessThan(
      DELETE_RESTORE_STATEMENT_TIMEOUT_MS,
    );
  });

  it('propagates the ambiguity when the verify CHECKOUT itself rejects', async () => {
    // One of the resolver's two catch-and-return-false error arms: flipping
    // it to true would run the world-state purge for a delete that never
    // provably landed. The pool refusing a second client under exactly the
    // saturation that expired the wall is the realistic shape.
    vi.useFakeTimers();
    try {
      const txClient = hungCommitClient();
      const failedBefore = characterDeleteGateStats().verifyFailed;
      dbMock.connect
        .mockResolvedValueOnce(txClient)
        .mockRejectedValueOnce(new Error('pool exhausted'));
      const failed = expect(deleteCharacter(7, 42)).rejects.toMatchObject({
        name: 'DbTransactionDeadlineExceeded',
        commitMayHaveSucceeded: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(65_000);
      await failed;
      // The checkout was really ATTEMPTED (the rejection above was consumed,
      // not skipped): a resolver that never tried would also pass the rest.
      expect(dbMock.connect).toHaveBeenCalledTimes(2);
      expect(dbMock.bustGuildList).not.toHaveBeenCalled();
      expect(drainLinkChanges()).toHaveLength(0);
      expect(characterDeleteGateStats().verifyFailed).toBe(failedBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates the ambiguity when the verify READ rejects, discarding the verify client', async () => {
    // The other error arm: a lock_timeout expiry (the hung COMMIT outlasting
    // the bounded wait) rejects the verify read. The ORIGINAL ambiguity must
    // stand (never the verify error), and the client, mid-transaction in an
    // unknown state, must be DISCARDED (release with an error), not returned
    // to the pool; dropping that release leaks a client on every
    // ambiguous-commit-plus-failed-verify.
    vi.useFakeTimers();
    try {
      const txClient = hungCommitClient();
      const verifyClient = clientStub();
      const failedBefore = characterDeleteGateStats().verifyFailed;
      verifyClient.query.mockImplementation(async (sql: string) => {
        if (/SELECT 1 FROM characters/.test(sql)) {
          throw Object.assign(new Error('canceling statement due to lock timeout'), {
            code: '55P03',
          });
        }
        return { rows: [], rowCount: 0 };
      });
      dbMock.connect.mockResolvedValueOnce(txClient).mockResolvedValueOnce(verifyClient);
      const failed = expect(deleteCharacter(7, 42)).rejects.toMatchObject({
        name: 'DbTransactionDeadlineExceeded',
        commitMayHaveSucceeded: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(65_000);
      await failed;
      expect(verifyClient.release).toHaveBeenCalledOnce();
      expect(verifyClient.release.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(dbMock.bustGuildList).not.toHaveBeenCalled();
      expect(drainLinkChanges()).toHaveLength(0);
      expect(characterDeleteGateStats().verifyFailed).toBe(failedBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reports a landed verify when only the cleanup ROLLBACK fails, discarding the client', async () => {
    // The one arm that returns the computed answer despite a failed cleanup,
    // deliberately: the row-gone reading was already definitive, and
    // demoting it back to ambiguity would skip the world-state purge for a
    // delete that provably landed (the exact bug the resolver fixes).
    vi.useFakeTimers();
    try {
      const txClient = hungCommitClient();
      const verifyClient = clientStub();
      verifyClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('Connection terminated unexpectedly');
        return { rows: [], rowCount: 0 };
      });
      dbMock.connect.mockResolvedValueOnce(txClient).mockResolvedValueOnce(verifyClient);
      const done = deleteCharacter(7, 42);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(65_000);
      await expect(done).resolves.toBe(true);
      expect(dbMock.bustGuildList).toHaveBeenCalledOnce();
      // Discarded exactly ONCE, with the error: the cleanup failure must
      // never be followed by a second release (pg throws on double release).
      expect(verifyClient.release).toHaveBeenCalledOnce();
      expect(verifyClient.release.mock.calls[0][0]).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the delete permit across the ambiguity verify (the wait rides the admission)', async () => {
    // The docstring claim, pinned as an ordering: the verify checkout lands
    // BEFORE the permit release. Moved after the finally, the verify would
    // start stacking over the sub-cap under exactly the saturation that
    // produced the ambiguity, with every test still green but this one.
    vi.useFakeTimers();
    const order: string[] = [];
    configureCharacterDeleteBackgroundGate(async () => ({
      release: () => {
        order.push('permit_released');
      },
    }));
    try {
      const txClient = hungCommitClient();
      const verifyClient = clientStub();
      dbMock.connect
        .mockImplementationOnce(async () => {
          order.push('connect_tx');
          return txClient;
        })
        .mockImplementationOnce(async () => {
          order.push('connect_verify');
          return verifyClient;
        });
      const done = deleteCharacter(7, 42);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(65_000);
      await expect(done).resolves.toBe(true);
      expect(order).toEqual(['connect_tx', 'connect_verify', 'permit_released']);
    } finally {
      configureCharacterDeleteBackgroundGate(null);
      vi.useRealTimers();
    }
  });
});

describe('consumeAppearanceReroll', () => {
  // The WHERE arm of this one UPDATE is the eligibility AUTHORITY: the JS
  // mirror the roster button reads (appearanceRerollAvailable) is pinned by
  // tests/server/characters.test.ts, but if THIS statement drifts, the button
  // renders for a character the UPDATE refuses or hides for one it would
  // accept. So the statement itself is pinned here, the renameCharacter
  // pattern: every eligibility predicate inside the SQL, asserted as SQL.
  const LOOK = { gender: 'female' as const };
  const CUTOFF = new Date('2026-08-17T00:00:00Z');

  it('decides everything inside the one UPDATE: ownership, realm, window-or-never-designed, unspent token', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    await consumeAppearanceReroll(7, 42, LOOK, true, CUTOFF);

    const [sql, params] = dbMock.query.mock.calls.at(-1)!;
    expect(sql).toMatch(/UPDATE characters/i);
    // the atomic one-shot: the token burns in the same statement as the look
    expect(sql).toMatch(/appearance_reroll_used\s*=\s*TRUE/i);
    expect(sql).toMatch(/appearance_reroll_used\s*=\s*FALSE/i);
    // the free window OR the never-designed safety net, disjoined in SQL so
    // two racing submits cannot both land whichever arm admits them
    expect(sql).toMatch(/created_at\s*<\s*\$6\s+OR\s+appearance\s+IS\s+NULL/i);
    // BOLA scoping, the getCharacter trio
    expect(sql).toMatch(/account_id\s*=\s*\$2/);
    expect(sql).toMatch(/realm\s*=\s*\$4/);
    expect(params).toEqual([42, 7, JSON.stringify(LOOK), REALM, true, CUTOFF]);
  });

  it('edits the ONE helm key in the state blob, guarded on an actual change', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    await consumeAppearanceReroll(7, 42, LOOK, true, CUTOFF);
    const [sql] = dbMock.query.mock.calls.at(-1)!;
    // jsonb_set / minus-key, never a whole-blob rewrite from an HTTP route...
    expect(sql).toMatch(/jsonb_set\(state,\s*'\{helmHidden\}'/);
    expect(sql).toMatch(/state\s*-\s*'helmHidden'/);
    // ...and each arm fires only when the value actually moves, because both
    // operators mint a whole new datum: an unguarded write detoasts and
    // re-TOASTs the entire blob even when nothing changed.
    expect(sql).toMatch(/IS DISTINCT FROM 'true'::jsonb/);
    expect(sql).toMatch(/state \? 'helmHidden'/);
    // a NULL helm choice (client offered no toggle) leaves the blob alone
    expect(sql).toMatch(/\$5::boolean IS NULL THEN state/);
  });

  it('maps rowCount to the applied/refused boolean the route answers with', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    expect(await consumeAppearanceReroll(7, 42, LOOK, null, CUTOFF)).toBe(true);
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    expect(await consumeAppearanceReroll(7, 42, LOOK, null, CUTOFF)).toBe(false);
  });
});

describe('createCharacterCapped appearance column', () => {
  it('persists the authored look as the sixth INSERT column, null for a legacy client', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query.mockImplementation(async (sql: string) => {
      if (/FROM accounts/i.test(sql)) return { rows: [{ id: 7 }], rowCount: 1 };
      if (/count\(\*\)/i.test(sql)) return { rows: [{ n: 0 }], rowCount: 1 };
      if (/INSERT INTO characters/i.test(sql)) {
        return { rows: [{ id: 100, account_id: 7 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await createCharacterCapped(7, 'Designed', 'mage', 10, null, { gender: 'female' });
    let insert = client.query.mock.calls.find((c: any[]) => /INSERT INTO characters/i.test(c[0]))!;
    expect(insert[0]).toMatch(/appearance\)/);
    expect(insert[1][5]).toBe(JSON.stringify({ gender: 'female' }));

    client.query.mockClear();
    await createCharacterCapped(7, 'Legacy', 'mage', 10, null, null);
    insert = client.query.mock.calls.find((c: any[]) => /INSERT INTO characters/i.test(c[0]))!;
    expect(insert[1][5]).toBeNull();
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
      rows: [
        {
          id: 42,
          account_id: 7,
          name: 'Newname',
          class: 'mage',
          level: 5,
          state: null,
          is_gm: false,
          force_rename: false,
        },
      ],
      rowCount: 1,
    } as any);
    expect((await renameCharacter(7, 42, 'Newname'))?.name).toBe('Newname');
    // A landed rename moves the bot-visible flex name (and the profileUrl derived
    // from it), so it is a flex transition (Phase 5 QA feed sweep).
    expect(drainLinkChanges()).toEqual([{ accountId: 7, kinds: ['flex'] }]);
    expect(dbMock.bustGuildList).toHaveBeenCalledOnce();

    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    expect(await renameCharacter(7, 42, 'Newname')).toBeNull();
    // No sanctioned rename matched: no transition, no feed item.
    expect(drainLinkChanges()).toEqual([]);
    // The success arm above already busted once; the null arm adds nothing.
    expect(dbMock.bustGuildList).toHaveBeenCalledOnce();
  });

  it('does not invalidate the guild directory when the rename fails', async () => {
    dbMock.query.mockRejectedValueOnce(new Error('rename failed'));

    await expect(renameCharacter(7, 42, 'Newname')).rejects.toThrow('rename failed');

    expect(dbMock.bustGuildList).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({
        rows: [
          {
            id: 99,
            name: 'SturdyStubs',
            level: 4,
            state: { skin: 2 },
            account_id: 7,
            deactivated_at: '2026-01-01T00:00:00Z',
            banned_at: null,
          },
        ],
        rowCount: 1,
      } as any) // holder lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // archive-name clash check: free
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any) // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // COMMIT

    // The archived identity comes back so the caller can rekey the freed
    // name's world state (market, mail, the orphan's own signed instances)
    // exactly like a rename. freedName is the holder's STORED name (the
    // lookup below is case-insensitive), and the blob rides along for the
    // signer sweep.
    await expect(reclaimDeactivatedName('sturdystubs')).resolves.toEqual({
      id: 99,
      archivedName: 'SturdyStubsa',
      freedName: 'SturdyStubs',
      level: 4,
      state: { skin: 2 },
    });

    const calls = client.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[1][0]).toMatch(/deactivated_at/);
    expect(calls[1][0]).toMatch(/FOR UPDATE/);
    expect(calls[1][0]).toMatch(/lower\(c\.name\)\s*=\s*lower\(\$2\)/);
    expect(calls[1][1]).toEqual([REALM, 'sturdystubs']);
    const updateCall = calls.find((c) => /UPDATE characters/i.test(c[0]));
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toMatch(/force_rename\s*=\s*TRUE/i);
    expect(updateCall![1][0]).toBe(99); // scoped to the orphaned character id
    expect(updateCall![1][1]).toBe('SturdyStubsa'); // archival placeholder
    const commitIndex = calls.findIndex((c) => c[0] === 'COMMIT');
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(dbMock.bustGuildList).toHaveBeenCalledOnce();
    expect(client.query.mock.invocationCallOrder[commitIndex]).toBeLessThan(
      dbMock.bustGuildList.mock.invocationCallOrder[0],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
    // The archived name is bot-visible via the flex payload and deactivation keeps
    // the link row, so the release enqueues ONE flex item for the HOLDER's account
    // (Phase 5 QA feed sweep). The holder SELECT must carry account_id for it.
    expect(calls[1][0]).toMatch(/c\.account_id/);
    // The rich return's level/state come from the MOCK ROW, so the toEqual above
    // is blind to the column list; these pins hold the hand-unioned SELECT (the
    // caller feeds reclaimed.level/state straight into a real save write).
    expect(calls[1][0]).toMatch(/c\.level/);
    expect(calls[1][0]).toMatch(/c\.state/);
    expect(drainLinkChanges()).toEqual([{ accountId: 7, kinds: ['flex'] }]);
  });

  it('does nothing and reports false when the name is held by a live account', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 99, name: 'SturdyStubs', deactivated_at: null, banned_at: null }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(reclaimDeactivatedName('SturdyStubs')).resolves.toBeNull();
    const verbs = client.query.mock.calls.map((c) => c[0]);
    expect(verbs).not.toContain('COMMIT');
    expect(verbs).toContain('ROLLBACK');
    expect(verbs.some((s) => /UPDATE characters/i.test(s))).toBe(false);
    // A refusal is not a transition: nothing may reach the change feed.
    expect(drainLinkChanges()).toEqual([]);
    expect(dbMock.bustGuildList).not.toHaveBeenCalled();
  });

  it('does nothing when the name is not held at all', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // no holder
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(reclaimDeactivatedName('Nobody')).resolves.toBeNull();
    expect(client.query.mock.calls.map((c) => c[0])).not.toContain('COMMIT');
    // A refusal is not a transition: nothing may reach the change feed.
    expect(drainLinkChanges()).toEqual([]);
  });

  it("leaves a banned account's name reserved even when the account is deactivated", async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 99,
            name: 'SturdyStubs',
            deactivated_at: '2026-01-01T00:00:00Z',
            banned_at: '2026-01-01T00:00:00Z',
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(reclaimDeactivatedName('SturdyStubs')).resolves.toBeNull();
    expect(client.query.mock.calls.map((c) => c[0]).some((s) => /UPDATE characters/i.test(s))).toBe(
      false,
    );
    // The moderation-hold refusal must not reach the change feed either.
    expect(drainLinkChanges()).toEqual([]);
  });
});

describe('account and session request metadata', () => {
  it('stores account creation IP and user agent when registering', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ id: 7, username: 'alice', password_hash: 'hash' }],
    } as any);

    await createAccount('alice', 'hash', { ip: '203.0.113.4', userAgent: 'Mozilla/5.0' });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/created_ip/);
    expect(sql).toMatch(/created_user_agent/);
    expect(params).toEqual(['alice', 'hash', '203.0.113.4', 'Mozilla/5.0', true]);
  });

  it('updates last login IP and user agent when logging in', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] } as any);

    await touchLogin(7, { ip: '203.0.113.5', userAgent: 'Mozilla/5.0' });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/last_login_ip/);
    expect(sql).toMatch(/last_login_user_agent/);
    expect(params).toEqual([7, '203.0.113.5', 'Mozilla/5.0']);
  });

  it('backfills a recovery email only for accounts that have none (Discord capture)', async () => {
    dbMock.query.mockResolvedValueOnce({ rowCount: 1 } as any);
    const filled = await backfillAccountEmailIfEmpty(7, 'from-discord@example.com', true);

    const [sql, params] = dbMock.query.mock.calls[0];
    // The guard is in the UPDATE (WHERE email IS NULL OR email = ''), never a
    // read-then-write, and email_verified_at is stamped only when verified.
    expect(sql).toMatch(/email IS NULL OR email = ''/);
    expect(sql).toMatch(/email_verified_at = CASE WHEN/);
    expect(params).toEqual([7, 'from-discord@example.com', true]);
    expect(filled).toBe(true);
  });

  it('reports no backfill when the account already had a recovery email', async () => {
    dbMock.query.mockResolvedValueOnce({ rowCount: 0 } as any);
    const filled = await backfillAccountEmailIfEmpty(7, 'from-discord@example.com', false);
    expect(filled).toBe(false);
  });

  it('stores play session IP and user agent when entering the world', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ id: 99 }] } as any);

    await openPlaySession(7, 42, 'Alice', { ip: '203.0.113.6', userAgent: 'Mozilla/5.0' });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/ip_address/);
    expect(sql).toMatch(/user_agent/);
    expect(sql).toContain('player_account_facts');
    expect(sql).toContain('player_activity_daily');
    expect(params).toEqual([7, 42, 'Alice', REALM, 1, '203.0.113.6', 'Mozilla/5.0']);
  });
});

describe('account cosmetics', () => {
  it('loads normalized account cosmetic unlocks', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          cosmetics: {
            completedQuestIds: ['q_aldrics_fallen_star', 4, 'q_aldrics_fallen_star'],
            mechChromaIds: ['amber_crimson', null, 'onyx_gold'],
          },
        },
      ],
    } as any);

    await expect(loadAccountCosmetics(7)).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson', 'onyx_gold'],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });

    expect(dbMock.query.mock.calls[0][0]).toContain('cosmetics');
    expect(dbMock.query.mock.calls[0][1]).toEqual([7]);
  });

  it('persists account-wide quest completion without replacing existing cosmetic unlocks', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          cosmetics: {
            completedQuestIds: ['q_aldrics_fallen_star'],
            mechChromaIds: ['onyx_gold'],
          },
        },
      ],
    } as any);

    await expect(markAccountQuestComplete(7, 'q_aldrics_fallen_star')).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['onyx_gold'],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE accounts/);
    expect(sql).toMatch(/jsonb_set/);
    expect(sql).toMatch(/LEFT JOIN account_weapon_cosmetics/);
    expect(params).toEqual([7, 'completedQuestIds', 'q_aldrics_fallen_star']);
  });

  it('persists mech chroma unlocks without replacing account quest lockouts', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          cosmetics: {
            completedQuestIds: ['q_aldrics_fallen_star'],
            mechChromaIds: ['amber_crimson'],
          },
        },
      ],
    } as any);

    await expect(grantAccountMechChroma(7, 'amber_crimson')).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson'],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/jsonb_set/);
    expect(params).toEqual([7, 'mechChromaIds', 'amber_crimson']);
  });
});

describe('account weapon skin cosmetics', () => {
  it('keeps paid weapon cosmetics in a dedicated rollback-safe table', async () => {
    expect(SCHEMA).toMatch(/CREATE TABLE IF NOT EXISTS account_weapon_cosmetics/);
    expect(SCHEMA).toMatch(/INSERT INTO account_weapon_cosmetics/);
    expect(SCHEMA).toMatch(/ON CONFLICT \(account_id\) DO NOTHING/);

    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          cosmetics: {
            completedQuestIds: ['q_aldrics_fallen_star'],
            mechChromaIds: ['amber_crimson'],
            // A stale legacy copy must not override the dedicated paid state.
            weaponSkinIds: ['guildmark_arming_sword'],
            weaponSkinLoadout: { sword: 'guildmark_arming_sword' },
          },
          weapon_skin_ids: ['ice_fang_sword'],
          weapon_skin_loadout: { sword: 'ice_fang_sword' },
        },
      ],
    } as any);

    await expect(loadAccountCosmetics(7)).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson'],
      weaponSkinIds: ['ice_fang_sword'],
      weaponSkinLoadout: { sword: 'ice_fang_sword' },
    });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN account_weapon_cosmetics/);
    expect(params).toEqual([7]);
  });

  it('grants skins atomically in the dedicated table and returns the merged row', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          cosmetics: {
            completedQuestIds: ['q_aldrics_fallen_star'],
            mechChromaIds: [],
          },
          // Junk shapes in the dedicated JSONB normalize away on the way out.
          weapon_skin_ids: ['ice_fang_sword', 4, 'ice_fang_sword'],
          weapon_skin_loadout: { sword: 'ice_fang_sword', axe: 9 },
        },
      ],
    } as any);

    await expect(grantAccountWeaponSkins(7, ['ice_fang_sword'])).resolves.toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: [],
      weaponSkinIds: ['ice_fang_sword'],
      weaponSkinLoadout: { sword: 'ice_fang_sword' },
    });

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO account_weapon_cosmetics/);
    expect(sql).toMatch(/ON CONFLICT \(account_id\) DO UPDATE/);
    expect(sql).toMatch(/RETURNING account_id, skin_ids, loadout/);
    expect(params).toEqual([7, ['ice_fang_sword']]);
  });

  it('drops empty ids from the grant params (defensive filter)', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] } as any);

    await grantAccountWeaponSkins(7, ['ice_fang_sword', '']);

    expect(dbMock.query.mock.calls[0][1]).toEqual([7, ['ice_fang_sword']]);
  });

  it('replaces the dedicated loadout atomically with the JSON-encoded record', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          cosmetics: {
            completedQuestIds: [],
            mechChromaIds: [],
          },
          weapon_skin_ids: ['ice_fang_sword'],
          weapon_skin_loadout: { sword: 'ice_fang_sword' },
        },
      ],
    } as any);

    await expect(setAccountWeaponSkinLoadout(7, { sword: 'ice_fang_sword' })).resolves.toEqual({
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: ['ice_fang_sword'],
      weaponSkinLoadout: { sword: 'ice_fang_sword' },
    });

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO account_weapon_cosmetics/);
    expect(sql).toMatch(/loadout = EXCLUDED\.loadout/);
    expect(sql).toMatch(/RETURNING account_id, skin_ids, loadout/);
    expect(params).toEqual([7, JSON.stringify({ sword: 'ice_fang_sword' })]);
  });

  it('normalizes a malformed RETURNING (no row) into the 4-field default shape', async () => {
    const defaults = {
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    };

    dbMock.query.mockResolvedValueOnce({ rows: [] } as any);
    await expect(setAccountWeaponSkinLoadout(7, {})).resolves.toEqual(defaults);

    dbMock.query.mockResolvedValueOnce({ rows: [] } as any);
    await expect(grantAccountWeaponSkins(7, ['ice_fang_sword'])).resolves.toEqual(defaults);
  });
});

describe('bankBonusFactsForAccount', () => {
  // The bank bonus-slot facts read at every fresh join. One round trip, fully
  // parameterized, with the RESOLVED criteria (verified email, level-10 referee), and
  // NEVER a balance/holder/chain read for the wallet fact.
  it('reads all four facts in one parameterized query carrying the load-bearing predicates', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          email_verified: true,
          discord_linked: false,
          wallet_linked: true,
          qualified_referrals: 3,
          character_count: 2,
        },
      ],
    } as any);

    const facts = await bankBonusFactsForAccount(7);

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    // Bound to $1, never string-interpolated (an id spliced into the SQL would be an
    // injection vector and would fail this pair of assertions).
    expect(params).toEqual([7]);
    expect(sql).toContain('$1');
    expect(sql).not.toMatch(/id\s*=\s*7/);
    // The verified-email criterion (never email-present) and the level-10 referee gate.
    expect(sql).toMatch(/email_verified_at IS NOT NULL/i);
    expect(sql).toMatch(/level\s*>=\s*10/);
    // A link ROW is the whole proof for Discord/wallet; a referral row feeds the count.
    expect(sql).toMatch(/discord_links/);
    expect(sql).toMatch(/wallet_links/);
    expect(sql).toMatch(/referrals/);
    // The referral DIRECTION: count referrals this account MADE (referrer = $1) whose
    // REFEREE owns the level-10 character. A swap would count referrals RECEIVED and
    // grant the wrong bonus to every referrer while passing every other assertion.
    expect(sql).toMatch(/referrer_account_id\s*=\s*\$1/);
    expect(sql).toMatch(/c\.account_id\s*=\s*r\.referee_account_id/);
    // Invariant: never a balance/holder-tier/chain read for the wallet fact.
    expect(sql).not.toMatch(/balance|holder|pubkey|chain/i);
    // Rows map straight onto the facts object.
    expect(facts).toEqual({
      emailVerified: true,
      discordLinked: false,
      walletLinked: true,
      qualifiedReferrals: 3,
      characterCount: 2,
    });
  });

  it('returns all-false/0 for a missing account (no row)', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] } as any);
    await expect(bankBonusFactsForAccount(999)).resolves.toEqual({
      emailVerified: false,
      discordLinked: false,
      walletLinked: false,
      qualifiedReferrals: 0,
      characterCount: 0,
    });
  });

  it('coerces db booleans and guards a null referral count into 0', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          email_verified: false,
          discord_linked: true,
          wallet_linked: false,
          qualified_referrals: null,
        },
      ],
    } as any);
    await expect(bankBonusFactsForAccount(7)).resolves.toEqual({
      emailVerified: false,
      discordLinked: true,
      walletLinked: false,
      qualifiedReferrals: 0,
      characterCount: 0,
    });
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
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            account_id: 7,
            name: 'Captest',
            class: 'mage',
            level: 1,
            state: null,
            is_gm: false,
            force_rename: false,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // player metric facts
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // COMMIT

    const row = await createCharacterCapped(7, 'Captest', 'mage', 10);

    expect(row?.id).toBe(42);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][1]).toEqual([7]);
    expect(client.query.mock.calls[2][0]).toContain('count(*)::int');
    expect(client.query.mock.calls[2][1]).toEqual([7, REALM]);
    expect(client.query.mock.calls[3][0]).toMatch(/INSERT INTO characters/);
    expect(client.query.mock.calls[4][0]).toContain('INSERT INTO player_account_facts');
    expect(client.query.mock.calls[5][0]).toBe('COMMIT');
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

// The characters-table writers on the linked-member change feed. A create can make the
// account's top character (and fixes that character's class forever), a delete can
// promote the next one, and the community-test roster defines a top character the
// instant it commits. The enqueue lives inside these db functions rather than at the
// routes so the RouteDef arm, its retained legacy twin in main.ts, and the PBE boost
// roster are all covered by one site each.
describe('character roster feed enqueues', () => {
  it('enqueues one flex item for the account a successful create belongs to', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ n: 2 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ id: 42, account_id: 7 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // player metric facts
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // COMMIT

    await createCharacterCapped(7, 'Feedtest', 'mage', 10);

    expect(drainLinkChanges()).toEqual([{ accountId: 7, kinds: ['flex'] }]);
  });

  it('enqueues nothing when the create is refused at the realm cap', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ n: 10 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // ROLLBACK

    await expect(createCharacterCapped(7, 'Overflow', 'warrior', 10)).resolves.toBeNull();

    expect(drainLinkChanges()).toEqual([]);
  });

  it('enqueues for a delete that matched a row, never for one that matched none', async () => {
    dbMock.connect.mockResolvedValueOnce(deleteClient({ character: false }));
    expect(await deleteCharacter(7, 42)).toBe(false);
    expect(drainLinkChanges()).toEqual([]);

    dbMock.connect.mockResolvedValueOnce(deleteClient());
    expect(await deleteCharacter(7, 42)).toBe(true);
    expect(drainLinkChanges()).toEqual([{ accountId: 7, kinds: ['flex'] }]);
  });

  it('enqueues the community-test roster only once the transaction commits', async () => {
    configureCommunityTestAccounts(true);
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO accounts/i.test(sql)) {
        return { rows: [{ id: 42, username: 'tester', password_hash: 'hash' }], rowCount: 1 };
      }
      if (/INSERT INTO characters/i.test(sql)) {
        return { rows: [{ id: 100, name: params?.[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await createAccount('tester', 'hash');

    // Nine roster characters, one item: the feed's unit is the account, not the row.
    expect(drainLinkChanges()).toEqual([{ accountId: 42, kinds: ['flex'] }]);
  });

  it('enqueues nothing when the roster transaction rolls back', async () => {
    configureCommunityTestAccounts(true);
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as any);
    let characterInsert = 0;
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO accounts/i.test(sql)) {
        return { rows: [{ id: 42, username: 'tester', password_hash: 'hash' }], rowCount: 1 };
      }
      if (/INSERT INTO characters/i.test(sql) && ++characterInsert === 4) {
        throw new Error('character write failed');
      }
      return { rows: [{ id: 100 }], rowCount: 1 };
    });

    await expect(createAccount('tester', 'hash')).rejects.toThrow('character write failed');

    // Three characters inserted before the failure, all of them rolled back: a feed
    // item here would tell the bot to re-read a roster that does not exist.
    expect(drainLinkChanges()).toEqual([]);
  });
});

describe('save-backend cancel wiring (db.ts and character_delete_db.ts source pins)', () => {
  // A deadline that destroys the save socket must also pg_cancel the backend,
  // or the accounts/characters/guild_banks locks ride out the full server-side
  // statement_timeout. The wrapper is the enforcement point: every character
  // save in db.ts must go through beginSaveTx, which forwards cancelSaveBackend.
  it('routes every db.ts character save through the cancel-wired wrapper', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('./helpers/strip_comments');
    const src = stripComments(readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8'));
    // The dedicated canceller, never backendCancelViaPool(pool): an expiry
    // cancel fires exactly when the main pool is the saturated thing.
    expect(src).toContain('const cancelSaveBackend = cancelDetachedBackend;');
    expect(src).not.toContain('backendCancelViaPool(pool)');
    expect(src).toContain('beginCharacterSaveTx(c, op, s, cancelSaveBackend);');
    // Exactly one direct call: the wrapper. A new save path calling
    // beginCharacterSaveTx directly would bypass the cancel wiring.
    expect(src.split('beginCharacterSaveTx(').length - 1).toBe(1);
    expect(src.split("beginSaveTx(client, '").length - 1).toBe(3);
  });

  it('wires backend cancel into the character delete transaction', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('./helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../server/character_delete_db.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('db.cancelBackend ??');
    expect(src).toContain('(db.query ? backendCancelViaPool(');
    // db.ts hands the delete its dedicated side-pool canceller, so the
    // pool-derived fallback only serves narrow test worlds.
    const dbSrc = stripComments(readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8'));
    expect(dbSrc).toContain(
      '{ connect: () => pool.connect(), cancelBackend: cancelDetachedBackend }',
    );
  });
});
