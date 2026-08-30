import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bustGuildList: vi.fn(),
}));

vi.mock('../server/admin_guilds_read', () => ({
  bustAdminGuildListReads: mocks.bustGuildList,
}));

import { PgSocialDb } from '../server/social_db';

function harness() {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  };
  return { client, db: new PgSocialDb(pool as never) };
}

// The pledge is the offline seat's consent (docs/prd/guild-pledge-board.md):
// requirePledge consumes it inside the SAME transaction as the member insert,
// so a withdraw or decline racing the caller's pledge read rolls the whole
// seat back instead of seating a player who just said no.
describe('PgSocialDb pledge-consuming seat (addGuildMemberAtomic requirePledge)', () => {
  beforeEach(() => {
    mocks.bustGuildList.mockReset();
  });

  it('consumes the pledge inside the seat transaction and commits', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 }) // guild FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // membership check
      .mockResolvedValueOnce({ rows: [{ n: 3 }], rowCount: 1 }) // cap count
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // member insert
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // pledge consume
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await expect(db.addGuildMemberAtomic(7, 44, 'member', 100, true)).resolves.toBe('ok');

    const verbs = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(verbs).toEqual(['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'INSERT', 'DELETE', 'COMMIT']);
    // The consume is scoped to BOTH the character and THIS guild, so a pledge
    // to some other guild can never stand in as consent for this seat.
    expect(client.query.mock.calls[5]).toEqual([
      'DELETE FROM guild_pledges WHERE character_id = $1 AND guild_id = $2',
      [44, 7],
    ]);
    expect(mocks.bustGuildList).toHaveBeenCalled();
  });

  it('rolls the whole seat back when the pledge is gone', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ n: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // pledge already gone
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(db.addGuildMemberAtomic(7, 44, 'member', 100, true)).resolves.toBe('no_pledge');

    const verbs = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(verbs).toEqual(['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'INSERT', 'DELETE', 'ROLLBACK']);
    expect(mocks.bustGuildList).not.toHaveBeenCalled();
  });

  it('does not touch pledges on a plain seat', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ n: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await expect(db.addGuildMemberAtomic(7, 44, 'member', 100)).resolves.toBe('ok');

    const verbs = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(verbs).toEqual(['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'INSERT', 'COMMIT']);
  });
});
