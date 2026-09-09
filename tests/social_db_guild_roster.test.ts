// PgSocialDb's roster-expansion statements (docs/prd/guild-roster-expansion.md)
// against a mocked pool: the membership read carries roster_pages, the atomic
// seat reads the cap from the LOCKED guild row, and the page purchase is a
// compare-and-set on the pages-bought count. The DB-free sibling of
// social_db_seat_pledge.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bustGuildList: vi.fn(),
}));

vi.mock('../server/admin_guilds_read', () => ({
  bustAdminGuildListReads: mocks.bustGuildList,
}));

import { PgSocialDb, SOCIAL_SCHEMA } from '../server/social_db';
import { GUILD_ROSTER_MAX_PAGES, GUILD_ROSTER_PAGE_PRICES } from '../src/sim/guild_roster';

function harness() {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  };
  return {
    client,
    db: new PgSocialDb(pool as never),
    pool,
  };
}

describe('PgSocialDb guild roster expansion', () => {
  beforeEach(() => {
    mocks.bustGuildList.mockReset();
  });

  it('reads roster_pages on the membership JOIN and floors it into the ladder', async () => {
    const { pool, db } = harness();
    pool.query.mockResolvedValueOnce({
      rows: [{ guild_id: 4, guild_name: 'Knights', rank: 'leader', roster_pages: 3 }],
    });
    await expect(db.guildMembership(8)).resolves.toEqual({
      guildId: 4,
      guildName: 'Knights',
      rank: 'leader',
      rosterPages: 3,
    });
    expect(String(pool.query.mock.calls[0][0])).toContain('g.roster_pages');
    expect(pool.query.mock.calls[0][1]).toEqual([8]);

    // A legacy or tampered count never indexes a price it did not pay for.
    pool.query.mockResolvedValueOnce({
      rows: [{ guild_id: 4, guild_name: 'Knights', rank: 'member', roster_pages: 999 }],
    });
    expect((await db.guildMembership(8))?.rosterPages).toBe(GUILD_ROSTER_MAX_PAGES);
    pool.query.mockResolvedValueOnce({
      rows: [{ guild_id: 4, guild_name: 'Knights', rank: 'member', roster_pages: null }],
    });
    expect((await db.guildMembership(8))?.rosterPages).toBe(0);
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await db.guildMembership(8)).toBeNull();
  });

  it('seats against the cap read from the LOCKED guild row: full at the bought cap', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7, roster_pages: 1 }], rowCount: 1 }) // FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // membership check
      .mockResolvedValueOnce({ rows: [{ n: 120 }], rowCount: 1 }) // cap count: one page = 120
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(db.addGuildMemberAtomic(7, 44, 'member')).resolves.toBe('full');

    const lock = client.query.mock.calls[1];
    expect(String(lock[0])).toContain('roster_pages');
    expect(String(lock[0])).toContain('FOR UPDATE');
    expect(lock[1]).toEqual([7]);
    const verbs = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(verbs).toEqual(['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'ROLLBACK']);
    expect(mocks.bustGuildList).not.toHaveBeenCalled();
  });

  it('seats below the bought cap, one seat past the base roster', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7, roster_pages: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ n: 100 }], rowCount: 1 }) // the base cap is behind us
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // member insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await expect(db.addGuildMemberAtomic(7, 44, 'member')).resolves.toBe('ok');
    const verbs = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(verbs).toEqual(['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'INSERT', 'COMMIT']);
    expect(mocks.bustGuildList).toHaveBeenCalledOnce();
  });

  it('a row with no pages yet caps at the base roster', async () => {
    const { client, db } = harness();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, roster_pages: 0 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ n: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    await expect(db.addGuildMemberAtomic(7, 44, 'member')).resolves.toBe('full');
  });

  // The page purchase itself (compare-and-set, receipt, fenced purse save) is
  // one transaction in server/guild_roster_page_db.ts; its statements and
  // verdicts are pinned in tests/guild_roster_page_db.test.ts.

  it('declares the receipts table after guilds and roster_pages, cascading, BIGINT copper, indexed', () => {
    const table = SOCIAL_SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS guild_roster_receipts');
    expect(table).toBeGreaterThan(SOCIAL_SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS guilds'));
    expect(table).toBeGreaterThan(
      SOCIAL_SCHEMA.indexOf('ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_pages'),
    );
    const block = SOCIAL_SCHEMA.slice(table, SOCIAL_SCHEMA.indexOf(');', table));
    expect(block).toContain('batch_key TEXT PRIMARY KEY');
    expect(block).toContain('guild_id INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE');
    expect(block).toContain(
      'character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE',
    );
    // The ladder crosses INT4 at page 30, so the column must stay BIGINT.
    expect(block).toContain('copper BIGINT NOT NULL');
    expect(Math.max(...GUILD_ROSTER_PAGE_PRICES)).toBeGreaterThan(2 ** 31);
    // No (guild_id, page) uniqueness: a lowered counter must be sellable again.
    expect(block).not.toContain('UNIQUE');
    expect(SOCIAL_SCHEMA).toContain('DROP CONSTRAINT IF EXISTS guild_roster_receipts_page_once');
    // Both cascades are index-backed, the bank_ledger_batch_receipts precedent.
    expect(SOCIAL_SCHEMA).toContain(
      'CREATE INDEX IF NOT EXISTS guild_roster_receipts_guild_page\n  ON guild_roster_receipts (guild_id, page)',
    );
    expect(SOCIAL_SCHEMA).toContain(
      'CREATE INDEX IF NOT EXISTS guild_roster_receipts_character\n  ON guild_roster_receipts (character_id)',
    );
  });
});
