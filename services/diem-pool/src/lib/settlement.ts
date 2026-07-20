// Daily settlement math. Pure functions — the BullMQ worker supplies data and
// persists results, so every rule here is unit-testable without a database.
//
// Reward pipeline per provider for a settled UTC day:
//   base      = floor(consumedUsd * claudiumPerUsd * rewardMultiplier)
//               — consumed compute only; rewardMultiplier is the per-vendor knob
//   afterMult = floor(base * multiplier)                     — 1.25x at a 30-day healthy streak
//   standby   = floor(unusedCapacityUsd * standbyRate)       — only if ACTIVE + healthy all
//               day AND the vendor is standby-eligible (stake-backed Venice
//               capacity only — a free-to-declare BYOK budget earns no standby)
//   prelim    = afterMult + standby
// Then the anti-whale cap: when at least `minProvidersForCap` providers earned
// something, nobody keeps more than `maxDailyShare` of the day's total
// preliminary emission (the cap threshold is computed against the *uncapped*
// total, one pass, so the rule is order-independent and deterministic).

export interface SettlementConfig {
  claudiumPerUsd: number;
  standbyClaudiumPerUsdCapacity: number;
  uptimeMultiplier: number;
  uptimeStreakDays: number;
  maxDailyShare: number;
  minProvidersForCap: number;
}

export interface ProviderDay {
  providerId: string;
  status: 'ACTIVE' | 'DEGRADED' | 'REVOKED' | 'INVALID';
  dailyCapacityUsd: number;
  consumedUsd: number;
  /** ACTIVE with no health incidents during the settled day. */
  healthyAllDay: boolean;
  /** Streak including the settled day (caller updates streaks first). */
  consecutiveHealthyDays: number;
  /** Per-vendor reward knob applied to the base (VendorConfig). */
  rewardMultiplier: number;
  /** Whether this provider's vendor earns standby on unused capacity. */
  standbyEligible: boolean;
}

export interface SettlementRow {
  providerId: string;
  consumedUsd: number;
  baseClaudium: number;
  multiplier: number;
  standbyClaudium: number;
  capped: boolean;
  totalClaudium: number;
}

export function computeSettlement(days: ProviderDay[], cfg: SettlementConfig): SettlementRow[] {
  const prelim = days.map((d) => {
    const base = Math.floor(d.consumedUsd * cfg.claudiumPerUsd * d.rewardMultiplier);
    const multiplier =
      d.consecutiveHealthyDays >= cfg.uptimeStreakDays ? cfg.uptimeMultiplier : 1;
    const afterMult = Math.floor(base * multiplier);
    const unusedUsd = Math.max(0, d.dailyCapacityUsd - d.consumedUsd);
    const standby =
      d.healthyAllDay && d.status === 'ACTIVE' && d.standbyEligible
        ? Math.floor(unusedUsd * cfg.standbyClaudiumPerUsdCapacity)
        : 0;
    return { day: d, base, multiplier, standby, preliminary: afterMult + standby };
  });

  const earners = prelim.filter((p) => p.preliminary > 0);
  const totalEmission = earners.reduce((sum, p) => sum + p.preliminary, 0);
  const capApplies = earners.length >= cfg.minProvidersForCap;
  const capLimit = capApplies ? Math.floor(totalEmission * cfg.maxDailyShare) : Infinity;

  return prelim
    .filter((p) => p.preliminary > 0 || p.day.consumedUsd > 0)
    .map((p) => ({
      providerId: p.day.providerId,
      consumedUsd: p.day.consumedUsd,
      baseClaudium: p.base,
      multiplier: p.multiplier,
      standbyClaudium: p.standby,
      capped: p.preliminary > capLimit,
      totalClaudium: Math.min(p.preliminary, capLimit),
    }));
}

/** Health-streak transition applied once per settled day. */
export function nextHealthyStreak(previous: number, healthyAllDay: boolean): number {
  return healthyAllDay ? previous + 1 : 0;
}

/**
 * Self-dealing heuristic: the share of a provider's consumed USD attributable
 * to its single busiest game account. 0 when volume is below `minUsd` (tiny
 * samples say nothing) or when no events carry an account id.
 */
export function computeSuspicionScore(
  events: Array<{ gameAccountId: string | null; costUsd: number }>,
  minUsd: number,
): number {
  let total = 0;
  const byAccount = new Map<string, number>();
  for (const e of events) {
    total += e.costUsd;
    if (e.gameAccountId) {
      byAccount.set(e.gameAccountId, (byAccount.get(e.gameAccountId) ?? 0) + e.costUsd);
    }
  }
  if (total < minUsd || byAccount.size === 0) return 0;
  const top = Math.max(...byAccount.values());
  return Math.round((top / total) * 10000) / 10000;
}

/** Midnight-UTC Date for the calendar day `daysAgo` days before `now`. */
export function utcDay(now: Date, daysAgo = 0): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo),
  );
}

/**
 * When a settled reward becomes spendable. null = vests immediately
 * (stake-backed vendors); otherwise midnight UTC `vestingDays` after the
 * settled day — the BYOK fraud window.
 */
export function vestingDate(settledDayUtc: Date, vestingDays: number): Date | null {
  if (vestingDays <= 0) return null;
  return new Date(settledDayUtc.getTime() + vestingDays * 86_400_000);
}
