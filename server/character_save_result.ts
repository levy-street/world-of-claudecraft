// The two OUTCOME rules the character-save family shared by copy: did the
// fenced write actually land, and what a failed save's error becomes.
//
// Extracted from server/db.ts at the material-source integration (the monolith
// ratchet; server/CLAUDE.md module-first) because both rules were written out
// four and three times respectively, and each copy was load-bearing: the landed
// predicate decides whether a displaced session's blob is refused, and the
// failure mapping is what turns a growth-limit violation raised inside SQL into
// the typed error the callers surface. Two copies of a predicate is a pair; the
// third and fourth are the rule of three.
//
// Pure: no pool, no clock, no transaction. Both functions are total.
import type { BankLedgerBatchWriteResult } from './bank_ledger_batch_db';
import {
  BankLedgerGrowthLimitExceeded,
  bankLedgerGrowthLimitFromError,
} from './bank_ledger_growth_budget';
import {
  attachBankLedgerCommittedPrefixToError,
  type BankLedgerSaveEffects,
} from './bank_ledger_save_effects_db';
import type { StorageAppliedEffect } from './storage_purchase_db';

/**
 * Did this save's character UPDATE land?
 *
 * A save with NO fence and NO cross-effects is the unconditional write (tests,
 * resumes, meta-less sessions): it reports success whatever the row count,
 * exactly as it did before the lease fence existed. Every other shape is judged
 * on the row count alone, because a zero-row result there means the fence
 * refused the write and the caller must persist NOTHING: a lease-fenced session
 * that lost its lease, or a storage/ledger effect whose paired character half
 * never landed.
 */
export function characterSaveLanded(
  leaseNonce: string | undefined,
  storageEffects: readonly StorageAppliedEffect[],
  ledger: BankLedgerSaveEffects | undefined,
  rowCount: number | null | undefined,
): boolean {
  if (leaseNonce === undefined && storageEffects.length === 0 && !ledger) return true;
  return (rowCount ?? 0) > 0;
}

/**
 * The error a failed save throws: the growth-limit violation recognized
 * whichever way it arrived (thrown by the batch writer, or raised by the
 * database and recognized from its SQLSTATE), carrying the committed-prefix
 * evidence the caller needs to report what DID land before the failure.
 *
 * Returns the failure rather than throwing it, so the call site keeps its
 * `throw` visible and its rollback ordering unchanged.
 */
export function characterSaveFailure(
  err: unknown,
  ledger: BankLedgerSaveEffects | undefined,
  ledgerWrite: BankLedgerBatchWriteResult | undefined,
): unknown {
  const failure =
    err instanceof BankLedgerGrowthLimitExceeded
      ? err
      : (bankLedgerGrowthLimitFromError(err) ?? err);
  attachBankLedgerCommittedPrefixToError(failure, ledger, ledgerWrite);
  return failure;
}
