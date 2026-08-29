// Paid guild creation coordinator. It owns the bounded in-flight identity,
// character-save FIFO job, live purse compensation, and post-commit effect
// acknowledgement. GameServer supplies only its live-session and transport ports.

import { GUILD_CREATION_FEE_COPPER } from '../src/sim/guild_bank';
import type { CharacterState } from '../src/sim/sim';
import { bankLedgerSyncMinimumEncodedBytes } from './bank_ledger_admission';
import { BankLedgerGrowthLimitExceeded } from './bank_ledger_growth_budget';
import type { BankLedgerOutboxReservation, BankLedgerOutboxSnapshot } from './bank_ledger_outbox';
import {
  acknowledgeCharacterSaveEffects as acknowledgeCommittedCharacterSaveEffects,
  bankLedgerSaveEffects,
} from './bank_ledger_session';
import { recordDeedUnlocks } from './deeds_records';
import { enqueueLinkChange } from './discord_link_changes';
import type { ClientSession } from './game';
import type { PaidGuildCreateArgs, PaidGuildCreateResult } from './guild_create_db';
import { KeyedSerialWriteAborted, type KeyedSerialWriter } from './serial_writer';
import type { GuildCreateResult } from './social';
import type { StorageAppliedEffect } from './storage_purchase_db';
import { storageAppliedEffectsCommitted } from './storage_purchases';

export const PAID_GUILD_CREATE_MAX_IN_FLIGHT = 2;
export const PAID_GUILD_CREATE_QUEUE_TIMEOUT_MS = 70_000;

export const GUILD_CREATION_FEE_GOLD = ((): number => {
  const gold = GUILD_CREATION_FEE_COPPER / 10_000;
  if (!Number.isInteger(gold) || gold <= 0) {
    throw new Error(
      `GUILD_CREATION_FEE_COPPER must be a positive whole number of gold for the guild.createFee matcher, got ${GUILD_CREATION_FEE_COPPER}`,
    );
  }
  return gold;
})();

/**
 * Add the founder credit to the detached state committed by the atomic create.
 * SocialService applies the same one credit to live state only after COMMIT, so
 * changing the snapshot here preserves that hook without double-crediting it.
 */
function stateWithPaidGuildFounderCredit(state: CharacterState): CharacterState {
  const counters = state.deedStats?.counters;
  return {
    ...state,
    deedStats: {
      ...state.deedStats,
      counters: {
        ...counters,
        guildsFounded: (counters?.guildsFounded ?? 0) + 1,
      },
    },
  };
}

interface PendingPaidGuildCreate {
  readonly accountId: number;
  readonly batchKey: string;
  readonly ledgerReservation: BankLedgerOutboxReservation;
  readonly origin: ClientSession;
  readonly queueAbort: AbortController;
  readonly queueTimeout: ReturnType<typeof setTimeout>;
  charge: { amount: number; pursePaid: number } | null;
}

export interface PaidGuildCreateSnapshot {
  readonly level: number;
  readonly state: CharacterState;
  readonly storageEffects: readonly StorageAppliedEffect[];
  readonly bankLedgerSnapshot: BankLedgerOutboxSnapshot;
}

export interface PaidGuildCreationHost {
  readonly characterSaveQueues: Pick<KeyedSerialWriter<number>, 'enqueueCancellable'>;
  readonly sessionByCharacterId: (characterId: number) => ClientSession | undefined;
  readonly copperFor: (pid: number) => number | undefined;
  readonly hasEntity: (pid: number) => boolean;
  readonly chargeFee: (pid: number) => number;
  readonly refundFee: (pid: number, amount: number) => number;
  readonly serializeForPersist: (characterId: number) => PaidGuildCreateSnapshot | null;
  readonly createAtomic: (args: PaidGuildCreateArgs) => Promise<PaidGuildCreateResult>;
  readonly guildCreate: (
    session: ClientSession,
    rawName: string,
    create: (name: string, leaderId: number) => Promise<GuildCreateResult>,
  ) => Promise<boolean>;
  readonly sendNotice: (session: ClientSession, text: string) => void;
  readonly quarantineProjection: (session: ClientSession, error: unknown) => void;
  readonly quarantineGrowthLimit: (
    session: ClientSession,
    error: BankLedgerGrowthLimitExceeded,
  ) => void;
  /** Refresh the player-visible create_fee projection after exact COMMIT acknowledgement. */
  readonly bustCommittedGuildLog: (guildId: number) => void;
  readonly kick: (session: ClientSession, reason: string, auditReason: string) => void;
  readonly logSocialError: (error: unknown) => void;
  readonly nowMs?: () => number;
}

