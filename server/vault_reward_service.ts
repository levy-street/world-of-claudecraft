// Host orchestration for durable vault rewards. The Sim decides eligibility and
// rolls once; this service makes the outcome and each delivery crash-safe.
import type { Pool, PoolClient } from 'pg';
import { HOARD_REWARD_LETTER } from '../src/sim/content/letters';
import { ITEMS } from '../src/sim/data';
import { applyDurableVaultGuestPayouts } from '../src/sim/rift/hoard_guest_cap';
import {
  confirmHoardRewardChest,
  confirmHoardRewardClaim,
  releaseHoardRewardClaim,
} from '../src/sim/rift/hoard_reward_chest';
import type { Sim } from '../src/sim/sim';
import { confirmVaultAttemptDurable, finishVaultAttempt } from '../src/sim/treasure_vault';
import type { SimEvent } from '../src/sim/types';
import { pool } from './db';
import {
  type CustodyParcelRow,
  confirmCustodyParcelBooked,
  insertCustodyParcelRowIn,
} from './mail_custody_overlay';
import { REALM } from './realm';
import {
  createVaultRewardsDb,
  markVaultRewardClaimBooked,
  type VaultOutcomeInput,
  type VaultRewardClaim,
  vaultCustodyParcelStatus,
  vaultRewardClaimChannel,
} from './vault_rewards_db';

const MAIL_DELAY_MS = 5 * 60_000;
const RETRY_MS = 5_000;
const MAIL_POLL_MS = 30_000;
const MAIL_FULL_RETRY_MS = 10 * 60_000;
const MAIL_WAKE_WAIT_MS = 10_000;
const MAX_MAIL_WAKES_QUEUED = 64;
const MAX_OUTCOME_WRITES = 2;
const MAX_DIRECT_CLAIMS = 3;
const MAX_RECONCILES = 2;
const rewardsDb = createVaultRewardsDb(pool, REALM);

export interface VaultRewardHost {
  readonly sim: Sim;
  withPermit<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  saveOwner(pid: number): Promise<boolean>;
  claimDirect(
    attemptId: string,
    claim: VaultRewardClaim,
    owner: boolean,
  ): Promise<'delivered' | 'already_claimed' | 'lease_lost' | 'retry'>;
  characterPid(characterId: number): number | null;
  onClaimFailure(characterId: number, error: unknown): void;
}

export function saveVaultOwner<Session extends { left: boolean }>(
  session: Session | undefined,
  save: (session: Session) => Promise<boolean>,
): Promise<boolean> {
  return session && !session.left ? save(session) : Promise.resolve(false);
}

export class VaultRewardService {
  private readonly pending = new Map<string, VaultOutcomeInput>();
  private readonly committing = new Set<string>();
  private readonly outcomeRetryAt = new Map<string, number>();
  private readonly claiming = new Set<string>();
  private readonly pendingClaims = new Map<
    string,
    { attemptId: string; characterId: number; pid: number }
  >();
  private readonly pendingReconcile = new Map<
    number,
    { pid: number; attemptId: string; nextAt: number }
  >();
  private readonly reconciling = new Set<number>();
  private nextRetryAt = 0;
  private nextMailAt = 0;
  private mailing = false;
  private readonly mailingRecipients = new Set<number>();
  private readonly queuedMailWakes = new Set<number>();
  private readonly activeMailWakes = new Set<number>();
  private mailCursor: { mailDueAt: string; attemptId: string; characterId: number } | null = null;
  private readonly pendingLiveParcels = new Map<
    string,
    { row: CustodyParcelRow; attemptId: string }
  >();

  constructor(
    private readonly host: VaultRewardHost,
    private readonly db = rewardsDb,
    private readonly mailPool: Pick<Pool, 'connect' | 'query'> = pool,
  ) {}

  observe(events: readonly SimEvent[], now = Date.now()): void {
    for (const event of events) {
      if (event.type === 'treasureVaultOutcomePending') {
        if (!this.pending.has(event.attemptId)) {
          this.pending.set(event.attemptId, {
            attemptId: event.attemptId,
            ownerCharacterId: event.ownerCharacterId,
            claims: event.claims.map((claim) => ({
              ...claim,
              mailDueAt: new Date(now + MAIL_DELAY_MS),
            })),
          });
        }
        // While the immutable outcome is still only in memory, do not let an
        // expired/cleaned-up instance reopen the same consumed map. A restart
        // with no committed outcome deliberately restores the retry right.
        const ownerPid = this.host.characterPid(event.ownerCharacterId);
        const owner = ownerPid === null ? undefined : this.host.sim.meta(ownerPid);
        if (owner?.vaultAttempt?.id === event.attemptId) owner.vaultAttemptDurable = false;
        this.drainOutcomes();
      } else if (event.type === 'treasureVaultClaimRequested' && event.pid !== undefined) {
        this.pendingClaims.set(`${event.attemptId}:${event.characterId}`, {
          attemptId: event.attemptId,
          characterId: event.characterId,
          pid: event.pid,
        });
        this.drainClaims();
      }
    }
  }

