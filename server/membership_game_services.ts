import { nearBanker } from '../src/sim/bank';
import { applyMembershipBankInventoryPlan } from '../src/sim/membership_bank';
import type { Sim } from '../src/sim/sim';
import { tradeInfoFor } from '../src/sim/social/trade';
import type { InvSlot } from '../src/sim/types';
import type { ClientSession } from './game';
import { CUSTODY_PARCEL_LETTERS, confirmCustodyParcelBooked } from './mail_custody_overlay';
import { createMembershipBankService } from './membership_bank_service';
import { MEMBERSHIP_REFRESH_BATCH_SIZE } from './membership_batch';
import { consumeMembershipToken, redeemMembershipTokenAtomic } from './membership_redemption_db';
import {
  bustMembership,
  getMembership,
  getMembershipBatch,
  trustedRecurringMembershipExpiry,
} from './membership_service';
import { createMembershipTokenDelivery } from './membership_token_delivery';
import {
  persistMembershipAnnualDelivery,
  persistMembershipTokenDelivery,
} from './membership_token_delivery_db';
import type { MembershipTokenRecipient } from './membership_token_store';
import { KeyedSerialWriteAborted } from './serial_writer';
import type { CharacterSaveArgs } from './woc_market_character_save';

interface MembershipGameHost {
  sim: Sim;
  session(id: number): ClientSession | null;
  enqueue<T>(id: number, job: () => Promise<T>, signal: AbortSignal): Promise<T>;
  capture(id: number): Omit<CharacterSaveArgs, 'characterId' | 'leaseNonce'> | null;
  conflict(id: number): boolean;
  acknowledge(save: CharacterSaveArgs): boolean;
  quarantine(pid: number, id: number, kind: 'fenced' | 'ambiguous', surface: string): void;
  send(session: ClientSession, message: unknown): void;
  kick(session: ClientSession, message: string): void;
  observeCost(ms: number): void;
  mailWrite<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  database<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export const MEMBERSHIP_REFRESH_WORKERS = 4;
export const MEMBERSHIP_REFRESH_MS = 30_000;
export const MEMBERSHIP_REFRESH_COALESCE_MS = 25;

interface MembershipAccountSessions {
  sessions: Set<ClientSession>;
  nextRefreshAt?: number;
}

/** Account-scoped refreshes and deliberate banking operations, never snapshot reads. */
export class MembershipGameServices {
  private readonly busy = new Set<number>();
  private readonly accounts = new Map<number, MembershipAccountSessions>();
  private readonly refreshQueue = new Set<number>();
  private readonly refreshWakeups = new Map<
    number,
    { accounts: Set<number>; timer: ReturnType<typeof setTimeout> }
  >();
  private refreshing = 0;
  private refreshDrainTimer?: ReturnType<typeof setTimeout>;
  readonly bank;

  constructor(private readonly host: MembershipGameHost) {
    this.bank = createMembershipBankService<ClientSession>({
      authorized: (s) => {
        const player = host.sim.entities.get(s.pid);
        return this.valid(s) && !!player && !player.dead && nearBanker(host.sim.ctx, player);
      },
      membership: getMembership,
      enqueueExclusive: (s, job, signal) => this.exclusive(s, job, signal),
      capture: (s) => host.capture(s.characterId),
      apply: (s, result) => {
        const meta = host.sim.meta(s.pid);
        if (!meta || !this.valid(s)) return false;
        const next = applyMembershipBankInventoryPlan(
          meta.inventory,
          result.inventoryBefore,
          result.inventory,
          meta.bags,
        );
        if (!next) return false;
        meta.inventory = next;
        host.sim.ctx.onInventoryChangedForQuests(meta);
        return true;
      },
      acknowledge: (s, snap) =>
        host.acknowledge({
          ...snap,
          level: snap.state.level,
          characterId: s.characterId,
          leaseNonce: s.leaseNonce,
          storageEffects: [...(snap.storageEffects ?? [])],
        }),
      quarantine: (s, reason) =>
        host.quarantine(
          s.pid,
          s.characterId,
          reason === 'lease_lost' ? 'fenced' : 'ambiguous',
          'membership bank',
        ),
      publish: (s, info) => {
        if (this.valid(s)) host.send(s, { t: 'account_bank', info });
      },
      onError: (error) => console.error('membership bank failed:', error),
    });
  }

  private valid(session: ClientSession): boolean {
    return (
      !session.left &&
      !session.escrowQuarantined &&
      this.host.session(session.characterId) === session
    );
  }
  isBusy(accountId: number): boolean {
    return this.busy.has(accountId);
  }

  private tokenDelivery?: ReturnType<typeof createMembershipTokenDelivery>;
  private annualDelivery?: ReturnType<typeof createMembershipTokenDelivery>;