export interface PaidGuildCreationCoordinator {
  start(session: ClientSession, rawName: string): void;
  cancelQueuedForLeave(session: ClientSession): void;
  readonly pendingCount: number;
}

export function createPaidGuildCreationCoordinator(
  host: PaidGuildCreationHost,
): PaidGuildCreationCoordinator {
  const pendingByCharacter = new Map<number, PendingPaidGuildCreate>();
  const nowMs = host.nowMs ?? Date.now;

  const clearPending = (pending: PendingPaidGuildCreate): void => {
    // The fee row was never needed, safely rolled back, or committed directly
    // by the atomic transaction instead of entering the ordinary outbox.
    pending.origin.bankLedgerJournal.outbox.cancel(pending.ledgerReservation);
    if (pendingByCharacter.get(pending.origin.characterId) === pending) {
      pendingByCharacter.delete(pending.origin.characterId);
    }
  };

  const abandonPending = (pending: PendingPaidGuildCreate): void => {
    // Unknown durability retains the charged capacity until terminal session
    // teardown discards the quarantined outbox.
    if (pendingByCharacter.get(pending.origin.characterId) === pending) {
      pendingByCharacter.delete(pending.origin.characterId);
    }
  };

  const refundCharge = (pending: PendingPaidGuildCreate): boolean => {
    const charge = pending.charge;
    if (!charge) return true;
    const session = host.sessionByCharacterId(pending.origin.characterId);
    const before = session === pending.origin ? host.copperFor(session.pid) : undefined;
    if (session !== pending.origin || before === undefined || charge.amount <= 0) {
      console.error(
        `guild create fee refund lost its exact live origin for character ${pending.origin.characterId}`,
      );
      return false;
    }
    const refunded = host.refundFee(session.pid, charge.amount);
    const after = host.copperFor(session.pid);
    if (refunded !== charge.amount || after === undefined || after - before !== charge.amount) {
      console.error(
        `guild create fee refund could not be proved for character ${session.characterId}: charged ${charge.amount}, refunded ${refunded}`,
      );
      return false;
    }
    pending.charge = null;
    return true;
  };

  const runPaidCreate = (
    session: ClientSession,
    pending: PendingPaidGuildCreate,
    name: string,
    leaderId: number,
  ): Promise<GuildCreateResult> => {
    const characterId = session.characterId;
    return host.characterSaveQueues
      .enqueueCancellable(
        characterId,
        pending.queueAbort.signal,
        async (): Promise<GuildCreateResult> => {
          clearTimeout(pending.queueTimeout);
          const refuse = (
            error: Extract<GuildCreateResult, { error: string }>['error'],
          ): GuildCreateResult => {
            clearPending(pending);
            return { error };
          };
          const live = host.sessionByCharacterId(characterId);
          if (
            pendingByCharacter.get(characterId) !== pending ||
            live !== session ||
            pending.origin !== session ||
            pending.accountId !== session.accountId ||
            leaderId !== characterId ||
            session.left ||
            session.escrowQuarantined ||
            !session.leaseNonce
          ) {
            return refuse('busy');
          }
          // The direct create transaction intentionally carries no live guild
          // book. Ordinary queued guild rows must drain through their own save.
          if (
            session.dirtyGuildBanks.size > 0 ||
            session.bankLedgerJournal.outbox.hasQueuedGuildRows
          ) {
            return refuse('busy');
          }
          const purse = host.copperFor(session.pid);
          if (
            purse === undefined ||
            !host.hasEntity(session.pid) ||
            purse < GUILD_CREATION_FEE_COPPER
          ) {
            return refuse('insufficient_funds');
          }

          const charged = host.chargeFee(session.pid);
          const pursePaid = (host.copperFor(session.pid) ?? purse) - purse;
          if (charged !== GUILD_CREATION_FEE_COPPER || pursePaid !== -charged) {
            if (charged === 0 && pursePaid === 0) return refuse('insufficient_funds');
            if (charged > 0 && pursePaid === -charged) {
              pending.charge = { amount: charged, pursePaid };
              if (refundCharge(pending)) {
                clearPending(pending);
                return { error: 'insufficient_funds' };
              }
            }
            const error = new Error(
              `guild create charge invariant failed: reported ${charged}, observed ${pursePaid}`,
            );
            abandonPending(pending);
            host.quarantineProjection(session, error);
            throw new Error('guild creation charge could not be proved');
          }
          pending.charge = { amount: charged, pursePaid };

          const save = host.serializeForPersist(characterId);
          if (!save) {
            const refunded = refundCharge(pending);
            const error = new Error('paid guild create lost its post-charge character snapshot');
            if (refunded) clearPending(pending);
            else {
              abandonPending(pending);
              host.quarantineProjection(session, error);
            }
            throw error;
          }
          const recordUpTo = session.pendingDeedRecords.length;

          const result = await host.createAtomic({
            name,
            characterId,
            accountId: session.accountId,
            level: save.level,
            state: stateWithPaidGuildFounderCredit(save.state),
            leaseNonce: session.leaseNonce,
            storageEffects: save.storageEffects,
            ledgerEffects: bankLedgerSaveEffects(save.bankLedgerSnapshot),
            fee: {
              batchKey: pending.batchKey,
              chargedCopper: charged,
              purseCopperDelta: pursePaid,
            },
          });

          if (result.durability === 'commit_ambiguous') {
            abandonPending(pending);
            host.quarantineProjection(session, result.error);
            throw result.error;
          }
          if (result.durability === 'not_committed') {
            const refunded = refundCharge(pending);
            if (!refunded) {
              const error = new Error(
                `paid guild create ${result.reason} could not be compensated`,
              );
              abandonPending(pending);
              host.quarantineProjection(session, error);
              throw new Error('paid guild creation compensation failed');
            }
            clearPending(pending);
            if (result.reason === 'name_taken' || result.reason === 'already_in_guild') {
              return { error: result.reason };
            }
            if (result.reason === 'lease_lost') {
              host.kick(session, 'character taken over', 'paid guild create fenced');
              throw new Error('paid guild creation lost the character lease');
            }
            if (result.reason === 'database_error') {
              if (result.error instanceof BankLedgerGrowthLimitExceeded) {
                host.quarantineGrowthLimit(session, result.error);
              }
              throw result.error;
            }
            throw new Error('unexpected paid guild refusal');
          }

          // COMMIT is authoritative. Local acknowledgement and notification
          // failures quarantine for reload but can never refund the founder.
          clearPending(pending);
          session.lastSave = nowMs();
          const quarantineCommitted = (error: unknown): void => {
            try {
              host.quarantineProjection(session, error);
            } catch (quarantineError) {
              session.escrowQuarantined = true;
              console.error('paid guild create post-commit quarantine failed:', quarantineError);
            }
          };
          const feeBatchAcknowledged = result.feeBatchKey === pending.batchKey;
          if (!feeBatchAcknowledged) {
            quarantineCommitted(
              new Error('paid guild create returned a different durable fee batch identity'),
            );
          }
          let acknowledged = false;
          try {
            acknowledged = acknowledgeCommittedCharacterSaveEffects({
              pendingStorageEffects: session.pendingStorageAppliedEffects,
              storageSnapshot: save.storageEffects,
              ledgerOutbox: session.bankLedgerJournal.outbox,
              ledgerSnapshot: save.bankLedgerSnapshot,
              onStorageCommitted: storageAppliedEffectsCommitted,
              onPostCommitFailure: (error) =>
                console.error(
                  `storage recovery notification failed after paid guild create for character ${characterId}:`,
                  error,
                ),
            });
          } catch (error) {
            quarantineCommitted(error);
          }
          if (!acknowledged) {
            quarantineCommitted(
              new Error('paid guild create committed but its exact effect prefix changed'),
            );
          }
          if (feeBatchAcknowledged && acknowledged) {
            try {
              host.bustCommittedGuildLog(result.guildId);
            } catch (error) {
              quarantineCommitted(error);
            }
          }
          try {
            recordDeedUnlocks(
              { characterId, accountId: session.accountId },
              session.pendingDeedRecords.splice(0, recordUpTo),
            );
          } catch (error) {
            quarantineCommitted(error);
          }
          try {
            if (save.level !== session.lastPersistedLevel) {
              session.lastPersistedLevel = save.level;
              enqueueLinkChange({ accountId: session.accountId, kinds: ['flex'] }, nowMs());
            }
          } catch (error) {
            quarantineCommitted(error);
          }
          return { guildId: result.guildId };
        },
      )
      .catch((error) => {
        if (error instanceof KeyedSerialWriteAborted && !pending.charge) {
          clearPending(pending);
          return { error: 'busy' };
        }
        // An unexpected rejection after a measured charge crosses an unknown
        // DB boundary. Never compensate it from live memory alone.
        if (pendingByCharacter.get(characterId) === pending) {
          if (pending.charge) {
            abandonPending(pending);
            host.quarantineProjection(session, error);
          } else {
            clearPending(pending);
          }
        }
        throw error;
      });
  };

  return {
    start(session: ClientSession, rawName: string): void {
      const copper = host.copperFor(session.pid);
      if (copper === undefined || copper < GUILD_CREATION_FEE_COPPER) {
        host.sendNotice(session, `You need ${GUILD_CREATION_FEE_GOLD} gold to found a guild.`);
        return;
      }
      if (pendingByCharacter.has(session.characterId)) return;
      if (pendingByCharacter.size >= PAID_GUILD_CREATE_MAX_IN_FLIGHT) {
        host.sendNotice(session, 'You are busy. Try again in a moment.');
        return;
      }
      const ledgerReservation = session.bankLedgerJournal.outbox.tryReserve({
        maxRows: 1,
        maxEncodedBytes: bankLedgerSyncMinimumEncodedBytes(1),
      });
      if (!ledgerReservation) {
        host.sendNotice(session, 'You are busy. Try again in a moment.');
        return;
      }
      const queueAbort = new AbortController();
      const queueTimeout = setTimeout(() => queueAbort.abort(), PAID_GUILD_CREATE_QUEUE_TIMEOUT_MS);
      queueTimeout.unref();
      const pending: PendingPaidGuildCreate = {
        accountId: session.accountId,
        batchKey: ledgerReservation.batchKey,
        ledgerReservation,
        origin: session,
        queueAbort,
        queueTimeout,
        charge: null,
      };
      pendingByCharacter.set(session.characterId, pending);
      const settlement = host
        .guildCreate(session, rawName, (name, leaderId) =>
          runPaidCreate(session, pending, name, leaderId),
        )
        .then(() => clearPending(pending))
        .catch((error) => {
          host.logSocialError(error);
          if (pendingByCharacter.get(session.characterId) !== pending) return;
          if (pending.charge) {
            abandonPending(pending);
            host.quarantineProjection(session, error);
          } else {
            clearPending(pending);
          }
        })
        .finally(() => {
          clearTimeout(pending.queueTimeout);
          if (session.guildCreateSettlement === settlement) {
            session.guildCreateSettlement = undefined;
          }
        });
      session.guildCreateSettlement = settlement;
    },

    cancelQueuedForLeave(session: ClientSession): void {
      const pending = pendingByCharacter.get(session.characterId);
      if (pending?.origin === session && !pending.charge) pending.queueAbort.abort();
    },

    get pendingCount(): number {
      return pendingByCharacter.size;
    },
  };
}
