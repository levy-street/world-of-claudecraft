// The world quest block's persistence (server/world_quest_block_db.ts) and its
// server runtime (server/world_quest_block_runtime.ts, the join restore in
// server/account_sanctions_runtime.ts). Pins that each audited write commits the
// account change and its moderation-history row in ONE transaction, that every
// refusal rolls back before the audit insert, and that the live apply and the
// join restore stamp exactly the right sessions.
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

const db = vi.hoisted(() => ({
  query: vi.fn<TestQuery>(),
  connect: vi.fn<() => Promise<PoolClient>>(),
}));

vi.mock('../../server/db', () => ({
  pool: { query: db.query, connect: db.connect },
  runWithStatementTimeout: vi.fn(),
}));

vi.mock('../../server/suspicion_flags', () => ({ flagRegistrationBurst: vi.fn() }));

const cheaterMark = vi.hoisted(() => ({ refreshCheaterMark: vi.fn() }));
vi.mock('../../server/cheater_mark_runtime', () => cheaterMark);

import { restoreAccountSanctions } from '../../server/account_sanctions_runtime';
import { WorldQuestBlockRefused } from '../../server/world_quest_block_api';
import {
  accountWorldQuestsBlocked,
  liftAccountWorldQuestBlock,
  setAccountWorldQuestBlock,
} from '../../server/world_quest_block_db';
import {
  applyWorldQuestBlockLive,
  refreshWorldQuestBlock,
} from '../../server/world_quest_block_runtime';

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

function clientStub() {
  return {
    query: vi.fn<TestQuery>(async () => queryResult([])),
    release: vi.fn(),
  };
}

function statements(client: ReturnType<typeof clientStub>): string[] {
  return client.query.mock.calls.map((call) => call[0]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('setAccountWorldQuestBlock', () => {
  it('locks the row, blocks it, and audits the block in one transaction', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([{ blocked: false }])) // SELECT ... FOR UPDATE
      .mockResolvedValue(queryResult([], 1));
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    await setAccountWorldQuestBlock({ accountId: 42, adminAccountId: 7, reason: '  bot  ' });

    expect(statements(client)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('SET world_quests_blocked_at = now()'),
      expect.stringContaining('INSERT INTO account_moderation_actions'),
      'COMMIT',
    ]);
    expect(client.query.mock.calls[2][1]).toEqual([42, 'bot']);
    expect(client.query.mock.calls[3][1]).toEqual([42, 7, 'world_quests_block', 'bot', null]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('refuses a blank reason before opening a transaction', async () => {
    await expect(
      setAccountWorldQuestBlock({ accountId: 42, adminAccountId: 7, reason: '   ' }),
    ).rejects.toEqual(new WorldQuestBlockRefused('reason_required'));
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('refuses an account already blocked and rolls back with no audit row', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ blocked: true }]))
      .mockResolvedValue(queryResult([]));
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      setAccountWorldQuestBlock({ accountId: 42, adminAccountId: 7, reason: 'bot' }),
    ).rejects.toMatchObject({ refusal: 'already_blocked' });
    expect(statements(client)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('refuses an id with no account row and rolls back', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValue(queryResult([]));
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      setAccountWorldQuestBlock({ accountId: 999, adminAccountId: 7, reason: 'bot' }),
    ).rejects.toMatchObject({ refusal: 'no_account' });
    expect(statements(client)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      'ROLLBACK',
    ]);
  });
});

