import type { CharacterState } from '../src/sim/character_state';
import type { MembershipBankTransferRequest } from '../src/sim/membership_bank';
import type { AccountBankInfo } from '../src/world_api/bank';
import type { BankLedgerOutboxSnapshot } from './bank_ledger_outbox';
import { bankLedgerSaveEffects } from './bank_ledger_session';
import {
  listMembershipBanks,
  loadMembershipBank,
  type MembershipBankCommitted,
  transferMembershipBank,
} from './membership_bank_db';
import type { MembershipAuthorization } from './membership_service';
import type { StorageAppliedEffect } from './storage_purchase_db';

export const MEMBERSHIP_BANK_MAX_IN_FLIGHT = 64;
export const MEMBERSHIP_BANK_QUEUE_WAIT_MS = 5_000;
const METER_MAX = 5000;
const METER_BURST = 6;

export interface MembershipBankSession {
  accountId: number;
  characterId: number;
  leaseNonce?: string;
}
export interface MembershipBankCapture {
  state: CharacterState;
  storageEffects?: readonly StorageAppliedEffect[];
  bankLedgerSnapshot?: BankLedgerOutboxSnapshot;
}
export interface MembershipBankHost<S extends MembershipBankSession> {
  /** Alive, at a banker, still the same session, and not quarantined. */
  authorized(session: S): boolean;
  membership(accountId: number): Promise<MembershipAuthorization>;
  /** Acquire shared inventory guard, flush conflicting books, enter the existing
   * save FIFO, and release only when job has settled. Abort unstarted jobs. */
  enqueueExclusive<T>(session: S, job: () => Promise<T>, signal: AbortSignal): Promise<T | null>;
  capture(session: S): MembershipBankCapture | null;
  apply(session: S, committed: MembershipBankCommitted): boolean;
  acknowledge(session: S, capture: MembershipBankCapture): boolean;
  quarantine(session: S, reason: 'uncertain' | 'lease_lost' | 'changed'): void;
  publish(session: S, info: AccountBankInfo): void;
  onError(error: unknown): void;
}
interface BankDatabase {
  list: typeof listMembershipBanks;
  load: typeof loadMembershipBank;
  transfer: typeof transferMembershipBank;
}

export function createMembershipBankService<S extends MembershipBankSession>(
  host: MembershipBankHost<S>,
  database: BankDatabase = {
    list: listMembershipBanks,
    load: loadMembershipBank,
    transfer: transferMembershipBank,
  },
  now: () => number = Date.now,
) {
  // Weak session views disappear with disconnect. Strong bookkeeping is fixed
  // capacity and account keyed so parallel sockets cannot multiply the budget.
  const views = new WeakMap<S, AccountBankInfo>();
  const pending = new Set<number>();
  const meters = new Map<number, { tokens: number; at: number }>();
  const empty = (): AccountBankInfo => ({ characters: [], selectedCharacterId: null, bank: null });
  const send = (session: S, info: AccountBankInfo): void => {
    views.set(session, info);
    host.publish(session, info);
  };
  const fail = (session: S, error: string): void =>
    send(session, {
      ...(views.get(session) ?? empty()),
      bank: null,
      error,
    });
  const membershipActive = (member: MembershipAuthorization): boolean =>
    member.active && Number(member.expiresAt) > now() && member.authorizedUntil > now();

  async function run(
    session: S,
    work: (membership: MembershipAuthorization) => Promise<void>,
  ): Promise<void> {
    if (!host.authorized(session)) {
      fail(session, 'invalid');
      return;
    }
    if (pending.has(session.accountId) || pending.size >= MEMBERSHIP_BANK_MAX_IN_FLIGHT) {
      fail(session, 'busy');
      return;
    }
    const time = now();
    const meter = meters.get(session.accountId) ?? { tokens: METER_BURST, at: time };
    meter.tokens = Math.min(METER_BURST, meter.tokens + Math.max(0, time - meter.at) / 1000);
    meter.at = time;
    if (meter.tokens < 1) {
      fail(session, 'rate_limited');
      return;
    }
    meter.tokens--;
    meters.delete(session.accountId);
    if (meters.size >= METER_MAX) meters.delete(meters.keys().next().value as number);
    meters.set(session.accountId, meter);
    pending.add(session.accountId);
    try {
      const member = await host.membership(session.accountId);
      if (!membershipActive(member)) {
        fail(session, 'membership_required');
        return;
      }
      if (!host.authorized(session)) {
        fail(session, 'invalid');
        return;
      }
      await work(member);
    } catch (error) {
      host.onError(error);
      fail(session, 'unavailable');
    } finally {
      pending.delete(session.accountId);
    }
  }
  return {
    list(session: S): Promise<void> {
      return run(session, async (member) => {
        const characters = await database.list(session.accountId);
        if (!host.authorized(session) || !membershipActive(member)) {
          fail(session, 'membership_required');
          return;
        }
        send(session, {
          characters: characters.filter((row) => row.characterId !== session.characterId),
          selectedCharacterId: null,
          bank: null,
        });
      });
    },
    select(session: S, characterId: number): Promise<void> {
      return run(session, async (member) => {
        if (characterId === session.characterId) {
          fail(session, 'invalid');
          return;
        }
        const result = await database.load(session.accountId, characterId);
        if (!host.authorized(session) || !membershipActive(member)) {
          fail(session, 'membership_required');
          return;
        }
        send(session, {
          ...(views.get(session) ?? empty()),
          selectedCharacterId: characterId,
          bank: result.ok ? result.value : null,
          error: result.ok ? undefined : result.error,
        });
      });
    },
    transfer(
      session: S,
      characterId: number,
      request: MembershipBankTransferRequest,
    ): Promise<void> {
      return run(session, async (member) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), MEMBERSHIP_BANK_QUEUE_WAIT_MS);
        try {
          const answer = await host.enqueueExclusive(
            session,
            async () => {
              clearTimeout(timer);
              if (
                controller.signal.aborted ||
                !host.authorized(session) ||
                !membershipActive(member)
              )
                return false;
              const capture = host.capture(session);
              if (!capture || !session.leaseNonce) return false;
              const result = await database.transfer({
                accountId: session.accountId,
                characterId: session.characterId,
                targetCharacterId: characterId,
                leaseNonce: session.leaseNonce,
                state: capture.state,
                membership: member,
                storageEffects: capture.storageEffects,
                ledgerEffects: capture.bankLedgerSnapshot
                  ? bankLedgerSaveEffects(capture.bankLedgerSnapshot)
                  : undefined,
                request,
                stillAuthorized: () => host.authorized(session) && membershipActive(member),
              });
              if (!result.ok) {
                if (result.error === 'uncertain' || result.error === 'lease_lost')
                  host.quarantine(session, result.error);
                fail(session, result.error);
                return true;
              }
              // This section is synchronous: no economy command or passive grant
              // can interleave the durable acknowledgement and exact-delta apply.
              let applied = false;
              try {
                applied = host.apply(session, result.value) && host.acknowledge(session, capture);
              } catch (error) {
                host.onError(error);
              }
              if (!applied) {
                host.quarantine(session, 'changed');
                fail(session, 'uncertain');
                return true;
              }
              send(session, {
                ...(views.get(session) ?? empty()),
                selectedCharacterId: characterId,
                bank: result.value.bank,
                error: undefined,
              });
              return true;
            },
            controller.signal,
          );
          if (!answer) fail(session, 'busy');
        } finally {
          clearTimeout(timer);
        }
      });
    },
  };
}