  recipient(accountId: number): MembershipTokenRecipient | null {
    const group = this.accounts.get(accountId);
    if (!group) return null;
    for (const session of group.sessions) {
      if (this.valid(session)) return { characterId: session.characterId, name: session.name };
    }
    return null;
  }

  deliverToken(
    accountId: number,
    recipient: MembershipTokenRecipient,
    receiptId: string,
  ): Promise<boolean> {
    this.tokenDelivery ??= this.createDelivery(persistMembershipTokenDelivery);
    return this.tokenDelivery(accountId, recipient, receiptId);
  }

  deliverAnnualReward(
    accountId: number,
    recipient: MembershipTokenRecipient,
    receiptId: string,
  ): Promise<boolean> {
    this.annualDelivery ??= this.createDelivery(persistMembershipAnnualDelivery);
    return this.annualDelivery(accountId, recipient, receiptId);
  }

  private createDelivery(persist: typeof persistMembershipTokenDelivery) {
    return createMembershipTokenDelivery({
      mailWrite: (job, signal) => this.host.mailWrite(job, signal),
      database: (job, signal) => this.host.database(job, signal),
      persist,
      book: (parcel) => {
        const booked = this.host.sim.mailSystemParcel(
          parcel.recipient,
          CUSTODY_PARCEL_LETTERS[parcel.letter],
          parcel.items,
          parcel.custodyRef,
        );
        if (!booked && !this.host.sim.hasCustodyParcel(parcel.custodyRef)) return false;
        confirmCustodyParcelBooked(parcel);
        return true;
      },
    });
  }

