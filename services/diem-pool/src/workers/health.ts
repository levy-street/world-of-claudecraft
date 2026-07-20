import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { decryptSecret } from '@/lib/crypto';
import { invalidatePoolCache, voidPendingRewards } from '@/lib/inference';
import { getAdapter } from '@/lib/vendors';
import type { VendorName } from '@/lib/vendors/config';

// 30-minute health probe via each provider's vendor adapter (GET /models
// equivalent — auth-exercising, zero tokens).
//   401/403            → INVALID (key revoked upstream) + pending rewards voided
//   429 / errors ×2    → DEGRADED (skipped by routing until it probes healthy)
//   healthy            → ACTIVE (recovers DEGRADED), failure counter reset

const PROBE_CONCURRENCY = 5;

export async function runHealthProbes(now: Date = new Date()): Promise<void> {
  const env = getEnv();
  const providers = await prisma.provider.findMany({
    where: { status: { in: ['ACTIVE', 'DEGRADED'] }, encryptedKey: { not: null } },
  });

  for (let i = 0; i < providers.length; i += PROBE_CONCURRENCY) {
    await Promise.all(
      providers.slice(i, i + PROBE_CONCURRENCY).map(async (p) => {
        const key = decryptSecret(p.encryptedKey!, env.KEY_ENCRYPTION_KEY);
        const result = await getAdapter(p.vendor as VendorName).probe(key);

        switch (result) {
          case 'healthy':
            await prisma.provider.update({
              where: { id: p.id },
              data: { status: 'ACTIVE', consecutiveFailures: 0, lastProbeAt: now, lastHealthyAt: now },
            });
            break;
          case 'auth_failed':
            await prisma.provider.update({
              where: { id: p.id },
              data: { status: 'INVALID', unhealthyToday: true, lastProbeAt: now },
            });
            await voidPendingRewards(p.id, 'health probe: key revoked upstream');
            break;
          default: {
            // rate_limited / error — degrade only on repeat, matching routing.
            const updated = await prisma.provider.update({
              where: { id: p.id },
              data: { consecutiveFailures: { increment: 1 }, lastProbeAt: now },
            });
            if (updated.consecutiveFailures >= 2 && updated.status === 'ACTIVE') {
              await prisma.provider.update({
                where: { id: p.id },
                data: { status: 'DEGRADED', unhealthyToday: true },
              });
            }
          }
        }
      }),
    );
  }

  invalidatePoolCache();

  // Housekeeping: nonces are single-use with a 10-minute TTL; anything used
  // or expired for over a day is only table bloat. A day of history stays
  // queryable for abuse forensics.
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const pruned = await prisma.providerNonce.deleteMany({
    where: { OR: [{ usedAt: { lt: dayAgo } }, { expiresAt: { lt: dayAgo } }] },
  });

  console.log(
    `[health] probed ${providers.length} providers` +
      (pruned.count ? `, pruned ${pruned.count} stale nonces` : ''),
  );
}
