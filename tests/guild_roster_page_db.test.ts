// The atomic roster page write (server/guild_roster_page_db.ts): the
// compare-and-set, the receipt, and the fenced character save in ONE
// transaction, and the classification of every failure into a known refusal,
// a proven rollback, a receipt-proved commit, or ambiguity. The save helper,
// the transaction opener, and the account lock are the real modules' seams
// and are faked here so the statement order and the verdicts are what this
// suite decides on.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  save: vi.fn(),
  lock: vi.fn(),
  bustAdmin: vi.fn(),
}));

vi.mock('../server/db', () => ({ saveCharacterStateOnClient: mocks.save }));
vi.mock('../server/character_save_transaction', () => ({ beginCharacterSaveTx: mocks.begin }));
vi.mock('../server/bank_ledger_save_effects_db', () => ({
  lockCharacterSaveAccountParentKeyShareOnClient: mocks.lock,
}));
vi.mock('../server/admin_guilds_read', () => ({ bustAdminGuildListReads: mocks.bustAdmin }));

import { DbTransactionDeadlineExceeded } from '../server/db_transaction_deadline';
import { PAID_GUILD_RECEIPT_RECONCILE_QUERY_TIMEOUT_MS } from '../server/guild_create_db';
import {
  buyGuildRosterPageAtomic,
  GUILD_ROSTER_PAGE_CAS_SQL,
  GUILD_ROSTER_RECEIPT_INSERT_SQL,
  GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS,
  GUILD_ROSTER_RECEIPT_SELECT_SQL,
  type GuildRosterPageArgs,
} from '../server/guild_roster_page_db';
import { GUILD_ROSTER_MAX_PAGES } from '../src/sim/guild_roster';

const ACCOUNT_LOCK = { accountId: 5 };

function args(overrides: Partial<GuildRosterPageArgs> = {}): GuildRosterPageArgs {
  return {
    guildId: 42,
    expectedPages: 2,
    characterId: 7,
    accountId: 5,
    level: 3,
    state: { copper: 10 } as never,
    leaseNonce: 'lease-1',
    storageEffects: [],
    ledgerEffects: undefined,
    receipt: { batchKey: 'roster:test', copper: 400_000 },
    ...overrides,
  };
}

/** What one reconcile look answers: rows, a rejection, or a read that never
 *  returns (a lost connection), which only the deadline can end. */
type ReceiptAnswer = { rows: unknown[] } | Error | 'hang';

