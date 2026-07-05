import { describe, expect, it } from 'vitest';
import { sharedIpsFromLiveSessions } from '../server/live_shared_ips';

describe('sharedIpsFromLiveSessions', () => {
  it('counts distinct online accounts and ignores single-account addresses', () => {
    const rows = sharedIpsFromLiveSessions([
      { accountId: 1, ip: '203.0.113.7', joinedAt: 1000 },
      { accountId: 1, ip: '203.0.113.7', joinedAt: 2000 },
      { accountId: 2, ip: '203.0.113.7', joinedAt: 3000 },
      { accountId: 3, ip: '198.51.100.4', joinedAt: 4000 },
      { accountId: 4, ip: '', joinedAt: 5000 },
    ]);

    expect(rows).toEqual([
      {
        ip: '203.0.113.7',
        accountCount: 2,
        lastSeenAt: new Date(3000).toISOString(),
      },
    ]);
  });

  it('sorts by account count, latest join, then address', () => {
    const rows = sharedIpsFromLiveSessions([
      { accountId: 1, ip: '203.0.113.8', joinedAt: 1000 },
      { accountId: 2, ip: '203.0.113.8', joinedAt: 1000 },
      { accountId: 3, ip: '203.0.113.7', joinedAt: 2000 },
      { accountId: 4, ip: '203.0.113.7', joinedAt: 2000 },
      { accountId: 5, ip: '203.0.113.9', joinedAt: 500 },
      { accountId: 6, ip: '203.0.113.9', joinedAt: 500 },
      { accountId: 7, ip: '203.0.113.9', joinedAt: 500 },
    ]);

    expect(rows.map((row) => row.ip)).toEqual(['203.0.113.9', '203.0.113.7', '203.0.113.8']);
  });
});
