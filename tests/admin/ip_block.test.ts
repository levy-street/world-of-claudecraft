import { describe, expect, it } from 'vitest';
import { knownAccountIps } from '../../src/admin/ip_block';
import type { ModerationAccountDetail } from '../../src/admin/types';

function detail(
  over: Partial<ModerationAccountDetail['account']>,
  blockedIps: string[],
): ModerationAccountDetail {
  return {
    account: {
      id: 1,
      username: 'u',
      createdAt: '',
      lastLogin: null,
      isAdmin: false,
      isAi: false,
      isStreamer: false,
      streamerLinks: {},
      online: false,
      bannedAt: null,
      suspendedUntil: null,
      moderationReason: '',
      chatMutedUntil: null,
      chatMuteReason: '',
      chatStrikes: 0,
      lastLoginIp: null,
      playtimeSeconds: 0,
      characters: [],
      recentSessions: [],
      moderationHistory: [],
      ...over,
    },
    reports: [],
    chat: { chatMutedUntil: null, chatStrikes: 0, violations: [] },
    blockedIps,
  };
}

const session = (ip: string) => ({
  id: 0,
  characterName: '',
  startedAt: '',
  endedAt: null,
  seconds: 0,
  ip,
});

describe('knownAccountIps', () => {
  it('lists newest first, marks the last-login IP, and dedupes', () => {
    const d = detail(
      { lastLoginIp: '1.1.1.1', recentSessions: [session('1.1.1.1'), session('2.2.2.2')] },
      [],
    );
    const ips = knownAccountIps(d);
    expect(ips.map((x) => x.ip)).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(ips[0].isLast).toBe(true);
    expect(ips[1].isLast).toBe(false);
  });

  it('caps the recent list but always includes blocked IPs past the cap', () => {
    const d = detail(
      { lastLoginIp: 'a', recentSessions: ['b', 'c', 'd', 'e', 'f', 'g'].map(session) },
      ['z'],
    );
    const ips = knownAccountIps(d);
    expect(ips.filter((x) => !x.blocked)).toHaveLength(5); // capped
    expect(ips.find((x) => x.ip === 'z')?.blocked).toBe(true); // blocked appended past cap
  });
});
