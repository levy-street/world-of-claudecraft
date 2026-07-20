import { createHmac } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import {
  computeSettlement,
  computeSuspicionScore,
  nextHealthyStreak,
  utcDay,
  vestingDate,
  type ProviderDay,
} from '@/lib/settlement';
import { tierFromStreak, type VendorName } from '@/lib/vendors/config';
import { getVendorPolicies } from '@/lib/vendors/policies';
import { getSettlementEventsQueue, type SettlementEvent } from './queues';

// Daily settlement job (midnight UTC): settles the UTC day that just ended,
// then vests any pending rewards whose fraud window has elapsed.
//
// Idempotency model:
//  - Ledger rows upsert on (providerId, date) — always safe to re-run. The
//    upsert's update branch never touches status/vestAt, so a re-run can
//    never resurrect a VOIDED row or un-vest a VESTED one.
//  - Streak bumps / tier promotion / suspicion scores / unhealthyToday resets
//    are NOT naturally idempotent, so they commit in one transaction together
//    with the ledger rows and the SettlementRun.streaksApplied flag.
//  - Event emission is at-least-once (re-run after a crash re-emits); the
//    queue payload carries (providerId, date) and the queue jobId dedupes;
//    webhook consumers must dedupe on the same key.

export async function runDailySettlement(now: Date = new Date()): Promise<void> {
  const env = getEnv();
  const date = utcDay(now, 1);
  const nextDate = utcDay(now, 0);

  const run = await prisma.settlementRun.upsert({
    where: { date },
    create: { date },
    update: {},
  });
  if (run.completedAt) {
    console.log(`[settle] ${isoDate(date)} already settled, skipping`);
    return;
  }

  const policies = await getVendorPolicies();

  if (!run.streaksApplied) {
    const providers = await prisma.provider.findMany();
    const events = await prisma.usageEvent.findMany({
      where: { createdAt: { gte: date, lt: nextDate }, providerId: { not: null } },
      select: { providerId: true, gameAccountId: true, costUsd: true },
    });

    const eventsByProvider = new Map<string, Array<{ gameAccountId: string | null; costUsd: number }>>();
    for (const e of events) {
      const list = eventsByProvider.get(e.providerId!) ?? [];
      list.push({ gameAccountId: e.gameAccountId, costUsd: Number(e.costUsd) });
      eventsByProvider.set(e.providerId!, list);
    }

    const days: ProviderDay[] = providers.map((p) => {
      const policy = policies[p.vendor as VendorName];
      const consumed = (eventsByProvider.get(p.id) ?? []).reduce((sum, e) => sum + e.costUsd, 0);
      const healthyAllDay = p.status === 'ACTIVE' && !p.unhealthyToday;
      return {
        providerId: p.id,
        status: p.status,
        dailyCapacityUsd: Number(p.dailyCapacityUsd),
        consumedUsd: round8(consumed),
        healthyAllDay,
        consecutiveHealthyDays: nextHealthyStreak(p.consecutiveHealthyDays, healthyAllDay),
        rewardMultiplier: policy.rewardMultiplier,
        standbyEligible: policy.standbyEligible,
      };
    });

    const rows = computeSettlement(days, {
      claudiumPerUsd: env.CLAUDIUM_PER_USD,
      standbyClaudiumPerUsdCapacity: env.STANDBY_CLAUDIUM_PER_USD_CAPACITY,
      uptimeMultiplier: env.UPTIME_MULTIPLIER,
      uptimeStreakDays: env.UPTIME_STREAK_DAYS,
      maxDailyShare: env.MAX_DAILY_SHARE,
      minProvidersForCap: env.MIN_PROVIDERS_FOR_CAP,
    });
    const dayByProvider = new Map(days.map((d) => [d.providerId, d]));
    const providerById = new Map(providers.map((p) => [p.id, p]));

    await prisma.$transaction([
      ...providers.map((p) => {
        const day = dayByProvider.get(p.id)!;
        return prisma.provider.update({
          where: { id: p.id },
          data: {
            consecutiveHealthyDays: day.consecutiveHealthyDays,
            trustTier: tierFromStreak(day.consecutiveHealthyDays),
            unhealthyToday: false,
            suspicionScore: computeSuspicionScore(
              eventsByProvider.get(p.id) ?? [],
              env.SUSPICION_MIN_USD,
            ),
          },
        });
      }),
      ...rows.map((r) => {
        const vendor = providerById.get(r.providerId)!.vendor as VendorName;
        const vestAt = vestingDate(date, policies[vendor].vestingDays);
        const amounts = {
          consumedUsd: r.consumedUsd,
          baseClaudium: r.baseClaudium,
          multiplier: r.multiplier,
          standbyClaudium: r.standbyClaudium,
          capped: r.capped,
          totalClaudium: r.totalClaudium,
        };
        return prisma.rewardLedger.upsert({
          where: { providerId_date: { providerId: r.providerId, date } },
          create: {
            providerId: r.providerId,
            date,
            ...amounts,
            status: vestAt ? 'PENDING' : 'VESTED',
            vestAt,
          },
          // Never touch status/vestAt on re-run — a VOIDED or VESTED row
          // must not be reopened by settling the same day twice.
          update: amounts,
        });
      }),
      prisma.settlementRun.update({ where: { date }, data: { streaksApplied: true } }),
    ]);
    const pendingCount = rows.filter((r) => {
      const vendor = providerById.get(r.providerId)!.vendor as VendorName;
      return policies[vendor].vestingDays > 0;
    }).length;
    console.log(
      `[settle] ${isoDate(date)} ledger written: ${rows.length} providers (${pendingCount} pending vest)`,
    );
  }

  // Emit events for instantly-vested rows, then mark the run complete.
  // PENDING rows are emitted later by runVesting when their window elapses.
  const ledger = await prisma.rewardLedger.findMany({
    where: { date, status: 'VESTED' },
    include: { provider: { select: { wallet: true, vendor: true } } },
  });
  for (const row of ledger) {
    await emitSettlement(toEvent(row));
  }

  await prisma.settlementRun.update({ where: { date }, data: { completedAt: new Date() } });
  console.log(`[settle] ${isoDate(date)} complete: ${ledger.length} settlement events emitted`);
}

