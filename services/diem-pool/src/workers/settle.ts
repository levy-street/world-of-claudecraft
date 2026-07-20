import { createHmac } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import {
  computeSettlement,
  computeSuspicionScore,
  nextHealthyStreak,
  utcDay,
  type ProviderDay,
} from '@/lib/settlement';
import { getSettlementEventsQueue, type SettlementEvent } from './queues';

// Daily settlement job (midnight UTC): settles the UTC day that just ended.
//
// Idempotency model:
//  - Ledger rows upsert on (providerId, date) — always safe to re-run.
//  - Streak bumps / suspicion scores / unhealthyToday resets are NOT naturally
//    idempotent, so they commit in one transaction together with the ledger
//    rows and the SettlementRun.streaksApplied flag.
//  - Event emission is at-least-once (re-run after a crash re-emits); the
//    queue payload carries (providerId, date) for consumer-side dedupe.

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
      const consumed = (eventsByProvider.get(p.id) ?? []).reduce((sum, e) => sum + e.costUsd, 0);
      const healthyAllDay = p.status === 'ACTIVE' && !p.unhealthyToday;
      return {
        providerId: p.id,
        status: p.status,
        dailyCapacityUsd: Number(p.dailyCapacityUsd),
        consumedUsd: round8(consumed),
        healthyAllDay,
        consecutiveHealthyDays: nextHealthyStreak(p.consecutiveHealthyDays, healthyAllDay),
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

    await prisma.$transaction([
      ...providers.map((p) =>
        prisma.provider.update({
          where: { id: p.id },
          data: {
            consecutiveHealthyDays: dayByProvider.get(p.id)!.consecutiveHealthyDays,
            unhealthyToday: false,
            suspicionScore: computeSuspicionScore(
              eventsByProvider.get(p.id) ?? [],
              env.SUSPICION_MIN_USD,
            ),
          },
        }),
      ),
      ...rows.map((r) =>
        prisma.rewardLedger.upsert({
          where: { providerId_date: { providerId: r.providerId, date } },
          create: {
            providerId: r.providerId,
            date,
            consumedUsd: r.consumedUsd,
            baseClaudium: r.baseClaudium,
            multiplier: r.multiplier,
            standbyClaudium: r.standbyClaudium,
            capped: r.capped,
            totalClaudium: r.totalClaudium,
          },
          update: {
            consumedUsd: r.consumedUsd,
            baseClaudium: r.baseClaudium,
            multiplier: r.multiplier,
            standbyClaudium: r.standbyClaudium,
            capped: r.capped,
            totalClaudium: r.totalClaudium,
          },
        }),
      ),
      prisma.settlementRun.update({ where: { date }, data: { streaksApplied: true } }),
    ]);
    console.log(`[settle] ${isoDate(date)} ledger written: ${rows.length} providers`);
  }

  // Emit events from the ledger (source of truth), then mark the run complete.
  const ledger = await prisma.rewardLedger.findMany({
    where: { date },
    include: { provider: { select: { wallet: true } } },
  });
  for (const row of ledger) {
    const event: SettlementEvent = {
      providerId: row.providerId,
      wallet: row.provider.wallet,
      date: isoDate(date),
      consumedUsd: Number(row.consumedUsd),
      baseClaudium: row.baseClaudium,
      multiplier: Number(row.multiplier),
      standbyClaudium: row.standbyClaudium,
      capped: row.capped,
      totalClaudium: row.totalClaudium,
    };
    await getSettlementEventsQueue().add('settlement', event, {
      // Queue-level dedupe for the common re-run case.
      jobId: `settlement:${row.providerId}:${isoDate(date)}`,
      removeOnComplete: { age: 7 * 24 * 3600 },
    });
    await postWebhook(event);
  }

  await prisma.settlementRun.update({ where: { date }, data: { completedAt: new Date() } });
  console.log(`[settle] ${isoDate(date)} complete: ${ledger.length} settlement events emitted`);
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
