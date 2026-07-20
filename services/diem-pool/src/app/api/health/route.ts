import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { isRoutingPaused } from '@/lib/config';
import { utcDay } from '@/lib/settlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Settlement runs at 00:00 UTC for the previous day; if the newest completed
// run is older than yesterday, the worker is stuck and ops should know.
function settlementStale(lastCompleted: Date | null, now: Date): boolean {
  if (!lastCompleted) return false; // fresh install — nothing to have settled
  return lastCompleted.getTime() < utcDay(now, 1).getTime();
}

/**
 * Unauthenticated liveness/readiness probe for load balancers and alerting.
 * Exposes component status and coarse counts only — no provider data.
 * 200 = fully healthy; 503 = at least one component down or stale.
 */
export async function GET() {
  const now = new Date();

  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Math.round((performance.now() - t0) * 100) / 100;
    dbOk = true;
  } catch (err) {
    console.error('[health] db check failed:', (err as Error).message);
  }

  let redisOk = false;
  try {
    // One quick retry: the fail-fast client rejects instantly while its
    // initial connection is still being established.
    await getRedis()
      .ping()
      .catch(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return getRedis().ping();
      });
    redisOk = true;
  } catch (err) {
    console.error('[health] redis check failed:', (err as Error).message);
  }

  let lastSettledDate: string | null = null;
  let settlementOk = true;
  let routingPaused = false;
  let providerCounts: Record<string, number> = {};
  if (dbOk) {
    const [lastRun, paused, statuses] = await Promise.all([
      prisma.settlementRun.findFirst({
        where: { completedAt: { not: null } },
        orderBy: { date: 'desc' },
      }),
      isRoutingPaused(),
      prisma.provider.groupBy({ by: ['status'], _count: true }),
    ]);
    lastSettledDate = lastRun ? lastRun.date.toISOString().slice(0, 10) : null;
    settlementOk = !settlementStale(lastRun?.date ?? null, now);
    routingPaused = paused;
    providerCounts = Object.fromEntries(statuses.map((s) => [s.status, s._count]));
  }

  const healthy = dbOk && redisOk && settlementOk;
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      redis: { ok: redisOk },
      settlement: { ok: settlementOk, lastSettledDate },
      routingPaused,
      providerCounts,
      time: now.toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
