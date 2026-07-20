import { describe, expect, it } from 'vitest';
import { WeightedRouter, type ProviderSnapshot } from '@/lib/router';

function snap(
  id: string,
  dailyCapacityUsd: number,
  spentTodayUsd = 0,
  status: ProviderSnapshot['status'] = 'ACTIVE',
): ProviderSnapshot {
  return { id, status, dailyCapacityUsd, spentTodayUsd };
}

describe('WeightedRouter weighting', () => {
  it('distributes picks proportionally to remaining daily credit', () => {
    const router = new WeightedRouter();
    const pool = [snap('a', 10), snap('b', 30), snap('c', 60)];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const N = 10_000;
    for (let i = 0; i < N; i++) counts[router.pick(pool)!]++;
    // Weights 10/30/60 → expected shares 10%/30%/60%; smooth WRR is exact
    // over cycles, allow 1% slack for the tail cycle.
    expect(counts.a / N).toBeCloseTo(0.1, 2);
    expect(counts.b / N).toBeCloseTo(0.3, 2);
    expect(counts.c / N).toBeCloseTo(0.6, 2);
  });

  it('weight shrinks as intraday spend accrues', () => {
    const router = new WeightedRouter();
    // Equal capacity, but "a" has burned most of its day already.
    const pool = [snap('a', 100, 85), snap('b', 100, 0)];
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 1_000; i++) counts[router.pick(pool)!]++;
    // remaining budgets: a = 100*0.9-85 = 5, b = 90 → b gets ~18x the traffic.
    expect(counts.b).toBeGreaterThan(counts.a * 10);
  });

  it('stops routing at the 90% headroom line', () => {
    const router = new WeightedRouter();
    const pool = [snap('a', 100, 90), snap('b', 100, 89.999)];
    // a is exactly at 90% → excluded; b just under → still eligible.
    for (let i = 0; i < 100; i++) expect(router.pick(pool)).toBe('b');
  });

  it('honors a custom headroom fraction', () => {
    const router = new WeightedRouter({ headroomFraction: 0.5 });
    expect(router.pick([snap('a', 100, 50)])).toBeNull();
    expect(router.pick([snap('a', 100, 49)])).toBe('a');
  });

  it('never routes to DEGRADED, REVOKED, or INVALID providers', () => {
    const router = new WeightedRouter();
    const pool = [
      snap('a', 100, 0, 'DEGRADED'),
      snap('b', 100, 0, 'REVOKED'),
      snap('c', 100, 0, 'INVALID'),
      snap('d', 1, 0, 'ACTIVE'),
    ];
    for (let i = 0; i < 50; i++) expect(router.pick(pool)).toBe('d');
  });

  it('returns null when the pool is exhausted (house-key fallback signal)', () => {
    const router = new WeightedRouter();
    expect(router.pick([])).toBeNull();
    expect(router.pick([snap('a', 10, 10), snap('b', 5, 0, 'DEGRADED')])).toBeNull();
  });

  it('respects the exclude set (failover skips failed providers)', () => {
    const router = new WeightedRouter();
    const pool = [snap('a', 100), snap('b', 1)];
    expect(router.pick(pool, new Set(['a']))).toBe('b');
  });

  it('is deterministic for identical state', () => {
    const seqOf = () => {
      const r = new WeightedRouter();
      const pool = [snap('a', 10), snap('b', 20), snap('c', 30)];
      return Array.from({ length: 60 }, () => r.pick(pool));
    };
    expect(seqOf()).toEqual(seqOf());
  });
});

describe('WeightedRouter.pickOrder (failover)', () => {
  it('ranks failover candidates by remaining budget, capped at max', () => {
    const router = new WeightedRouter();
    const pool = [snap('a', 5), snap('b', 50), snap('c', 20), snap('d', 10)];
    const order = router.pickOrder(pool, 3);
    expect(order).toHaveLength(3);
    expect(new Set(order).size).toBe(3);
    // Whatever wins the WRR pick, the failovers are the best-budget others.
    const failovers = order.slice(1);
    const budgets = failovers.map((id) => pool.find((p) => p.id === id)!.dailyCapacityUsd);
    expect(budgets).toEqual([...budgets].sort((x, y) => y - x));
  });

  it('returns empty when nothing is eligible', () => {
    const router = new WeightedRouter();
    expect(router.pickOrder([snap('a', 10, 9.5)])).toEqual([]);
  });
});
