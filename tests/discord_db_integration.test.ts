// Opt-in real-Postgres coverage for the set-based Discord statements: the two
// added with POST /internal/discord/flex-batch and the members-meta bulk upsert,
// plus the batched identity read GET /internal/discord/outbox drains through.
//
// WHY THIS FILE EXISTS: tests/discord_db.test.ts drives both functions through a
// fake pool that routes on SQL TEXT, so it can pin the shape, the bound
// parameters and the statement COUNT, but it never parses, plans or executes a
// line of the SQL. What ships in those two statements is unusually novel for this
// codebase (a data-modifying CTE, multi-argument unnest, a row-constructor
// IS DISTINCT FROM, array_agg over an anti-join, a LATERAL with LIMIT 1, ISO
// strings bound into timestamptz[], bigint-as-string coercion), and a syntax or
// type defect in the ONE statement that now carries the whole member sweep is a
// total outage rather than a degradation. This file is the arm that actually runs
// them. The default suite stays DB-free: set TEST_DATABASE_URL to opt in.
//
// Mirrors the admin_db_integration.test.ts / daily_rewards_db_integration.test.ts
// template: a dedicated schema, tables carrying only the columns these statements
// read, and EXPLAIN ... FORMAT JSON to pin the plan rather than only the result.

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  discordFlexRowsForDiscordIds,
  discordLinksForAccounts,
  setDiscordMemberMetaBulk,
} from '../server/discord_db';
import {
  configureDiscordStatusCache,
  readDiscordStatusCore,
  resetDiscordStatusCacheForTests,
} from '../server/discord_status_cache';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'discord_db_integration_test';
const describeDb = DB_URL ? describe : describe.skip;
const REALM = 'eastbrook';

function planNodes(node: Record<string, unknown>): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [node];
  const children = (node.Plans as Record<string, unknown>[] | undefined) ?? [];
  for (const child of children) {
    if (child && typeof child === 'object') nodes.push(...planNodes(child));
  }
  return nodes;
}

