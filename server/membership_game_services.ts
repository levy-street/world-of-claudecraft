import { MEMBERSHIP_ITEM_DAYS } from '../src/membership_contract';
import { nearBanker } from '../src/sim/bank';
import {
  abandonCourierAccountLeg,
  COURIER_ADMISSION_BYTES,
  COURIER_CAPACITY,
  type CourierAccountLeg,
  courierPayloadFits,
} from '../src/sim/courier';
import { applyMembershipBankInventoryPlan } from '../src/sim/membership_bank';
import type { Sim } from '../src/sim/sim';
import { tradeInfoFor } from '../src/sim/social/trade';
import type { InvSlot } from '../src/sim/types';
import { bankLedgerSaveEffects } from './bank_ledger_session';
import type { ClientSession } from './game';
import { CUSTODY_PARCEL_LETTERS, confirmCustodyParcelBooked } from './mail_custody_overlay';
import { transferCourierAccountLeg } from './membership_bank_db';
import { createMembershipBankService } from './membership_bank_service';
import {
  configureMembershipBatchDatabase,
  MEMBERSHIP_REFRESH_BATCH_SIZE,
} from './membership_batch';
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
  /** Refresh live sessions after an annual reward persisted the account mount entitlement. */
  grantAnnualMount(accountId: number): void;
}
export const MEMBERSHIP_REFRESH_WORKERS = 4;
export const MEMBERSHIP_REFRESH_MS = 30_000;
export const MEMBERSHIP_REFRESH_COALESCE_MS = 25;

/** Realm boot wires batch reads through the same admission gate as membership operations. */
export function createMembershipGameServices(host: MembershipGameHost): MembershipGameServices {
  configureMembershipBatchDatabase((job) => host.database(job));
  return new MembershipGameServices(host);
}

interface MembershipAccountSessions {
  sessions: Set<ClientSession>;
  nextRefreshAt?: number;
}

/** Account-scoped refreshes and deliberate banking operations, never snapshot reads. */
export class MembershipGameServices {
  private readonly busy = new Set<number>();
  private readonly accounts = new Map<number, MembershipAccountSessions>();
  // One pending explicit grant per resident session, cleared on refresh or leave.
  private readonly redemptionArmourClaims = new Set<ClientSession>();
  private readonly refreshQueue = new Set<number>();
  private readonly refreshWakeups = new Map<
    number,
    { accounts: Set<number>; timer: ReturnType<typeof setTimeout> }
  >();
  // Sessions whose courier other-character leg is running right now.
  private readonly courierLegs = new Set<ClientSession>();
  private refreshing = 0;
  private refreshDrainTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  readonly bank;

