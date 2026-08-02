// topLifetimeXp reads each ranked character's guild name, on BOTH scope arms, as a
// SELECT-list scalar subquery so the ranking itself is untouched (the WHERE /
// ORDER BY still key on the bare lifetime-XP expression, which is what lets the
// expression indexes serve the board).
//
// Same harness as title_reads.test.ts: the read runs inside
// runWithStatementTimeout, so pool.connect is stubbed to a client that answers the
// BEGIN / SET LOCAL / COMMIT control statements itself and forwards the one real
// read through the spied pool.query.

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_guild_reads';

import { readFileSync } from 'node:fs';
import type { PoolClient, QueryResult } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, topLifetimeXp } from '../../server/db';

// The load-bearing fragments of the subquery: the join it walks, the correlation
// that keys it to the ranked row, and the output alias the mapper reads.
const GUILD_JOIN_SQL = 'JOIN guilds g ON g.id = gm.guild_id';
const GUILD_CORRELATION_SQL = 'WHERE gm.character_id = characters.id';
const GUILD_ALIAS_SQL = 'AS guild_name';

function result(rows: Record<string, unknown>[]): QueryResult {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult;
}

function xpRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Zyzz',
    class: 'warrior',
    level: 60,
    realm: 'Claudemoon',
    lifetime_xp: '5000000',
    prestige_rank: 0,
    active_title: null,
    guild_name: 'Monarchs',
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(pool, 'connect').mockImplementation(
    async () =>
      ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve(result([]))
            : (pool.query as (t: string, v?: unknown[]) => Promise<unknown>)(text, values),
        release() {},
      }) as unknown as PoolClient,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('topLifetimeXp reads the guild name for each ranked character (both arms)', () => {
  it('the realm arm embeds the guild subquery and maps the name through', async () => {
    const spy = vi
      .spyOn(pool, 'query')
      .mockImplementation(() => Promise.resolve(result([xpRow()])) as never);
    const rows = await topLifetimeXp(10);
    expect(spy.mock.calls).toHaveLength(1);
    const sql = String(spy.mock.calls[0][0]);
    expect(sql).toContain(GUILD_JOIN_SQL);
    expect(sql).toContain(GUILD_CORRELATION_SQL);
    expect(sql).toContain(GUILD_ALIAS_SQL);
    expect(rows[0].guild).toBe('Monarchs');
  });

  it('the global arm embeds the same subquery', async () => {
    const spy = vi
      .spyOn(pool, 'query')
      .mockImplementation(() => Promise.resolve(result([])) as never);
    await topLifetimeXp(10, { global: true });
    const sql = String(spy.mock.calls[0][0]);
    expect(sql).toContain(GUILD_JOIN_SQL);
    expect(sql).toContain(GUILD_CORRELATION_SQL);
    expect(sql).toContain(GUILD_ALIAS_SQL);
  });

  it("normalizes NULL / '' / non-string to null (the activeTitle rule)", async () => {
    vi.spyOn(pool, 'query').mockImplementation(
      () =>
        Promise.resolve(
          result([
            xpRow({ name: 'Unguilded', guild_name: null }),
            xpRow({ name: 'Empty', guild_name: '' }),
            xpRow({ name: 'Weird', guild_name: 7 }),
          ]),
        ) as never,
    );
    const rows = await topLifetimeXp(10);
    expect(rows.map((r) => r.guild)).toEqual([null, null, null]);
  });

  it('keeps the guild lookup OUT of the ranking predicate and sort', async () => {
    // The whole point of the SELECT-list subquery: a guild join in the FROM/WHERE
    // would cost the board its expression index. Pin that the filter and the order
    // still name only the lifetime-XP expression and the eligibility check.
    const spy = vi
      .spyOn(pool, 'query')
      .mockImplementation(() => Promise.resolve(result([])) as never);
    await topLifetimeXp(10);
    const sql = String(spy.mock.calls[0][0]);
    const orderBy = sql.slice(sql.indexOf('ORDER BY'));
    expect(orderBy).not.toContain('guild');
    // The FROM clause is `FROM characters` alone; the guild tables appear only
    // inside the parenthesized subquery, which sits before the FROM.
    const fromOnward = sql.slice(sql.indexOf('FROM characters'));
    expect(fromOnward).not.toContain('guild_members');
  });
});

describe('the shared board cache maps the guild onto LeaderboardEntry (source pin)', () => {
  it('refreshLeaderboard fills guild from the normalized row, omitting it when unguilded', () => {
    // main.ts is the server entrypoint (side-effectful import), so the one cache
    // fill both dispatch arms page from is pinned at the source level, the way the
    // title fill is in title_reads.test.ts. Omitting the key (rather than sending
    // null) is what keeps an unguilded row byte-unchanged on the wire.
    const main = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
    const fill = main.slice(main.indexOf('async function refreshLeaderboard'));
    expect(fill.length).toBeGreaterThan(0);
    expect(fill.slice(0, 1400)).toContain('...(r.guild ? { guild: r.guild } : {})');
  });
});