function harness(opts: { receipt?: () => ReceiptAnswer; gate?: boolean } = {}) {
  const transaction = {
    query: vi.fn(),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
  };
  // The reconcile reads run the REAL deadline wrapper over this client: it
  // attaches an error listener, issues BEGIN READ ONLY, the SET LOCAL
  // budget, the SELECT, and ROLLBACK, and destroys the client (release with
  // an error) plus cancels the backend when its deadline fires.
  let outstandingReads = 0;
  let maxOutstandingReads = 0;
  // A destroyed socket fails every in-flight query, the way pg does when the
  // deadline wrapper releases the client with an error.
  const hungReads: ((error: Error) => void)[] = [];
  const client = {
    query: vi.fn(async (sql: string, _values?: unknown[]) => {
      if (!sql.includes('FROM guild_roster_receipts')) return { rows: [] };
      const answer = opts.receipt?.() ?? { rows: [] };
      if (answer instanceof Error) throw answer;
      if (answer === 'hang') {
        outstandingReads += 1;
        maxOutstandingReads = Math.max(maxOutstandingReads, outstandingReads);
        return new Promise<never>((_resolve, reject) => {
          hungReads.push(reject);
        });
      }
      return answer;
    }),
    release: vi.fn((error?: unknown) => {
      if (!error) return;
      outstandingReads = 0;
      const death = new Error('Connection terminated');
      for (const reject of hungReads.splice(0)) reject(death);
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
    processID: 4242,
  };
  const pool = { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) };
  const bustGuildRoster = vi.fn();
  const cancelBackend = vi.fn(async () => {});
  const permits: { release: ReturnType<typeof vi.fn> }[] = [];
  const acquireBackgroundPermit = vi.fn(async () => {
    const permit = { release: vi.fn() };
    permits.push(permit);
    return permit;
  });
  // The (mocked) save transaction releases the client it was opened on, so
  // the write's own permit is freed exactly as the real wrapper frees it.
  mocks.begin.mockImplementation(async (client: { release(): void }) => {
    transaction.release.mockImplementation(() => client.release());
    return transaction;
  });
  mocks.lock.mockResolvedValue(ACCOUNT_LOCK);
  mocks.save.mockResolvedValue(true);
  const run = (a: GuildRosterPageArgs = args()) =>
    buyGuildRosterPageAtomic(
      {
        pool: pool as never,
        bustGuildRoster,
        cancelBackend,
        ...(opts.gate ? { acquireBackgroundPermit } : {}),
      },
      a,
    );
  const receiptReads = () =>
    client.query.mock.calls.filter(([sql]) => String(sql).includes('FROM guild_roster_receipts'));
  return {
    transaction,
    client,
    pool,
    bustGuildRoster,
    cancelBackend,
    acquireBackgroundPermit,
    permits,
    run,
    receiptReads,
    maxOutstandingReads: () => maxOutstandingReads,
  };
}

const sqlOf = (call: unknown[]): string => String(call[0]);

beforeEach(() => {
  mocks.begin.mockReset();
  mocks.save.mockReset();
  mocks.lock.mockReset();
  mocks.bustAdmin.mockReset();
});

describe('buyGuildRosterPageAtomic: the committed path', () => {
  it('locks the account, compare-and-sets the page, writes the receipt, saves fenced, commits', async () => {
    const h = harness();
    h.transaction.query
      .mockResolvedValueOnce({ rows: [{ roster_pages: 3 }], rowCount: 1 }) // CAS
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // receipt
    await expect(h.run()).resolves.toEqual({ durability: 'committed', pages: 3 });

    expect(mocks.begin).toHaveBeenCalledWith(
      expect.anything(),
      'guild roster page',
      undefined,
      expect.any(Function),
    );
    expect(mocks.lock).toHaveBeenCalledWith(h.transaction, 5);
    const [cas, receipt] = h.transaction.query.mock.calls;
    expect(sqlOf(cas)).toBe(GUILD_ROSTER_PAGE_CAS_SQL);
    expect(cas[1]).toEqual([42, 2, GUILD_ROSTER_MAX_PAGES, 7]);
    expect(sqlOf(receipt)).toBe(GUILD_ROSTER_RECEIPT_INSERT_SQL);
    expect(receipt[1]).toEqual(['roster:test', 42, 3, 7, 400_000]);
    // The fenced save rides the same transaction with the lease and the lock.
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const save = mocks.save.mock.calls[0];
    expect(save[0]).toBe(h.transaction);
    expect(save.slice(1)).toEqual([7, 3, { copper: 10 }, 'lease-1', [], undefined, ACCOUNT_LOCK]);
    expect(h.transaction.commit).toHaveBeenCalledTimes(1);
    expect(h.transaction.rollback).not.toHaveBeenCalled();
    expect(h.transaction.release).toHaveBeenCalledTimes(1);
    expect(h.bustGuildRoster).toHaveBeenCalledWith(42);
    expect(mocks.bustAdmin).toHaveBeenCalledTimes(1);
    expect(h.pool.query).not.toHaveBeenCalled();
  });

  it('pins the compare-and-set: floored count, ladder bound, leader re-check, RETURNING', () => {
    // Advanced from the floored count too: a tampered negative column becomes
    // page one rather than a negative count the receipt guard refuses forever.
    expect(GUILD_ROSTER_PAGE_CAS_SQL).toContain('roster_pages = GREATEST(roster_pages, 0) + 1');
    expect(GUILD_ROSTER_PAGE_CAS_SQL).toContain('GREATEST(roster_pages, 0) = $2');
    expect(GUILD_ROSTER_PAGE_CAS_SQL).toContain('roster_pages < $3');
    expect(GUILD_ROSTER_PAGE_CAS_SQL).toMatch(
      /guild_members[\s\S]*character_id = \$4[\s\S]*rank = 'leader'/,
    );
    expect(GUILD_ROSTER_PAGE_CAS_SQL).toContain('RETURNING roster_pages');
  });

  it('writes a private copy of the snapshot, never the caller-owned object', async () => {
    const h = harness();
    h.transaction.query
      .mockResolvedValueOnce({ rows: [{ roster_pages: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const input = args({ state: { copper: 10, bags: [] } as never });
    await h.run(input);
    const written = mocks.save.mock.calls[0][3];
    expect(written).toEqual(input.state);
    expect(written).not.toBe(input.state);
  });
});

describe('buyGuildRosterPageAtomic: known refusals roll back before any save', () => {
  it('stale when the count moved (guild still exists), no receipt, no save', async () => {
    const h = harness();
    h.transaction.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // CAS missed
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }); // guild exists
    await expect(h.run()).resolves.toEqual({ durability: 'not_committed', reason: 'stale' });
    expect(h.transaction.query).toHaveBeenCalledTimes(2);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(h.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(h.transaction.commit).not.toHaveBeenCalled();
  });

  it('no_guild when the row is gone', async () => {
    const h = harness();
    h.transaction.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(h.run()).resolves.toEqual({ durability: 'not_committed', reason: 'no_guild' });
    expect(h.transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('lease_lost when the fenced save misses: the page and receipt roll back with it', async () => {
    const h = harness();
    h.transaction.query
      .mockResolvedValueOnce({ rows: [{ roster_pages: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.save.mockResolvedValue(false);
    await expect(h.run()).resolves.toEqual({ durability: 'not_committed', reason: 'lease_lost' });
    expect(h.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(h.transaction.commit).not.toHaveBeenCalled();
    expect(h.bustGuildRoster).not.toHaveBeenCalled();
  });

  it('a statement-level SQLSTATE before COMMIT is a proven rollback: database_error, no reconcile', async () => {
    const h = harness();
    const dup = Object.assign(new Error('duplicate receipt'), { code: '23505' });
    h.transaction.query
      .mockResolvedValueOnce({ rows: [{ roster_pages: 3 }], rowCount: 1 })
      .mockRejectedValueOnce(dup);
    await expect(h.run()).resolves.toEqual({
      durability: 'not_committed',
      reason: 'database_error',
      error: dup,
    });
    expect(h.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(h.pool.query).not.toHaveBeenCalled();
  });
});

describe('buyGuildRosterPageAtomic: a lost COMMIT answer', () => {
  const MATCHING = { rows: [{ guild_id: '42', page: '3', character_id: '7', copper: '400000' }] };

  function lostCommit(opts: Parameters<typeof harness>[0] = {}) {
    const h = harness(opts);
    h.transaction.query
      .mockResolvedValueOnce({ rows: [{ roster_pages: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    h.transaction.commit.mockRejectedValue(new Error('socket closed'));
    return h;
  }

  it('is proved committed by a matching receipt, read inside a bounded READ ONLY transaction', async () => {
    const h = lostCommit({ receipt: () => MATCHING });
    await expect(h.run()).resolves.toEqual({ durability: 'committed', pages: 3 });
    const statements = h.client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe('BEGIN READ ONLY');
    expect(statements[1]).toMatch(/SET LOCAL statement_timeout = \d+/);
    expect(statements[1]).toMatch(/SET LOCAL lock_timeout = \d+/);
    expect(statements[2]).toBe(GUILD_ROSTER_RECEIPT_SELECT_SQL);
    expect(h.client.query.mock.calls[2][1]).toEqual(['roster:test']);
    expect(statements[3]).toBe('ROLLBACK');
    // The read never rides the bare pool: it is a checkout of its own.
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(h.bustGuildRoster).toHaveBeenCalledWith(42);
  });

  it('is ambiguous (never a refusal) when no receipt turns up after every attempt', async () => {
    const h = lostCommit();
    const result = await h.run();
    expect(result.durability).toBe('commit_ambiguous');
    expect(h.receiptReads()).toHaveLength(GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS);
    expect(h.bustGuildRoster).toHaveBeenCalledWith(42);
  });

  it('a receipt that does not match the purchase is no proof', async () => {
    const h = lostCommit({
      receipt: () => ({
        rows: [{ guild_id: '42', page: '3', character_id: '99', copper: '400000' }],
      }),
    });
    const result = await h.run();
    expect(result.durability).toBe('commit_ambiguous');
    expect(h.receiptReads()).toHaveLength(1);
  });

  it('a failed look is retried, not read as a "no"', async () => {
    let looks = 0;
    const h = lostCommit({
      receipt: () => (++looks === 1 ? new Error('pool draining') : MATCHING),
    });
    await expect(h.run()).resolves.toEqual({ durability: 'committed', pages: 3 });
    expect(h.receiptReads()).toHaveLength(2);
  });

  it('every reconcile look takes a background permit and releases it with its client', async () => {
    const h = lostCommit({ gate: true });
    const result = await h.run();
    expect(result.durability).toBe('commit_ambiguous');
    // One permit for the write itself, one per receipt look.
    expect(h.acquireBackgroundPermit).toHaveBeenCalledTimes(
      1 + GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS,
    );
    expect(h.permits).toHaveLength(1 + GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS);
    for (const permit of h.permits) expect(permit.release).toHaveBeenCalled();
  });

  it('a look that never returns is cancelled by its deadline before the next look, so reads never stack', async () => {
    const h = lostCommit({ receipt: () => 'hang' });
    const started = Date.now();
    const result = await h.run();
    expect(result.durability).toBe('commit_ambiguous');
    // Three looks, each ended by its own deadline rather than by an answer.
    expect(h.receiptReads()).toHaveLength(GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS);
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS * PAID_GUILD_RECEIPT_RECONCILE_QUERY_TIMEOUT_MS - 50,
    );
    // Each deadline destroyed its socket and cancelled its backend.
    const destroyed = h.client.release.mock.calls.filter(([error]) => error instanceof Error);
    expect(destroyed).toHaveLength(GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS);
    expect(h.cancelBackend).toHaveBeenCalledTimes(GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS);
    expect(h.cancelBackend).toHaveBeenCalledWith(4242);
    // At no point did a second read start while an earlier one still hung.
    expect(h.maxOutstandingReads()).toBe(1);
  }, 10_000);

  it('a deadline that fired before COMMIT was sent is a proven rollback, not ambiguity', async () => {
    const h = lostCommit();
    h.transaction.commit.mockRejectedValue(
      new DbTransactionDeadlineExceeded('guild roster page', 1000, false),
    );
    const result = await h.run();
    expect(result.durability).toBe('not_committed');
    expect(h.receiptReads()).toHaveLength(0);
  });
});

describe('buyGuildRosterPageAtomic: argument guards', () => {
  it('refuses to run unfenced or with a shapeless receipt before touching the pool', async () => {
    const h = harness();
    await expect(h.run(args({ leaseNonce: '' }))).rejects.toThrow(TypeError);
    await expect(h.run(args({ receipt: { batchKey: '', copper: 1 } }))).rejects.toThrow(TypeError);
    await expect(h.run(args({ receipt: { batchKey: 'k', copper: 0 } }))).rejects.toThrow(
      RangeError,
    );
    await expect(h.run(args({ expectedPages: -1 }))).rejects.toThrow(RangeError);
    expect(h.pool.connect).not.toHaveBeenCalled();
  });
});
