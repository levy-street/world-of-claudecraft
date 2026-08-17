import { Client, Pool } from 'pg';
import { pool } from './db';
import {
  GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
  GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE,
  GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS,
} from './general_chat_quota_config';

export {
  GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
  GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS,
} from './general_chat_quota_config';
export { GENERAL_CHAT_QUOTA_SCHEMA } from './general_chat_quota_schema';

export const GENERAL_CHAT_QUOTA_MIN_MESSAGES = 1;
export const GENERAL_CHAT_QUOTA_MAX_MESSAGES = 1_000;
export const GENERAL_CHAT_QUOTA_MIN_WINDOW_MINUTES = 1;
export const GENERAL_CHAT_QUOTA_MAX_WINDOW_MINUTES = 1_440;
export const GENERAL_CHAT_QUOTA_NOTIFY_CHANNEL = 'general_chat_quota_changed';
const GENERAL_CHAT_QUOTA_LOCK_TIMEOUT_MS = 250;
const GENERAL_CHAT_QUOTA_STATEMENT_TIMEOUT_MS = 1_000;
const GENERAL_CHAT_QUOTA_SETTER_LOCK_TIMEOUT_MS = 1_500;
// A separate, exactly bounded pool keeps quota latency and admission independent
// from auth/save work. The coordinator admits no more than this count, so this
// pool never owns an application-level waiter; pg's native checkout/connect
// timeout remains the final defensive bound.
const GENERAL_CHAT_QUOTA_REASON_MAX = 500;
const GENERAL_CHAT_QUOTA_RESYNC_BATCH = 500;
export const GENERAL_CHAT_QUOTA_LISTENER_DIRTY_MAX = 1_024;
const GENERAL_CHAT_QUOTA_LISTENER_RETRY_MAX_MS = 5_000;

// The shared pool remains the one bootstrap owner for DATABASE_URL (including
// .env loading and fail-fast validation). Read its resolved connection string
// when available; the env fallback keeps legacy unit-test partial pool mocks
// importable without widening the db.ts mock contract across the repository.
const GENERAL_CHAT_QUOTA_DATABASE_URL =
  (pool as { options?: { connectionString?: string } }).options?.connectionString ??
  process.env.DATABASE_URL;

const quotaPool = new Pool({
  connectionString: GENERAL_CHAT_QUOTA_DATABASE_URL,
  max: GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS,
  connectionTimeoutMillis: GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
  lock_timeout: GENERAL_CHAT_QUOTA_LOCK_TIMEOUT_MS,
  statement_timeout: GENERAL_CHAT_QUOTA_STATEMENT_TIMEOUT_MS,
  query_timeout: GENERAL_CHAT_QUOTA_STATEMENT_TIMEOUT_MS + GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
});
// The real pg Pool is an EventEmitter, but several server suites mock `pg` with
// a minimal Pool that omits .on (they reach this module through admin.ts). Guard
// the registration by capability, exactly as the shared pool does in db.ts,
// rather than force every such fake to grow the event surface.
if (typeof quotaPool.on === 'function') {
  quotaPool.on('error', (error) => console.error('general chat quota database pool error:', error));
}

export interface GeneralChatRateLimit {
  messages: number;
  windowMinutes: number;
}

export type GeneralChatQuotaConsumeResult =
  | { status: 'allowed' }
  | { status: 'denied'; retryAfterSeconds: number }
  | { status: 'unlimited' };