/**
 * Vest matured PENDING rewards: emit the credit event (queue jobId dedupes),
 * then flip PENDING→VESTED. Runs right after settlement each midnight; a
 * crash between emit and flip re-emits next run — at-least-once, consumers
 * dedupe on (providerId, date).
 */
export async function runVesting(now: Date = new Date()): Promise<void> {
  const due = await prisma.rewardLedger.findMany({
    where: { status: 'PENDING', vestAt: { lte: now } },
    include: { provider: { select: { wallet: true, vendor: true } } },
  });
  for (const row of due) {
    await emitSettlement(toEvent(row));
    await prisma.rewardLedger.updateMany({
      // Guarded transition: only PENDING→VESTED, never from VOIDED.
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'VESTED' },
    });
  }
  if (due.length) console.log(`[vest] vested ${due.length} matured reward rows`);
}

type LedgerRowWithProvider = {
  providerId: string;
  date: Date;
  consumedUsd: unknown;
  baseClaudium: number;
  multiplier: unknown;
  standbyClaudium: number;
  capped: boolean;
  totalClaudium: number;
  provider: { wallet: string; vendor: VendorName };
};

function toEvent(row: LedgerRowWithProvider): SettlementEvent {
  return {
    providerId: row.providerId,
    wallet: row.provider.wallet,
    vendor: row.provider.vendor,
    date: isoDate(row.date),
    consumedUsd: Number(row.consumedUsd),
    baseClaudium: row.baseClaudium,
    multiplier: Number(row.multiplier),
    standbyClaudium: row.standbyClaudium,
    capped: row.capped,
    totalClaudium: row.totalClaudium,
  };
}

async function emitSettlement(event: SettlementEvent): Promise<void> {
  await getSettlementEventsQueue().add('settlement', event, {
    // Queue-level dedupe across settlement re-runs and vesting retries.
    jobId: `settlement:${event.providerId}:${event.date}`,
    removeOnComplete: { age: 7 * 24 * 3600 },
  });
  await postWebhook(event);
}

async function postWebhook(event: SettlementEvent): Promise<void> {
  const env = getEnv();
  if (!env.GAME_WEBHOOK_URL) return;
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', env.GAME_WEBHOOK_SECRET).update(body).digest('hex');
  try {
    const res = await fetch(env.GAME_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wocc-signature': signature },
      body,
    });
    if (!res.ok) console.error(`[settle] webhook ${res.status} for provider ${event.providerId}`);
  } catch (err) {
    // Webhook is best-effort; the queue message is the reliable channel.
    console.error(`[settle] webhook failed for provider ${event.providerId}:`, err);
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