  tick(now = Date.now()): void {
    if (now >= this.nextRetryAt) {
      this.nextRetryAt = now + RETRY_MS;
      this.drainOutcomes();
      this.drainClaims();
      this.drainReconciles(now);
    }
    if (now >= this.nextMailAt && !this.mailing) {
      this.nextMailAt = now + MAIL_POLL_MS;
      void this.mailDue(new Date(now));
    }
  }

  onVaultMailTaken(characterId: number): void {
    if (
      !this.queuedMailWakes.has(characterId) &&
      this.queuedMailWakes.size >= MAX_MAIL_WAKES_QUEUED
    )
      return; // the durable ten-minute retry still owns this claim
    this.queuedMailWakes.add(characterId);
    this.drainMailWakes();
  }

  private drainMailWakes(): void {
    for (const characterId of this.queuedMailWakes) {
      if (this.activeMailWakes.size >= 2) break;
      if (this.activeMailWakes.has(characterId)) continue;
      this.queuedMailWakes.delete(characterId);
      this.activeMailWakes.add(characterId);
      void this.wakeMailOne(characterId).finally(() => {
        this.activeMailWakes.delete(characterId);
        this.drainMailWakes();
      });
    }
  }

  private async wakeMailOne(characterId: number): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAIL_WAKE_WAIT_MS);
    timeout.unref();
    try {
      const claim = await this.host.withPermit(
        () => this.db.wakeOldestVaultRewardClaim(characterId, new Date()),
        controller.signal,
      );
      if (claim) await this.host.withPermit(() => this.mailOne(claim), controller.signal);
    } catch (error) {
      this.host.onClaimFailure(characterId, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  reconcileJoin(pid: number, characterId: number, attemptId: string): void {
    const meta = this.host.sim.meta(pid);
    if (meta?.characterId !== characterId || meta.vaultAttempt?.id !== attemptId) return;
    meta.vaultAttemptDurable = false;
    this.pendingReconcile.set(characterId, { pid, attemptId, nextAt: 0 });
    this.drainReconciles(Date.now());
  }

  private drainOutcomes(): void {
    for (const attemptId of this.pending.keys()) {
      if (this.committing.size >= MAX_OUTCOME_WRITES) break;
      if ((this.outcomeRetryAt.get(attemptId) ?? 0) > Date.now()) continue;
      if (!this.committing.has(attemptId)) void this.commitOutcome(attemptId);
    }
  }

  private drainClaims(): void {
    for (const [key, request] of this.pendingClaims) {
      if (this.claiming.size >= MAX_DIRECT_CLAIMS) break;
      if (this.claiming.has(key)) continue;
      this.pendingClaims.delete(key);
      void this.claim(request.attemptId, request.characterId, request.pid);
    }
  }

  private drainReconciles(now: number): void {
    for (const [characterId, pending] of this.pendingReconcile) {
      if (this.reconciling.size >= MAX_RECONCILES) break;
      if (this.reconciling.has(characterId) || pending.nextAt > now) continue;
      void this.reconcileOne(characterId, pending);
    }
  }

  private async reconcileOne(
    characterId: number,
    pending: { pid: number; attemptId: string; nextAt: number },
  ): Promise<void> {
    this.reconciling.add(characterId);
    if (this.pendingReconcile.get(characterId) === pending)
      this.pendingReconcile.delete(characterId);
    try {
      const outcome = await this.host.withPermit(() => this.db.loadVaultOutcome(pending.attemptId));
      const fresh = this.host.sim.meta(pending.pid);
      if (fresh?.characterId !== characterId || fresh.vaultAttempt?.id !== pending.attemptId)
        return;
      if (outcome) {
        finishVaultAttempt(this.host.sim.ctx, characterId, pending.attemptId);
        void this.host
          .saveOwner(pending.pid)
          .catch((error) => this.host.onClaimFailure(characterId, error));
      } else {
        if (!this.pending.has(pending.attemptId))
          confirmVaultAttemptDurable(this.host.sim.ctx, pending.pid, pending.attemptId);
      }
    } catch (error) {
      this.host.onClaimFailure(characterId, error);
      pending.nextAt = Date.now() + RETRY_MS;
      if (!this.pendingReconcile.has(characterId)) this.pendingReconcile.set(characterId, pending);
    } finally {
      this.reconciling.delete(characterId);
      this.drainReconciles(Date.now());
    }
  }

  private async commitOutcome(attemptId: string): Promise<void> {
    const input = this.pending.get(attemptId);
    if (!input || this.committing.has(attemptId)) return;
    this.committing.add(attemptId);
    try {
      await this.host.withPermit(() => this.db.commitVaultOutcome(input));
      // A mailed reward consumes the guest allowance at clear, even when nobody
      // opens the chest. Keep online cap checks in step before opening it.
      for (const claim of input.claims) {
        if (claim.characterId === input.ownerCharacterId || !claim.guestCycle) continue;
        const pid = this.host.characterPid(claim.characterId);
        const meta = pid === null ? undefined : this.host.sim.meta(pid);
        if (
          !meta ||
          meta.characterId !== claim.characterId ||
          meta.worldQuestCycle !== claim.guestCycle
        )
          continue;
        const used = await this.host.withPermit(() =>
          this.db.guestPayoutsForCycle(claim.characterId, claim.guestCycle as string),
        );
        if (this.host.characterPid(claim.characterId) === pid)
          applyDurableVaultGuestPayouts(meta, claim.guestCycle, used);
      }
      this.pending.delete(attemptId);
      this.outcomeRetryAt.delete(attemptId);
      confirmHoardRewardChest(this.host.sim.ctx, attemptId);
      const pid = finishVaultAttempt(this.host.sim.ctx, input.ownerCharacterId, attemptId);
      if (pid !== null)
        void this.host
          .saveOwner(pid)
          .catch((error) => this.host.onClaimFailure(input.ownerCharacterId, error));
    } catch (error) {
      this.outcomeRetryAt.set(attemptId, Date.now() + RETRY_MS);
      this.host.onClaimFailure(input.ownerCharacterId, error);
    } finally {
      this.committing.delete(attemptId);
      this.drainOutcomes();
    }
  }

  private async claim(attemptId: string, characterId: number, pid: number): Promise<void> {
    const key = `${attemptId}:${characterId}`;
    if (this.claiming.has(key)) return;
    this.claiming.add(key);
    try {
      const outcome = await this.host.withPermit(() => this.db.loadVaultOutcome(attemptId));
      const claim = outcome?.claims.find((candidate) => candidate.characterId === characterId);
      if (!outcome || !claim || this.host.characterPid(characterId) !== pid) return;
      const result = await this.host.claimDirect(
        attemptId,
        claim,
        outcome.ownerCharacterId === characterId,
      );
      if (result === 'delivered') {
        confirmHoardRewardClaim(this.host.sim.ctx, attemptId, pid);
      } else if (result === 'already_claimed') {
        confirmHoardRewardClaim(this.host.sim.ctx, attemptId, pid);
      } else if (result === 'lease_lost') {
        this.host.onClaimFailure(characterId, new Error('vault reward character lease lost'));
      }
    } catch (error) {
      this.host.onClaimFailure(characterId, error);
    } finally {
      releaseHoardRewardClaim(this.host.sim.ctx, attemptId, pid);
      this.claiming.delete(key);
      this.drainClaims();
    }
  }

  private async mailDue(now: Date): Promise<void> {
    if (this.mailing) return;
    this.mailing = true;
    try {
      const due = await this.host.withPermit(() =>
        this.db.dueVaultRewardClaims(100, now, this.mailCursor ?? undefined),
      );
      let last: (typeof due)[number] | undefined;
      let processed = 0;
      let failures = 0;
      const startedAt = Date.now();
      for (const claim of due) {
        if (failures >= 3 || Date.now() - startedAt >= 5_000) break;
        last = claim;
        processed++;
        try {
          await this.host.withPermit(() => this.mailOne(claim));
        } catch (error) {
          failures++;
          this.host.onClaimFailure(claim.characterId, error);
        }
      }
      this.mailCursor =
        (due.length === 100 || processed < due.length) && last
          ? { mailDueAt: last.mailDueAt, attemptId: last.attemptId, characterId: last.characterId }
          : null;
    } catch (error) {
      console.error('vault reward mail sweep failed:', error);
    } finally {
      try {
        await this.reconcileLiveParcels();
      } catch (error) {
        console.error('vault reward live parcel reconciliation failed:', error);
      }
      this.mailing = false;
    }
  }

  private async reconcileLiveParcels(): Promise<void> {
    for (const [ref, pending] of [...this.pendingLiveParcels].slice(0, 20)) {
      const { row, attemptId } = pending;
      try {
        const status = await this.host.withPermit(() =>
          vaultCustodyParcelStatus(this.mailPool, REALM, row),
        );
        // A COMMIT whose connection failed can still finish after this read.
        // Keep reconciling a missing row until the due-claim retry proves the
        // rollback by successfully booking, or a late COMMIT becomes visible.
        if (status === 'missing') {
          const channel = await this.host.withPermit(() =>
            vaultRewardClaimChannel(this.mailPool, REALM, attemptId, Number(row.recipient.key)),
          );
          if (channel === 'direct') this.pendingLiveParcels.delete(ref);
          continue;
        }
        if (status === 'conflict') throw new Error(`conflicting vault parcel ${ref}`);
        else this.bookLiveParcel(row);
      } catch (error) {
        this.host.onClaimFailure(Number(row.recipient.key), error);
      } finally {
        if (this.pendingLiveParcels.has(ref)) {
          this.pendingLiveParcels.delete(ref);
          this.pendingLiveParcels.set(ref, pending);
        }
      }
    }
  }

  private bookLiveParcel(row: CustodyParcelRow): void {
    const booked = this.host.sim.mailSystemParcel(
      row.recipient,
      { ...HOARD_REWARD_LETTER, copper: row.copper ?? 0 },
      row.items,
      row.custodyRef,
    );
    if (booked || this.host.sim.hasCustodyParcel(row.custodyRef)) {
      confirmCustodyParcelBooked(row);
      this.pendingLiveParcels.delete(row.custodyRef);
    } else {
      console.error(
        `vault reward parcel ${row.custodyRef} committed but live mail refused; retrying`,
      );
    }
  }

  private async mailOne(claim: VaultRewardClaim & { attemptId: string }): Promise<void> {
    if (this.mailingRecipients.has(claim.characterId)) return;
    this.mailingRecipients.add(claim.characterId);
    try {
      await this.mailOneExclusive(claim);
    } finally {
      this.mailingRecipients.delete(claim.characterId);
    }
  }

  private async mailOneExclusive(claim: VaultRewardClaim & { attemptId: string }): Promise<void> {
    const hasPayload = claim.items.length > 0 || claim.copper > 0;
    if (hasPayload && !this.host.sim.canBookVaultRewardMail(claim.characterId)) {
      await this.db.deferVaultRewardClaim(
        claim.attemptId,
        claim.characterId,
        new Date(Date.now() + MAIL_FULL_RETRY_MS),
      );
      return;
    }
    for (const item of claim.items)
      if (!Object.hasOwn(ITEMS, item.itemId))
        throw new Error(`unknown vault reward item ${item.itemId}`);
    const row: CustodyParcelRow = {
      custodyRef: `vault:${REALM}:${claim.attemptId}:${claim.characterId}`,
      recipient: { key: String(claim.characterId), name: claim.recipientName },
      letter: 'vault_reward',
      items: claim.items.map((item) => ({ ...item })),
      copper: claim.copper,
    };
    const priorPending = this.pendingLiveParcels.has(row.custodyRef);
    if (hasPayload) {
      if (!this.pendingLiveParcels.has(row.custodyRef) && this.pendingLiveParcels.size >= 1000)
        throw new Error('vault live parcel reconciliation backlog saturated');
      this.pendingLiveParcels.set(row.custodyRef, { row, attemptId: claim.attemptId });
    }
    let client: PoolClient;
    try {
      client = await this.mailPool.connect();
    } catch (error) {
      if (!priorPending) this.pendingLiveParcels.delete(row.custodyRef);
      throw error;
    }
    let committed = false;
    let commitStarted = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query(
        "SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '10s'",
      );
      if (hasPayload)
        await insertCustodyParcelRowIn((text, values) => client.query(text, values), row);
      const booked = await markVaultRewardClaimBooked(
        client,
        REALM,
        claim.attemptId,
        claim.characterId,
        'mail',
      );
      if (!booked) {
        await client.query('ROLLBACK');
        // A prior ambiguous COMMIT may have landed since this due read. Its
        // parcel still needs a live-book reconciliation, even after CAS=false.
        if (!priorPending) this.pendingLiveParcels.delete(row.custodyRef);
        return;
      }
      commitStarted = true;
      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!commitStarted && !priorPending) this.pendingLiveParcels.delete(row.custodyRef);
      throw error;
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    if (hasPayload) {
      this.bookLiveParcel(row);
    }
  }
}