interface GeneralChatQuotaQuery {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface GeneralChatQuotaPool {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export class GeneralChatQuotaValidationError extends Error {}
export class GeneralChatQuotaDbError extends Error {
  constructor(
    readonly phase: 'acquire_timeout' | 'query_timeout' | 'error',
    options?: ErrorOptions,
  ) {
    super(`general chat quota database ${phase.replace('_', ' ')}`, options);
  }
}
export class GeneralChatQuotaAccountNotFoundError extends Error {
  constructor() {
    super('account not found');
  }
}

/** One cross-realm advisory lock, one post-lock database timestamp, and one conditional update. */
export const GENERAL_CHAT_QUOTA_CONSUME_SQL =
  'SELECT allowed, retry_after_seconds FROM consume_account_general_chat_quota($1)';

function normalizedRateLimit(
  row: Record<string, unknown> | undefined,
): GeneralChatRateLimit | null {
  if (!row || row.messages === null || row.messages === undefined) return null;
  const messages = Number(row.messages);
  const windowMinutes = Number(row.window_minutes);
  if (!validGeneralChatRateLimit({ messages, windowMinutes })) {
    throw new GeneralChatQuotaValidationError('stored general chat rate limit is invalid');
  }
  return { messages, windowMinutes };
}

export function validGeneralChatRateLimit(value: unknown): value is GeneralChatRateLimit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Number.isInteger(record.messages) &&
    Number(record.messages) >= GENERAL_CHAT_QUOTA_MIN_MESSAGES &&
    Number(record.messages) <= GENERAL_CHAT_QUOTA_MAX_MESSAGES &&
    Number.isInteger(record.windowMinutes) &&
    Number(record.windowMinutes) >= GENERAL_CHAT_QUOTA_MIN_WINDOW_MINUTES &&
    Number(record.windowMinutes) <= GENERAL_CHAT_QUOTA_MAX_WINDOW_MINUTES
  );
}

export async function generalChatRateLimitForAccount(
  accountId: number,
): Promise<GeneralChatRateLimit | null> {
  const result = await pool.query(
    `SELECT messages, window_minutes
     FROM account_general_chat_rate_limits
     WHERE account_id = $1`,
    [accountId],
  );
  return normalizedRateLimit(result.rows[0]);
}

