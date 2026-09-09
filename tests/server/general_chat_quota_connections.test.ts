// Regression coverage for the general chat quota module's OWN pg connections
// (the dedicated consume Pool and the default LISTEN Client), which db.ts's
// materialSourceConnection split changed the shape of: the writer-capability
// startup options now ride a separate `options` config property instead of
// living inside the connection string. tests/general_chat_quota_db.test.ts
// mocks `../server/db` but never mocks `pg`, so it cannot see what actually
// reaches the `pg.Pool`/`pg.Client` constructors; this file captures those
// constructor calls directly.
//
// Real PostgreSQL proof of the same regression lives in
// tests/general_chat_quota_db_integration.test.ts (a 42883 "function does not
// exist" failure under an isolated search_path schema): this suite pins the
// mechanism without a database.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
  GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS,
} from '../../server/general_chat_quota_config';

interface CapturedPgConfig {
  connectionString?: string;
  options?: string;
  max?: number;
  connectionTimeoutMillis?: number;
  lock_timeout?: number;
  statement_timeout?: number;
  query_timeout?: number;
}

const { poolConfigs, clientConfigs, clientInstances } = vi.hoisted(() => ({
  poolConfigs: [] as CapturedPgConfig[],
  clientConfigs: [] as CapturedPgConfig[],
  clientInstances: [] as InstanceType<typeof import('pg').Client>[],
}));

vi.mock('pg', () => {
  class MockPool {
    options: CapturedPgConfig;
    query = vi.fn(async () => ({ rows: [] }));
    end = vi.fn(async () => {});
    constructor(config: CapturedPgConfig) {
      this.options = config;
      poolConfigs.push(config);
    }
    on(): this {
      return this;
    }
  }

  class MockClient {
    options: CapturedPgConfig;
    connect = vi.fn(async () => {});
    query = vi.fn(async () => ({ rows: [] }));
    end = vi.fn(async () => {});
    private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();
    constructor(config: CapturedPgConfig) {
      this.options = config;
      clientConfigs.push(config);
      clientInstances.push(this as unknown as InstanceType<typeof import('pg').Client>);
    }
    on(event: string, listener: (value?: unknown) => void): this {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
      return this;
    }
  }

  return { Pool: MockPool, Client: MockClient };
});

// The composed shape server/db.ts actually produces since materialSourceConnection:
// the writer-capability startup option is carried on a SEPARATE `options`
// property, never folded back into the connection string.
const COMPOSED_CONNECTION_STRING = 'postgres://writer-composed.invalid/woc';
const COMPOSED_WRITER_OPTIONS = '-c search_path=woc_writer -c woc.material_source_writer=1';

function mockSharedPool(overrides: Partial<{ options: CapturedPgConfig }> = {}) {
  vi.doMock('../../server/db', () => ({
    pool: {
      query: vi.fn(),
      connect: vi.fn(),
      on: () => {},
      ...overrides,
    },
  }));
}

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeEach(() => {
  vi.resetModules();
  poolConfigs.length = 0;
  clientConfigs.length = 0;
  clientInstances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../server/db');
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('general chat quota pg connections carry the shared pool composed options', () => {
  it('gives the dedicated consume Pool the byte-exact composed connectionString and options', async () => {
    mockSharedPool({
      options: {
        connectionString: COMPOSED_CONNECTION_STRING,
        options: COMPOSED_WRITER_OPTIONS,
      },
    });

    await import('../../server/general_chat_quota_db');

    expect(poolConfigs).toHaveLength(1);
    expect(poolConfigs[0]?.connectionString).toBe(COMPOSED_CONNECTION_STRING);
    // The dedicated Pool must forward pool.options.options verbatim, so the
    // writer capability and operator search_path reach the quota pool's
    // connections too.
    expect(poolConfigs[0]?.options).toBe(COMPOSED_WRITER_OPTIONS);
  });

  it('sizes the dedicated Pool independently of the shared application pool', async () => {
    mockSharedPool({
      options: {
        connectionString: COMPOSED_CONNECTION_STRING,
        options: COMPOSED_WRITER_OPTIONS,
        max: 99,
        connectionTimeoutMillis: 5000,
        lock_timeout: 12000,
        statement_timeout: 42000,
        query_timeout: 65000,
      },
    });

    await import('../../server/general_chat_quota_db');

    expect(poolConfigs[0]?.max).toBe(GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS);
    expect(poolConfigs[0]?.max).toBe(2);
    expect(poolConfigs[0]?.connectionTimeoutMillis).toBe(GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS);
    expect(poolConfigs[0]?.connectionTimeoutMillis).toBe(500);
    expect(poolConfigs[0]?.lock_timeout).toBe(250);
    expect(poolConfigs[0]?.statement_timeout).toBe(1000);
    // The client-side (driver) backstop must sit above the server-side
    // statement_timeout, exactly like the shared pool's own ladder, but on the
    // quota module's OWN smaller numbers rather than db.ts's DB_QUERY_TIMEOUT_MS.
    expect(poolConfigs[0]?.query_timeout).toBe(1500);
  });

  it('gives the default LISTEN Client the same composed connectionString and options', async () => {
    mockSharedPool({
      options: {
        connectionString: COMPOSED_CONNECTION_STRING,
        options: COMPOSED_WRITER_OPTIONS,
      },
    });

    const quota = await import('../../server/general_chat_quota_db');
    // No `connect` override: this drives the module's OWN default
    // connectGeneralChatQuotaListener, unlike the listener suite in
    // tests/general_chat_quota_db.test.ts, which injects a fake client and so
    // never constructs a real pg.Client.
    const listener = quota.createGeneralChatQuotaListener({
      activeAccountIds: () => [],
      onResync: () => {},
      onChange: () => {},
      onError: () => {},
    });

    await listener.start();
    try {
      expect(clientConfigs).toHaveLength(1);
      expect(clientConfigs[0]?.connectionString).toBe(COMPOSED_CONNECTION_STRING);
      // connectGeneralChatQuotaListener must forward pool.options.options too,
      // so the LISTEN connection keeps the operator search_path and writer
      // capability.
      expect(clientConfigs[0]?.options).toBe(COMPOSED_WRITER_OPTIONS);
      expect(clientConfigs[0]?.connectionTimeoutMillis).toBe(GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS);
      expect(clientConfigs[0]?.statement_timeout).toBe(1000);
      expect(clientConfigs[0]?.query_timeout).toBe(1500);
      expect(clientInstances[0]?.connect).toHaveBeenCalledOnce();
    } finally {
      await listener.stop();
    }
  });

  it('imports through the legacy partial-pool mock shape via the env fallback, without mutating the environment permanently', async () => {
    // Some existing unit-test suites mock `../server/db` with a pool that has
    // no `.options` at all (the pre-materialSourceConnection shape). The
    // module must stay importable through that fallback without widening the
    // db.ts mock contract every such suite would otherwise need to grow.
    mockSharedPool();
    process.env.DATABASE_URL = 'postgres://env-fallback.invalid/woc';

    const quota = await import('../../server/general_chat_quota_db');
    const listener = quota.createGeneralChatQuotaListener({
      activeAccountIds: () => [],
      onResync: () => {},
      onChange: () => {},
      onError: () => {},
    });
    await listener.start();
    try {
      expect(poolConfigs).toHaveLength(1);
      expect(clientConfigs).toHaveLength(1);
      expect(poolConfigs[0]?.connectionString).toBe('postgres://env-fallback.invalid/woc');
      expect(clientConfigs[0]?.connectionString).toBe('postgres://env-fallback.invalid/woc');
    } finally {
      await listener.stop();
    }
  });
});
