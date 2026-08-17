import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../server/db', () => ({
  pool: {
    query,
    connect,
    options: { connectionString: 'postgres://quota-test.invalid/test' },
  },
}));

import {
  consumeGeneralChatQuota,
  createGeneralChatQuotaListener,
  GENERAL_CHAT_QUOTA_CONSUME_SQL,
  GENERAL_CHAT_QUOTA_LISTENER_DIRTY_MAX,
  GENERAL_CHAT_QUOTA_SCHEMA,
  GeneralChatQuotaAccountNotFoundError,
  GeneralChatQuotaDbError,
  GeneralChatQuotaValidationError,
  setGeneralChatRateLimit,
} from '../server/general_chat_quota_db';

function transactionClient(results: Array<unknown | Error>) {
  const txQuery = vi.fn(async (_sql: string, _values?: unknown[]) => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next ?? { rows: [] };
  });
  const release = vi.fn();
  return { query: txQuery, release };
}

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('general chat quota schema and atomic consume', () => {
  it('owns one sparse bounded row per account with cascade deletion', () => {
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/account_id INT PRIMARY KEY/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/REFERENCES accounts\(id\) ON DELETE CASCADE/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/messages BETWEEN 1 AND 1000/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/window_minutes BETWEEN 1 AND 1440/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/message_count BETWEEN 0 AND messages/i);
  });

  it('pins the dedicated max-two pool and every native timeout option', () => {
    const source = readFileSync(
      new URL('../server/general_chat_quota_db.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('max: GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS');
    expect(source).toContain('connectionTimeoutMillis: GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS');
    expect(source).toContain('lock_timeout: GENERAL_CHAT_QUOTA_LOCK_TIMEOUT_MS');
    expect(source).toContain('statement_timeout: GENERAL_CHAT_QUOTA_STATEMENT_TIMEOUT_MS');
    expect(source).toContain(
      'query_timeout: GENERAL_CHAT_QUOTA_STATEMENT_TIMEOUT_MS + GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS',
    );
  });

  it('uses one conditional row update and database time for an anchored fixed window', () => {
    expect(GENERAL_CHAT_QUOTA_CONSUME_SQL).toMatch(/consume_account_general_chat_quota\(\$1\)/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/pg_advisory_xact_lock\(/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/clock_timestamp\(\)/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/policy\.message_count < policy\.messages/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).toMatch(/ELSE[\s\S]*allowed := FALSE/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).not.toMatch(/FOR UPDATE/i);
    expect(GENERAL_CHAT_QUOTA_SCHEMA).not.toMatch(/SET\s+updated_at/i);
    expect(GENERAL_CHAT_QUOTA_CONSUME_SQL).not.toMatch(/rate_limits\s+r/i);
  });

  it.each([
    [[], { status: 'unlimited' }],
    [[{ allowed: true, retry_after_seconds: 0 }], { status: 'allowed' }],
    [[{ allowed: false, retry_after_seconds: 12 }], { status: 'denied', retryAfterSeconds: 12 }],
  ] as const)('maps the one atomic result without a follow-up read', async (rows, expected) => {
    const consumeQuery = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [...rows] }));
    await expect(consumeGeneralChatQuota(1, { query: consumeQuery })).resolves.toEqual(expected);
    expect(consumeQuery).toHaveBeenCalledOnce();
    expect(String(consumeQuery.mock.calls[0]?.[0])).toContain('consume_account_general_chat_quota');
  });

  it.each([
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
  ])('classifies the dedicated pool native acquisition timeout: %s', async (message) => {
    const consumeQuery = vi.fn(async () => {
      throw new Error(message);
    });
    await expect(consumeGeneralChatQuota(1, { query: consumeQuery })).rejects.toMatchObject({
      phase: 'acquire_timeout',
    });
  });

  it('classifies a black-holed query timeout from the one pool query', async () => {
    const consumeQuery = vi.fn(async () => {
      throw new Error('Query read timeout');
    });
    await expect(consumeGeneralChatQuota(1, { query: consumeQuery })).rejects.toMatchObject({
      phase: 'query_timeout',
    });
    expect(consumeQuery).toHaveBeenCalledOnce();
  });
});

