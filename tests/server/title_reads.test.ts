// The load-bearing state->>'activeTitle' reads behind the title surfaces.
// The board/roster fakes elsewhere hand back pre-normalized shapes, so a
// JSON-path typo or a state-key rename in the REAL SQL would silently drop
// every title while those suites stay green. This file drives the real
// query builders with a spied/faked pool: the SQL fragment is pinned as a
// LITERAL on every arm, and the ''/null-to-null normalization runs on real
// rows. The main.ts cache map (title: r.activeTitle) is source-pinned (the
// module is the server entrypoint, too heavy to load in a unit).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_title_reads';

import { readFileSync } from 'node:fs';
import type { QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool, topLifetimeXp } from '../../server/db';
import { PgSocialDb } from '../../server/social_db';

const TITLE_SQL_LITERAL = "state->>'activeTitle' AS active_title";

function result(rows: Record<string, unknown>[]): QueryResult {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('topLifetimeXp reads and normalizes the selected title (both arms)', () => {
  function xpRow(over: Record<string, unknown>): Record<string, unknown> {
    return {
      name: 'Hilda',
      class: 'warrior',
      level: 20,
      realm: 'Claudemoon',
      lifetime_xp: '1000',
      prestige_rank: 0,
      active_title: null,
      ...over,
    };
  }

  it('the realm arm embeds the literal read and maps a deed id through', async () => {
    const spy = vi
      .spyOn(pool, 'query')
      .mockImplementation(
        () => Promise.resolve(result([xpRow({ active_title: 'prog_veteran' })])) as never,
      );
    const rows = await topLifetimeXp(10);
    expect(spy.mock.calls).toHaveLength(1);
    expect(String(spy.mock.calls[0][0])).toContain(TITLE_SQL_LITERAL);
    expect(rows[0].activeTitle).toBe('prog_veteran');
  });

  it('the global arm embeds the same literal read', async () => {
    const spy = vi
      .spyOn(pool, 'query')
      .mockImplementation(() => Promise.resolve(result([])) as never);
    await topLifetimeXp(10, { global: true });
    expect(String(spy.mock.calls[0][0])).toContain(TITLE_SQL_LITERAL);
  });

  it("normalizes '' and non-string to null (the charactersForDeedsBoard rule)", async () => {
    vi.spyOn(pool, 'query').mockImplementation(
      () =>
        Promise.resolve(
          result([
            xpRow({ name: 'Empty', active_title: '' }),
            xpRow({ name: 'Absent', active_title: null }),
            xpRow({ name: 'Titled', active_title: 'hid_saul_footnote' }),
          ]),
        ) as never,
    );
    const rows = await topLifetimeXp(10);
    expect(rows.map((r) => r.activeTitle)).toEqual([null, null, 'hid_saul_footnote']);
  });
});

describe('PgSocialDb roster/friends reads carry the selected title', () => {
  function fakePool(rows: Record<string, unknown>[]) {
    const calls: string[] = [];
    const p = {
      query: (sql: string) => {
        calls.push(sql);
        return Promise.resolve(result(rows));
      },
    };
    return { db: new PgSocialDb(p as never), calls };
  }

  it('listFriends embeds the literal read and normalizes per row', async () => {
    const { db, calls } = fakePool([
      { id: 1, name: 'Titled', cls: 'mage', level: 5, realm: 'R', active_title: 'prog_veteran' },
      { id: 2, name: 'Empty', cls: 'mage', level: 5, realm: 'R', active_title: '' },
      { id: 3, name: 'Absent', cls: 'mage', level: 5, realm: 'R', active_title: null },
    ]);
    const friends = await db.listFriends(9);
    expect(calls[0]).toContain(TITLE_SQL_LITERAL);
    expect(friends.map((f) => f.activeTitle)).toEqual(['prog_veteran', null, null]);
    // the raw column name never leaks onto the wire shape
    expect('active_title' in friends[0]).toBe(false);
  });

  it('guildMembers embeds the literal read, normalizes, and keeps lastLogin intact', async () => {
    const iso = '2026-01-02T03:04:05.000Z';
    const { db, calls } = fakePool([
      {
        id: 1,
        name: 'Titled',
        cls: 'mage',
        level: 5,
        realm: 'R',
        rank: 'member',
        lastLogin: iso,
        active_title: 'col_seven_regalia',
      },
      {
        id: 2,
        name: 'Plain',
        cls: 'mage',
        level: 5,
        realm: 'R',
        rank: 'leader',
        lastLogin: null,
        active_title: '',
      },
    ]);
    const members = await db.guildMembers(4);
    expect(calls[0]).toContain(TITLE_SQL_LITERAL);
    expect(members[0].activeTitle).toBe('col_seven_regalia');
    expect(members[0].lastLogin).toBe(iso);
    expect(members[1].activeTitle).toBeNull();
    expect('active_title' in members[0]).toBe(false);
  });
});

describe('the shared board cache maps the read onto LeaderboardEntry (source pin)', () => {
  it('refreshLeaderboard fills title from the normalized row on BOTH scopes', () => {
    // main.ts is the server entrypoint (side-effectful import), so the one
    // cache fill both dispatch arms page from is pinned at the source level.
    const main = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
    const fill = main.slice(main.indexOf('async function refreshLeaderboard'));
    expect(fill.length).toBeGreaterThan(0);
    expect(fill.slice(0, 700)).toContain('title: r.activeTitle');
  });
});
