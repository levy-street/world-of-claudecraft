import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
  const poolQuery = vi.fn();
  const clientQuery = vi.fn();
  const client = { query: clientQuery, release: vi.fn() };
  return { poolQuery, clientQuery, client, connect: vi.fn(() => client) };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.poolQuery, connect: dbMock.connect };
  }),
}));

import { acceptFriendInvite, createFriendInvite, friendInviteStats } from '../server/db';
import { REALM } from '../server/realm';

const inviteRow = {
  token: 'a'.repeat(64),
  inviter_account_id: 1,
  inviter_character_id: 10,
  inviter_name: 'Aldren',
  realm: REALM,
  expires_at: new Date(Date.now() + 86_400_000),
  accepted_account_id: null,
  accepted_character_id: null,
  accepted_character_name: null,
  completed_at: null,
};

beforeEach(() => {
  dbMock.poolQuery.mockReset();
  dbMock.clientQuery.mockReset();
  dbMock.client.release.mockReset();
  dbMock.connect.mockClear();
});

describe('friend invite db helpers', () => {
  it('reuses an active unaccepted invite for the same character', async () => {
    dbMock.poolQuery.mockResolvedValueOnce({ rows: [inviteRow] });

    const invite = await createFriendInvite('b'.repeat(64), 1, 10);

    expect(invite.token).toBe(inviteRow.token);
    expect(invite.inviterName).toBe('Aldren');
    expect(dbMock.poolQuery).toHaveBeenCalledTimes(1);
    expect(dbMock.poolQuery.mock.calls[0][1]).toEqual([1, 10, REALM]);
  });

  it('creates a new invite when no active invite exists', async () => {
    dbMock.poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...inviteRow, token: 'b'.repeat(64) }] });

    const invite = await createFriendInvite('b'.repeat(64), 1, 10);

    expect(invite.token).toBe('b'.repeat(64));
    expect(dbMock.poolQuery.mock.calls[1][1]).toEqual(['b'.repeat(64), 1, 10, REALM, '14']);
  });

  it('rejects using your own invite', async () => {
    dbMock.clientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [inviteRow] })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const result = await acceptFriendInvite(inviteRow.token, 1);

    expect(result).toEqual({ ok: false, status: 400, error: 'you cannot use your own invite' });
    expect(dbMock.client.release).toHaveBeenCalledTimes(1);
  });

  it('completes an accepted invite once an invited character enters the realm', async () => {
    dbMock.clientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...inviteRow, accepted_account_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 20, name: 'Bera', realm: REALM }] })
      .mockResolvedValueOnce({
        rows: [{
          ...inviteRow,
          accepted_account_id: 2,
          accepted_character_id: 20,
          accepted_character_name: 'Bera',
          completed_at: new Date(),
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await acceptFriendInvite(inviteRow.token, 2, 20);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.completedNow).toBe(true);
      expect(result.invite.acceptedCharacterName).toBe('Bera');
    }
  });

  it('reports cosmetic invite milestone status', async () => {
    dbMock.poolQuery.mockResolvedValueOnce({ rows: [{ sent_completed: 1, accepted_completed: 0 }] });

    await expect(friendInviteStats(1)).resolves.toEqual({
      sentCompleted: 1,
      acceptedCompleted: 0,
      titleUnlocked: true,
    });
  });
});
