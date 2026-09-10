// The Postgres store behind the pledge-board recruiting settings
// (server/social_db.ts): the new_player_friendly column's DDL, the read that
// aliases it onto the shared GuildPledgeSettings shape, and the write that
// merges an ABSENT flag inside the statement (COALESCE over a nullable
// parameter) so an older client's save never clears an opt-in and two officers
// saving at once never race a stale read over a fresher toggle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bustGuildList: vi.fn(),
}));

vi.mock('../server/admin_guilds_read', () => ({
  bustAdminGuildListReads: mocks.bustGuildList,
}));

import { PgSocialDb, SOCIAL_SCHEMA } from '../server/social_db';

function harness() {
  const pool = {
    connect: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  };
  return { pool, db: new PgSocialDb(pool as never) };
}

describe('SOCIAL_SCHEMA: the guild board category column', () => {
  it('adds new_player_friendly to guilds additively, NOT NULL DEFAULT FALSE, after the pledge columns', () => {
    const alter = SOCIAL_SCHEMA.indexOf(
      'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS new_player_friendly BOOLEAN NOT NULL DEFAULT FALSE;',
    );
    expect(alter).toBeGreaterThan(SOCIAL_SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS guilds'));
    expect(alter).toBeGreaterThan(
      SOCIAL_SCHEMA.indexOf('ALTER TABLE guilds ADD COLUMN IF NOT EXISTS pledge_note'),
    );
  });
});

describe('PgSocialDb pledge settings round trip', () => {
  beforeEach(() => {
    mocks.bustGuildList.mockReset();
  });

  it('reads the flag under the shared shape, defaulting an absent row to the feature defaults', async () => {
    const { pool, db } = harness();
    pool.query.mockResolvedValueOnce({
      rows: [{ enabled: false, minLevel: 20, note: 'raiders', newPlayerFriendly: true }],
      rowCount: 1,
    });
    expect(await db.guildPledgeSettings(7)).toEqual({
      enabled: false,
      minLevel: 20,
      note: 'raiders',
      newPlayerFriendly: true,
    });
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('new_player_friendly AS "newPlayerFriendly"');
    expect(sql).toContain('FROM guilds WHERE id = $1');
    expect(params).toEqual([7]);

    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await db.guildPledgeSettings(8)).toEqual({
      enabled: true,
      minLevel: 1,
      note: '',
      newPlayerFriendly: false,
    });
  });

  it('writes an explicit flag as the fifth parameter', async () => {
    const { pool, db } = harness();
    await db.setGuildPledgeSettings(7, {
      enabled: true,
      minLevel: 5,
      note: 'hi',
      newPlayerFriendly: true,
    });
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('new_player_friendly = COALESCE($5, new_player_friendly)');
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual([7, true, 5, 'hi', true]);
  });

  it('writes an ABSENT flag as NULL so COALESCE keeps the stored value (an older client)', async () => {
    const { pool, db } = harness();
    await db.setGuildPledgeSettings(7, { enabled: false, minLevel: 3, note: 'x' });
    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([7, false, 3, 'x', null]);
  });

  it('writes an explicit false as false, never as the keep-stored NULL', async () => {
    const { pool, db } = harness();
    await db.setGuildPledgeSettings(7, {
      enabled: true,
      minLevel: 1,
      note: '',
      newPlayerFriendly: false,
    });
    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBe(false);
  });
});