describe('setGeneralChatRateLimit', () => {
  it.each([
    [{ messages: 0, windowMinutes: 1 }, 'messages'],
    [{ messages: 1001, windowMinutes: 1 }, 'messages'],
    [{ messages: 1.5, windowMinutes: 1 }, 'messages'],
    [{ messages: 1, windowMinutes: 0 }, 'windowMinutes'],
    [{ messages: 1, windowMinutes: 1441 }, 'windowMinutes'],
  ] as const)(
    'rejects invalid %s bounds before opening a transaction',
    async (rateLimit, _field) => {
      await expect(
        setGeneralChatRateLimit({ accountId: 1, adminAccountId: 2, rateLimit, reason: 'test' }),
      ).rejects.toThrow(GeneralChatQuotaValidationError);
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty reason before opening a transaction', async () => {
    await expect(
      setGeneralChatRateLimit({
        accountId: 1,
        adminAccountId: 2,
        rateLimit: null,
        reason: '   ',
      }),
    ).rejects.toThrow(GeneralChatQuotaValidationError);
    expect(connect).not.toHaveBeenCalled();
  });

  it('locks account then policy, resets the window, audits, notifies, and commits', async () => {
    const client = transactionClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 7 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    connect.mockResolvedValueOnce(client);

    await expect(
      setGeneralChatRateLimit({
        accountId: 7,
        adminAccountId: 3,
        rateLimit: { messages: 4, windowMinutes: 9 },
        reason: 'reduce spam',
      }),
    ).resolves.toEqual({
      before: null,
      after: { messages: 4, windowMinutes: 9 },
      changed: true,
    });

    const sql = client.query.mock.calls.map((call) => String(call[0]));
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toMatch(/SET LOCAL lock_timeout/);
    expect(sql[2]).toMatch(/pg_advisory_xact_lock/);
    expect(sql[3]).toMatch(/FROM accounts WHERE id = \$1 FOR NO KEY UPDATE/);
    expect(sql[4]).toMatch(/account_general_chat_rate_limits[\s\S]*FOR UPDATE/);
    expect(sql[5]).toMatch(/ON CONFLICT[\s\S]*window_started_at = NULL[\s\S]*message_count = 0/);
    expect(sql[6]).toMatch(/INSERT INTO account_moderation_actions/);
    expect(sql[7]).toMatch(/pg_notify/);
    expect(sql[8]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does no mutation, audit, or notify for an idempotent policy', async () => {
    const client = transactionClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 7 }] },
      { rows: [{ messages: 4, window_minutes: 9 }] },
      { rows: [] },
    ]);
    connect.mockResolvedValueOnce(client);

    await expect(
      setGeneralChatRateLimit({
        accountId: 7,
        adminAccountId: 3,
        rateLimit: { messages: 4, windowMinutes: 9 },
        reason: 'same policy',
      }),
    ).resolves.toEqual({
      before: { messages: 4, windowMinutes: 9 },
      after: { messages: 4, windowMinutes: 9 },
      changed: false,
    });
    const sql = client.query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(sql).not.toMatch(/DELETE FROM|INSERT INTO account_moderation_actions|pg_notify/);
  });

  it('deletes, audits, and notifies when clearing a configured policy', async () => {
    const client = transactionClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 7 }] },
      { rows: [{ messages: 4, window_minutes: 9 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    connect.mockResolvedValueOnce(client);

    await expect(
      setGeneralChatRateLimit({
        accountId: 7,
        adminAccountId: 3,
        rateLimit: null,
        reason: 'restriction complete',
      }),
    ).resolves.toMatchObject({ before: { messages: 4, windowMinutes: 9 }, after: null });
    const sql = client.query.mock.calls.map((call) => String(call[0]));
    expect(sql[5]).toMatch(/DELETE FROM account_general_chat_rate_limits/);
    expect(sql[6]).toMatch(/INSERT INTO account_moderation_actions/);
    expect(sql[7]).toMatch(/pg_notify/);
    expect(sql[8]).toBe('COMMIT');
  });

  it('rolls back an absent account without mutation or notification', async () => {
    const client = transactionClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    connect.mockResolvedValueOnce(client);
    await expect(
      setGeneralChatRateLimit({
        accountId: 77,
        adminAccountId: 3,
        rateLimit: null,
        reason: 'test absent',
      }),
    ).rejects.toThrow(GeneralChatQuotaAccountNotFoundError);
    expect(client.query.mock.calls.map((call) => String(call[0]))).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '1500ms'",
      'SELECT pg_advisory_xact_lock($1::int, $2::int)',
      'SELECT id FROM accounts WHERE id = $1 FOR NO KEY UPDATE',
      'ROLLBACK',
    ]);
  });

  it('rolls back a failed mutation before audit, notify, or commit', async () => {
    const client = transactionClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 7 }] },
      { rows: [] },
      new Error('write failed'),
      { rows: [] },
    ]);
    connect.mockResolvedValueOnce(client);
    await expect(
      setGeneralChatRateLimit({
        accountId: 7,
        adminAccountId: 3,
        rateLimit: { messages: 4, windowMinutes: 9 },
        reason: 'test failure',
      }),
    ).rejects.toThrow('write failed');
    const sql = client.query.mock.calls.map((call) => String(call[0]));
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql.join('\n')).not.toMatch(/account_moderation_actions|pg_notify|COMMIT/);
  });
});

