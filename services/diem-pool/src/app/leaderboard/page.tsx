import { prisma } from '@/lib/db';
import { truncateWallet } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Public leaderboard: lifetime $ of compute served to the realm. */
export default async function LeaderboardPage() {
  const usage = await prisma.usageEvent.groupBy({
    by: ['providerId'],
    where: { house: false, providerId: { not: null } },
    _sum: { costUsd: true },
    orderBy: { _sum: { costUsd: 'desc' } },
    take: 50,
  });
  const providers = await prisma.provider.findMany({
    where: { id: { in: usage.map((u) => u.providerId!) } },
    select: { id: true, displayName: true, wallet: true, vendor: true, consecutiveHealthyDays: true },
  });
  const byId = new Map(providers.map((p) => [p.id, p]));

  return (
    <>
      <h1>Compute Champions of the Realm</h1>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Provider</th>
              <th>Vendor</th>
              <th>Wallet</th>
              <th>Lifetime $ served</th>
              <th>Health streak</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u, i) => {
              const p = byId.get(u.providerId!);
              if (!p) return null;
              return (
                <tr key={u.providerId}>
                  <td>{i + 1}</td>
                  <td>{p.displayName}</td>
                  <td>{p.vendor}</td>
                  <td>
                    <code>{truncateWallet(p.wallet)}</code>
                  </td>
                  <td>${Number(u._sum.costUsd ?? 0).toFixed(2)}</td>
                  <td>{p.consecutiveHealthyDays}d</td>
                </tr>
              );
            })}
            {usage.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No compute served yet - be the first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