  constructor(private readonly host: MembershipGameHost) {
    this.bank = createMembershipBankService<ClientSession>({
      authorized: (s) => {
        const player = host.sim.entities.get(s.pid);
        return this.valid(s) && !!player && !player.dead && nearBanker(host.sim.ctx, player);
      },
      // Reading the roster or a bank also works beside a waiting courier, whose
      // window plans deliveries to these banks. Moving items still needs a banker.
      authorizedRead: (s) => {
        const player = host.sim.entities.get(s.pid);
        return (
          this.valid(s) &&
          !!player &&
          !player.dead &&
          (nearBanker(host.sim.ctx, player) || host.sim.meta(s.pid)?.courier?.phase === 'ready')
        );
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
    return this.annualDelivery(accountId, recipient, receiptId).then((delivered) => {
      if (delivered) this.host.grantAnnualMount(accountId);
      return delivered;
    });
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

  /** The Sim's courier hook for the other-character leg. Always 'pending': the
   *  leg settles by leaving the courier's custody (committed or abandoned), which
   *  the Sim sees on its next poll. One run per session at a time. */
  courierAccountExchange(pid: number): 'pending' | 'settled' {
    const meta = this.host.sim.meta(pid);
    const session = meta?.characterId === undefined ? null : this.host.session(meta.characterId);
    const leg = meta?.courier?.account;
    if (!leg) return 'settled';
    if (!session || !this.valid(session) || this.courierLegs.has(session)) return 'pending';
    this.courierLegs.add(session);
    void this.runCourierLeg(session, leg)
      .catch((error) => console.error('courier account leg failed:', error))
      .finally(() => this.courierLegs.delete(session));
    return 'pending';
  }

  private async runCourierLeg(session: ClientSession, leg: CourierAccountLeg): Promise<void> {
    const sameLeg = () => {
      const live = this.host.sim.meta(session.pid)?.courier;
      return !!live?.account && JSON.stringify(live.account) === JSON.stringify(leg);
    };
    const abandon = () => {
      const live = this.host.sim.meta(session.pid)?.courier;
      if (!live || !sameLeg()) return;
      abandonCourierAccountLeg(live);
      live.revision++;
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      await this.exclusive(
        session,
        async () => {
          clearTimeout(timer);
          if (!sameLeg()) return;
          // Membership hydration shares the bounded account and database admission.
          const membership = await getMembership(session.accountId);
          if (!this.valid(session) || !sameLeg()) return;
          if (!(membership.active && membership.authorizedUntil > Date.now())) {
            abandon();
            return;
          }
          const snap = this.host.capture(session.characterId);
          // The captured courier must be the live one, leg and all; a leg that
          // cannot be captured or fenced can never run, so its stacks ride home.
          if (
            !session.leaseNonce ||
            !snap ||
            JSON.stringify(snap.state.courier?.account) !== JSON.stringify(leg)
          ) {
            abandon();
            return;
          }
          const leaseNonce = session.leaseNonce;
          const save: CharacterSaveArgs = {
            ...snap,
            characterId: session.characterId,
            leaseNonce,
          };
          // A thrown write rolled back (a lost COMMIT acknowledgement returns
          // 'uncertain' instead), so its stacks ride home rather than retry forever.
          const result = await transferCourierAccountLeg({
            accountId: session.accountId,
            characterId: session.characterId,
            leaseNonce,
            state: snap.state,
            membership,
            storageEffects: snap.storageEffects,
            ledgerEffects: snap.bankLedgerSnapshot
              ? bankLedgerSaveEffects(snap.bankLedgerSnapshot)
              : undefined,
            stillAuthorized: () => this.valid(session) && sameLeg(),
            fits: (cargo) =>
              cargo.length <= COURIER_CAPACITY &&
              courierPayloadFits({ cargo, withdrawals: [] }, COURIER_ADMISSION_BYTES),
          }).catch((error: unknown) => {
            console.error('courier account leg write failed:', error);
            return { ok: false as const, error: 'unavailable' as const };
          });
          if (!result.ok) {
            if (result.error === 'uncertain' || result.error === 'lease_lost') {
              this.host.quarantine(
                session.pid,
                session.characterId,
                result.error === 'lease_lost' ? 'fenced' : 'ambiguous',
                'courier account leg',
              );
              return;
            }
            // Refused (logged in, gone, too large, membership): the stacks ride home.
            abandon();
            return;
          }
          // The courier waited at the banker with its leg untouched, so the
          // committed courier replaces it exactly; anything else is ambiguous.
          const live = this.host.sim.meta(session.pid);
          if (!live?.courier || !sameLeg() || !this.host.acknowledge(save)) {
            this.host.quarantine(
              session.pid,
              session.characterId,
              'ambiguous',
              'courier account leg projection',
            );
            return;
          }
          live.courier.cargo = result.value.cargo;
          delete live.courier.account;
          live.courier.revision++;
        },
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Clears every pending refresh timer and arms no new one. A cohort wakeup
   *  holds this service, its host and the whole Sim, so a stopped server must
   *  not leave one behind (GameServer.stop). */
  stop(): void {
    this.stopped = true;
    for (const bucket of this.refreshWakeups.values()) clearTimeout(bucket.timer);
    this.refreshWakeups.clear();
    if (this.refreshDrainTimer) clearTimeout(this.refreshDrainTimer);
    this.refreshDrainTimer = undefined;
    this.refreshQueue.clear();
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
    this.redemptionArmourClaims.delete(session);
    this.courierLegs.delete(session);
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
    if (this.stopped) return;
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
    if (this.stopped || !this.accounts.has(accountId)) return;
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
          const repairArmour =
            seconds > 0 &&
            this.redemptionArmourClaims.delete(session) &&
            this.host.sim.entities.get(session.pid)?.membershipActive;
          this.host.sim.setMembership(session.pid, seconds);
          // Ordinary refreshes never traverse owned storage. A committed token
          // repairs already-active members; activation already claims new members.
          if (repairArmour) this.host.sim.claimMembershipArmour(session.pid);
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
          this.redemptionArmourClaims.add(session);
          this.requestRefresh(session.accountId);
          this.host.sim.ctx.emit({
            type: 'membershipRedeemed',
            days: MEMBERSHIP_ITEM_DAYS,
            expiresAt: result.expiresAt,
            pid: session.pid,
          });
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
