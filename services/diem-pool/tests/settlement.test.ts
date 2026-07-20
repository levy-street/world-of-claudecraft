import { describe, expect, it } from 'vitest';
import {
  computeSettlement,
  computeSuspicionScore,
  nextHealthyStreak,
  utcDay,
  vestingDate,
  type ProviderDay,
  type SettlementConfig,
  type SettlementRow,
} from '@/lib/settlement';

const CFG: SettlementConfig = {
  claudiumPerUsd: 100,
  standbyClaudiumPerUsdCapacity: 5,
  uptimeMultiplier: 1.25,
  uptimeStreakDays: 30,
  maxDailyShare: 0.2,
  // Cap disengaged for most scenarios; cap-specific tests lower this.
  minProvidersForCap: 5,
};

function day(overrides: Partial<ProviderDay> & { providerId: string }): ProviderDay {
  return {
    status: 'ACTIVE',
    dailyCapacityUsd: 10,
    consumedUsd: 0,
    healthyAllDay: true,
    consecutiveHealthyDays: 1,
    rewardMultiplier: 1,
    standbyEligible: true,
    ...overrides,
  };
}

describe('computeSettlement — base reward', () => {
  it('pays floor(consumedUsd * CLAUDIUM_PER_USD) on consumed compute only', () => {
    const [row] = computeSettlement(
      [day({ providerId: 'a', consumedUsd: 0.567, healthyAllDay: false })],
      CFG,
    );
    expect(row.baseClaudium).toBe(56); // floor(56.7)
    expect(row.standbyClaudium).toBe(0);
    expect(row.totalClaudium).toBe(56);
  });

  it('pays nothing for pledged-but-unconsumed capacity when unhealthy', () => {
    const rows = computeSettlement(
      [day({ providerId: 'a', consumedUsd: 0, healthyAllDay: false, dailyCapacityUsd: 500 })],
      CFG,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('computeSettlement — uptime multiplier', () => {
  it('applies 1.25x at a 30-day streak', () => {
    const [row] = computeSettlement(
      [day({ providerId: 'a', consumedUsd: 1, consecutiveHealthyDays: 30, healthyAllDay: false })],
      CFG,
    );
    expect(row.multiplier).toBe(1.25);
    expect(row.totalClaudium).toBe(125);
  });

  it('does not apply at 29 days', () => {
    const [row] = computeSettlement(
      [day({ providerId: 'a', consumedUsd: 1, consecutiveHealthyDays: 29, healthyAllDay: false })],
      CFG,
    );
    expect(row.multiplier).toBe(1);
    expect(row.totalClaudium).toBe(100);
  });

  it('floors after the multiplier', () => {
    // base = floor(0.55*100) = 55; 55*1.25 = 68.75 → 68
    const [row] = computeSettlement(
      [day({ providerId: 'a', consumedUsd: 0.55, consecutiveHealthyDays: 40, healthyAllDay: false })],
      CFG,
    );
    expect(row.totalClaudium).toBe(68);
  });
});

describe('computeSettlement — per-vendor economics', () => {
  it('applies the vendor reward multiplier to the base', () => {
    const [row] = computeSettlement(
      [day({ providerId: 'a', consumedUsd: 1, healthyAllDay: false, rewardMultiplier: 1.5 })],
      CFG,
    );
    expect(row.baseClaudium).toBe(150); // floor(1 × 100 × 1.5)
  });

  it('denies standby to standby-ineligible (BYOK) vendors even when healthy', () => {
    const rows = computeSettlement(
      [day({ providerId: 'byok', dailyCapacityUsd: 1000, consumedUsd: 0, standbyEligible: false })],
      CFG,
    );
    // Huge declared budget, healthy all day, zero consumption → zero reward.
    expect(rows).toHaveLength(0);
  });

  it('BYOK consumption still pays base while standby stays zero', () => {
    const [row] = computeSettlement(
      [day({ providerId: 'byok', dailyCapacityUsd: 100, consumedUsd: 2, standbyEligible: false })],
      CFG,
    );
    expect(row.baseClaudium).toBe(200);
    expect(row.standbyClaudium).toBe(0);
    expect(row.totalClaudium).toBe(200);
  });

  it('vestingDate: instant for 0 days, midnight-UTC offset otherwise', () => {
    const settled = utcDay(new Date('2026-07-20T12:00:00Z'));
    expect(vestingDate(settled, 0)).toBeNull();
    expect(vestingDate(settled, 7)?.toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });
});

describe('computeSettlement — standby rate', () => {
  it('pays the standby rate on unused capacity for healthy ACTIVE providers', () => {
    const [row] = computeSettlement(
      [day({ providerId: 'a', dailyCapacityUsd: 10, consumedUsd: 4 })],
      CFG,
    );
    expect(row.baseClaudium).toBe(400);
    expect(row.standbyClaudium).toBe(30); // floor(6 * 5)
    expect(row.totalClaudium).toBe(430);
  });

  it('withholds standby from DEGRADED or unhealthy providers', () => {
    const rows = computeSettlement(
      [
        day({ providerId: 'a', consumedUsd: 1, status: 'DEGRADED', healthyAllDay: false }),
        day({ providerId: 'b', consumedUsd: 1, healthyAllDay: false }),
      ],
      CFG,
    );
    expect(rows.every((r) => r.standbyClaudium === 0)).toBe(true);
  });
});

describe('computeSettlement — per-provider emission cap', () => {
  it('caps a dominant provider at MAX_DAILY_SHARE of total emission', () => {
    const rows = computeSettlement(
      [
        day({ providerId: 'whale', consumedUsd: 10, healthyAllDay: false }), // 1000 prelim
        day({ providerId: 'fish', consumedUsd: 1, healthyAllDay: false }), // 100 prelim
      ],
      { ...CFG, minProvidersForCap: 2 },
    );
    const whale = rows.find((r) => r.providerId === 'whale')!;
    const fish = rows.find((r) => r.providerId === 'fish')!;
    // total emission = 1100 → cap = floor(220)
    expect(whale.capped).toBe(true);
    expect(whale.totalClaudium).toBe(220);
    expect(fish.capped).toBe(false);
    expect(fish.totalClaudium).toBe(100);
  });

  it('skips the cap below MIN_PROVIDERS_FOR_CAP earners', () => {
    const rows = computeSettlement(
      [day({ providerId: 'solo', consumedUsd: 10, healthyAllDay: false })],
      { ...CFG, minProvidersForCap: 5 },
    );
    expect(rows[0].capped).toBe(false);
    expect(rows[0].totalClaudium).toBe(1000);
  });

  it('cap threshold is computed against the uncapped total (order-independent)', () => {
    const days = [
      day({ providerId: 'a', consumedUsd: 8, healthyAllDay: false }),
      day({ providerId: 'b', consumedUsd: 1, healthyAllDay: false }),
      day({ providerId: 'c', consumedUsd: 1, healthyAllDay: false }),
    ];
    const capCfg = { ...CFG, minProvidersForCap: 3 };
    const forward = computeSettlement(days, capCfg);
    const reversed = computeSettlement([...days].reverse(), capCfg);
    const total = (rows: SettlementRow[]) => rows.reduce((s, r) => s + r.totalClaudium, 0);
    expect(total(forward)).toBe(total(reversed));
    // cap = floor(1000 * 0.2) = 200 for provider a
    expect(forward.find((r) => r.providerId === 'a')!.totalClaudium).toBe(200);
  });
});

describe('settlement idempotency', () => {
  // Models the worker's persistence contract: upsert keyed on
  // (providerId, date) — the property that makes re-runs safe.
  class FakeLedger {
    rows = new Map<string, SettlementRow>();
    writes = 0;
    upsert(dateUtc: Date, row: SettlementRow): void {
      this.writes++;
      this.rows.set(`${row.providerId}:${dateUtc.toISOString()}`, row);
    }
  }
  const persist = (store: FakeLedger, dateUtc: Date, rows: SettlementRow[]) =>
    rows.forEach((row) => store.upsert(dateUtc, row));

  it('re-running a settlement never duplicates or changes ledger rows', async () => {
    const days = [
      day({ providerId: 'a', consumedUsd: 2 }),
      day({ providerId: 'b', consumedUsd: 3 }),
    ];
    const date = utcDay(new Date('2026-07-20T00:00:00Z'), 1);
    const store = new FakeLedger();

    const first = computeSettlement(days, CFG);
    persist(store, date, first);
    const snapshot = new Map(store.rows);

    // Same inputs → same rows; upsert keyed on (providerId, date) → same state.
    const second = computeSettlement(days, CFG);
    expect(second).toEqual(first);
    persist(store, date, second);

    expect(store.writes).toBe(4);
    expect(store.rows.size).toBe(2);
    expect(store.rows).toEqual(snapshot);
  });

  it('a different day writes distinct rows (no cross-day clobbering)', async () => {
    const rows = computeSettlement([day({ providerId: 'a', consumedUsd: 1 })], CFG);
    const store = new FakeLedger();
    persist(store, utcDay(new Date('2026-07-19T12:00:00Z')), rows);
    persist(store, utcDay(new Date('2026-07-20T12:00:00Z')), rows);
    expect(store.rows.size).toBe(2);
  });
});

describe('health streak + suspicion helpers', () => {
  it('nextHealthyStreak increments on healthy days and resets on unhealthy', () => {
    expect(nextHealthyStreak(0, true)).toBe(1);
    expect(nextHealthyStreak(29, true)).toBe(30);
    expect(nextHealthyStreak(29, false)).toBe(0);
  });

  it('suspicion score is the top game-account share of consumed USD', () => {
    const score = computeSuspicionScore(
      [
        { gameAccountId: 'acct-1', costUsd: 0.9 },
        { gameAccountId: 'acct-2', costUsd: 0.1 },
      ],
      0.5,
    );
    expect(score).toBe(0.9);
  });

  it('ignores tiny volumes and account-less usage', () => {
    expect(computeSuspicionScore([{ gameAccountId: 'a', costUsd: 0.1 }], 0.5)).toBe(0);
    expect(computeSuspicionScore([{ gameAccountId: null, costUsd: 5 }], 0.5)).toBe(0);
  });

  it('utcDay normalizes to midnight UTC and supports daysAgo', () => {
    const now = new Date('2026-07-20T15:30:00Z');
    expect(utcDay(now).toISOString()).toBe('2026-07-20T00:00:00.000Z');
    expect(utcDay(now, 1).toISOString()).toBe('2026-07-19T00:00:00.000Z');
  });
});
