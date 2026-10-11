import { firstPaidBatch, firstPaidFeed, grantClaudium } from './referral_economy_delivery';
import { referralDiagnostics } from './referral_metrics';
import type { PgReferralStore, ReferralBondRecipient } from './referral_store_db';

export interface ReferralRewardDeliveryHost {
  realm: string;
  withPermit<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T>;
  /** Projection from permanent account entitlement; safe to retry after reconnect. */
  applyEntitlements(accountId: number, mask: number): void;
  /** Uses membership's immutable receipt/custody delivery, never direct inventory mutation. */
  membershipRecipient(accountId: number): ReferralBondRecipient | null;
  deliverMembershipBond(
    accountId: number,
    receipt: string,
    recipient: ReferralBondRecipient,
  ): Promise<boolean>;
  observeCost(ms: number): void;
  onError(error: unknown): void;
}
export interface ReferralRewardDeliveryNetwork {
  firstPaidBatch: typeof firstPaidBatch;
  firstPaidFeed?: typeof firstPaidFeed;
  grantClaudium: typeof grantClaudium;
}
/** Self-clocked bounded outbox pump. No checked-out connection survives across
 * HTTP. Claims expire after 60s; external grants and membership deliveries use
 * permanent idempotency receipts, so a second realm retry cannot duplicate them. */
export class ReferralRewardDelivery {
  private readonly online = new Set<number>();
  private cursor: Iterator<number> | null = null;
  private running = false;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly host: ReferralRewardDeliveryHost,
    private readonly store: PgReferralStore,
    private readonly network: ReferralRewardDeliveryNetwork = {
      firstPaidBatch,
      firstPaidFeed,
      grantClaudium,
    },
  ) {
    this.timer = setInterval(() => {
      void this.pump();
    }, 5_000);
    this.timer.unref();
  }
  attach(accountId: number): void {
    this.online.add(accountId);
  }
  detach(accountId: number): void {
    this.online.delete(accountId);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.online.clear();
    await this.inFlight;
  }
  private database<T>(run: () => Promise<T>): Promise<T> {
    return this.host.withPermit(run, AbortSignal.timeout(15_000));
  }
  private candidates(): number[] {
    this.cursor ??= this.online.values();
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const next = this.cursor.next();
      if (next.done) {
        this.cursor = null;
        break;
      }
      if (this.online.has(next.value)) ids.push(next.value);
    }
    return ids;
  }
  pump(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.stopped) return Promise.resolve();
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private async run(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const started = performance.now();
      const ids = this.candidates();
      this.host.observeCost(performance.now() - started);
      if (this.network.firstPaidFeed) {
        const cursor = await this.database(() => this.store.membershipFeedCursor(this.host.realm));
        if (this.stopped) return;
        const feed = await this.network.firstPaidFeed(cursor, 25);
        if (this.stopped) return;
        if (feed && feed.nextCursor !== cursor)
          await this.database(() =>
            this.store.bookMembershipFeed(this.host.realm, cursor, feed.nextCursor, feed.receipts),
          );
      } else if (ids.length) {
        const candidates = await this.database(() => this.store.membershipCandidates(ids));
        if (this.stopped) return;
        if (candidates.length) {
          const paid = await this.network.firstPaidBatch(candidates);
          if (this.stopped) return;
          if (paid)
            for (const id of candidates) {
              const first = paid.get(id);
              if (first && !first.reversed)
                await this.database(() => this.store.bookMembershipBond(id, first.receiptId));
            }
        }
      }
      if (this.stopped) return;
      const rewards = await this.database(() => this.store.claimRewards());
      referralDiagnostics.outboxClaimed += rewards.length;
      if (this.stopped) return;
      await this.work(rewards, async (row) => {
        if (row.tier === 3 || row.tier === 4) {
          const receipt = `referral_${row.accountId}_tier_${row.tier}`;
          if (!(await this.network.grantClaudium(row.accountId, row.tier, receipt))) {
            referralDiagnostics.outboxFailed++;
            return;
          }
          if (this.stopped) return;
        }
        const mask = await this.database(() => this.store.settleReward(row));
        referralDiagnostics.outboxDelivered++;
        if (!this.stopped) this.host.applyEntitlements(row.accountId, mask);
      });
      if (this.stopped) return;
      const bonds = await this.database(() => this.store.claimBonds(this.host.realm, ids));
      referralDiagnostics.outboxClaimed += bonds.length;
      if (this.stopped) return;
      await this.work(bonds, async (row) => {
        const started = performance.now();
        const proposed = row.recipient ?? this.host.membershipRecipient(row.accountId);
        this.host.observeCost(performance.now() - started);
        if (!proposed) return;
        const recipient =
          row.recipient ?? (await this.database(() => this.store.bindBondRecipient(row, proposed)));
        if (!recipient || recipient.realm !== this.host.realm) return;
        if (this.stopped) return;
        if (
          (await this.host.deliverMembershipBond(row.accountId, row.receipt, recipient)) &&
          !this.stopped
        ) {
          await this.database(() => this.store.settleBond(row));
          referralDiagnostics.outboxDelivered++;
        }
      });
    } catch (error) {
      this.host.onError(error);
    } finally {
      this.running = false;
    }
  }
  private async work<T>(rows: readonly T[], run: (row: T) => Promise<void>): Promise<void> {
    let offset = 0;
    const worker = async () => {
      while (!this.stopped && offset < rows.length) {
        const row = rows[offset++];
        try {
          await run(row);
        } catch (error) {
          referralDiagnostics.outboxFailed++;
          this.host.onError(error);
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
}
