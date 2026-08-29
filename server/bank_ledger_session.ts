// Character-session ownership for the transactional bank-ledger outbox.
// Gameplay callers reserve before mutation, character saves capture an exact
// immutable prefix, and the host advances ledger + storage effects together
// only after the database transaction commits.

import { randomUUID } from 'node:crypto';
import type { VaultConsumptionReservation, VaultConsumptionTake } from '../src/sim/types';
import { buildVaultCraftConsumeLedgerRows } from './bank_ledger';
import {
  type BankLedgerAdmission,
  BankLedgerOutboxAdmission,
  type BankLedgerProjectionSurface,
} from './bank_ledger_admission';
import {
  BankLedgerOutbox,
  type BankLedgerOutboxOptions,
  type BankLedgerOutboxPreparedReservation,
  type BankLedgerOutboxSnapshot,
  type PreparedBankLedgerCommandBatch,
  serializeBankLedgerCommandBatch,
} from './bank_ledger_outbox';
import type { BankLedgerSaveEffects } from './bank_ledger_save_effects_db';
import {
  acknowledgeStorageAppliedEffects,
  storageAppliedEffectsMatchPrefix,
} from './storage_applied_effect_queue';
import type { StorageAppliedEffect } from './storage_purchase_db';

export const BANK_LEDGER_SAVE_HIGH_WATER_ROWS = 1_024;
export const BANK_LEDGER_SAVE_HIGH_WATER_BYTES = 1024 * 1024;

export interface BankLedgerSessionJournal {
  readonly outbox: BankLedgerOutbox;
  readonly admission: BankLedgerAdmission;
  reserveVaultConsumption(
    takes: readonly VaultConsumptionTake[],
    vaultUpgrades: number,
  ): VaultConsumptionReservation | null;
}

export interface BankLedgerSessionJournalHooks {
  /** Runs synchronously after a guarded mutation can no longer be projected.
   *  The live host must quarantine before any disconnect can save it. */
  readonly onProjectionFailure: (error: unknown, surface: BankLedgerProjectionSurface) => void;
  /** A malformed pre-mutation host projection is safe to refuse and log. */
  readonly onReservationFailure?: (error: unknown) => void;
  /** Coalesced by the host; this callback must never save synchronously. */
  readonly onHighWater?: () => void;
}

type JournalOutboxOptions = Pick<BankLedgerOutboxOptions, 'budget' | 'limits'>;

export function nextBankLedgerBatchKey(): string {
  return `ledger:${randomUUID()}`;
}

/** Construct the two admission surfaces that share one character-owned queue. */
export function createBankLedgerSessionJournal(
  owner: BankLedgerOutboxOptions['owner'],
  hooks: BankLedgerSessionJournalHooks,
  options: JournalOutboxOptions = {},
): BankLedgerSessionJournal {
  const outbox = new BankLedgerOutbox({
    owner,
    ...options,
    nextBatchKey: nextBankLedgerBatchKey,
  });
  const admission = new BankLedgerOutboxAdmission(outbox, {
    onProjectionFailure: hooks.onProjectionFailure,
  });

  const noteHighWater = (): void => {
    if (bankLedgerJournalNeedsSave(outbox)) hooks.onHighWater?.();
  };

  return Object.freeze({
    outbox,
    admission,
    reserveVaultConsumption(
      takes: readonly VaultConsumptionTake[],
      vaultUpgrades: number,
    ): VaultConsumptionReservation | null {
      let batch: PreparedBankLedgerCommandBatch;
      let reservation: BankLedgerOutboxPreparedReservation | null;
      try {
        batch = serializeBankLedgerCommandBatch(
          nextBankLedgerBatchKey(),
          buildVaultCraftConsumeLedgerRows([
            {
              who: {
                characterId: outbox.owner.characterId,
                accountId: outbox.owner.accountId,
              },
              takes,
              upgrades: vaultUpgrades,
            },
          ]),
        );
        reservation = outbox.tryReservePrepared(batch);
      } catch (error) {
        hooks.onReservationFailure?.(error);
        return null;
      }
      if (!reservation) return null;
      let active = true;
      return Object.freeze({
        commit(): void {
          if (!active) return;
          try {
            outbox.commitPrepared(reservation);
            active = false;
          } catch (error) {
            // commitPrepared is accounting-only, but a broken invariant here
            // follows the same fail-closed rule as a post-mutation projection.
            active = false;
            hooks.onProjectionFailure(error, 'vault');
            return;
          }
          try {
            noteHighWater();
          } catch (error) {
            // Scheduling is outside the mutation/evidence pair. The row is
            // safely queued and the normal autosave remains its backstop.
            hooks.onReservationFailure?.(error);
          }
        },
        cancel(): void {
          if (!active) return;
          outbox.cancel(reservation);
          active = false;
        },
      });
    },
  });
}

export function bankLedgerJournalNeedsSave(outbox: BankLedgerOutbox): boolean {
  const usage = outbox.usage;
  return (
    usage.queuedRows >= BANK_LEDGER_SAVE_HIGH_WATER_ROWS ||
    usage.queuedEncodedBytes >= BANK_LEDGER_SAVE_HIGH_WATER_BYTES
  );
}

/** DB argument for an exact outbox snapshot. Empty snapshots still remain the
 *  host's acknowledgement key but need no transactional ledger statement. */
export function bankLedgerSaveEffects(
  snapshot: BankLedgerOutboxSnapshot,
): BankLedgerSaveEffects | undefined {
  return snapshot.rowCount > 0
    ? Object.freeze({ owner: snapshot.owner, batches: snapshot.batches })
    : undefined;
}

export interface CharacterSaveEffectAcknowledgement {
  readonly pendingStorageEffects: StorageAppliedEffect[];
  readonly storageSnapshot: readonly StorageAppliedEffect[];
  readonly ledgerOutbox: BankLedgerOutbox;
  readonly ledgerSnapshot: BankLedgerOutboxSnapshot;
  readonly onStorageCommitted: (
    characterId: number,
    effects: readonly StorageAppliedEffect[],
  ) => void;
  readonly onPostCommitFailure?: (error: unknown) => void;
}

/** Advance both in-memory effect queues or neither. All checks and mutations
 *  are synchronous, so nothing can invalidate the proven prefixes between the
 *  two preflights and the two acknowledgements. */
export function acknowledgeCharacterSaveEffects(
  effects: CharacterSaveEffectAcknowledgement,
): boolean {
  if (
    !storageAppliedEffectsMatchPrefix(effects.pendingStorageEffects, effects.storageSnapshot) ||
    !effects.ledgerOutbox.canAcknowledge(effects.ledgerSnapshot)
  ) {
    return false;
  }
  acknowledgeStorageAppliedEffects(effects.pendingStorageEffects, effects.storageSnapshot);
  if (!effects.ledgerOutbox.acknowledge(effects.ledgerSnapshot)) {
    // No await, callback, or user code runs between preflight and consume.
    // Reaching this means the outbox violated its own synchronous contract.
    throw new Error('bank ledger acknowledgement changed after preflight');
  }
  try {
    effects.onStorageCommitted(effects.ledgerSnapshot.owner.characterId, effects.storageSnapshot);
  } catch (error) {
    // Durability is already known and both queues are consumed. A recovery
    // notification failure is operational evidence, never grounds to replay.
    effects.onPostCommitFailure?.(error);
  }
  return true;
}