describeDb('discord set-based statements (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    // search_path is set as a startup option so the MODULE functions (which take
    // the pool and issue unqualified SQL) land in the test schema.
    pool = new Pool({ connectionString: DB_URL, max: 4, options: `-c search_path=${SCHEMA}` });
    const admin = new Pool({ connectionString: DB_URL, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    // Only the columns these two statements read, taken from DISCORD_SCHEMA
    // (server/discord_db.ts) and the characters table (server/db.ts).
    await pool.query(`
      CREATE TABLE accounts (id SERIAL PRIMARY KEY);
      CREATE TABLE discord_links (
        account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        discord_user_id TEXT NOT NULL UNIQUE,
        discord_username TEXT,
        discord_avatar TEXT,
        guild_member BOOLEAN NOT NULL DEFAULT FALSE,
        linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        discord_joined_at TIMESTAMPTZ,
        discord_role TEXT,
        discord_email TEXT
      );
      CREATE TABLE reward_points (
        account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        points BIGINT NOT NULL DEFAULT 0,
        lifetime_points BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE characters (
        id SERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        class TEXT NOT NULL,
        level INT NOT NULL DEFAULT 1,
        state JSONB,
        realm TEXT NOT NULL
      );
      CREATE INDEX characters_account ON characters(account_id);
    `);
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE accounts, discord_links, reward_points, characters CASCADE');
  });

  /** Link account `id` to Discord id `du`, with optional stored meta. */
  async function seedLink(
    id: number,
    du: string,
    meta: { username?: string | null; joinedAt?: string | null; role?: string | null } = {},
  ): Promise<void> {
    await pool.query('INSERT INTO accounts (id) VALUES ($1)', [id]);
    await pool.query(
      `INSERT INTO discord_links (account_id, discord_user_id, discord_username, discord_joined_at, discord_role)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, du, meta.username ?? null, meta.joinedAt ?? null, meta.role ?? null],
    );
  }

  // -------------------------------------------------------------------------
  // setDiscordMemberMetaBulk
  // -------------------------------------------------------------------------

  describe('setDiscordMemberMetaBulk', () => {
    it('classifies a mixed batch into changed, skipped and unapplied', async () => {
      // The whole reason the endpoint reports three numbers instead of one, run
      // for real: one row that moves, one already correct, one with NO link row.
      await seedLink(1, 'changes', { username: 'Old', role: null });
      await seedLink(2, 'identical', {
        username: 'Same',
        joinedAt: '2023-11-14T22:13:20.000Z',
        role: 'mods',
      });

      const result = await setDiscordMemberMetaBulk(pool, [
        { discordUserId: 'changes', nickname: 'New', joinedAtMs: null, roleKey: null },
        {
          discordUserId: 'identical',
          nickname: 'Same',
          joinedAtMs: 1_700_000_000_000,
          roleKey: 'mods',
        },
        { discordUserId: 'nolink', nickname: 'Ghost', joinedAtMs: null, roleKey: null },
      ]);

      expect(result).toEqual({ changed: 1, skipped: 1, unapplied: ['nolink'] });
      // And the write really landed on the row that moved, and only that row.
      const rows = await pool.query(
        'SELECT discord_user_id, discord_username FROM discord_links ORDER BY discord_user_id',
      );
      expect(rows.rows).toEqual([
        { discord_user_id: 'changes', discord_username: 'New' },
        { discord_user_id: 'identical', discord_username: 'Same' },
      ]);
    });

    it('busts exactly the CHANGED accounts /api/discord status cores (Phase 9), executed', async () => {
      // The bust population rides `RETURNING dl.account_id` off the UPDATE CTE,
      // a column this file must execute for real: the DB-free suite can only
      // pin the SQL text and parse a scripted row (novel SQL needs an executed
      // test). The status cache itself is in-memory, so installing a counting
      // reader here observes the busts the real statement produced.
      await seedLink(1, 'changes', { username: 'Old', role: null });
      await seedLink(2, 'identical', {
        username: 'Same',
        joinedAt: '2023-11-14T22:13:20.000Z',
        role: 'mods',
      });
      const reads = new Map<number, number>();
      configureDiscordStatusCache(async (accountId) => {
        reads.set(accountId, (reads.get(accountId) ?? 0) + 1);
        return { link: null, points: 0, lifetimePoints: 0, claimedSwagIds: [], passwordSet: true };
      });
      resetDiscordStatusCacheForTests();
      try {
        await readDiscordStatusCore(1);
        await readDiscordStatusCore(2);
        const result = await setDiscordMemberMetaBulk(pool, [
          { discordUserId: 'changes', nickname: 'New', joinedAtMs: null, roleKey: null },
          {
            discordUserId: 'identical',
            nickname: 'Same',
            joinedAtMs: 1_700_000_000_000,
            roleKey: 'mods',
          },
          { discordUserId: 'nolink', nickname: 'Ghost', joinedAtMs: null, roleKey: null },
        ]);
        expect(result).toEqual({ changed: 1, skipped: 1, unapplied: ['nolink'] });
        await readDiscordStatusCore(1);
        await readDiscordStatusCore(2);
        // The changed row's account refreshed; the skipped account kept its
        // snapshot (the statement returned account id 1 and only 1).
        expect(reads.get(1)).toBe(2);
        expect(reads.get(2)).toBe(1);
      } finally {
        resetDiscordStatusCacheForTests();
      }
    });

    it('writes NO row version when the incoming values already match', async () => {
      // The phase's biggest database win, proved rather than asserted: the old
      // loop wrote a tuple for every member on every sweep.
      //
      // WHICH ASSERTION IS LOAD-BEARING, stated plainly because an earlier draft
      // of this comment got it wrong. `changed` is the decisive one: it is not a
      // counter kept beside the write, it IS count(*) over the UPDATE's RETURNING,
      // so no mutation of this statement can make a row rewrite while `changed`
      // stays 0. Mutation-checked in Phase 4 QA: stripping the UPDATE's predicate
      // reds the `changed` line, and it reds FIRST, before either xmin line runs.
      //
      // The xmin pair is therefore DEFENSE IN DEPTH, kept deliberately rather than
      // mistaken for the proof. It checks the tuple version directly, so it is the
      // only thing here that would catch a rewrite arriving from OUTSIDE this
      // statement (a trigger, a second statement added later, an ON UPDATE side
      // effect), which `changed` by construction cannot see. It is also sampled
      // ACROSS the push rather than twice afterwards: two consecutive reads with
      // nothing in between, as the first draft had, compare a value with itself
      // and can never fail.
      //
      // pg_stat_xact_user_tables is deliberately NOT used, and the reason is NOT
      // that it reads zero. That was this session's first guess and a direct probe
      // against Postgres 16.2 disproved it: the view emits one row per user table
      // (so a ?? 0 fallback never fires) and the counter really did move 0 to 1
      // across two separate autocommit pool.query calls with an UPDATE between
      // them, because a backend accumulates pending per-relation stats locally and
      // flushes them at most once a second. It was dropped because that makes it
      // TIMING-dependent: it only reads that way while node-postgres keeps handing
      // back the same idle backend and while the flush window has not turned over,
      // so it can both miss a write and red without one. xmin straddling the write
      // proves the same property deterministically.
      await seedLink(1, 'identical', {
        username: 'Same',
        joinedAt: '2023-11-14T22:13:20.000Z',
        role: 'mods',
      });
      const record = {
        discordUserId: 'identical',
        nickname: 'Same',
        joinedAtMs: 1_700_000_000_000,
        roleKey: 'mods',
      };
      await setDiscordMemberMetaBulk(pool, [record]);

      const xminBefore = (
        await pool.query("SELECT xmin::text FROM discord_links WHERE discord_user_id = 'identical'")
      ).rows[0].xmin;
      const second = await setDiscordMemberMetaBulk(pool, [record]);
      const xminAfter = (
        await pool.query("SELECT xmin::text FROM discord_links WHERE discord_user_id = 'identical'")
      ).rows[0].xmin;

      expect(second).toEqual({ changed: 0, skipped: 1, unapplied: [] });
      expect(xminAfter).toBe(xminBefore);

      // Non-vacuous: the SAME sampling, straddling a push that really does move a
      // value, MUST show a new row version. Without this the pin above could hold
      // simply because xmin never moves for any reason the test can produce.
      const moved = await setDiscordMemberMetaBulk(pool, [{ ...record, nickname: 'Moved' }]);
      const xminMoved = (
        await pool.query("SELECT xmin::text FROM discord_links WHERE discord_user_id = 'identical'")
      ).rows[0].xmin;
      expect(moved).toEqual({ changed: 1, skipped: 0, unapplied: [] });
      expect(xminMoved).not.toBe(xminBefore);
    });

    it('treats a NULL-to-NULL column as unchanged, not as a difference', async () => {
      // This is what IS DISTINCT FROM buys over <>: with plain inequality, NULL
      // comparisons are NULL, the predicate never holds, and NOTHING would ever
      // update. Seeded with every nullable field null and pushed the same way.
      await seedLink(1, 'allnull');
      const result = await setDiscordMemberMetaBulk(pool, [
        { discordUserId: 'allnull', nickname: null, joinedAtMs: null, roleKey: null },
      ]);
      expect(result).toEqual({ changed: 0, skipped: 1, unapplied: [] });
    });

    it('clears a role with null but never clears a name or join date', async () => {
      // discord_role is assigned unconditionally, the other two ride COALESCE.
      await seedLink(1, 'member', {
        username: 'Keep',
        joinedAt: '2023-11-14T22:13:20.000Z',
        role: 'mods',
      });
      const result = await setDiscordMemberMetaBulk(pool, [
        { discordUserId: 'member', nickname: null, joinedAtMs: null, roleKey: null },
      ]);
      expect(result.changed).toBe(1);
      const row = await pool.query(
        'SELECT discord_username, discord_joined_at, discord_role FROM discord_links',
      );
      expect(row.rows[0].discord_username).toBe('Keep');
      expect(row.rows[0].discord_joined_at).not.toBeNull();
      expect(row.rows[0].discord_role).toBeNull();
    });

    it('stores the exact instant a joinedAtMs names, epoch included', async () => {
      await seedLink(1, 'epoch');
      await setDiscordMemberMetaBulk(pool, [
        { discordUserId: 'epoch', nickname: null, joinedAtMs: 0, roleKey: null },
      ]);
      const row = await pool.query(
        "SELECT to_char(discord_joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS') AS iso FROM discord_links",
      );
      // 0 is a real instant, not a missing value: it must not COALESCE away.
      expect(row.rows[0].iso).toBe('1970-01-01T00:00:00.000');
    });

    it('survives an out-of-range joinedAtMs without losing the rest of the batch', async () => {
      // The static suite proves the binding is null; this proves Postgres accepts
      // the resulting array and the other two records still apply.
      await seedLink(1, 'aaa-first');
      await seedLink(2, 'mmm-bad');
      await seedLink(3, 'zzz-last');
      const result = await setDiscordMemberMetaBulk(pool, [
        { discordUserId: 'aaa-first', nickname: 'A', joinedAtMs: 1_700_000_000_000, roleKey: null },
        { discordUserId: 'mmm-bad', nickname: 'B', joinedAtMs: 1e20, roleKey: null },
        { discordUserId: 'zzz-last', nickname: 'C', joinedAtMs: 1_700_000_000_001, roleKey: null },
      ]);
      // Note what this DECIDES, not just what it observes: an unusable joinedAtMs is
      // a silent coercion. The record is still counted in `changed` (its nickname
      // moved), it is NOT reported in `unapplied`, and COALESCE leaves whatever join
      // date was already stored alone. So a caller cannot distinguish "we kept your
      // old join date" from "we accepted the one you sent". That is the deliberate
      // choice (the alternative aborts the whole batch, the failure this helper
      // exists to prevent) and it is written down here so it stays a choice.
      expect(result).toEqual({ changed: 3, skipped: 0, unapplied: [] });
      const bad = await pool.query(
        "SELECT discord_joined_at FROM discord_links WHERE discord_user_id = 'mmm-bad'",
      );
      expect(bad.rows[0].discord_joined_at).toBeNull();
    });

    it('classifies a full 1000-record push in ONE executed statement', async () => {
      // TITLE SCOPE, deliberate. An earlier title also claimed "uses the unique
      // index", which this body never checked and MUST NOT: discord_links holds
      // 200 freshly-ANALYZEd rows here, so a hash join over a Seq Scan is the
      // correct and cheapest plan, and a "no Seq Scan" assertion would red on the
      // optimal plan rather than on a regression. The read test next door can pin
      // a plan because its LATERAL forbids pull-up at any table size; this
      // statement has no such invariant, so the honest pin is the executed
      // classification plus the statement count, both of which are below.
      for (let i = 1; i <= 200; i++) await seedLink(i, `u${i}`, { username: 'Old' });
      await pool.query('ANALYZE discord_links');
      const records = Array.from({ length: 1000 }, (_, i) => ({
        discordUserId: `u${i + 1}`,
        nickname: 'New',
        joinedAtMs: 1_700_000_000_000,
        roleKey: null,
      }));

      // Counted here too, not only against the fake pool: this is the arm where
      // the statement really executes, so "one statement" and "the counts are
      // right" are proved by the same run rather than by two separate rigs.
      let statements = 0;
      const countingPool = {
        query: (sql: string, params: unknown[]) => {
          statements++;
          return pool.query(sql, params as never[]);
        },
      } as unknown as Pool;
      const result = await setDiscordMemberMetaBulk(countingPool, records);
      expect(statements).toBe(1);
      // 200 linked rows change; the other 800 ids have no link row.
      expect(result.changed).toBe(200);
      expect(result.skipped).toBe(0);
      expect(result.unapplied).toHaveLength(800);
      expect(result.unapplied).toContain('u201');
      expect(result.unapplied).not.toContain('u200');
    });
  });

  // -------------------------------------------------------------------------
  // discordFlexRowsForDiscordIds
  // -------------------------------------------------------------------------

  describe('discordFlexRowsForDiscordIds', () => {
    it('returns the top character, the reward totals, and nothing for unlinked ids', async () => {
      await seedLink(1, 'du1', { username: 'coolguy' });
      await pool.query(
        'INSERT INTO reward_points (account_id, points, lifetime_points) VALUES (1, 1500, 2000)',
      );
      // Three characters: the top one is the highest level, and the tie-break
      // below it is lifetime XP, so the ordering rule is actually exercised.
      await pool.query(
        `INSERT INTO characters (account_id, name, class, level, state, realm) VALUES
           (1, 'Low', 'mage', 10, '{"level":10,"lifetimeXp":50}'::jsonb, $1),
           (1, 'Hero', 'warrior', 40, '{"level":40,"lifetimeXp":900}'::jsonb, $1),
           (1, 'Mid', 'rogue', 40, '{"level":40,"lifetimeXp":100}'::jsonb, $1)`,
        [REALM],
      );

      const rows = await discordFlexRowsForDiscordIds(pool, ['du1', 'never-linked'], REALM);

      expect(rows).toEqual([
        {
          discord_user_id: 'du1',
          account_id: 1,
          discord_username: 'coolguy',
          points: 1500,
          lifetime_points: 2000,
          character_name: 'Hero',
          character_class: 'warrior',
          character_level: 40,
        },
      ]);
    });

    it('answers for a linked account with no characters and no reward row', async () => {
      // Both LEFT JOINs proved at once: the row must still come back, zeroed.
      await seedLink(2, 'du2');
      const rows = await discordFlexRowsForDiscordIds(pool, ['du2'], REALM);
      expect(rows).toEqual([
        {
          discord_user_id: 'du2',
          account_id: 2,
          discord_username: null,
          points: 0,
          lifetime_points: 0,
          character_name: null,
          character_class: null,
          character_level: null,
        },
      ]);
    });

    it('scopes the top character to the realm', async () => {
      await seedLink(1, 'du1');
      await pool.query(
        `INSERT INTO characters (account_id, name, class, level, state, realm) VALUES
           (1, 'Foreign', 'mage', 60, '{"level":60}'::jsonb, 'otherrealm'),
           (1, 'Local', 'warrior', 5, '{"level":5}'::jsonb, $1)`,
        [REALM],
      );
      const rows = await discordFlexRowsForDiscordIds(pool, ['du1'], REALM);
      // The level-60 character on another realm must not win.
      expect(rows[0].character_name).toBe('Local');
      expect(rows[0].character_level).toBe(5);
    });

    it('prefers the state level over the column and tolerates a malformed one', async () => {
      // The guard the static suite can only pin as text. A float, a string and a
      // missing key each fall back rather than raising, and one bad row must not
      // deny the read for every OTHER member in the batch.
      await seedLink(1, 'num');
      await seedLink(2, 'float');
      await seedLink(3, 'text');
      await seedLink(4, 'missing');
      await pool.query(
        `INSERT INTO characters (account_id, name, class, level, state, realm) VALUES
           (1, 'Num', 'warrior', 3, '{"level":41}'::jsonb, $1),
           (2, 'Float', 'warrior', 7, '{"level":41.6}'::jsonb, $1),
           (3, 'Text', 'warrior', 9, '{"level":"boom"}'::jsonb, $1),
           (4, 'Missing', 'warrior', 11, '{}'::jsonb, $1)`,
        [REALM],
      );

      const rows = await discordFlexRowsForDiscordIds(
        pool,
        ['num', 'float', 'text', 'missing'],
        REALM,
      );
      const byId = new Map(rows.map((r) => [r.discord_user_id, r.character_level]));
      expect(rows).toHaveLength(4);
      expect(byId.get('num')).toBe(41); // state wins over the column
      expect(byId.get('float')).toBe(42); // numeric cast, rounded, never a raise
      expect(byId.get('text')).toBe(9); // not a JSON number: fall back to column
      expect(byId.get('missing')).toBe(11); // absent key: fall back to column
    });

    it('probes the character index once per id and never re-scans per row', async () => {
      // The scaling claim, planned rather than argued. Seeded AT the packet's D18
      // scale envelope (5,000 guild members, three characters each, so 15,000
      // character rows) rather than at a convenient fraction of it, so the planner
      // chooses against statistics the size production will actually show it. These
      // are also the numbers the Phase 4 note reports its 6.6 ms measurement at; an
      // earlier draft seeded 2,000 and 6,000, so the committed fixture did not even
      // stand at the envelope the note quotes. It still does not REPRODUCE that
      // figure and is not meant to: the statement here runs under EXPLAIN ANALYZE,
      // whose per-node instrumentation makes its Execution Time incomparable to a
      // production timing. What the fixture buys is the right planner inputs.
      //
      // The two Actual Loops pins below are table-size sensitive by nature, so this
      // seeding is part of their contract rather than incidental: re-run this file
      // against a real Postgres after changing either number. Verified green at
      // 5000/15000 in Phase 4 QA.
      await pool.query('INSERT INTO accounts (id) SELECT g FROM generate_series(1, 5000) g');
      await pool.query(
        `INSERT INTO discord_links (account_id, discord_user_id)
         SELECT g, 'du' || g FROM generate_series(1, 5000) g`,
      );
      // The 1000 REQUESTED accounts carry production-shaped state: an
      // incompressible ~32 KiB filler that forces TOAST storage, because the
      // LATERAL's level projection and lifetimeXp ORDER BY read c.state and
      // therefore detoast it for EVERY candidate row before LIMIT 1 discards
      // all but one. A two-key state that stays inline (the fixture's earlier
      // shape) proves the plan SHAPE while silently measuring none of that
      // detoast cost, which at the cap is the statement's real weight (~3000
      // TOAST fetches per request). Incompressible on purpose: pglz collapses
      // a repeat() filler back under the inline threshold.
      await pool.query(
        `INSERT INTO characters (account_id, name, class, level, state, realm)
         SELECT g, 'C' || g || '_' || s, 'warrior', (g % 20) + 1,
                jsonb_build_object(
                  'level', (g % 20) + 1,
                  'lifetimeXp', g * 10,
                  'pad', CASE WHEN g <= 1000
                              THEN (SELECT string_agg(md5(g::text || s::text || i::text), '')
                                      FROM generate_series(1, 1000) i)
                              ELSE NULL END
                ), $1
           FROM generate_series(1, 5000) g, generate_series(1, 3) s`,
        [REALM],
      );
      await pool.query('ANALYZE discord_links, characters, reward_points');
      const ids = Array.from({ length: 1000 }, (_, i) => `du${i + 1}`);

      // The raw statement at the cap, timed WITHOUT EXPLAIN instrumentation
      // (whose per-node timers make Execution Time incomparable): the whole
      // batch, detoast included, must land far inside DB_STATEMENT_TIMEOUT_MS
      // (15 s), because the statement rides the session default with no
      // runWithStatementTimeout allowance and holds one of the ten pool
      // clients for its whole duration. The bound is generous (a slow laptop
      // passes with a wide margin; measured 38 ms here, 54k shared-hit buffers)
      // so it reds only on a structural regression, e.g. the LATERAL starting
      // to detoast the whole table's state rather than the requested accounts'.
      const rawStart = Date.now();
      const rawRows = await discordFlexRowsForDiscordIds(pool, ids, REALM);
      const rawMs = Date.now() - rawStart;
      expect(rawRows).toHaveLength(1000);
      expect(rawMs).toBeLessThan(10_000);

      // Capture the statement the MODULE actually issues, then explain exactly
      // that. Re-typing the SQL here would pin a copy that can drift away from
      // the one that ships.
      let captured = '';
      const capturingPool = {
        query: (sql: string, params: unknown[]) => {
          captured = sql;
          return pool.query(sql, params as never[]);
        },
      } as unknown as Pool;
      const rows = await discordFlexRowsForDiscordIds(capturingPool, ids, REALM);
      expect(rows).toHaveLength(1000);

      const explain = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`, [
        ids,
        REALM,
      ]);
      const planRoot = explain.rows[0]['QUERY PLAN'][0];
      // Recorded, not only bounded: the measured figures are the evidence the
      // detoast-cost review asked for, and re-running this file after a change
      // to the statement or the fixture is how the next number gets recorded.
      console.log(
        `[flex-batch @${ids.length} ids, TOASTed state] raw ${rawMs} ms; ` +
          `EXPLAIN execution ${planRoot['Execution Time']} ms, ` +
          `shared hit ${planRoot.Plan['Shared Hit Blocks']}, ` +
          `read ${planRoot.Plan['Shared Read Blocks']}`,
      );
      const nodes = planNodes(planRoot.Plan);

      // The LATERAL's LIMIT 1 forbids pull-up, so the shape must be a nested loop
      // whose inner side reaches characters THROUGH THE INDEX. The assertion is
      // deliberately on "index-driven, never a seq scan" rather than on one node
      // type: Postgres legitimately picks Index Scan or Bitmap Heap Scan here
      // depending on statistics, and pinning either one would red on a planner
      // choice that is not a regression. A Seq Scan WOULD be one, because it
      // reads the whole character table once per requested id.
      const charNodes = nodes.filter((n) => String(n['Relation Name']) === 'characters');
      expect(charNodes.length).toBeGreaterThan(0);
      expect(charNodes.map((n) => String(n['Node Type']))).not.toContain('Seq Scan');
      expect(nodes.some((n) => String(n['Index Name']) === 'characters_account')).toBe(true);
      expect(nodes.some((n) => String(n['Node Type']) === 'Nested Loop')).toBe(true);

      // One probe per requested id, not per id times anything. This is the
      // property that makes the endpoint linear rather than quadratic; a plan
      // that re-scanned per outer row would blow past it.
      const charHeap = charNodes.find((n) => Number(n['Actual Loops']) > 1);
      expect(Number(charHeap?.['Actual Loops'])).toBe(1000);

      // discord_links itself is read ONCE for the whole batch, whichever scan the
      // planner picks for it (at this table size a seq scan is the cheap and
      // correct choice, so the assertion is on the loop count, not the node type).
      const linkScan = nodes.find((n) => String(n['Relation Name']) === 'discord_links');
      expect(Number(linkScan?.['Actual Loops'])).toBe(1);
    }, 120_000);
  });

  // -------------------------------------------------------------------------
  // discordLinksForAccounts (the outbox drain's one identity read)
  // -------------------------------------------------------------------------

  describe('discordLinksForAccounts', () => {
    it('answers a mixed present/absent account set with the right rows', async () => {
      await seedLink(1, 'du1', { username: 'One' });
      await seedLink(2, 'du2', { username: 'Two' });

      const rows = await discordLinksForAccounts(pool, [1, 2, 999]);

      expect(rows.map((r) => r.account_id).sort((a, b) => a - b)).toEqual([1, 2]);
      const one = rows.find((r) => r.account_id === 1);
      expect(one?.discord_user_id).toBe('du1');
      expect(one?.discord_username).toBe('One');
      // Exactly the identity columns the outbox enriches with, proved against a
      // real row rather than only against the statement text: discord_email is
      // NOT among them, so a drain resolving thousands of accounts never
      // materializes their email addresses. Narrowed further in the Phase 5 QA
      // round: guild_member and linked_at were dead payload no consumer read.
      expect(Object.keys(one ?? {}).sort()).toEqual([
        'account_id',
        'discord_avatar',
        'discord_user_id',
        'discord_username',
      ]);
      // 999 has no link row and produces no row rather than a null-filled one.
      expect(rows.some((r) => r.account_id === 999)).toBe(false);
    });

    it('reads the whole account set through the primary-key index in ONE pass', async () => {
      // Seeded AT the packet's D18 envelope (5,000 linked guild members) rather
      // than at a convenient fraction, so the planner decides against statistics
      // production will really show it. That size is load-bearing in both
      // directions and was measured, not assumed: at this table size a 50-id ask
      // plans an Index Scan on discord_links_pkey, while a 200-id ask over the
      // same 5,000 rows correctly plans a Seq Scan (1% of the table is worth an
      // index probe, 4% is not). So the pin below is on the SAMPLE-SIZED read,
      // and it deliberately asserts the index is used rather than that no Seq
      // Scan exists anywhere: at a larger ask a seq scan is the cheap and correct
      // plan, and pinning against it would red on the optimal choice.
      //
      // What a regression here WOULD look like: the loop count moving off 1, i.e.
      // a plan that touches discord_links once per requested id instead of once
      // for the whole set. That is the property making the outbox drain flat.
      await pool.query('INSERT INTO accounts (id) SELECT g FROM generate_series(1, 5000) g');
      await pool.query(
        `INSERT INTO discord_links (account_id, discord_user_id, discord_username, discord_avatar)
         SELECT g, 'du' || g, 'un' || g, 'av' || g FROM generate_series(1, 5000) g`,
      );
      await pool.query('ANALYZE discord_links');

      // 50 accounts spread across the table, plus three that were never linked,
      // plus a repeat of the first (the de-duplication is what keeps the bound
      // array the size the plan is costed for).
      const present = Array.from({ length: 50 }, (_, i) => i * 97 + 1);
      const requested = [...present, 90_001, 90_002, 90_003, present[0]];

      // Capture the statement the MODULE issues, then explain exactly that:
      // re-typing the SQL here would pin a copy free to drift from what ships.
      let captured = '';
      const capturingPool = {
        query: (sql: string, params: unknown[]) => {
          captured = sql;
          return pool.query(sql, params as never[]);
        },
      } as unknown as Pool;
      const rows = await discordLinksForAccounts(capturingPool, requested);
      expect(rows).toHaveLength(50);
      expect(rows.map((r) => r.account_id).sort((a, b) => a - b)).toEqual(present);

      const explain = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`, [
        [...new Set(requested)],
      ]);
      const nodes = planNodes(explain.rows[0]['QUERY PLAN'][0].Plan);

      expect(nodes.some((n) => String(n['Index Name']) === 'discord_links_pkey')).toBe(true);
      const linkScan = nodes.find((n) => String(n['Relation Name']) === 'discord_links');
      expect(Number(linkScan?.['Actual Loops'])).toBe(1);
      expect(Number(linkScan?.['Actual Rows'])).toBe(50);
    }, 120_000);

    it('stays a ONE-PASS read at the outbox page size of 1000 ids', async () => {
      // The ask the endpoint really makes. server/internal.ts pages the
      // link-change drain at OUTBOX_LINK_CHANGE_PAGE (1000), and a poll can also
      // mention relay issuers and activity participants, so 1000 ids over the
      // 5,000-row D18 envelope is the size the plan has to hold up at, not the
      // 50-id sample the case above pins.
      //
      // WHAT IS ASSERTED, and what deliberately is NOT. Only Actual Loops === 1:
      // the flatness property that makes a drain cost one pass rather than one
      // probe per id. At 20% selectivity the planner correctly picks a Seq Scan,
      // so a "no Seq Scan" or an index-name assertion here would red on the
      // OPTIMAL plan; the index pin stays on the 50-id case above, where an index
      // probe is what the planner should and does choose.
      await pool.query('INSERT INTO accounts (id) SELECT g FROM generate_series(1, 5000) g');
      await pool.query(
        `INSERT INTO discord_links (account_id, discord_user_id, discord_username, discord_avatar)
         SELECT g, 'du' || g, 'un' || g, 'av' || g FROM generate_series(1, 5000) g`,
      );
      await pool.query('ANALYZE discord_links');

      const requested = Array.from({ length: 1000 }, (_, i) => i + 1);
      let captured = '';
      const capturingPool = {
        query: (sql: string, params: unknown[]) => {
          captured = sql;
          return pool.query(sql, params as never[]);
        },
      } as unknown as Pool;
      const rows = await discordLinksForAccounts(capturingPool, requested);
      expect(rows).toHaveLength(1000);

      const explain = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${captured}`, [requested]);
      const nodes = planNodes(explain.rows[0]['QUERY PLAN'][0].Plan);

      const linkScan = nodes.find((n) => String(n['Relation Name']) === 'discord_links');
      // Non-vacuous: the statement really did touch the table it is planned over.
      expect(linkScan).toBeDefined();
      expect(Number(linkScan?.['Actual Loops'])).toBe(1);
      expect(Number(linkScan?.['Actual Rows'])).toBe(1000);
    }, 120_000);
  });
});
