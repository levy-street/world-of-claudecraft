import { describe, expect, it } from 'vitest';
import { recentAccountIps } from '../../src/admin/account_ips';

const session = (ip: string | null, startedAt: string) => ({
  id: 1,
  characterName: 'Merlin',
  startedAt,
  endedAt: null,
  seconds: 0,
  ip,
});

describe('recentAccountIps', () => {
  it('deduplicates addresses, keeps their newest date, and sorts newest first', () => {
    const ips = recentAccountIps({
      lastLoginIp: '203.0.113.7',
      lastLogin: '2026-06-28T10:00:00Z',
      recentSessions: [
        session('198.51.100.4', '2026-06-28T11:00:00Z'),
        session('203.0.113.7', '2026-06-27T09:00:00Z'),
        session('198.51.100.4', '2026-06-26T08:00:00Z'),
        session(null, '2026-06-28T12:00:00Z'),
      ],
    });

    expect(ips).toEqual([
      {
        ip: '198.51.100.4',
        lastSeenAt: '2026-06-28T11:00:00Z',
        isLastLogin: false,
      },
      {
        ip: '203.0.113.7',
        lastSeenAt: '2026-06-28T10:00:00Z',
        isLastLogin: true,
      },
    ]);
  });

  it('caps the result after sorting', () => {
    const ips = recentAccountIps(
      {
        lastLoginIp: null,
        lastLogin: null,
        recentSessions: [
          session('a', '2026-06-01T00:00:00Z'),
          session('b', '2026-06-02T00:00:00Z'),
          session('c', '2026-06-03T00:00:00Z'),
        ],
      },
      2,
    );

    expect(ips.map((entry) => entry.ip)).toEqual(['c', 'b']);
  });
});
