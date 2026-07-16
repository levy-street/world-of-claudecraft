// The Renown board's SQL roll-up (server/db.ts deedsBoardRanked): the account-level
// aggregation was moved OUT of Node (the old deedsBoardRows full-table pull +
// computeDeedsBoard JS rebuild) and INTO Postgres, so only the ranked accounts
// cross the wire, never the whole character_deeds table. computeDeedsBoard
// (server/deeds_board.ts) stays the EXECUTABLE SPEC this mirrors.
//
// Two layers of coverage:
//   1. Always-run (mocked pool): decisive text-literal pins on the query the
//      function hands to pool.query (the CTE spine, both eligibility sites, the
//      floor HAVING, the ordering, the unnest param types, the unknown side read)
//      plus the row -> RankedDeedsAccount mapping and the O(ranked) result shape.
//   2. pg-gated differential (WOCC_PG_DIFFERENTIAL=1, a reachable Postgres at
//      DATABASE_URL): seeds a fixture covering every semantic the spec pins and
//      asserts deedsBoardRanked(...).ranked equals computeDeedsBoard(rows,
//      catalog).ranked row-for-row. Skipped in normal CI (no dev Postgres), where
//      the text pins are the guard.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_deeds_board_sql';

import type { PoolClient, QueryResult } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deedsBoardRanked, ELIGIBLE_ACCOUNT_SQL, ensureSchema, pool } from '../../server/db';
import {
  computeDeedsBoard,
  DEEDS_BOARD_ENTRY_FLOOR,
  type DeedsBoardSourceRow,
} from '../../server/deeds_board';
import type { DeedDef } from '../../src/sim/types';

const T1 = '2026-07-01T00:00:00.000Z';
const T2 = '2026-07-02T00:00:00.000Z';
const T3 = '2026-07-03T00:00:00.000Z';
const T4 = '2026-07-04T00:00:00.000Z';

// Synthetic content table: only id + renown matter to the board. sql_feat0 is a
// zero-renown feat (scores and counts nothing); sql_gone is deliberately ABSENT
// so a character_deeds row carrying it is an unknown-deed the roll-up skips + warns.
function deed(id: string, renown: DeedDef['renown']): DeedDef {
  return {
    id,
    name: id,
    desc: id,
    category: 'progression',
    renown,
    trigger: { kind: 'level', level: 2 },
  };
}
// Renown is quantized to the DeedDef union (5/10/25/50, plus 0 feats), so the
// nearest reachable score below the 50 floor is 45 (25 + 10 + 10): the tightest
// just-below-floor case, matching the entry-floor test in deeds_board.test.ts.
const CATALOG: Record<string, DeedDef> = {
  sql_d50: deed('sql_d50', 50),
  sql_d25a: deed('sql_d25a', 25),
  sql_d25b: deed('sql_d25b', 25),
  sql_d10: deed('sql_d10', 10),
  sql_d10b: deed('sql_d10b', 10),
  sql_feat0: { ...deed('sql_feat0', 0), feat: true },
};
const DEED_IDS = Object.keys(CATALOG);
const RENOWNS = DEED_IDS.map((id) => CATALOG[id].renown);

// ---------------------------------------------------------------------------
// Layer 1: always-run text + mapping pins (mocked pool.query).
// ---------------------------------------------------------------------------

function queryResult(rows: unknown[]): QueryResult {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows: rows as never[] };
}

// deedsBoardRanked now runs inside runWithStatementTimeout (server/db.ts): a
// dedicated pooled client issues BEGIN, SET LOCAL statement_timeout, the real
// reads, then COMMIT. Stub pool.connect to a client that answers those control
// statements itself and forwards the real reads through the spied pool.query, so
// the existing pool.query spies still capture exactly the real reads in order.
function stubStatementTimeoutConnect(): void {
  vi.spyOn(pool, 'connect').mockImplementation(
    async () =>
      ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve({ rows: [] })
            : (pool.query as (t: string, v?: unknown[]) => Promise<unknown>)(text, values),
        release() {},
      }) as unknown as PoolClient,
  );
}

