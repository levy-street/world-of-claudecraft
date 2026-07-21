import type { AccountDetail } from './types';

export interface RecentAccountIp {
  ip: string;
  lastSeenAt: string | null;
  isLastLogin: boolean;
}

type AccountIpHistory = Pick<AccountDetail, 'lastLogin' | 'lastLoginIp' | 'recentSessions'>;

const DEFAULT_RECENT_IP_LIMIT = 5;

function validTimestamp(value: string | null): number {
  if (value === null) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function recentAccountIps(
  account: AccountIpHistory,
  limit = DEFAULT_RECENT_IP_LIMIT,
): RecentAccountIp[] {
  const byIp = new Map<string, RecentAccountIp>();

  const add = (ip: string | null, lastSeenAt: string | null, isLastLogin: boolean) => {
    if (!ip) return;
    const normalizedLastSeenAt = validTimestamp(lastSeenAt) > 0 ? lastSeenAt : null;
    const existing = byIp.get(ip);
    if (!existing) {
      byIp.set(ip, { ip, lastSeenAt: normalizedLastSeenAt, isLastLogin });
      return;
    }
    existing.isLastLogin ||= isLastLogin;
    if (validTimestamp(normalizedLastSeenAt) > validTimestamp(existing.lastSeenAt)) {
      existing.lastSeenAt = normalizedLastSeenAt;
    }
  };

  add(account.lastLoginIp, account.lastLogin, true);
  for (const session of account.recentSessions) {
    add(session.ip, session.startedAt, false);
  }

  return [...byIp.values()]
    .sort((a, b) => validTimestamp(b.lastSeenAt) - validTimestamp(a.lastSeenAt))
    .slice(0, Math.max(0, Math.floor(limit)));
}
