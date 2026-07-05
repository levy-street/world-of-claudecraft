// A real in-memory EngagementDb shared by the service and API tests. It is a
// working implementation (not a mock of the service): the same uniqueness and
// replay semantics the Postgres schema enforces, so handlers/service are tested
// against genuine persistence behavior.
import {
  EngagementDb,
  DailyCommitRow,
  SpinRow,
  StreakRow,
  PackOpeningInput,
} from '../../server/engagement_db';

export class InMemoryEngagementDb implements EngagementDb {
  commits = new Map<number, DailyCommitRow>();
  spins: SpinRow[] = [];
  private nextSpinId = 1;
  streaks = new Map<number, StreakRow>();
  pity = new Map<string, number>();
  payments = new Set<string>();
  openings: Array<PackOpeningInput & { id: number }> = [];
  private nextOpeningId = 1;

  async getDailyCommit(utcDay: number) {
    const r = this.commits.get(utcDay);
    return r ? { ...r } : null;
  }
  async putDailyCommit(row: DailyCommitRow) {
    if (!this.commits.has(row.utcDay)) this.commits.set(row.utcDay, { ...row });
  }
  async revealDailySeed(utcDay: number) {
    const r = this.commits.get(utcDay);
    if (r) r.revealed = true;
  }

  async getSpinForDay(accountId: number, utcDay: number) {
    const s = this.spins.find((x) => x.accountId === accountId && x.utcDay === utcDay);
    return s ? { ...s } : null;
  }
  async insertSpin(row: Omit<SpinRow, 'id' | 'status' | 'settleSig'>) {
    if (this.spins.some((s) => s.accountId === row.accountId && s.utcDay === row.utcDay)) {
      throw new Error('unique_violation: spins_account_day');
    }
    const rec: SpinRow = { id: this.nextSpinId++, status: 'pending', settleSig: null, ...row };
    this.spins.push(rec);
    return { ...rec };
  }
  async getSpin(id: number) {
    const s = this.spins.find((x) => x.id === id);
    return s ? { ...s } : null;
  }
  async markSpinSettled(id: number, settleSig: string) {
    const s = this.spins.find((x) => x.id === id);
    if (s) {
      s.status = 'settled';
      s.settleSig = settleSig;
    }
  }
  async markSpinFailed(id: number) {
    const s = this.spins.find((x) => x.id === id);
    if (s) s.status = 'failed';
  }
  async listPendingSpins(limit: number) {
    return this.spins
      .filter((s) => s.status === 'pending')
      .sort((a, b) => a.id - b.id)
      .slice(0, limit)
      .map((s) => ({ ...s }));
  }

  async getStreak(accountId: number) {
    return this.streaks.get(accountId) ?? { lastDay: null, streak: 0 };
  }
  async setStreak(accountId: number, row: StreakRow) {
    this.streaks.set(accountId, { ...row });
  }

  async hasPaymentSig(txSig: string) {
    return this.payments.has(txSig);
  }
  async getPity(accountId: number, packId: string) {
    return this.pity.get(`${accountId}:${packId}`) ?? 0;
  }
  async setPity(accountId: number, packId: string, opens: number) {
    this.pity.set(`${accountId}:${packId}`, opens);
  }
  async recordPackOpening(input: PackOpeningInput) {
    if (this.payments.has(input.txSig)) throw new Error('unique_violation: pack_openings.tx_sig');
    this.payments.add(input.txSig);
    const id = this.nextOpeningId++;
    this.openings.push({ ...input, id });
    return id;
  }
}
