export interface LiveIpSession {
  accountId: number;
  ip: string;
  joinedAt: number;
}

export interface LiveSharedIp {
  ip: string;
  accountCount: number;
  lastSeenAt: string;
}

// Builds the online-only Shared IPs view from authoritative in-memory sessions.
// Multiple characters from the same account count once for a given address.
export function sharedIpsFromLiveSessions(sessions: Iterable<LiveIpSession>): LiveSharedIp[] {
  const byIp = new Map<string, { accountIds: Set<number>; latestJoin: number }>();
  for (const session of sessions) {
    if (!session.ip) continue;
    const current = byIp.get(session.ip);
    if (current) {
      current.accountIds.add(session.accountId);
      current.latestJoin = Math.max(current.latestJoin, session.joinedAt);
    } else {
      byIp.set(session.ip, {
        accountIds: new Set([session.accountId]),
        latestJoin: session.joinedAt,
      });
    }
  }

  const rows: LiveSharedIp[] = [];
  for (const [ip, value] of byIp) {
    if (value.accountIds.size <= 1) continue;
    rows.push({
      ip,
      accountCount: value.accountIds.size,
      lastSeenAt: new Date(value.latestJoin).toISOString(),
    });
  }
  return rows.sort(
    (a, b) =>
      b.accountCount - a.accountCount ||
      b.lastSeenAt.localeCompare(a.lastSeenAt) ||
      a.ip.localeCompare(b.ip),
  );
}
