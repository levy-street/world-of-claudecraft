// Weighted round-robin routing across provider keys.
//
// Algorithm: smooth weighted round-robin (the nginx variant), with each
// provider's weight equal to its *remaining routable budget* for the day:
//
//   weight(p) = max(0, dailyCapacityUsd * headroom - spentTodayUsd)
//
// headroom defaults to 0.9 — we stop routing at ~90% of declared capacity to
// leave slack for metering estimation error vs Venice's own accounting.
//
// Smooth WRR per pick: every candidate's counter increases by its weight, the
// highest counter wins and pays back the total weight. Over N picks each
// provider is selected in exact proportion to its weight, without the bursts
// plain WRR produces, and picks are deterministic given the same state —
// which is what the unit tests assert.
//
// Weights are quantized to micro-dollars (integers) so counter arithmetic is
// exact. Failover order after the primary pick is by remaining budget
// descending (ties broken by id) — a failed provider's counters are left
// as-is, so a transient failure doesn't distort long-run proportions.

export type ProviderStatusLike = 'ACTIVE' | 'DEGRADED' | 'REVOKED' | 'INVALID';

export interface ProviderSnapshot {
  id: string;
  status: ProviderStatusLike;
  dailyCapacityUsd: number;
  spentTodayUsd: number;
}

const MICRO = 1_000_000;

export class WeightedRouter {
  private counters = new Map<string, number>();
  readonly headroom: number;

  constructor(opts: { headroomFraction?: number } = {}) {
    this.headroom = opts.headroomFraction ?? 0.9;
  }

  /** USD still routable to `p` today; 0 when at/over the headroom line. */
  remainingBudgetUsd(p: ProviderSnapshot): number {
    return Math.max(0, p.dailyCapacityUsd * this.headroom - p.spentTodayUsd);
  }

  /** ACTIVE providers with budget left. DEGRADED/REVOKED/INVALID never route. */
  eligible(providers: ProviderSnapshot[]): ProviderSnapshot[] {
    return providers.filter((p) => p.status === 'ACTIVE' && this.remainingBudgetUsd(p) > 0);
  }

  /**
   * Smooth-WRR pick among eligible providers not in `exclude`.
   * Returns null when the pool is exhausted (caller falls back to house key).
   */
  pick(providers: ProviderSnapshot[], exclude: ReadonlySet<string> = new Set()): string | null {
    const cands = this.eligible(providers).filter((p) => !exclude.has(p.id));
    if (cands.length === 0) return null;

    const weights = cands.map((p) => Math.max(1, Math.round(this.remainingBudgetUsd(p) * MICRO)));
    let total = 0;
    for (const w of weights) total += w;

    let winnerIdx = 0;
    let best = -Infinity;
    for (let i = 0; i < cands.length; i++) {
      const next = (this.counters.get(cands[i].id) ?? 0) + weights[i];
      this.counters.set(cands[i].id, next);
      if (next > best || (next === best && cands[i].id < cands[winnerIdx].id)) {
        best = next;
        winnerIdx = i;
      }
    }
    const winner = cands[winnerIdx];
    this.counters.set(winner.id, (this.counters.get(winner.id) ?? 0) - total);
    return winner.id;
  }

  /**
   * Primary pick plus failover candidates, best-budget-first — the order the
   * inference service walks when upstream calls fail. `max` bounds how many
   * distinct providers one request may burn through.
   */
  pickOrder(providers: ProviderSnapshot[], max = 3): string[] {
    const first = this.pick(providers);
    if (first === null) return [];
    const rest = this.eligible(providers)
      .filter((p) => p.id !== first)
      .sort(
        (a, b) => this.remainingBudgetUsd(b) - this.remainingBudgetUsd(a) || (a.id < b.id ? -1 : 1),
      )
      .map((p) => p.id);
    return [first, ...rest].slice(0, max);
  }

  /** Drop counter state for a provider (revoked/invalid) so the map can't grow unbounded. */
  forget(id: string): void {
    this.counters.delete(id);
  }
}
