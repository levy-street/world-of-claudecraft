import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bustGuildList: vi.fn(),
}));

vi.mock('../server/admin_guilds_read', () => ({
  bustAdminGuildListReads: mocks.bustGuildList,
}));

import { DEFAULT_REALM, PgSocialDb } from '../server/social_db';

function harness() {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  };
  return {
    client,
    db: new PgSocialDb(pool as never),
    pool,
  };
}

describe('PgSocialDb case-insensitive guild creation', () => {
  beforeEach(() => {
    mocks.bustGuildList.mockReset();
  });

  it('takes the folded-name advisory lock before checking and inserting', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    await expect(db.createGuildWithLeader('Dawn Guard', 8)).resolves.toEqual({ guildId: 12 });

    expect(client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'INSERT',
      'INSERT',
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1]).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'),
      [`guild-name:${DEFAULT_REALM}:dawn guard`],
    ]);
    expect(client.query.mock.calls[2]).toEqual([
      expect.stringContaining('lower(name) = lower($2)'),
      [DEFAULT_REALM, 'Dawn Guard', null],
    ]);
    expect(mocks.bustGuildList).toHaveBeenCalledOnce();
    const commitIndex = client.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
    expect(client.query.mock.invocationCallOrder[commitIndex]).toBeLessThan(
      mocks.bustGuildList.mock.invocationCallOrder[0],
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects a case-only collision before inserting a guild row', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(db.createGuildWithLeader('DAWN GUARD', 8)).resolves.toEqual({
      error: 'name_taken',
    });

    expect(client.query.mock.calls[1][1]).toEqual([`guild-name:${DEFAULT_REALM}:dawn guard`]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.bustGuildList).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('invalidates the directory after delete, member removal, and rank changes', async () => {
    const { db } = harness();

    await db.deleteGuild(12);
    await db.removeGuildMember(8);
    await db.setGuildRank(8, 12, 'officer');

    expect(mocks.bustGuildList).toHaveBeenCalledTimes(3);
  });

  it('invalidates the directory after a member is added successfully', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 12 }], rowCount: 1 }) // guild lock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no existing membership
      .mockResolvedValueOnce({ rows: [{ n: 1 }], rowCount: 1 }) // below member limit
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // membership insert
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    await expect(db.addGuildMemberAtomic(12, 8, 'member', 50)).resolves.toBe('ok');

    expect(mocks.bustGuildList).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    const commitIndex = client.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
    expect(client.query.mock.invocationCallOrder[commitIndex]).toBeLessThan(
      mocks.bustGuildList.mock.invocationCallOrder[0],
    );
    expect(client.release).toHaveBeenCalledOnce();
  });
});
