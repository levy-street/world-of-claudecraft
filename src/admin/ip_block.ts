import { recentAccountIps } from './account_ips';
import type { ModerationAccountDetail } from './types';

// Add moderation-specific block state to the shared recent-IP history. Blocked
// addresses beyond the normal cap stay visible so the Unblock action remains reachable.

export interface KnownIp {
  ip: string;
  blocked: boolean;
  isLast: boolean;
}

export function knownAccountIps(d: ModerationAccountDetail): KnownIp[] {
  const blocked = new Set(d.blockedIps);
  const recent = recentAccountIps(d.account);
  const entries: KnownIp[] = recent.map((entry) => ({
    ip: entry.ip,
    blocked: blocked.has(entry.ip),
    isLast: entry.isLastLogin,
  }));
  const seen = new Set(entries.map((entry) => entry.ip));
  for (const ip of d.blockedIps) {
    if (!seen.has(ip)) {
      seen.add(ip);
      entries.push({ ip, blocked: true, isLast: false });
    }
  }
  return entries;
}
