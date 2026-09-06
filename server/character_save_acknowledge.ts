// The post-COMMIT half of a caller-owned character save: consume the exact
// effect prefix the committed save carried (staged storage effects and the
// bank ledger outbox snapshot) as ONE decision, after proving the save still
// belongs to the live session. Extracted from GameServer so the market
// custody path and the guild roster purchase share it without either seam
// reaching into the session's queues on its own.
//
// The contract every caller relies on: exact-match the character AND the
// lease identity, consume neither queue on any mismatch, and answer false
// rather than throw, so a known database commit can never enter a caller's
// compensation arm by way of a bookkeeping error.

import { visitGuildLedgerIdsForOps } from './bank_ledger_guild_prefix';
import {
  acknowledgeCharacterSaveEffects as acknowledgeCommittedCharacterSaveEffects,
  type BankLedgerSessionJournal,
} from './bank_ledger_session';
import { bustGuildBankLog, GUILD_BANK_LOG_VISIBLE_OPS } from './guild_bank_log';
import { REALM } from './realm';
import type { StorageAppliedEffect } from './storage_purchase_db';
import { storageAppliedEffectsCommitted } from './storage_purchases';
import type { CharacterSaveArgs } from './woc_market_character_save';

/** The slice of a live session the acknowledgement reads and consumes. */
export interface AcknowledgingSession {
  readonly characterId: number;
  readonly accountId: number;
  readonly leaseNonce: string | undefined;
  readonly pendingStorageAppliedEffects: StorageAppliedEffect[];
  readonly bankLedgerJournal: BankLedgerSessionJournal;
}

export function acknowledgeSessionSaveEffects(
  session: AcknowledgingSession | null | undefined,
  save: CharacterSaveArgs,
): boolean {
  const snapshot = save.bankLedgerSnapshot;
  if (
    !session ||
    session.leaseNonce !== save.leaseNonce ||
    !snapshot ||
    snapshot.owner.realm !== REALM ||
    snapshot.owner.characterId !== session.characterId ||
    snapshot.owner.accountId !== session.accountId
  ) {
    return false;
  }
  const acknowledged = acknowledgeCommittedCharacterSaveEffects({
    pendingStorageEffects: session.pendingStorageAppliedEffects,
    storageSnapshot: save.storageEffects ?? [],
    ledgerOutbox: session.bankLedgerJournal.outbox,
    ledgerSnapshot: snapshot,
    onStorageCommitted: storageAppliedEffectsCommitted,
    onPostCommitFailure: (error) =>
      console.error(
        `storage recovery notification failed after WOC save for character ${session.characterId}:`,
        error,
      ),
  });
  if (acknowledged) {
    visitGuildLedgerIdsForOps(snapshot.batches, GUILD_BANK_LOG_VISIBLE_OPS, bustGuildBankLog);
  }
  return acknowledged;
}
