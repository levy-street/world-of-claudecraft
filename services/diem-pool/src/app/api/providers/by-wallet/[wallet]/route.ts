import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { utcDay } from '@/lib/settlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Provider dashboard stats. Read-only, no key material — everything here is
 * as public as the leaderboard, so no signature required to view.
 */
export async function GET(_req: NextRequest, { params }: { params: { wallet: string } }) {
  const provider = await prisma.provider.findUnique({ where: { wallet: params.wallet } });
  if (!provider) return NextResponse.json({ error: 'not registered' }, { status: 404 });

  const today = utcDay(new Date());
  const [todaySpend, lifetime, rewards] = await Promise.all([
    prisma.providerDailySpend.findUnique({
      where: { providerId_date: { providerId: provider.id, date: today } },
    }),
    prisma.usageEvent.aggregate({
      where: { providerId: provider.id },
      _sum: { costUsd: true },
      _count: true,
    }),
    prisma.rewardLedger.aggregate({
      where: { providerId: provider.id },
      _sum: { totalClaudium: true },
    }),
  ]);

  return NextResponse.json({
    id: provider.id,
    wallet: provider.wallet,
    displayName: provider.displayName,
    status: provider.status,
    keyLast4: provider.keyLast4,
    dailyCapacityUsd: Number(provider.dailyCapacityUsd),
    todayConsumedUsd: Number(todaySpend?.spentUsd ?? 0),
    lifetimeConsumedUsd: Number(lifetime._sum.costUsd ?? 0),
    lifetimeRequests: lifetime._count,
    claudiumEarned: rewards._sum.totalClaudium ?? 0,
    consecutiveHealthyDays: provider.consecutiveHealthyDays,
    lastProbeAt: provider.lastProbeAt,
  });
}