export async function generalChatRateLimitsForAccounts(
  accountIds: readonly number[],
  db: GeneralChatQuotaQuery = pool,
): Promise<Map<number, GeneralChatRateLimit>> {
  const unique = [...new Set(accountIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  const policies = new Map<number, GeneralChatRateLimit>();
  for (let offset = 0; offset < unique.length; offset += GENERAL_CHAT_QUOTA_RESYNC_BATCH) {
    const batch = unique.slice(offset, offset + GENERAL_CHAT_QUOTA_RESYNC_BATCH);
    const result = await db.query(
      `SELECT account_id, messages, window_minutes
       FROM account_general_chat_rate_limits
       WHERE account_id = ANY($1::int[])`,
      [batch],
    );
    for (const row of result.rows) {
      const policy = normalizedRateLimit(row);
      if (policy) policies.set(Number(row.account_id), policy);
    }
  }
  return policies;
}

export async function consumeGeneralChatQuota(
  accountId: number,
  db: GeneralChatQuotaPool = quotaPool,
): Promise<GeneralChatQuotaConsumeResult> {
  try {
    // The VOLATILE function owns one implicit transaction and obtains a fresh
    // post-advisory-lock snapshot internally. Pool.query error-releases its
    // client, so a black-holed socket is destroyed rather than reused.
    const result = await db.query(GENERAL_CHAT_QUOTA_CONSUME_SQL, [accountId]);
    const row = result.rows[0];
    if (!row) return { status: 'unlimited' };
    if (row.allowed === true) return { status: 'allowed' };
    return {
      status: 'denied',
      retryAfterSeconds: Math.max(1, Math.ceil(Number(row.retry_after_seconds) || 1)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const phase =
      /timeout exceeded when trying to connect|connection terminated due to connection timeout/i.test(
        message,
      )
        ? 'acquire_timeout'
        : code === '57014' || code === '55P03' || /query read timeout/i.test(message)
          ? 'query_timeout'
          : 'error';
    throw new GeneralChatQuotaDbError(phase, { cause: error });
  }
}

export function generalChatQuotaDbPoolState(): {
  total: number;
  idle: number;
  waiting: number;
} {
  return {
    total: quotaPool.totalCount,
    idle: quotaPool.idleCount,
    waiting: quotaPool.waitingCount,
  };
}

export async function closeGeneralChatQuotaPool(): Promise<void> {
  await quotaPool.end();
}

function validateSetInput(input: {
  accountId: number;
  adminAccountId: number;
  rateLimit: GeneralChatRateLimit | null;
  reason: string;
}): string {
  // An unsafe or nonpositive id can never name an account: the same semantic
  // failure as a well-formed-but-missing account, so the same error class
  // (callers map it to 404, not the 400 a validation error maps to).
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0) {
    throw new GeneralChatQuotaAccountNotFoundError();
  }
  if (!Number.isSafeInteger(input.adminAccountId) || input.adminAccountId <= 0) {
    throw new GeneralChatQuotaValidationError('administrator account is required');
  }
  if (input.rateLimit !== null && !validGeneralChatRateLimit(input.rateLimit)) {
    const record = input.rateLimit as Partial<GeneralChatRateLimit>;
    if (
      !Number.isInteger(record?.messages) ||
      Number(record?.messages) < GENERAL_CHAT_QUOTA_MIN_MESSAGES ||
      Number(record?.messages) > GENERAL_CHAT_QUOTA_MAX_MESSAGES
    ) {
      throw new GeneralChatQuotaValidationError('messages must be an integer from 1 to 1000');
    }
    throw new GeneralChatQuotaValidationError('windowMinutes must be an integer from 1 to 1440');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > GENERAL_CHAT_QUOTA_REASON_MAX) {
    throw new GeneralChatQuotaValidationError('a moderation reason is required (500 chars max)');
  }
  return reason;
}

function sameRateLimit(a: GeneralChatRateLimit | null, b: GeneralChatRateLimit | null): boolean {
  return a?.messages === b?.messages && a?.windowMinutes === b?.windowMinutes;
}

export async function setGeneralChatRateLimit(input: {
  accountId: number;
  adminAccountId: number;
  rateLimit: GeneralChatRateLimit | null;
  reason: string;
}): Promise<{
  before: GeneralChatRateLimit | null;
  after: GeneralChatRateLimit | null;
  changed: boolean;
}> {
  const reason = validateSetInput(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${GENERAL_CHAT_QUOTA_SETTER_LOCK_TIMEOUT_MS}ms'`);
    // Share the consume statement's cross-realm serialization key. This keeps
    // a policy reset/delete from racing a decision made against the old row.
    await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [
      GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE,
      input.accountId,
    ]);
    const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [
      input.accountId,
    ]);
    if (!account.rows[0]) throw new GeneralChatQuotaAccountNotFoundError();
    const current = await client.query(
      `SELECT messages, window_minutes
       FROM account_general_chat_rate_limits
       WHERE account_id = $1
       FOR UPDATE`,
      [input.accountId],
    );
    const before = normalizedRateLimit(current.rows[0]);
    const after = input.rateLimit;
    if (sameRateLimit(before, after)) {
      await client.query('COMMIT');
      return { before, after, changed: false };
    }
    if (after === null) {
      await client.query('DELETE FROM account_general_chat_rate_limits WHERE account_id = $1', [
        input.accountId,
      ]);
    } else {
      await client.query(
        `INSERT INTO account_general_chat_rate_limits
           (account_id, messages, window_minutes, window_started_at, message_count, updated_at)
         VALUES ($1, $2, $3, NULL, 0, now())
         ON CONFLICT (account_id) DO UPDATE SET
           messages = EXCLUDED.messages,
           window_minutes = EXCLUDED.window_minutes,
           window_started_at = NULL,
           message_count = 0,
           updated_at = now()`,
        [input.accountId, after.messages, after.windowMinutes],
      );
    }
    await client.query(
      `INSERT INTO account_moderation_actions
         (account_id, admin_account_id, action, reason,
          general_chat_rate_limit_before, general_chat_rate_limit_after)
       VALUES ($1, $2, 'general_chat_rate_limit', $3, $4::jsonb, $5::jsonb)`,
      [
        input.accountId,
        input.adminAccountId,
        reason,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );
    await client.query('SELECT pg_notify($1, $2)', [
      GENERAL_CHAT_QUOTA_NOTIFY_CHANNEL,
      JSON.stringify({ accountId: input.accountId }),
    ]);
    await client.query('COMMIT');
    return { before, after, changed: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

interface GeneralChatQuotaListenerClient {
  query: GeneralChatQuotaQuery['query'];
  on(
    event: 'notification',
    listener: (message: { channel: string; payload?: string }) => void,
  ): this;
  on(event: 'error' | 'end', listener: (error?: Error) => void): this;
  close(): Promise<void>;
}

export interface GeneralChatQuotaListener {
  start(): Promise<void>;
  stop(): Promise<void>;
  connected(): boolean;
  reconnects(): number;
  pendingRefreshes(): number;
}

export function createGeneralChatQuotaListener(deps: {
  activeAccountIds(): readonly number[];
  onResync(
    accountIds: readonly number[],
    policies: ReadonlyMap<number, GeneralChatRateLimit>,
  ): void;
  onChange(accountId: number, policy: GeneralChatRateLimit | null): void;
  connect?: () => Promise<GeneralChatQuotaListenerClient>;
  onError?: (error: unknown) => void;
}): GeneralChatQuotaListener {
  const connect = deps.connect ?? connectGeneralChatQuotaListener;
  let client: GeneralChatQuotaListenerClient | null = null;
  let stopped = false;
  let connecting: Promise<void> | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let retryMs = 250;
  let reconnectCount = 0;
  let listening = false;
  let draining: Promise<void> | null = null;
  let fullResyncRequested = false;
  const dirtyAccounts = new Set<number>();

  const report = (error: unknown): void => (deps.onError ?? console.error)(error);

  const scheduleReconnect = (): void => {
    if (stopped || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      reconnectCount++;
      void establish().catch((error) => {
        report(error);
        scheduleReconnect();
      });
    }, retryMs);
    retryTimer.unref();
    retryMs = Math.min(GENERAL_CHAT_QUOTA_LISTENER_RETRY_MAX_MS, retryMs * 2);
  };

  const loseClient = (failed: GeneralChatQuotaListenerClient): void => {
    if (client !== failed) return;
    client = null;
    listening = false;
    dirtyAccounts.clear();
    fullResyncRequested = false;
    void failed.close().catch(report);
    scheduleReconnect();
  };

  const drainChanges = (expected: GeneralChatQuotaListenerClient): void => {
    // LISTEN is active before the initial resync, so notifications may arrive
    // while that resync is still reading multiple batches. Keep them dirty until
    // the authoritative snapshot has been applied; otherwise a fast refresh can
    // be overwritten by a later stale resync batch.
    if (draining || client !== expected || stopped || !listening) return;
    draining = (async () => {
      while (client === expected && !stopped) {
        if (fullResyncRequested) {
          fullResyncRequested = false;
          dirtyAccounts.clear();
          const accountIds = [...deps.activeAccountIds()];
          const policies = await generalChatRateLimitsForAccounts(accountIds, expected);
          if (client !== expected || stopped) return;
          deps.onResync(accountIds, policies);
          continue;
        }
        const accountIds = [...dirtyAccounts].slice(0, GENERAL_CHAT_QUOTA_RESYNC_BATCH);
        if (accountIds.length === 0) return;
        for (const accountId of accountIds) dirtyAccounts.delete(accountId);
        const policies = await generalChatRateLimitsForAccounts(accountIds, expected);
        if (client !== expected || stopped) return;
        for (const accountId of accountIds) {
          deps.onChange(accountId, policies.get(accountId) ?? null);
        }
      }
    })()
      .catch((error) => {
        report(error);
        loseClient(expected);
      })
      .finally(() => {
        draining = null;
        if (client === expected && !stopped && (fullResyncRequested || dirtyAccounts.size > 0)) {
          drainChanges(expected);
        }
      });
  };

  const queueRefresh = (accountId: number, expected: GeneralChatQuotaListenerClient): void => {
    if (!fullResyncRequested) {
      if (dirtyAccounts.size >= GENERAL_CHAT_QUOTA_LISTENER_DIRTY_MAX) {
        dirtyAccounts.clear();
        fullResyncRequested = true;
      } else {
        dirtyAccounts.add(accountId);
      }
    }
    drainChanges(expected);
  };

  const establish = async (): Promise<void> => {
    if (stopped || connecting) return connecting ?? Promise.resolve();
    connecting = (async () => {
      let next: GeneralChatQuotaListenerClient | null = null;
      try {
        next = await connect();
        if (stopped) {
          await next.close();
          return;
        }
        // Adopt before LISTEN/resync so an error or end during initial setup is
        // handled by the same loss path as a steady-state disconnect.
        client = next;
        next.on('error', (error) => {
          report(error);
          loseClient(next!);
        });
        next.on('end', () => loseClient(next!));
        next.on('notification', (message) => {
          if (message.channel !== GENERAL_CHAT_QUOTA_NOTIFY_CHANNEL) return;
          let accountId = 0;
          try {
            accountId = Number(JSON.parse(message.payload ?? '').accountId);
          } catch {
            return;
          }
          if (!Number.isSafeInteger(accountId) || accountId <= 0) return;
          queueRefresh(accountId, next!);
        });
        // LISTEN is committed before the authoritative resync. Notifications that
        // arrive during the read queue on this same connection and apply afterward.
        await next.query(`LISTEN ${GENERAL_CHAT_QUOTA_NOTIFY_CHANNEL}`);
        const accountIds = [...deps.activeAccountIds()];
        const policies = await generalChatRateLimitsForAccounts(accountIds, next);
        if (client !== next || stopped) return;
        deps.onResync(accountIds, policies);
        listening = true;
        retryMs = 250;
        if (fullResyncRequested || dirtyAccounts.size > 0) drainChanges(next);
      } catch (error) {
        if (next && client === next) {
          client = null;
          await next.close().catch(report);
        }
        // This arm includes initial connect/LISTEN/resync failures, not just a
        // later emitted socket error, so every setup failure owns a retry.
        scheduleReconnect();
        throw error;
      }
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  return {
    async start(): Promise<void> {
      stopped = false;
      await establish();
    },
    async stop(): Promise<void> {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      await connecting?.catch(() => {});
      await draining?.catch(() => {});
      const current = client;
      client = null;
      listening = false;
      if (current) {
        await current.query(`UNLISTEN ${GENERAL_CHAT_QUOTA_NOTIFY_CHANNEL}`).catch(() => {});
        await current.close().catch(report);
      }
    },
    connected: () => listening,
    reconnects: () => reconnectCount,
    pendingRefreshes: () =>
      fullResyncRequested ? GENERAL_CHAT_QUOTA_LISTENER_DIRTY_MAX : dirtyAccounts.size,
  };
}

/**
 * LISTEN needs one connection for the realm's lifetime. It and the dedicated
 * two-client consume pool are outside the shared auth/save Pool and included
 * in db.ts's exact per-realm connection budget warning.
 */
async function connectGeneralChatQuotaListener(): Promise<GeneralChatQuotaListenerClient> {
  const raw = new Client({
    connectionString: GENERAL_CHAT_QUOTA_DATABASE_URL,
    connectionTimeoutMillis: GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
    statement_timeout: GENERAL_CHAT_QUOTA_STATEMENT_TIMEOUT_MS,
    query_timeout: GENERAL_CHAT_QUOTA_STATEMENT_TIMEOUT_MS + GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
  });
  await raw.connect();
  let closed = false;
  const adapter: GeneralChatQuotaListenerClient = {
    query: raw.query.bind(raw) as GeneralChatQuotaQuery['query'],
    on(event, listener): GeneralChatQuotaListenerClient {
      raw.on(event, listener as never);
      return adapter;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await raw.end();
    },
  };
  return adapter;
}