function listenerClient(
  queryImpl: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
) {
  const listeners = new Map<string, Array<(value?: unknown) => void>>();
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => queryImpl(sql, values)),
    on: vi.fn((event: string, listener: (value?: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return client;
    }),
    close: vi.fn(async () => {}),
    emit(event: string, value?: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
  };
  return client;
}

describe('cross-process policy listener', () => {
  it('LISTENs before resync and applies a later account notification', async () => {
    const rows = [
      { rows: [] },
      { rows: [{ account_id: 7, messages: 3, window_minutes: 5 }] },
      { rows: [] },
    ];
    const client = listenerClient(async () => rows.shift() ?? { rows: [] });
    const onResync = vi.fn();
    const onChange = vi.fn();
    const listener = createGeneralChatQuotaListener({
      activeAccountIds: () => [7],
      onResync,
      onChange,
      connect: async () => client,
    });

    await listener.start();
    expect(String(client.query.mock.calls[0][0])).toMatch(/^LISTEN general_chat_quota_changed$/);
    expect(onResync).toHaveBeenCalledWith([7], new Map([[7, { messages: 3, windowMinutes: 5 }]]));
    client.emit('notification', {
      channel: 'general_chat_quota_changed',
      payload: JSON.stringify({ accountId: 7 }),
    });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(7, null));
    await listener.stop();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('applies notifications received during initial batched resync after the snapshot', async () => {
    let releaseLastInitialBatch!: () => void;
    const lastInitialBatch = new Promise<void>((resolve) => {
      releaseLastInitialBatch = resolve;
    });
    let selectCalls = 0;
    const client = listenerClient(async (sql) => {
      if (sql.startsWith('LISTEN ')) return { rows: [] };
      selectCalls++;
      if (selectCalls === 1) return { rows: [] };
      if (selectCalls === 2) {
        await lastInitialBatch;
        return { rows: [{ account_id: 501, messages: 1, window_minutes: 5 }] };
      }
      return { rows: [{ account_id: 501, messages: 9, window_minutes: 5 }] };
    });
    const order: string[] = [];
    const onResync = vi.fn(() => order.push('resync'));
    const onChange = vi.fn(() => order.push('change'));
    const listener = createGeneralChatQuotaListener({
      activeAccountIds: () => Array.from({ length: 501 }, (_, index) => index + 1),
      onResync,
      onChange,
      connect: async () => client,
    });

    const starting = listener.start();
    await vi.waitFor(() => expect(selectCalls).toBe(2));
    client.emit('notification', {
      channel: 'general_chat_quota_changed',
      payload: JSON.stringify({ accountId: 501 }),
    });
    expect(selectCalls).toBe(2);
    expect(onChange).not.toHaveBeenCalled();

    releaseLastInitialBatch();
    await starting;
    expect(onResync).toHaveBeenCalledWith(
      Array.from({ length: 501 }, (_, index) => index + 1),
      new Map([[501, { messages: 1, windowMinutes: 5 }]]),
    );
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(501, { messages: 9, windowMinutes: 5 }),
    );
    expect(order).toEqual(['resync', 'change']);
    await listener.stop();
  });

  it('reports the exact active-account snapshot captured before a held resync query', async () => {
    let releaseResync!: () => void;
    const heldResync = new Promise<void>((resolve) => {
      releaseResync = resolve;
    });
    let queryCalls = 0;
    const client = listenerClient(async (sql) => {
      queryCalls++;
      if (!sql.startsWith('LISTEN ')) await heldResync;
      return { rows: [] };
    });
    let activeAccountIds = [7];
    const onResync = vi.fn();
    const listener = createGeneralChatQuotaListener({
      activeAccountIds: () => activeAccountIds,
      onResync,
      onChange: vi.fn(),
      connect: async () => client,
    });

    const starting = listener.start();
    await vi.waitFor(() => expect(queryCalls).toBe(2));
    activeAccountIds = [7, 8];
    releaseResync();
    await starting;

    expect(onResync).toHaveBeenCalledWith([7], new Map());
    await listener.stop();
  });

  it('reconnects and resyncs after an initial LISTEN failure', async () => {
    vi.useFakeTimers();
    const first = listenerClient(async () => {
      throw new Error('LISTEN failed');
    });
    const second = listenerClient(async () => ({ rows: [] }));
    const connectListener = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const onResync = vi.fn();
    const listener = createGeneralChatQuotaListener({
      activeAccountIds: () => [],
      onResync,
      onChange: vi.fn(),
      connect: connectListener,
      onError: vi.fn(),
    });

    await expect(listener.start()).rejects.toThrow('LISTEN failed');
    expect(listener.connected()).toBe(false);
    expect(first.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(connectListener).toHaveBeenCalledTimes(2));
    expect(listener.connected()).toBe(true);
    expect(onResync).toHaveBeenCalledWith([], new Map());
    expect(listener.reconnects()).toBe(1);
    await listener.stop();
  });

  it('reconnects and authoritatively resyncs after the initial resync query fails', async () => {
    vi.useFakeTimers();
    let firstCalls = 0;
    const first = listenerClient(async () => {
      firstCalls++;
      if (firstCalls === 1) return { rows: [] };
      throw new Error('initial resync failed');
    });
    const second = listenerClient(async () => ({
      rows: [{ account_id: 7, messages: 2, window_minutes: 9 }],
    }));
    const connectListener = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const onResync = vi.fn();
    const listener = createGeneralChatQuotaListener({
      activeAccountIds: () => [7],
      onResync,
      onChange: vi.fn(),
      connect: connectListener,
      onError: vi.fn(),
    });

    await expect(listener.start()).rejects.toThrow('initial resync failed');
    expect(first.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(connectListener).toHaveBeenCalledTimes(2));
    expect(listener.connected()).toBe(true);
    expect(onResync).toHaveBeenCalledWith([7], new Map([[7, { messages: 2, windowMinutes: 9 }]]));
    await listener.stop();
  });

  it('serializes notification reads and coalesces a burst for one account', async () => {
    let releaseFirstRefresh!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let calls = 0;
    const client = listenerClient(async () => {
      calls++;
      if (calls === 3) await firstRefresh;
      return { rows: [] };
    });
    const onChange = vi.fn();
    const listener = createGeneralChatQuotaListener({
      activeAccountIds: () => [7],
      onResync: vi.fn(),
      onChange,
      connect: async () => client,
    });
    await listener.start();
    for (let i = 0; i < 100; i++) {
      client.emit('notification', {
        channel: 'general_chat_quota_changed',
        payload: JSON.stringify({ accountId: 7 }),
      });
    }
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(listener.pendingRefreshes()).toBe(1);
    releaseFirstRefresh();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(listener.pendingRefreshes()).toBe(0);
    await listener.stop();
  });

  it('bounds distinct dirty notifications and falls back to one active-session resync', async () => {
    let releaseFirstRefresh!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let calls = 0;
    const client = listenerClient(async () => {
      calls++;
      if (calls === 3) await firstRefresh;
      return { rows: [] };
    });
    const onResync = vi.fn();
    const listener = createGeneralChatQuotaListener({
      activeAccountIds: () => [1, 2, 3],
      onResync,
      onChange: vi.fn(),
      connect: async () => client,
    });
    await listener.start();
    client.emit('notification', {
      channel: 'general_chat_quota_changed',
      payload: JSON.stringify({ accountId: 1 }),
    });
    for (let accountId = 2; accountId <= GENERAL_CHAT_QUOTA_LISTENER_DIRTY_MAX + 2; accountId++) {
      client.emit('notification', {
        channel: 'general_chat_quota_changed',
        payload: JSON.stringify({ accountId }),
      });
    }
    expect(listener.pendingRefreshes()).toBe(GENERAL_CHAT_QUOTA_LISTENER_DIRTY_MAX);
    releaseFirstRefresh();
    await vi.waitFor(() => expect(onResync).toHaveBeenCalledTimes(2));
    expect(listener.pendingRefreshes()).toBe(0);
    await listener.stop();
  });
});
