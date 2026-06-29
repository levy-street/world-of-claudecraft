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

import { accountDetail } from '../server/admin_db';

describe('admin account detail query', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('returns recent moderation actions with their current admin identity', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            username: 'alice',
            created_at: '2026-01-01T00:00:00Z',
            last_login: '2026-06-01T00:00:00Z',
            is_admin: false,
            banned_at: null,
            suspended_until: null,
            moderation_reason: '',
            chat_muted_until: null,
            chat_mute_reason: '',
            chat_strikes: 0,
            last_login_ip: '203.0.113.7',
            playtime_seconds: 3600,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '12',
            action: 'suspend',
            reason: 'harassment',
            created_at: '2026-06-01T02:00:00Z',
            expires_at: '2026-06-02T02:00:00Z',
            admin_account_id: 3,
            admin_username: 'moderator',
          },
        ],
      });

    const detail = await accountDetail(7);

    expect(detail?.moderationHistory).toEqual([
      {
        id: 12,
        action: 'suspend',
        reason: 'harassment',
        createdAt: '2026-06-01T02:00:00Z',
        expiresAt: '2026-06-02T02:00:00Z',
        adminAccountId: 3,
        adminUsername: 'moderator',
      },
    ]);
    expect(mocks.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('FROM account_moderation_actions action_log'),
      [7],
    );
    expect(mocks.query.mock.calls[3][0]).toContain(
      'ORDER BY action_log.created_at DESC, action_log.id DESC',
    );
    expect(mocks.query.mock.calls[3][0]).toContain('LIMIT 50');
  });
});
