// Synchronous pre-mutation admission for bank-ledger command brackets. The
// outbox owns capacity, stable key generation, serialization, and immutable
// batches; this adapter only reserves a command's worst-case row count and the
// session's entire remaining byte allowance while one event-loop turn mutates
// the Sim and computes its exact rows.

import type { BankLedgerGuildEffectInput, BankLedgerOutbox } from './bank_ledger_outbox';
import type { BankLedgerRow } from './db';

/**
 * Conservative allowance for one row produced by a legal current writer.
 * Known item-instance fields are bounded far below this by
 * item_instance_load.ts; multiplying by the command's maximum row count also
 * leaves room for row metadata and batch JSON. The outbox still reserves every
 * remaining byte, this threshold only refuses a mutation when that remainder
 * is too small to safely hold its worst-case legal command.
 *
 * Forward-compatible unknown instance objects are deliberately not globally
 * size-bounded on load. A post-mutation projection or serialization failure
 * from such corrupt or forward data is therefore still terminal: the live host
 * must quarantine the session and must not save the mutation without its row.
 */
export const BANK_LEDGER_SYNC_SERIALIZED_ROW_CEILING_BYTES = 16 * 1024;

/** Max-key JSON object syntax around the row array, rounded up from the
 *  current 200-byte key contract so the proof is independent of one key. */
export const BANK_LEDGER_SYNC_BATCH_ENVELOPE_BYTES = 256;

/** Formal worst-case legal batch allowance. The extra byte per row prices the
 *  array separator, deliberately including one more than JSON needs. */
export function bankLedgerSyncMinimumEncodedBytes(
  maxRows: number,
  maxGuildEffectDeltas = 0,
): number {
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) {
    throw new RangeError('bank ledger admission maxRows must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxGuildEffectDeltas) || maxGuildEffectDeltas < 0) {
    throw new RangeError(
      'bank ledger admission maxGuildEffectDeltas must be a non-negative safe integer',
    );
  }
  const minimumEncodedBytes =
    BANK_LEDGER_SYNC_BATCH_ENVELOPE_BYTES +
    (maxRows + maxGuildEffectDeltas) * (BANK_LEDGER_SYNC_SERIALIZED_ROW_CEILING_BYTES + 1);
  if (!Number.isSafeInteger(minimumEncodedBytes)) {
    throw new RangeError('bank ledger admission byte allowance exceeds the safe integer range');
  }
  return minimumEncodedBytes;
}

export interface BankLedgerAdmissionHandle {
  /** Commit one logical command. Empty rows cancel the reservation. */
  commit(rows: readonly BankLedgerRow[], guildEffect?: BankLedgerGuildEffectInput | null): boolean;
  /** Release a no-op or refused mutation. Repeated completion is a no-op. */
  cancel(): boolean;
  /** Quarantine signal for a failure after the Sim already mutated. Capacity
   *  deliberately remains charged so no later admitted command can pass it;
   *  the synchronous callback is what prevents a subsequent save. */
  failAfterMutation(error: unknown): void;
}

/** The gameplay surface whose already-applied mutation lost its projection.
 *  Fixed-cardinality so the host can route the incident without inspecting
 *  player or item data. */
export type BankLedgerProjectionSurface = 'personal' | 'vault' | 'guild';

/** Structural seam accepted by synchronous bank and vault wire dispatchers. */
export interface BankLedgerAdmission {
  tryReserve(
    maxRows: number,
    maxGuildEffectDeltas?: number,
    surface?: BankLedgerProjectionSurface,
  ): BankLedgerAdmissionHandle | null;
}

export interface BankLedgerOutboxAdmissionOptions {
  /** Must synchronously quarantine the session before any disconnect path can
   *  save its now-unpaired mutation. Called once per failed handle. */
  readonly onProjectionFailure?: (error: unknown, surface: BankLedgerProjectionSurface) => void;
}

/**
 * Adapt one character-owned outbox to synchronous wire commands. No key is
 * accepted here: BankLedgerOutbox invokes its injected globally unique key
 * factory only after both row and byte capacity checks pass.
 */
export class BankLedgerOutboxAdmission implements BankLedgerAdmission {
  private readonly onProjectionFailure:
    | ((error: unknown, surface: BankLedgerProjectionSurface) => void)
    | undefined;

  constructor(
    private readonly outbox: BankLedgerOutbox,
    options: BankLedgerOutboxAdmissionOptions = {},
  ) {
    this.onProjectionFailure = options.onProjectionFailure;
  }

  tryReserve(
    maxRows: number,
    maxGuildEffectDeltas = 0,
    surface: BankLedgerProjectionSurface = 'personal',
  ): BankLedgerAdmissionHandle | null {
    const minimumEncodedBytes = bankLedgerSyncMinimumEncodedBytes(maxRows, maxGuildEffectDeltas);
    const usage = this.outbox.usage;
    const remainingEncodedBytes =
      this.outbox.limits.maxEncodedBytes - usage.queuedEncodedBytes - usage.reservedEncodedBytes;
    if (remainingEncodedBytes < minimumEncodedBytes) return null;

    const reservation = this.outbox.tryReserve({
      maxRows,
      maxEncodedBytes: remainingEncodedBytes,
    });
    if (!reservation) return null;

    let active = true;
    return Object.freeze({
      commit: (
        rows: readonly BankLedgerRow[],
        guildEffect?: BankLedgerGuildEffectInput | null,
      ): boolean => {
        if (!active) return false;
        if (rows.length === 0) {
          if (guildEffect) {
            throw new Error('bank ledger guild effect cannot commit without ledger rows');
          }
          const cancelled = this.outbox.cancel(reservation);
          active = false;
          return cancelled;
        }
        // A failure here happens after the guarded Sim call. Keep the handle
        // active and the full reservation charged so the live host can detect
        // the terminal condition, quarantine, and refuse to save the mutation.
        this.outbox.commit(reservation, rows, guildEffect);
        active = false;
        return true;
      },
      cancel: (): boolean => {
        if (!active) return false;
        const cancelled = this.outbox.cancel(reservation);
        active = false;
        return cancelled;
      },
      failAfterMutation: (error: unknown): void => {
        if (!active) return;
        active = false;
        this.onProjectionFailure?.(error, surface);
      },
    });
  }
}