describe('deedsBoardRanked SQL shape (mocked pool)', () => {
  beforeEach(() => {
    stubStatementTimeoutConnect();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes the whole counted-set roll-up into ONE aggregation query, then a cheap unknown side read', async () => {
    const spy = vi
      .spyOn(pool, 'query')
      .mockResolvedValueOnce(queryResult([]) as never)
      .mockResolvedValueOnce(queryResult([]) as never);
    await deedsBoardRanked(DEED_IDS, RENOWNS, DEEDS_BOARD_ENTRY_FLOOR);
    expect(spy).toHaveBeenCalledTimes(2);
    const agg = String(spy.mock.calls[0][0]);
    const side = String(spy.mock.calls[1][0]);

    // The CTE spine, pinned as literals (the executable spec computeDeedsBoard
    // mirrors these exact steps).
    expect(agg).toContain('WITH renown(deed_id, renown) AS (');
    // Renown values arrive as query params (content-owned, never stored in SQL),
    // with the exact unnest element types.
    expect(agg).toContain('unnest($1::text[], $2::int[])');
    // Zero-renown deeds never enter the counted set (score AND count exclusion).
    expect(agg).toContain('WHERE u.renown > 0');
    // Per-deed earliest earn (a re-earn on a second character cannot move it).
    expect(agg).toContain('per_deed AS (');
    expect(agg).toContain('min(cd.earned_at) AS first_earned');
    expect(agg).toContain('GROUP BY cd.account_id, cd.deed_id');
    // Account score = sum over the counted set; deedCount = size; completionTime =
    // max of the per-deed earliest earns; floor applied server-side, inclusive.
    expect(agg).toContain('account_agg AS (');
    expect(agg).toContain('sum(r.renown)::int AS renown');
    expect(agg).toContain('count(*)::int AS deed_count');
    expect(agg).toContain('max(pd.first_earned) AS completion_time');
    expect(agg).toContain('HAVING sum(r.renown) >= $3');
    // Display character = highest per-character Renown, ties to lowest id.
    expect(agg).toContain('per_char AS (');
    expect(agg).toContain('sum(r.renown)::int AS char_renown');
    expect(agg).toContain('DISTINCT ON (account_id)');
    expect(agg).toContain('ORDER BY account_id, char_renown DESC, character_id ASC');
    // Final ordering: score desc, completion asc, accountId asc.
    expect(agg).toContain('ORDER BY aa.renown DESC, aa.completion_time ASC, aa.account_id ASC');

    // The eligibility fragment is embedded VERBATIM at BOTH roll-up sites (per-deed
    // and per-character), so a banned/suspended account is delisted from the score,
    // the count, AND the display pick.
    expect(agg.split(ELIGIBLE_ACCOUNT_SQL).length - 1).toBe(2);
    expect(agg).toContain('JOIN accounts a ON a.id = cd.account_id');
    // Belt over the ON DELETE CASCADE: only rows whose character still exists.
    expect(agg.split('JOIN characters c ON c.id = cd.character_id').length - 1).toBe(2);

    // The aggregation params: the content table (parallel arrays) plus the floor.
    expect(spy.mock.calls[0][1]).toEqual([DEED_IDS, RENOWNS, DEEDS_BOARD_ENTRY_FLOOR]);

    // The unknown-deed warn is a cheap side read over the whole content id set,
    // no eligibility join (it hunts removed/renamed content).
    expect(side).toContain(
      'SELECT DISTINCT deed_id FROM character_deeds WHERE deed_id <> ALL($1::text[])',
    );
    expect(side).not.toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(spy.mock.calls[1][1]).toEqual([DEED_IDS]);
  });

  it('maps each aggregated row 1:1 onto RankedDeedsAccount, so the node-side set is O(ranked accounts), not O(rows)', async () => {
    // The DB returns ONLY the ranked accounts (post-floor, post-aggregation), so
    // however large character_deeds grows, the array Node builds is bounded by the
    // number of ranked accounts. Two rows in -> exactly two ranked out.
    vi.spyOn(pool, 'query')
      .mockResolvedValueOnce(
        queryResult([
          {
            account_id: 1,
            renown: 75,
            deed_count: 2,
            completion_time: new Date(T2),
            display_character_id: 11,
          },
          {
            account_id: 2,
            renown: 50,
            deed_count: 1,
            completion_time: new Date(T2),
            display_character_id: 21,
          },
        ]) as never,
      )
      .mockResolvedValueOnce(queryResult([{ deed_id: 'sql_gone' }]) as never);
    const out = await deedsBoardRanked(DEED_IDS, RENOWNS, DEEDS_BOARD_ENTRY_FLOOR);
    expect(out.ranked).toHaveLength(2);
    expect(out.totalRanked).toBe(2);
    // TIMESTAMPTZ (Date) -> epoch ms, matching computeDeedsBoard's earnedMs.
    expect(out.ranked[0]).toEqual({
      accountId: 1,
      renown: 75,
      deedCount: 2,
      completionTime: Date.parse(T2),
      displayCharacterId: 11,
    });
    expect(out.unknownDeedIds).toEqual(['sql_gone']);
  });

  it('reads TIMESTAMPTZ completion_time whether pg hands back a Date or an ISO string', async () => {
    vi.spyOn(pool, 'query')
      .mockResolvedValueOnce(
        queryResult([
          {
            account_id: 9,
            renown: 50,
            deed_count: 1,
            completion_time: T1,
            display_character_id: 90,
          },
        ]) as never,
      )
      .mockResolvedValueOnce(queryResult([]) as never);
    const out = await deedsBoardRanked(DEED_IDS, RENOWNS, DEEDS_BOARD_ENTRY_FLOOR);
    expect(out.ranked[0].completionTime).toBe(Date.parse(T1));
    expect(out.unknownDeedIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: pg-gated differential parity against the executable spec. Runs only
// with WOCC_PG_DIFFERENTIAL=1 and a reachable Postgres at DATABASE_URL.
// ---------------------------------------------------------------------------

const PG_ON = process.env.WOCC_PG_DIFFERENTIAL === '1';

// Fixture account ids, high enough to avoid colliding with dev data; cleaned up
// in afterAll (character_deeds + characters cascade off ON DELETE CASCADE).
const ACCT = {
  score75: 991101,
  score50late: 991102,
  below45: 991103,
  below35: 991104,
  banned: 991105,
  suspended: 991106,
  tieEarlyLow: 991107,
  tieEarlyHigh: 991108,
} as const;
const ALL_ACCT_IDS = Object.values(ACCT);

interface DeedSeed {
  characterId: number;
  accountId: number;
  deedId: string;
  earnedAt: string;
}

// character_id -> account_id, so the seed and the raw-row read stay consistent.
const CHARS: Array<{ id: number; accountId: number; name: string }> = [
  { id: 99110111, accountId: ACCT.score75, name: 'sqlDiffA1' },
  { id: 99110112, accountId: ACCT.score75, name: 'sqlDiffA2' },
  { id: 99110211, accountId: ACCT.score50late, name: 'sqlDiffB1' },
  { id: 99110311, accountId: ACCT.below45, name: 'sqlDiffC1' },
  { id: 99110411, accountId: ACCT.below35, name: 'sqlDiffD1' },
  { id: 99110511, accountId: ACCT.banned, name: 'sqlDiffE1' },
  { id: 99110611, accountId: ACCT.suspended, name: 'sqlDiffF1' },
  { id: 99110711, accountId: ACCT.tieEarlyLow, name: 'sqlDiffG1' },
  { id: 99110712, accountId: ACCT.tieEarlyLow, name: 'sqlDiffG2' },
  { id: 99110811, accountId: ACCT.tieEarlyHigh, name: 'sqlDiffH1' },
];

const DEED_SEED: DeedSeed[] = [
  // score75: d50 earned by both chars (dedup; earliest T1), d25a (T2). A
  // zero-renown feat (T4) and an unknown id (sql_gone) must not perturb score,
  // count, or completionTime.
  { characterId: 99110111, accountId: ACCT.score75, deedId: 'sql_d50', earnedAt: T1 },
  { characterId: 99110112, accountId: ACCT.score75, deedId: 'sql_d50', earnedAt: T3 },
  { characterId: 99110111, accountId: ACCT.score75, deedId: 'sql_d25a', earnedAt: T2 },
  { characterId: 99110111, accountId: ACCT.score75, deedId: 'sql_feat0', earnedAt: T4 },
  { characterId: 99110111, accountId: ACCT.score75, deedId: 'sql_gone', earnedAt: T2 },
  // score50late: a single d50 at T2 (same score as the tie accounts, later time).
  { characterId: 99110211, accountId: ACCT.score50late, deedId: 'sql_d50', earnedAt: T2 },
  // below45: 25 + 10 + 10 = 45, the nearest reachable score below the 50 floor -> OUT.
  { characterId: 99110311, accountId: ACCT.below45, deedId: 'sql_d25a', earnedAt: T1 },
  { characterId: 99110311, accountId: ACCT.below45, deedId: 'sql_d10', earnedAt: T1 },
  { characterId: 99110311, accountId: ACCT.below45, deedId: 'sql_d10b', earnedAt: T1 },
  // below35: 25 + 10 = 35 -> OUT.
  { characterId: 99110411, accountId: ACCT.below35, deedId: 'sql_d25a', earnedAt: T1 },
  { characterId: 99110411, accountId: ACCT.below35, deedId: 'sql_d10', earnedAt: T1 },
  // banned: would score 100 (rank 1) but is delisted entirely.
  { characterId: 99110511, accountId: ACCT.banned, deedId: 'sql_d50', earnedAt: T1 },
  { characterId: 99110511, accountId: ACCT.banned, deedId: 'sql_d25a', earnedAt: T1 },
  { characterId: 99110511, accountId: ACCT.banned, deedId: 'sql_d25b', earnedAt: T1 },
  // suspended: would score 75 but is delisted while the suspension stands.
  { characterId: 99110611, accountId: ACCT.suspended, deedId: 'sql_d50', earnedAt: T1 },
  { characterId: 99110611, accountId: ACCT.suspended, deedId: 'sql_d25a', earnedAt: T1 },
  // tieEarlyLow: d50 on BOTH chars (per-account count once; both chars tie on
  // char renown, so the display char is the LOWER id).
  { characterId: 99110711, accountId: ACCT.tieEarlyLow, deedId: 'sql_d50', earnedAt: T1 },
  { characterId: 99110712, accountId: ACCT.tieEarlyLow, deedId: 'sql_d50', earnedAt: T1 },
  // tieEarlyHigh: 50 at T1, identical score+time to tieEarlyLow -> broken by accountId.
  { characterId: 99110811, accountId: ACCT.tieEarlyHigh, deedId: 'sql_d50', earnedAt: T1 },
];

async function cleanup(client: PoolClient): Promise<void> {
  await client.query('DELETE FROM accounts WHERE id = ANY($1::int[])', [ALL_ACCT_IDS]);
}

async function seed(client: PoolClient): Promise<void> {
  await cleanup(client);
  for (const id of ALL_ACCT_IDS) {
    const banned = id === ACCT.banned;
    const suspended = id === ACCT.suspended;
    await client.query(
      `INSERT INTO accounts (id, username, password_hash, banned_at, suspended_until)
       VALUES ($1, $2, 'x', ${banned ? 'now()' : 'NULL'},
               ${suspended ? "now() + interval '1 hour'" : 'NULL'})`,
      [id, `sqldiff_${id}`],
    );
  }
  for (const c of CHARS) {
    await client.query(
      `INSERT INTO characters (id, account_id, name, class, level) VALUES ($1, $2, $3, 'warrior', 10)`,
      [c.id, c.accountId, c.name],
    );
  }
  for (const d of DEED_SEED) {
    await client.query(
      `INSERT INTO character_deeds (realm, character_id, account_id, deed_id, earned_at)
       VALUES ('sqldiff-realm', $1, $2, $3, $4)`,
      [d.characterId, d.accountId, d.deedId, d.earnedAt],
    );
  }
}

// The raw eligible-row read the former deedsBoardRows did, for the spec side of
// the differential (computeDeedsBoard consumes it).
async function eligibleRows(): Promise<DeedsBoardSourceRow[]> {
  const res = await pool.query(
    `SELECT cd.account_id, cd.character_id, cd.deed_id, cd.earned_at
       FROM character_deeds cd
       JOIN characters c ON c.id = cd.character_id
       JOIN accounts a ON a.id = cd.account_id
      WHERE ${ELIGIBLE_ACCOUNT_SQL}
        AND cd.account_id = ANY($1::int[])`,
    [ALL_ACCT_IDS],
  );
  return res.rows.map((r) => ({
    accountId: Number(r.account_id),
    characterId: Number(r.character_id),
    deedId: String(r.deed_id),
    earnedAt: r.earned_at,
  }));
}

// deedsBoardRanked is cross-realm and reads the WHOLE table, so the differential
// scopes to the fixture accounts to stay isolated from any other dev data.
async function rankedForFixture(): Promise<Awaited<ReturnType<typeof deedsBoardRanked>>['ranked']> {
  const full = await deedsBoardRanked(DEED_IDS, RENOWNS, DEEDS_BOARD_ENTRY_FLOOR);
  return full.ranked.filter((a) => (ALL_ACCT_IDS as readonly number[]).includes(a.accountId));
}

describe.skipIf(!PG_ON)('deedsBoardRanked differential vs computeDeedsBoard (pg-gated)', () => {
  beforeAll(async () => {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await seed(client);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await cleanup(client);
    } finally {
      client.release();
    }
    await pool.end();
  });

  it('produces the same ranked order + fields the JS spec does, row-for-row', async () => {
    const rows = await eligibleRows();
    const spec = computeDeedsBoard(rows, CATALOG).ranked;
    const sql = await rankedForFixture();
    expect(sql).toEqual(spec);
  });

  it('ranks exactly the four eligible at-or-above-floor accounts, in spec order', async () => {
    const sql = await rankedForFixture();
    // score75 (75, T2) first; the two T1 ties (low accountId first); then the
    // later-time 50. Below-floor and delisted accounts are absent.
    expect(sql.map((a) => a.accountId)).toEqual([
      ACCT.score75,
      ACCT.tieEarlyLow,
      ACCT.tieEarlyHigh,
      ACCT.score50late,
    ]);
    expect(sql[0]).toMatchObject({
      renown: 75,
      deedCount: 2,
      completionTime: Date.parse(T2),
      displayCharacterId: 99110111,
    });
    // The display character for the tie account is the LOWER of the two tied ids.
    expect(sql[1].displayCharacterId).toBe(99110711);
    // The result set is bounded by ranked accounts, not the seeded row count.
    expect(sql.length).toBeLessThan(DEED_SEED.length);
  });

  it('flags the unknown deed id and excludes it (and the zero-renown feat) from every score', async () => {
    const full = await deedsBoardRanked(DEED_IDS, RENOWNS, DEEDS_BOARD_ENTRY_FLOOR);
    expect(full.unknownDeedIds).toContain('sql_gone');
    // score75's counted set is {d50, d25a} = 75, never inflated by sql_feat0 or sql_gone.
    const top = full.ranked.find((a) => a.accountId === ACCT.score75);
    expect(top?.renown).toBe(75);
    expect(top?.deedCount).toBe(2);
  });
});
