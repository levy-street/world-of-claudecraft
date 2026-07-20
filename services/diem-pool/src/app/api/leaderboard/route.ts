import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { truncateWallet } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public leaderboard: providers ranked by lifetime USD of compute served. */
export async function GET() {
  const usage = await prisma.usageEvent.groupBy({
    by: ['providerId'],
    where: { house: false, providerId: { not: null } },
    _sum: { costUsd: true },
    orderBy: { _sum: { costUsd: 'desc' } },
    take: 50,
  });

  const providers = await prisma.provider.findMany({
    where: { id: { in: usage.map((u) => u.providerId!) } },
    select: {
      id: true,
      displayName: true,
      wallet: true,
      vendor: true,
      status: true,
      consecutiveHealthyDays: true,
    },
  });
  const byId = new Map(providers.map((p) => [p.id, p]));

  return NextResponse.json({
    leaderboard: usage.flatMap((u, i) => {
      const p = byId.get(u.providerId!);
      if (!p) return [];
      return [
        {
          rank: i + 1,
          displayName: p.displayName,
          wallet: truncateWallet(p.wallet),
          vendor: p.vendor,
          lifetimeUsdServed: Number(u._sum.costUsd ?? 0),
          status: p.status,
          healthStreakDays: p.consecutiveHealthyDays,
        },
      ];
    }),
  });
}