  private async exclusive<T>(
    session: ClientSession,
    job: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T | null> {
    // One outstanding operation per account, four per realm; no unbounded FIFO admission.
    if (this.busy.has(session.accountId) || this.busy.size >= 4 || !this.valid(session))
      return null;
    this.busy.add(session.accountId);
    let started = false;
    try {
      return await this.host.enqueue(
        session.characterId,
        async () => {
          started = true;
          if (
            !this.valid(session) ||
            this.host.conflict(session.characterId) ||
            tradeInfoFor(this.host.sim.ctx, session.pid)
          )
            return null;
          return job();
        },
        signal,
      );
    } catch (error) {
      if (error instanceof KeyedSerialWriteAborted || (!started && signal.aborted)) return null;
      throw error;
    } finally {
      this.busy.delete(session.accountId);
    }
  }

  onJoin(session: ClientSession): void {
    let group = this.accounts.get(session.accountId);
    if (!group) {
      group = { sessions: new Set() };
      this.accounts.set(session.accountId, group);
    }
    group.sessions.add(session);
    this.requestRefresh(session.accountId);
  }
  onLeave(session: ClientSession): void {
    const group = this.accounts.get(session.accountId);
    if (!group) return;
    group.sessions.delete(session);
    if (group.sessions.size === 0) {
      this.cancelRefresh(session.accountId, group);
      this.accounts.delete(session.accountId);
      this.refreshQueue.delete(session.accountId);
    }
  }
  private cancelRefresh(accountId: number, group: MembershipAccountSessions): void {
    if (group.nextRefreshAt === undefined) return;
    const bucket = this.refreshWakeups.get(group.nextRefreshAt);
    if (bucket) {
      bucket.accounts.delete(accountId);
      if (!bucket.accounts.size) {
        clearTimeout(bucket.timer);
        this.refreshWakeups.delete(group.nextRefreshAt);
      }
    }
    group.nextRefreshAt = undefined;
  }
  private scheduleRefresh(accountId: number, group: MembershipAccountSessions): void {
    this.cancelRefresh(accountId, group);
    // One timer per due cohort, not one timer per player. Rounding adds at most
    // one second, inside the 60-second authority budget.
    const due = Math.ceil((Date.now() + MEMBERSHIP_REFRESH_MS) / 1000) * 1000;
    let bucket = this.refreshWakeups.get(due);
    if (!bucket) {
      const accounts = new Set<number>();
      const timer = setTimeout(() => {
        this.refreshWakeups.delete(due);
        for (const id of accounts) {
          const current = this.accounts.get(id);
          if (current?.nextRefreshAt === due) {
            current.nextRefreshAt = undefined;
            this.requestRefresh(id);
          }
        }
      }, due - Date.now()).unref();
      bucket = { accounts, timer };
      this.refreshWakeups.set(due, bucket);
    }
    bucket.accounts.add(accountId);
    group.nextRefreshAt = due;
  }
  private requestRefresh(accountId: number): void {
    if (!this.accounts.has(accountId)) return;
    this.refreshQueue.add(accountId);
    // Coalesce join/timer cohorts into bounded batches rather than spending one
    // external request on each account at the head of a timer burst.
    if (!this.refreshDrainTimer) {
      this.refreshDrainTimer = setTimeout(() => {
        this.refreshDrainTimer = undefined;
        this.drainRefresh();
      }, MEMBERSHIP_REFRESH_COALESCE_MS).unref();
    }
  }
  private drainRefresh(): void {
    while (this.refreshing < MEMBERSHIP_REFRESH_WORKERS && this.refreshQueue.size) {
      const ids: number[] = [];
      for (const accountId of this.refreshQueue) {
        this.refreshQueue.delete(accountId);
        if (this.accounts.has(accountId)) ids.push(accountId);
        if (ids.length === MEMBERSHIP_REFRESH_BATCH_SIZE) break;
      }
      if (!ids.length) continue;
      this.refreshing++;
      void this.refresh(ids).finally(() => {
        this.refreshing--;
        this.drainRefresh();
      });
    }
  }
  private async refresh(accountIds: readonly number[]): Promise<void> {
    const groups = accountIds.map((id) => [id, this.accounts.get(id)] as const);
    try {
      const memberships = await getMembershipBatch(accountIds);
      const started = performance.now();
      for (const [accountId, group] of groups) {
        if (!group || this.accounts.get(accountId) !== group) continue;
        const membership = memberships.get(accountId);
        const seconds = membership?.active
          ? Math.max(
              0,
              (Math.min(Number(membership.expiresAt), membership.authorizedUntil) - Date.now()) /
                1000,
            )
          : 0;
        for (const session of group.sessions) {
          if (!this.valid(session)) continue;
          this.host.sim.setMembership(session.pid, seconds);
          if (seconds <= 0) {
            this.host.send(session, { t: 'account_bank', info: null });
            if (session.membershipSlot)
              this.host.kick(session, 'membership required for this character');
          }
        }
      }
      this.host.observeCost(performance.now() - started);
    } catch (error) {
      console.error('membership refresh failed:', error);
    } finally {
      for (const [accountId, group] of groups) {
        if (group && this.accounts.get(accountId) === group) {
          this.scheduleRefresh(accountId, group);
        }
      }
    }
  }

  async redeem(session: ClientSession, index?: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const membership = await getMembership(session.accountId);
      await this.exclusive(
        session,
        async () => {
          clearTimeout(timer);
          const snap = this.host.capture(session.characterId);
          if (!snap) return;
          const slot =
            index ?? snap.state.inventory.findIndex((s) => s.itemId === 'membership_token');
          const probe = structuredClone(snap.state);
          if (!consumeMembershipToken(probe, slot)) return;
          const save: CharacterSaveArgs = {
            ...snap,
            characterId: session.characterId,
            leaseNonce: session.leaseNonce,
          };
          const result = await redeemMembershipTokenAtomic(
            session.accountId,
            save,
            slot,
            trustedRecurringMembershipExpiry(membership, Date.now()),
          );
          if (!result.ok) {
            if (result.reason === 'lease_lost')
              this.host.quarantine(
                session.pid,
                session.characterId,
                'fenced',
                'membership redemption',
              );
            return;
          }
          const meta = this.host.sim.meta(session.pid);
          // Commands were fenced. Preserve any unrelated passive grants while consuming this copy.
          if (
            !meta ||
            !this.valid(session) ||
            !consumeMembershipToken(
              { inventory: meta.inventory } as CharacterSaveArgs['state'],
              slot,
            ) ||
            !this.host.acknowledge(save)
          ) {
            this.host.quarantine(
              session.pid,
              session.characterId,
              'ambiguous',
              'membership redemption projection',
            );
            return;
          }
          this.host.sim.ctx.onInventoryChangedForQuests(meta);
          bustMembership(session.accountId);
          this.requestRefresh(session.accountId);
        },
        controller.signal,
      );
    } catch (error) {
      this.host.quarantine(session.pid, session.characterId, 'ambiguous', 'membership redemption');
      console.error('membership redemption failed:', error);
    } finally {
      clearTimeout(timer);
    }
  }

  dispatch(session: ClientSession, command: string, msg: Record<string, unknown>): void {
    if (command === 'account_bank_list') void this.bank.list(session);
    else if (command === 'account_bank_select' && Number.isSafeInteger(msg.characterId))
      void this.bank.select(session, Number(msg.characterId));
    else if (
      command === 'account_bank_transfer' &&
      Number.isSafeInteger(msg.characterId) &&
      Number.isSafeInteger(msg.slotIndex) &&
      (msg.direction === 'deposit' || msg.direction === 'withdraw') &&
      msg.expectedSlot &&
      typeof msg.expectedSlot === 'object'
    ) {
      void this.bank.transfer(session, Number(msg.characterId), {
        direction: msg.direction,
        slotIndex: Number(msg.slotIndex),
        count: typeof msg.count === 'number' ? msg.count : undefined,
        expectedSlot: msg.expectedSlot as InvSlot,
      });
    } else if (command === 'membership_claim_armour')
      this.host.sim.claimMembershipArmour(session.pid);
  }
}
