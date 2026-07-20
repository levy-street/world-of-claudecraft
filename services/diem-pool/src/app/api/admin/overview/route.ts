import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminToken } from '@/lib/auth';
import { isRoutingPaused } from '@/lib/config';
import { utcDay } from '@/lib/settlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;

  const today = utcDay(new Date());
  const [providers, todaySpends, todayHouse, lastRun, paused] = await Promise.all([
    prisma.provider.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.providerDailySpend.findMany({ where: { date: today } }),
    prisma.usageEvent.aggregate({
      where: { house: true, createdAt: { gte: today } },
      _sum: { costUsd: true },
    }),
    prisma.settlementRun.findFirst({ orderBy: { date: 'desc' } }),
    isRoutingPaused(),
  ]);
  const spendById = new Map(todaySpends.map((s) => [s.providerId, Number(s.spentUsd)]));

  return NextResponse.json({
    routingPaused: paused,
    lastSettledDate: lastRun?.completedAt ? lastRun.date : null,
    todayPoolSpendUsd: todaySpends.reduce((sum, s) => sum + Number(s.spentUsd), 0),
    todayHouseSpendUsd: Number(todayHouse._sum.costUsd ?? 0),
    statusCounts: providers.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {}),
    providers: providers.map((p) => ({
      id: p.id,
      wallet: p.wallet,
      vendor: p.vendor,
      trustTier: p.trustTier,
      displayName: p.displayName,
      status: p.status,
      keyLast4: p.keyLast4,
      dailyCapacityUsd: Number(p.dailyCapacityUsd),
      todayConsumedUsd: spendById.get(p.id) ?? 0,
      consecutiveHealthyDays: p.consecutiveHealthyDays,
      consecutiveFailures: p.consecutiveFailures,
      unhealthyToday: p.unhealthyToday,
      suspicionScore: Number(p.suspicionScore),
      flagged: Number(p.suspicionScore) >= 0.6,
      lastProbeAt: p.lastProbeAt,
    })),
  });
}
