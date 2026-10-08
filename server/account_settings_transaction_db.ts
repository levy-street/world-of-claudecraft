import type { QueryResult } from 'pg';
import { pool } from './db';
import { cancelDetachedBackend } from './db_backend_cancel';
import {
  backendCancelViaPool,
  createDbTransactionDeadline,
  type DbTransactionDeadlineClient,
  type DbTransactionDeadlineScheduler,
} from './db_transaction_deadline';

export const ACCOUNT_SETTINGS_TRANSACTION_TIMEOUT_MS = 3_000;
export const ACCOUNT_SETTINGS_STATEMENT_TIMEOUT_MS = 2_000;
export const ACCOUNT_SETTINGS_LOCK_TIMEOUT_MS = 1_000;
type SettingsPool = {
  connect(): Promise<DbTransactionDeadlineClient>;
  query(sql: string, values: unknown[]): Promise<unknown>;
};
export type AccountSettingsTransactionRunner = <T>(
  timeoutMs: number,
  fn: (query: (text: string, values?: unknown[]) => Promise<QueryResult>) => Promise<T>,
) => Promise<T>;

/** Domain wall deadline covers BEGIN, setup, all statements, COMMIT and cleanup.
 * Production cancellation uses the dedicated side pool so saturation of the
 * settings pool cannot queue cancellation behind the transaction it cancels. */
export function createAccountSettingsTransactionRunner(
  settingsPool: SettingsPool,
  cancelBackend = backendCancelViaPool(settingsPool),
  scheduler?: DbTransactionDeadlineScheduler,
): AccountSettingsTransactionRunner {
  return async (timeoutMs, fn) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new RangeError('invalid settings statement timeout');
    const client = await settingsPool.connect();
    const transaction = createDbTransactionDeadline(client, {
      timeoutMs: ACCOUNT_SETTINGS_TRANSACTION_TIMEOUT_MS,
      operation: 'account settings',
      cancelBackend,
      scheduler,
    });
    try {
      await transaction.query('BEGIN');
      await transaction.query(
        `SET LOCAL statement_timeout = ${Math.min(timeoutMs, ACCOUNT_SETTINGS_STATEMENT_TIMEOUT_MS)}`,
      );
      await transaction.query(`SET LOCAL lock_timeout = ${ACCOUNT_SETTINGS_LOCK_TIMEOUT_MS}`);
      await transaction.query(
        `SET LOCAL idle_in_transaction_session_timeout = ${ACCOUNT_SETTINGS_TRANSACTION_TIMEOUT_MS}`,
      );
      const result = await fn((text, values) => transaction.query(text, values));
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.release();
    }
  };
}
// db.ts imports this domain's schema during boot. Read its pool only after
// module initialization, when an authenticated settings operation actually runs.
export const runAccountSettingsTransaction: AccountSettingsTransactionRunner = (timeoutMs, fn) =>
  createAccountSettingsTransactionRunner(pool, cancelDetachedBackend)(timeoutMs, fn);
