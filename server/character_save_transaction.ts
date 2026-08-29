import type { BankLedgerSaveEffects } from './bank_ledger_save_effects_db';
import { prepareBankLedgerSaveEffects } from './bank_ledger_save_effects_db';
import {
  createDbTransactionDeadline,
  type DbTransactionDeadline,
  type DbTransactionDeadlineClient,
} from './db_transaction_deadline';
import { assertStorageAppliedEffectBatch, type StorageAppliedEffect } from './storage_purchase_db';

/** Per-statement server bound for the heavy (signal-less) save arm. Honest
 * residual: the 65s wall deadline destroys only the SOCKET, and PostgreSQL
 * notices a dead client between statements, so a statement that starts just
 * before the wall can hold the accounts/characters/guild_banks locks for up
 * to this full 60s AFTER the deadline fired. statement_timeout is the
 * backstop; DbTransactionDeadline's cancelBackend hook (pg_cancel_backend on
 * the detached pid) is the active bound once wired at the db.ts call sites. */
export const CHARACTER_SAVE_STATEMENT_TIMEOUT_MS = 60_000;
/** Recovery-owned saves are retryable and carry a shutdown signal. Keep their
 * detached-backend ceiling inside the ordinary pool budget instead of letting
 * a cancelled heavy save linger for the full minute. */
export const CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS = 15_000;
export const CHARACTER_SAVE_TRANSACTION_TIMEOUT_MS = 65_000;

/** Validate bounded cross-effect input synchronously, before any pool checkout. */
export function prepareCharacterSaveEffects(
  characterId: number,
  storageEffects: readonly StorageAppliedEffect[],
  ledgerEffects: BankLedgerSaveEffects | undefined,
  allowedGuildIds: readonly number[] = [],
): BankLedgerSaveEffects | undefined {
  assertStorageAppliedEffectBatch(storageEffects);
  return prepareBankLedgerSaveEffects(characterId, storageEffects, ledgerEffects, allowedGuildIds);
}

/** Start one character-save transaction with both server and wall-clock bounds. */
export async function beginCharacterSaveTx(
  client: DbTransactionDeadlineClient,
  operation: string,
  signal?: AbortSignal,
  cancelBackend?: (processId: number) => Promise<void>,
): Promise<DbTransactionDeadline> {
  const statementTimeoutMs = signal
    ? CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS
    : CHARACTER_SAVE_STATEMENT_TIMEOUT_MS;
  const transaction = createDbTransactionDeadline(client, {
    operation,
    timeoutMs: CHARACTER_SAVE_TRANSACTION_TIMEOUT_MS,
    signal,
    cancelBackend,
  });
  try {
    await transaction.query('BEGIN');
    await transaction.query(
      `SET LOCAL statement_timeout = ${statementTimeoutMs};
       SET LOCAL lock_timeout = '2s';
       SET LOCAL idle_in_transaction_session_timeout = '10s'`,
    );
    return transaction;
  } catch (error) {
    await transaction.rollback();
    transaction.release();
    throw error;
  }
}