describe('liftAccountWorldQuestBlock', () => {
  it('clears the block and audits the lift in one transaction', async () => {
    const client = clientStub();
    client.query.mockResolvedValue(queryResult([], 1));
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    await liftAccountWorldQuestBlock({ accountId: 42, adminAccountId: 7, reason: 'appeal' });

    expect(statements(client)).toEqual([
      'BEGIN',
      expect.stringContaining('world_quests_blocked_at IS NOT NULL'),
      expect.stringContaining('INSERT INTO account_moderation_actions'),
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1][0]).toContain('SET world_quests_blocked_at = NULL');
    expect(client.query.mock.calls[2][1]).toEqual([42, 7, 'world_quests_unblock', 'appeal', null]);
  });

  it('refuses an account that is not blocked and rolls back with no audit row', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([], 0))
      .mockResolvedValue(queryResult([]));
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      liftAccountWorldQuestBlock({ accountId: 42, adminAccountId: 7, reason: 'appeal' }),
    ).rejects.toMatchObject({ refusal: 'not_blocked' });
    expect(statements(client)).toEqual([
      'BEGIN',
      expect.stringContaining('world_quests_blocked_at IS NOT NULL'),
      'ROLLBACK',
    ]);
  });

  it('refuses a blank reason before opening a transaction', async () => {
    await expect(
      liftAccountWorldQuestBlock({ accountId: 42, adminAccountId: 7, reason: '' }),
    ).rejects.toMatchObject({ refusal: 'reason_required' });
    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('accountWorldQuestsBlocked', () => {
  it('reads the account row by id', async () => {
    db.query.mockResolvedValueOnce(queryResult([{ blocked: true }]));
    await expect(accountWorldQuestsBlocked(42)).resolves.toBe(true);
    expect(db.query.mock.calls[0][1]).toEqual([42]);
    db.query.mockResolvedValueOnce(queryResult([{ blocked: false }]));
    await expect(accountWorldQuestsBlocked(42)).resolves.toBe(false);
    db.query.mockResolvedValueOnce(queryResult([]));
    await expect(accountWorldQuestsBlocked(999)).resolves.toBe(false);
  });
});

/** A fake sim whose meta() hands back one mutable record per pid. */
function fakeSim(pids: number[]) {
  const metas = new Map(pids.map((pid) => [pid, {} as { worldQuestsBlocked?: boolean }]));
  return { metas, sim: { meta: (pid: number) => metas.get(pid) ?? null } };
}

describe('applyWorldQuestBlockLive', () => {
  it('stamps every live session of the account and no other', () => {
    const { metas, sim } = fakeSim([1, 2, 3]);
    const sessions = [
      { accountId: 42, pid: 1 },
      { accountId: 99, pid: 2 },
      { accountId: 42, pid: 3 },
    ];
    applyWorldQuestBlockLive(sessions, sim, 42, true);
    expect(metas.get(1)?.worldQuestsBlocked).toBe(true);
    expect(metas.get(2)?.worldQuestsBlocked).toBeUndefined();
    expect(metas.get(3)?.worldQuestsBlocked).toBe(true);

    applyWorldQuestBlockLive(sessions, sim, 42, false);
    expect('worldQuestsBlocked' in (metas.get(1) ?? {})).toBe(false);
    expect('worldQuestsBlocked' in (metas.get(3) ?? {})).toBe(false);
  });

  it('skips a session whose character has already left the sim', () => {
    const { sim } = fakeSim([]);
    expect(() =>
      applyWorldQuestBlockLive([{ accountId: 42, pid: 5 }], sim, 42, true),
    ).not.toThrow();
  });
});

describe('refreshWorldQuestBlock (join restore)', () => {
  it('stamps a blocked account onto the joining character', async () => {
    db.query.mockResolvedValueOnce(queryResult([{ blocked: true }]));
    const { metas, sim } = fakeSim([1]);
    await refreshWorldQuestBlock({ accountId: 42, pid: 1 }, sim, () => true);
    expect(metas.get(1)?.worldQuestsBlocked).toBe(true);
  });

  it('writes nothing for an unblocked account', async () => {
    db.query.mockResolvedValueOnce(queryResult([{ blocked: false }]));
    const { metas, sim } = fakeSim([1]);
    await refreshWorldQuestBlock({ accountId: 42, pid: 1 }, sim, () => true);
    expect('worldQuestsBlocked' in (metas.get(1) ?? {})).toBe(false);
  });

  it('writes nothing when the player left during the read', async () => {
    db.query.mockResolvedValueOnce(queryResult([{ blocked: true }]));
    const { metas, sim } = fakeSim([1]);
    await refreshWorldQuestBlock({ accountId: 42, pid: 1 }, sim, () => false);
    expect('worldQuestsBlocked' in (metas.get(1) ?? {})).toBe(false);
  });
});

describe('restoreAccountSanctions', () => {
  it('runs both restores, and a failing Cheater mark read does not skip the block', async () => {
    cheaterMark.refreshCheaterMark.mockRejectedValueOnce(new Error('cheater read down'));
    db.query.mockResolvedValueOnce(queryResult([{ blocked: true }]));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { metas, sim } = fakeSim([1]);
    const session = { accountId: 42, pid: 1, cheaterMarked: false };

    restoreAccountSanctions(session, { ...sim, setCheaterMark: vi.fn() }, () => true);
    await vi.waitFor(() => expect(metas.get(1)?.worldQuestsBlocked).toBe(true));

    expect(cheaterMark.refreshCheaterMark).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith('cheater mark refresh failed:', expect.any(Error)),
    );
    errors.mockRestore();
  });

  it('logs a failing block read without throwing into the join', async () => {
    cheaterMark.refreshCheaterMark.mockResolvedValueOnce(undefined);
    db.query.mockRejectedValueOnce(new Error('accounts read down'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { metas, sim } = fakeSim([1]);

    expect(() =>
      restoreAccountSanctions(
        { accountId: 42, pid: 1, cheaterMarked: false },
        { ...sim, setCheaterMark: vi.fn() },
        () => true,
      ),
    ).not.toThrow();
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith('world quest block refresh failed:', expect.any(Error)),
    );
    expect('worldQuestsBlocked' in (metas.get(1) ?? {})).toBe(false);
    errors.mockRestore();
  });
});
