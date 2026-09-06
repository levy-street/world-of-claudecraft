// In-memory WocMarketHeldDb for the Vault tests: the same idempotent-ref and
// non-negative-balance contract as the Pg module, over Maps.

import type {
  WocHeldEntryRow,
  WocHeldPost,
  WocHeldPostOutcome,
  WocMarketHeldDb,
} from '../../../server/woc_market_held_db';

export class FakeWocMarketHeldDb implements WocMarketHeldDb {
  readonly balances = new Map<number, bigint>();
  readonly rows: WocHeldEntryRow[] = [];
  private nextId = 1;

  constructor(
    /** The settlement state oracle for the reversal backlog read. */
    private readonly settlementState: (id: number) => string | null = () => null,
    private readonly now: () => number = () => 1_000,
  ) {}

  async balance(account: number): Promise<string> {
    return (this.balances.get(account) ?? 0n).toString();
  }

  async entries(account: number, limit: number): Promise<WocHeldEntryRow[]> {
    return this.rows
      .filter((e) => e.account === account)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  async post(entry: WocHeldPost): Promise<WocHeldPostOutcome> {
    if (this.rows.some((e) => e.ref === entry.ref)) return 'duplicate';
    const delta = BigInt(entry.deltaBase);
    const next = (this.balances.get(entry.account) ?? 0n) + delta;
    if (next < 0n) return 'insufficient';
    this.balances.set(entry.account, next);
    this.rows.push({
      id: this.nextId++,
      account: entry.account,
      ref: entry.ref,
      kind: entry.kind,
      deltaBase: entry.deltaBase,
      settlementId: entry.settlementId ?? null,
      createdAtMs: this.now(),
    });
    return 'posted';
  }

  async unreversedFailedPayments(limit: number): Promise<WocHeldEntryRow[]> {
    return this.rows
      .filter(
        (e) =>
          e.kind === 'pay' &&
          e.settlementId !== null &&
          ['failed', 'expired'].includes(this.settlementState(e.settlementId) ?? '') &&
          !this.rows.some((r) => r.kind === 'pay_reverse' && r.settlementId === e.settlementId),
      )
      .slice(0, limit);
  }
}
