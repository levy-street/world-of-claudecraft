import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { utcDay } from '@/lib/settlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Provider dashboard stats: every key the wallet has attached (one per
 * vendor) plus wallet-level totals. Read-only, no key material - everything
 * here is as public as the leaderboard, so no signature required to view.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const providers = await prisma.provider.findMany({
    where: { wallet },
    orderBy: { createdAt: 'asc' },
  });
  if (providers.length === 0) return NextResponse.json({ error: 'not registered' }, { status: 404 });

  const ids = providers.map((p) => p.id);
  const today = utcDay(new Date());
  const [todaySpends, lifetime, rewards] = await Promise.all([
    prisma.providerDailySpend.findMany({ where: { date: today, providerId: { in: ids } } }),
    prisma.usageEvent.groupBy({
      by: ['providerId'],
      where: { providerId: { in: ids } },
      _sum: { costUsd: true },
      _count: true,
    }),
    prisma.rewardLedger.groupBy({
      by: ['providerId', 'status'],
      where: { providerId: { in: ids } },
      _sum: { totalClaudium: true },
    }),
  ]);

  const spendById = new Map(todaySpends.map((s) => [s.providerId, Number(s.spentUsd)]));
  const lifetimeById = new Map(lifetime.map((l) => [l.providerId, l]));
  const claudium = (providerId: string, status: 'VESTED' | 'PENDING' | 'VOIDED') =>
    rewards
      .filter((r) => r.providerId === providerId && r.status === status)
      .reduce((sum, r) => sum + (r._sum.totalClaudium ?? 0), 0);

  const keys = providers.map((p) => ({
    id: p.id,
    vendor: p.vendor,
    displayName: p.displayName,
    status: p.status,
    keyLast4: p.keyLast4,
    dailyCapacityUsd: Number(p.dailyCapacityUsd),
    trustTier: p.trustTier,
    consecutiveHealthyDays: p.consecutiveHealthyDays,
    todayConsumedUsd: spendById.get(p.id) ?? 0,
    lifetimeConsumedUsd: Number(lifetimeById.get(p.id)?._sum.costUsd ?? 0),
    lifetimeRequests: lifetimeById.get(p.id)?._count ?? 0,
    claudiumVested: claudium(p.id, 'VESTED'),
    claudiumPending: claudium(p.id, 'PENDING'),
    lastProbeAt: p.lastProbeAt,
  }));

  return NextResponse.json({
    wallet,
    keys,
    totals: {
      lifetimeConsumedUsd: keys.reduce((sum, k) => sum + k.lifetimeConsumedUsd, 0),
      claudiumVested: keys.reduce((sum, k) => sum + k.claudiumVested, 0),
      claudiumPending: keys.reduce((sum, k) => sum + k.claudiumPending, 0),
    },
  });
}
