// PgSocialDb's guild custom rank statements (docs/prd/guild-custom-ranks.md)
// against a mocked pool: the additive ranks column, the ladder riding the
// membership JOIN (NULL or damaged rows resolve to the default ladder), the
// ladder write as a leadership compare-and-set that drops a deleted rank's
// holders to the joining rank in the SAME transaction, and the transfer's
// caller-resolved step-down rank. The DB-free sibling of
// social_db_guild_roster.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bustGuildList: vi.fn(),
}));

vi.mock('../server/admin_guilds_read', () => ({
  bustAdminGuildListReads: mocks.bustGuildList,
}));

import { PgSocialDb, SOCIAL_SCHEMA } from '../server/social_db';
import { defaultGuildRankLadder, type GuildRankDef } from '../src/sim/guild_ranks';

function harness() {
  const client = { query: vi.fn(), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() };
  return { client, pool, db: new PgSocialDb(pool as never) };
}

const LADDER: GuildRankDef[] = [
  {
    id: 'leader',
    name: '',
    perms: ['invite', 'remove', 'promote', 'bank', 'officerChat', 'motd', 'events'],
  },
  { id: 'r1', name: 'Veteran', perms: ['bank'] },
  { id: 'member', name: '', perms: [] },
];

describe('PgSocialDb guild custom ranks', () => {
  beforeEach(() => mocks.bustGuildList.mockReset());

  it('adds the nullable ranks column additively and idempotently', () => {
    expect(SOCIAL_SCHEMA).toContain('ALTER TABLE guilds ADD COLUMN IF NOT EXISTS ranks JSONB;');
  });

  it('the membership read carries the ladder on the same JOIN', async () => {
    const { pool, db } = harness();
    pool.query.mockResolvedValueOnce({
      rows: [{ guild_id: 4, guild_name: 'Knights', rank: 'r1', roster_pages: 0, ranks: LADDER }],
    });
    const m = await db.guildMembership(8);
    expect(m?.ranks).toEqual(LADDER);
    expect(m?.rank).toBe('r1');
    expect(String(pool.query.mock.calls[0][0])).toContain('g.ranks');
    expect(pool.query).toHaveBeenCalledTimes(1); // no second read for the ladder
  });

  it('a NULL or damaged stored ladder resolves to the default ladder', async () => {
    const { pool, db } = harness();
    for (const ranks of [null, [{ id: 'member' }], 'garbage']) {
      pool.query.mockResolvedValueOnce({
        rows: [{ guild_id: 4, guild_name: 'Knights', rank: 'member', roster_pages: 0, ranks }],
      });
      expect((await db.guildMembership(8))?.ranks).toEqual(defaultGuildRankLadder());
    }
    pool.query.mockResolvedValueOnce({ rows: [{ ranks: null }] });
    expect(await db.guildRanks(4)).toEqual(defaultGuildRankLadder());
    pool.query.mockResolvedValueOnce({ rows: [] }); // a guild that no longer exists
    expect(await db.guildRanks(4)).toEqual(defaultGuildRankLadder());
  });

  it('writes the ladder only while the caller still leads, then drops orphaned ranks, in one transaction', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE guilds (the CAS)
      .mockResolvedValueOnce({ rowCount: 2 }) // UPDATE guild_members (orphans)
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    await expect(db.setGuildRankLadder(4, 8, LADDER)).resolves.toBe(true);
    const sql = client.query.mock.calls.map((c) => String(c[0]));
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toMatch(/UPDATE guilds SET ranks = \$2::jsonb/);
    // The leadership compare-and-set lives IN the statement, never a prior read.
    expect(sql[1]).toMatch(/character_id = \$3 AND rank = 'leader'/);
    expect(client.query.mock.calls[1][1]).toEqual([4, JSON.stringify(LADDER), 8]);
    expect(sql[2]).toMatch(/UPDATE guild_members SET rank = 'member'/);
    expect(sql[2]).toMatch(/NOT \(rank = ANY\(\$2::text\[\]\)\)/);
    expect(client.query.mock.calls[2][1]).toEqual([4, ['leader', 'r1', 'member']]);
    expect(sql[3]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(mocks.bustGuildList).toHaveBeenCalledTimes(1);
  });

  it('a lost leadership race rolls back and writes nothing else', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0 }) // the CAS matched no row
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    await expect(db.setGuildRankLadder(4, 8, LADDER)).resolves.toBe(false);
    const sql = client.query.mock.calls.map((c) => String(c[0]));
    expect(sql).toEqual(['BEGIN', expect.stringMatching(/UPDATE guilds/), 'ROLLBACK']);
    expect(mocks.bustGuildList).not.toHaveBeenCalled();
  });

  it('a thrown statement rolls back and releases the client', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    await expect(db.setGuildRankLadder(4, 8, LADDER)).rejects.toThrow('boom');
    expect(String(client.query.mock.calls.at(-1)?.[0])).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('a transfer steps the former leader down to the rank the caller resolved', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 4 }] }) // lock the guild row
      .mockResolvedValueOnce({
        rows: [
          { character_id: 8, rank: 'leader' },
          { character_id: 9, rank: 'member' },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 }) // target -> leader
      .mockResolvedValueOnce({ rowCount: 1 }) // former leader -> step-down rank
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    await expect(db.transferGuildLeader(4, 8, 9, 'r1')).resolves.toBe('ok');
    expect(String(client.query.mock.calls[4][0])).toBe(
      'UPDATE guild_members SET rank = $2 WHERE character_id = $1',
    );
    expect(client.query.mock.calls[4][1]).toEqual([8, 'r1']);
  });
});
