import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: { query: mocks.query },
}));

vi.mock('../server/realm', () => ({
  REALM: 'test-realm',
}));

import { associationsForIp, listSharedIps } from '../server/admin_db';

describe('admin IP association queries', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('groups matching characters under their account and preserves association sources', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            username: 'alice',
            is_admin: false,
            status: 'suspended',
            suspended_until: '2026-06-03T00:00:00Z',
            created_at: '2026-01-01T00:00:00Z',
            created_with_ip: true,
            last_login_with_ip: false,
            latest_session_at: '2026-06-01T00:00:00Z',
            last_seen_at: '2026-06-01T00:00:00Z',
            total: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 7,
            character_id: 42,
            character_name: 'Alicia',
            realm: 'main',
            last_seen_at: '2026-06-01T00:00:00Z',
            session_count: 3,
          },
        ],
      });

    await expect(associationsForIp('203.0.113.7', 1, 25)).resolves.toEqual({
      ip: '203.0.113.7',
      accounts: [
        {
          accountId: 7,
          username: 'alice',
          isAdmin: false,
          status: 'suspended',
          suspendedUntil: '2026-06-03T00:00:00Z',
          createdAt: '2026-01-01T00:00:00Z',
          createdWithIp: true,
          lastLoginWithIp: false,
          hasSession: true,
          lastSeenAt: '2026-06-01T00:00:00Z',
          characters: [
            {
              characterId: 42,
              characterName: 'Alicia',
              realm: 'main',
              lastSeenAt: '2026-06-01T00:00:00Z',
              sessionCount: 3,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });

    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('a.created_ip = $1 OR a.last_login_ip = $1'),
      ['203.0.113.7', 25, 0],
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('COALESCE(c.name, ps.character_name)'),
      ['203.0.113.7', [7]],
    );
  });

  it('lists only IPs shared by multiple accounts in the requested last-seen order', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          ip: '203.0.113.7',
          account_count: 4,
          last_seen_at: '2026-06-28T12:00:00Z',
          total: 1,
        },
      ],
    });

    await expect(listSharedIps(2, 25, 'last_seen', 'asc')).resolves.toEqual({
      rows: [
        {
          ip: '203.0.113.7',
          accountCount: 4,
          lastSeenAt: '2026-06-28T12:00:00Z',
        },
      ],
      total: 1,
      page: 2,
      limit: 25,
    });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('HAVING count(DISTINCT account_id) > 1'),
      [25, 25, 'last_seen', 'asc'],
    );
    expect(mocks.query.mock.calls[0][0]).toContain(
      "CASE WHEN $3 = 'last_seen' AND $4 = 'asc' THEN last_seen_at END ASC",
    );
  });

  it('defaults shared IPs to account count descending', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await listSharedIps(1, 25);

    expect(mocks.query.mock.calls[0][1]).toEqual([25, 0, 'accounts', 'desc']);
    expect(mocks.query.mock.calls[0][0]).toContain(
      "CASE WHEN $3 = 'accounts' AND $4 = 'desc' THEN account_count END DESC",
    );
  });

  it('keeps creation-only accounts without inventing character associations', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 8,
          username: 'new-account',
          is_admin: false,
          status: 'active',
          suspended_until: null,
          created_at: '2026-06-02T00:00:00Z',
          created_with_ip: true,
          last_login_with_ip: false,
          latest_session_at: null,
          last_seen_at: '2026-06-02T00:00:00Z',
          total: 1,
        },
      ],
    });
    mocks.query.mockResolvedValueOnce({ rows: [] });

    const result = await associationsForIp('203.0.113.8', 1, 25);

    expect(result.accounts[0].hasSession).toBe(false);
    expect(result.accounts[0].characters).toEqual([]);
  });
});
