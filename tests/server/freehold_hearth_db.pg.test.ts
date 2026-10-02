// The EXECUTED proof for server/freehold_hearth_db.ts against real PostgreSQL
// (the novel-SQL rule: a fake client cannot tell whether the DDL parses,
// whether two same-account entries really serialize, whether a rollback really
// leaves the counters alone, or whether GREATEST really clamps a replayed
// epoch). The PG16 shard provides TEST_DATABASE_URL; a local run without it
// skips and the always-on text pins in freehold_hearth_db.test.ts still stand.
//
// The FK parents are MINIMAL STAND-INS (id-only accounts, plus a characters
// table that exists only so the character-deletion arm has something real to
// delete): this suite proves the account_freehold_hearth DDL (with the 07a
// advance token column and its catalog-probed ALTER), the four statements of
// an entry and the verify read, not the core schema, and the production
// parents exist long before ensureSchema reaches this module.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isIdempotentSchemaSkipNotice } from '../../server/schema_notices';

const url = process.env.TEST_DATABASE_URL ?? '';
const d = url === '' ? describe.skip : describe;

// A PRIVATE schema, the repo idiom for every database-gated suite. It is not
// tidiness: this suite DROPS its schema in both beforeAll and afterAll, and the
// module functions it drives issue UNQUALIFIED SQL, so without an isolated
// search_path a developer who points TEST_DATABASE_URL at a database that
// already carries the game schema (the documented dev database is on the same
// 127.0.0.1:5433 this harness uses) would destroy the REAL
// account_freehold_hearth table. That table is keep-forever by design: every
// dropped row is a free ready Hearth Key for an account that had one on
// cooldown, and nothing can reconstruct it.
const SCHEMA = 'freehold_hearth_pg_test';

const COOLDOWN_MS = 900_000;
const READY_ACCOUNT = 1;
const RACE_ACCOUNT = 2;
const CASCADE_ACCOUNT = 3;
const CHARACTER_ACCOUNT = 4;
const EXPORT_ACCOUNT = 5;
const ROLLBACK_ACCOUNT = 6;
const STALE_ACCOUNT = 7;
const FIRST_USE_RACE_ACCOUNT = 8;
const CHECK_ACCOUNT = 9;
const ROW_LOCK_RACE_ACCOUNT = 10;
const NUMERIC_PARSER_ACCOUNT = 11;
const CORRUPT_ACCOUNT = 12;
const BOUNDARY_ACCOUNT = 13;
const TOKEN_ACCOUNT = 14;
const CLOCK_RACE_ACCOUNT = 15;
const SECOND_ADVANCE_ACCOUNT = 16;
const ACK_LOST_ACCOUNT = 17;

/** A table that predates the advance token, in its own private schema, so the
 *  probe's ALTER arm runs for real without touching the suite's main table. */
const LEGACY_SCHEMA = 'freehold_hearth_pg_test_legacy';

const TOKEN = '0123456789abcdef0123456789abcdef';
const OTHER_TOKEN = 'fedcba9876543210fedcba9876543210';

d('account_freehold_hearth against real PostgreSQL', () => {
  // Imported lazily so the suite skips clean without pg installed state.
  let pool: import('pg').Pool;
  let probe: import('pg').Pool;
  let db: typeof import('../../server/freehold_hearth_db');
  let hearthSchema: string;

  /** The waiter's pid and the statement it is stuck on, or null while nothing
   *  is blocked by `holderPid`. Polled on the WAITER on purpose: a holder's own
   *  pg_stat_activity row reports the last statement it ran and looks frozen
   *  for the rest of its transaction, so it can never tell us who is waiting. */
  async function blockedBy(
    holderPid: number,
  ): Promise<{ pid: number; query: string; waitEvent: string } | null> {
    const waiting = await probe.query(
      `SELECT pid, query, wait_event_type || ':' || COALESCE(wait_event, '') AS wait_event
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name = $1
          AND wait_event_type = 'Lock'
          AND $2::int = ANY(pg_blocking_pids(pid))
        ORDER BY pid
        LIMIT 1`,
      [SCHEMA, holderPid],
    );
    const row = waiting.rows[0];
    return row
      ? { pid: Number(row.pid), query: String(row.query), waitEvent: String(row.wait_event) }
      : null;
  }

  async function waitForBlock(holderPid: number, budgetMs = 5_000) {
    const started = Date.now();
    for (;;) {
      const blocked = await blockedBy(holderPid);
      if (blocked) return { ...blocked, waitedMs: Date.now() - started };
      if (Date.now() - started > budgetMs) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  const backendPid = async (client: import('pg').PoolClient): Promise<number> =>
    Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);

  const readRow = async (accountId: number) =>
    (
      await pool.query(
        `SELECT ready_at_ms::text AS ready_at_ms, revision::text AS revision
           FROM account_freehold_hearth WHERE account_id = $1`,
        [accountId],
      )
    ).rows[0] ?? null;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    db = await import('../../server/freehold_hearth_db');
    // search_path is a STARTUP option so the module functions, which take the
    // pool or a pooled client and issue unqualified SQL, land in the private
    // schema. max 4 covers the race (two contenders) with headroom; the probe
    // pool is separate so polling can never queue behind a blocked contender.
    pool = new Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${SCHEMA}`,
      application_name: SCHEMA,
      statement_timeout: 15_000,
    });
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${LEGACY_SCHEMA} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`CREATE SCHEMA ${LEGACY_SCHEMA}`);
    await admin.end();
    probe = new Pool({
      connectionString: url,
      max: 1,
      options: `-c search_path=${SCHEMA}`,
      application_name: `${SCHEMA}_probe`,
      statement_timeout: 15_000,
    });
    await pool.query('CREATE TABLE accounts (id SERIAL PRIMARY KEY)');
    await pool.query(
      `CREATE TABLE characters (
         id SERIAL PRIMARY KEY,
         account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
       )`,
    );
    await pool.query(
      `INSERT INTO accounts (id)
       VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12), (13), (14), (15),
              (16), (17)`,
    );
    await pool.query('INSERT INTO characters (id, account_id) VALUES (1, $1), (2, $1)', [
      CHARACTER_ACCOUNT,
    ]);
    // The DDL executes for real, TWICE: idempotency is part of the contract
    // (ensureSchema re-runs every fragment at every boot).
    hearthSchema = db.freeholdHearthSchema(SCHEMA);
    await pool.query(hearthSchema);
    await pool.query(hearthSchema);
  }, 30_000);

  afterAll(async () => {
    if (probe) await probe.end();
    if (!pool) return;
    await pool.end();
    // Drop the whole private schema, never a bare table name: a DROP TABLE here
    // would resolve through whatever search_path the connection ended up with
    // and could take the real table with it.
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${LEGACY_SCHEMA} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  });

  it("runs entirely inside its private schema, never the caller's default", async () => {
    const where = await pool.query('SELECT current_schema() AS s');
    expect(where.rows[0].s).toBe(SCHEMA);
    // SCOPED TO THIS SCHEMA, the way the plot suite beside it already is. An
    // unfiltered catalog query asserts that NO other schema holds a table of
    // this name, which is false on the documented recipe: TEST_DATABASE_URL is
    // pointed at a database that already carries the game schema, so `public`
    // holds one legitimately, and any concurrent tenant holds one too. It went
    // red on exactly that, in a full-suite run where another suite applied the
    // real schema first.
    const owner = await pool.query(
      `SELECT schemaname FROM pg_tables
        WHERE tablename = 'account_freehold_hearth' AND schemaname = current_schema()`,
    );
    expect(owner.rows.map((r: { schemaname: string }) => r.schemaname)).toEqual([SCHEMA]);
    // ANTI-VACUITY for the filter: the unqualified name this suite's own pool
    // resolves must be the private one, which is the property `current_schema()`
    // filtering could otherwise hide.
    const resolved = await pool.query(
      `SELECT n.nspname AS schema
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid = to_regclass('account_freehold_hearth')`,
    );
    expect(resolved.rows[0].schema).toBe(SCHEMA);
  });

  it('applies a third time with no error, and installs exactly one index', async () => {
    await expect(pool.query(hearthSchema)).resolves.toBeTruthy();
    // The primary key IS the foreign key column, so the account delete cascade
    // is already index-backed. A second index here would be dead weight.
    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'account_freehold_hearth'
        ORDER BY indexname`,
      [SCHEMA],
    );
    expect(indexes.rows.map((r: { indexname: string }) => r.indexname)).toEqual([
      'account_freehold_hearth_pkey',
    ]);
    const key = await pool.query(
      `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [`${SCHEMA}.account_freehold_hearth`],
    );
    expect(key.rows.map((r: { attname: string }) => r.attname)).toEqual(['account_id']);
  });

  /** The advance token column and every constraint on the table that names it. */
  const tokenShape = async (schema: string) => {
    const column = await pool.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'account_freehold_hearth'
          AND column_name = 'advance_token'`,
      [schema],
    );
    const constraints = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = $1::regclass AND pg_get_constraintdef(oid) LIKE '%advance_token%'
        ORDER BY conname`,
      [`${schema}.account_freehold_hearth`],
    );
    return { column: column.rows, constraints: constraints.rows };
  };

  it('carries the advance token column and its ONE named constraint after three applications', async () => {
    // The probe text is present (the positive pin the catalog check relies on):
    // without it the fragment could never reach an older table at all.
    expect(hearthSchema).toContain('ADD COLUMN IF NOT EXISTS advance_token');
    // beforeAll applied the fragment twice and the case above a third time.
    expect(await tokenShape(SCHEMA)).toEqual({
      column: [{ data_type: 'text', is_nullable: 'YES', column_default: null }],
      constraints: [
        {
          conname: 'account_freehold_hearth_advance_token_shape',
          def: "CHECK (((advance_token IS NULL) OR (advance_token ~ '^[0-9a-f]{32}$'::text)))",
        },
      ],
    });
  });

  it('refuses a malformed advance token by its named constraint, and accepts the shape', async () => {
    await expect(
      pool.query(
        `INSERT INTO account_freehold_hearth (account_id, advance_token) VALUES ($1, $2)`,
        [CHECK_ACCOUNT, '0123456789ABCDEF0123456789ABCDEF'],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'account_freehold_hearth_advance_token_shape',
    });
    expect(await readRow(CHECK_ACCOUNT)).toBeNull();
    // The contrast arm: the exact shape the advance stamps is accepted.
    await pool.query(
      `INSERT INTO account_freehold_hearth (account_id, advance_token) VALUES ($1, $2)`,
      [CHECK_ACCOUNT, TOKEN],
    );
    expect(await readRow(CHECK_ACCOUNT)).toEqual({ ready_at_ms: '0', revision: '0' });
    await pool.query('DELETE FROM account_freehold_hearth WHERE account_id = $1', [CHECK_ACCOUNT]);
  });

  /** Applies `fragment` while another transaction holds ACCESS SHARE on
   *  `table`, under a short lock_timeout: an ALTER TABLE in the fragment must
   *  wait for ACCESS EXCLUSIVE and so times out (55P03); a fragment that only
   *  reads the catalog completes. */
  const applyBesideAReader = async (fragment: string, table: string) => {
    const reader = await pool.connect();
    const applier = await pool.connect();
    try {
      await reader.query('BEGIN');
      await reader.query(`LOCK TABLE ${table} IN ACCESS SHARE MODE`);
      await applier.query('BEGIN');
      await applier.query("SET LOCAL lock_timeout = '500ms'");
      try {
        await applier.query(fragment);
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, code: (err as { code?: string }).code };
      } finally {
        await applier.query('ROLLBACK');
      }
    } finally {
      await reader.query('ROLLBACK');
      reader.release();
      applier.release();
    }
  };

  it('a reapplication issues NO ALTER: it completes beside a live reader of the table', async () => {
    // A boot that reached the ALTER would queue for ACCESS EXCLUSIVE behind
    // every other realm's open Hearth read. The probe is what lets it pass.
    expect(await applyBesideAReader(hearthSchema, `${SCHEMA}.account_freehold_hearth`)).toEqual({
      ok: true,
    });
  });

  it('adds the column to a table that predates it, once, and then stops issuing the ALTER', async () => {
    // The 07 shape exactly: no advance_token column.
    await pool.query(
      `CREATE TABLE ${LEGACY_SCHEMA}.account_freehold_hearth (
         account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
         ready_at_ms BIGINT NOT NULL DEFAULT 0,
         revision BIGINT NOT NULL DEFAULT 0,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         CONSTRAINT account_freehold_hearth_ready_nonnegative CHECK (ready_at_ms >= 0),
         CONSTRAINT account_freehold_hearth_revision_nonnegative CHECK (revision >= 0)
       )`,
    );
    await pool.query(
      `INSERT INTO ${LEGACY_SCHEMA}.account_freehold_hearth (account_id, ready_at_ms, revision)
       VALUES ($1, 777, 3)`,
      [READY_ACCOUNT],
    );
    expect(await tokenShape(LEGACY_SCHEMA)).toEqual({ column: [], constraints: [] });
    const legacy = db.freeholdHearthSchema(LEGACY_SCHEMA);
    const legacyTable = `${LEGACY_SCHEMA}.account_freehold_hearth`;
    // THE CONTROL for the no-ALTER case above: with the column absent, the
    // fragment DOES reach the ALTER, which cannot pass the live reader.
    expect(await applyBesideAReader(legacy, legacyTable)).toEqual({ ok: false, code: '55P03' });
    expect(await tokenShape(LEGACY_SCHEMA)).toEqual({ column: [], constraints: [] });

    await pool.query(legacy);
    expect(await tokenShape(LEGACY_SCHEMA)).toEqual({
      column: [{ data_type: 'text', is_nullable: 'YES', column_default: null }],
      constraints: [
        {
          conname: 'account_freehold_hearth_advance_token_shape',
          def: "CHECK (((advance_token IS NULL) OR (advance_token ~ '^[0-9a-f]{32}$'::text)))",
        },
      ],
    });
    // The existing row survived with its counters and a NULL token.
    const kept = await pool.query(
      `SELECT ready_at_ms::text AS ready_at_ms, revision::text AS revision, advance_token
         FROM ${legacyTable} WHERE account_id = $1`,
      [READY_ACCOUNT],
    );
    expect(kept.rows).toEqual([{ ready_at_ms: '777', revision: '3', advance_token: null }]);
    // Upgraded once, the next two boots are catalog reads: no ALTER beside a
    // reader, and still exactly one constraint.
    expect(await applyBesideAReader(legacy, legacyTable)).toEqual({ ok: true });
    await pool.query(legacy);
    expect((await tokenShape(LEGACY_SCHEMA)).constraints).toHaveLength(1);
  });

  it('puts back a CHECK the column lost, NOT VALID: new tokens are checked again, old rows are not scanned', async () => {
    // Runs on the table the case above upgraded: the column stays, its named
    // CHECK goes (a hand edit), and a malformed token lands while it is gone.
    const legacy = db.freeholdHearthSchema(LEGACY_SCHEMA);
    const legacyTable = `${LEGACY_SCHEMA}.account_freehold_hearth`;
    await pool.query(
      `ALTER TABLE ${legacyTable} DROP CONSTRAINT account_freehold_hearth_advance_token_shape`,
    );
    await pool.query(`INSERT INTO ${legacyTable} (account_id, advance_token) VALUES ($1, $2)`, [
      CHECK_ACCOUNT,
      'NOT-A-TOKEN',
    ]);
    expect((await tokenShape(LEGACY_SCHEMA)).constraints).toEqual([]);
    // The control: with the CHECK missing, the probe's second arm reaches its
    // ALTER, which cannot pass a live reader.
    expect(await applyBesideAReader(legacy, legacyTable)).toEqual({ ok: false, code: '55P03' });

    await pool.query(legacy);
    expect((await tokenShape(LEGACY_SCHEMA)).constraints).toEqual([
      {
        conname: 'account_freehold_hearth_advance_token_shape',
        def: "CHECK (((advance_token IS NULL) OR (advance_token ~ '^[0-9a-f]{32}$'::text))) NOT VALID",
      },
    ]);
    // The old row was never scanned: it is still there, as written.
    const kept = await pool.query(
      `SELECT advance_token FROM ${legacyTable} WHERE account_id = $1`,
      [CHECK_ACCOUNT],
    );
    expect(kept.rows).toEqual([{ advance_token: 'NOT-A-TOKEN' }]);
    // Every NEW token is checked again, on an update as on an insert.
    await expect(
      pool.query(`UPDATE ${legacyTable} SET advance_token = $2 WHERE account_id = $1`, [
        READY_ACCOUNT,
        '0123456789ABCDEF0123456789ABCDEF',
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'account_freehold_hearth_advance_token_shape',
    });
    await pool.query(`UPDATE ${legacyTable} SET advance_token = $2 WHERE account_id = $1`, [
      READY_ACCOUNT,
      TOKEN,
    ]);
    // Repaired once, the next boot is a catalog read again with one CHECK.
    expect(await applyBesideAReader(legacy, legacyTable)).toEqual({ ok: true });
    await pool.query(legacy);
    expect((await tokenShape(LEGACY_SCHEMA)).constraints).toHaveLength(1);
    await pool.query(`DELETE FROM ${legacyTable} WHERE account_id = $1`, [CHECK_ACCOUNT]);
  });

  it('warns, never fails the boot, when a same-named constraint is not THIS check, and only then', async () => {
    const legacy = db.freeholdHearthSchema(LEGACY_SCHEMA);
    const legacyTable = `${LEGACY_SCHEMA}.account_freehold_hearth`;
    const WARNING =
      'account_freehold_hearth_advance_token_shape is not the 32-hex token CHECK, so the advance token shape is unchecked';
    const VALID_DEF =
      "CHECK (((advance_token IS NULL) OR (advance_token ~ '^[0-9a-f]{32}$'::text)))";
    /** One boot on its own client, every notice it raised kept whole. */
    const boot = async (sql: string) => {
      const client = await pool.connect();
      const notices: Array<{
        severity?: string;
        message?: string;
        code?: string;
        routine?: string;
      }> = [];
      const onNotice = (notice: (typeof notices)[number]) => notices.push(notice);
      client.on('notice', onNotice);
      try {
        await client.query(sql);
      } finally {
        client.off('notice', onNotice);
        client.release();
      }
      return notices.filter((notice) => notice.severity === 'WARNING');
    };
    /** The named constraint's whole definition, whatever it mentions. */
    const namedDefs = async () =>
      (
        await pool.query(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = $1::regclass
              AND conname = 'account_freehold_hearth_advance_token_shape'`,
          [legacyTable],
        )
      ).rows.map((row: { def: string }) => row.def);
    const replaceWith = async (definition: string) => {
      await pool.query(
        `ALTER TABLE ${legacyTable} DROP CONSTRAINT account_freehold_hearth_advance_token_shape`,
      );
      await pool.query(
        `ALTER TABLE ${legacyTable} ADD CONSTRAINT account_freehold_hearth_advance_token_shape ${definition}`,
      );
    };

    // The main table holds its validated CHECK, so the silent boots of it
    // below run the warning arm, not a repair.
    expect((await tokenShape(SCHEMA)).constraints).toEqual([
      { conname: 'account_freehold_hearth_advance_token_shape', def: VALID_DEF },
    ]);
    // Each impostor alone: another type, then a CHECK with another body. The
    // boot completes (no 42710), says the shape is unchecked, and leaves it.
    for (const definition of ['UNIQUE (advance_token)', 'CHECK (true)']) {
      await replaceWith(definition);
      const warnings = await boot(legacy);
      expect(
        warnings.map((notice) => notice.message),
        definition,
      ).toEqual([WARNING]);
      // The boot log's own filter forwards it (server/schema_notices.ts drops
      // only the idempotent-DDL skips, by code and reporting routine).
      expect(isIdempotentSchemaSkipNotice(warnings[0]), definition).toBe(false);
      expect(await namedDefs()).toEqual([definition]);
      // The arm reads only its OWN table: the main schema's healthy CHECK stays
      // silent while the legacy table holds the impostor.
      expect(await boot(hearthSchema), definition).toEqual([]);
    }
    // The controls, each SILENT: with the impostor gone the next boot puts the
    // CHECK back NOT VALID, and a boot over that repaired CHECK, or over the
    // validated one the table was created with, warns about nothing. The last
    // two prove the arm's literal is PostgreSQL's own text for the real CHECK.
    await pool.query(
      `ALTER TABLE ${legacyTable} DROP CONSTRAINT account_freehold_hearth_advance_token_shape`,
    );
    expect(await boot(legacy)).toEqual([]);
    expect((await tokenShape(LEGACY_SCHEMA)).constraints).toEqual([
      { conname: 'account_freehold_hearth_advance_token_shape', def: `${VALID_DEF} NOT VALID` },
    ]);
    expect(await boot(legacy)).toEqual([]);
    expect((await tokenShape(SCHEMA)).constraints).toEqual([
      { conname: 'account_freehold_hearth_advance_token_shape', def: VALID_DEF },
    ]);
    expect(await boot(hearthSchema)).toEqual([]);
  });

  it("a steady boot's one Hearth table lock is the token probe's: it waits behind ACCESS EXCLUSIVE and is held to no COMMIT", async () => {
    // Deparsing the CHECK opens the table under ACCESS SHARE and releases it at
    // once. So a boot waits there behind an ACCESS EXCLUSIVE holder or a queued
    // ACCESS EXCLUSIVE request (operator DDL), and inside the boot transaction
    // it holds no lock on the table after.
    const table = `${SCHEMA}.account_freehold_hearth`;
    // The precondition: the table is in its steady state, so the boot runs the
    // probe's warning arm and no repair arm.
    expect((await tokenShape(SCHEMA)).constraints).toEqual([
      {
        conname: 'account_freehold_hearth_advance_token_shape',
        def: "CHECK (((advance_token IS NULL) OR (advance_token ~ '^[0-9a-f]{32}$'::text)))",
      },
    ]);
    const modes = async (client: import('pg').PoolClient, granted: boolean, pid?: number) =>
      (
        await client.query(
          `SELECT mode FROM pg_locks
            WHERE relation = $1::regclass AND granted = $2 AND ($3::int IS NULL OR pid = $3)`,
          [table, granted, pid ?? null],
        )
      ).rows.map((row: { mode: string }) => row.mode);
    const holder = await pool.connect();
    try {
      const booter = await pool.connect();
      try {
        const queuer = await pool.connect();
        try {
          // A HOLDER: the boot waits, in the probe's ACCESS SHARE, inside the DO
          // block's deparse, and a lock timeout ends it with 55P03.
          await holder.query('BEGIN');
          await holder.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
          await booter.query('BEGIN');
          const waiting = booter.query(hearthSchema).then(
            () => null,
            (error: unknown) => error,
          );
          await vi.waitFor(async () =>
            expect(await modes(queuer, false)).toEqual(['AccessShareLock']),
          );
          await holder.query('ROLLBACK');
          expect(await waiting).toBeNull();
          await booter.query('ROLLBACK');
          await holder.query('BEGIN');
          await holder.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
          await booter.query('BEGIN');
          await booter.query("SET LOCAL lock_timeout = '300ms'");
          const held = await booter.query(hearthSchema).catch((error: unknown) => error);
          expect(held).toMatchObject({ code: '55P03' });
          expect(String((held as { where?: string }).where)).toMatch(
            /pg_get_constraintdef[\s\S]*inline_code_block/,
          );
          await booter.query('ROLLBACK');
          await holder.query('ROLLBACK');
          // A QUEUED REQUEST: a writer's ROW EXCLUSIVE alone does not stop the
          // boot, but an ACCESS EXCLUSIVE request queued behind it does.
          await holder.query('BEGIN');
          await holder.query(`LOCK TABLE ${table} IN ROW EXCLUSIVE MODE`);
          await booter.query('BEGIN');
          await booter.query("SET LOCAL lock_timeout = '300ms'");
          await booter.query(hearthSchema);
          await booter.query('ROLLBACK');
          await queuer.query('BEGIN');
          const queued = queuer.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
          await vi.waitFor(async () =>
            expect(await modes(holder, false)).toEqual(['AccessExclusiveLock']),
          );
          await booter.query('BEGIN');
          await booter.query("SET LOCAL lock_timeout = '300ms'");
          await expect(booter.query(hearthSchema)).rejects.toMatchObject({ code: '55P03' });
          await booter.query('ROLLBACK');
          await holder.query('ROLLBACK');
          await queued;
          await queuer.query('ROLLBACK');
          // NOTHING HELD: with no holder the boot completes and keeps no lock on
          // the table inside its still-open transaction; the positive control
          // shows the same read sees a lock that IS held.
          await booter.query('BEGIN');
          await booter.query(hearthSchema);
          const pid = (await booter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
          expect(await modes(queuer, true, pid)).toEqual([]);
          await booter.query(`LOCK TABLE ${table} IN ACCESS SHARE MODE`);
          expect(await modes(queuer, true, pid)).toEqual(['AccessShareLock']);
          await booter.query('ROLLBACK');
        } finally {
          await queuer.query('ROLLBACK').catch(() => {});
          queuer.release();
        }
      } finally {
        await booter.query('ROLLBACK').catch(() => {});
        booter.release();
      }
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  });

  it("restores the caller's in-flight search_path after the fragment", async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
      await client.query(hearthSchema);
      const after = await client.query('SELECT current_setting($1) AS p', ['search_path']);
      expect(after.rows[0].p).toBe('pg_catalog, pg_temp');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('refuses a negative ready_at_ms, by its named constraint', async () => {
    // One field bad, the other left valid: a single merged constraint would
    // pass one of this pair.
    await expect(
      pool.query(
        `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision)
         VALUES ($1, -1, 0)`,
        [CHECK_ACCOUNT],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'account_freehold_hearth_ready_nonnegative',
    });
    expect(await readRow(CHECK_ACCOUNT)).toBeNull();
  });

  it('refuses a negative revision, by its named constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision)
         VALUES ($1, 0, -1)`,
        [CHECK_ACCOUNT],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'account_freehold_hearth_revision_nonnegative',
    });
    expect(await readRow(CHECK_ACCOUNT)).toBeNull();
  });

  it('accepts the exact row the two check negatives corrupt, then removes it', async () => {
    await pool.query(
      `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision) VALUES ($1, 0, 0)`,
      [CHECK_ACCOUNT],
    );
    expect(await readRow(CHECK_ACCOUNT)).toEqual({ ready_at_ms: '0', revision: '0' });
    await pool.query('DELETE FROM account_freehold_hearth WHERE account_id = $1', [CHECK_ACCOUNT]);
  });

  it('loads truly absent state as absent, and creates no row doing it', async () => {
    expect(await db.loadFreeholdHearth(pool, READY_ACCOUNT)).toEqual({ kind: 'absent' });
    expect(await readRow(READY_ACCOUNT)).toBeNull();
    expect(db.ABSENT_FREEHOLD_HEARTH).toEqual({ readyAtMs: '0', revision: '0' });
  });

  it('initializes lazily from truly absent state and advances, inside one transaction', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query(
        'SELECT count(*)::int AS n FROM account_freehold_hearth WHERE account_id = $1',
        [READY_ACCOUNT],
      );
      expect(before.rows[0].n).toBe(0);
      const advanced = await db.advanceFreeholdHearthOnClient(client, READY_ACCOUNT, COOLDOWN_MS);
      expect(advanced.kind).toBe('advanced');
      if (advanced.kind !== 'advanced') throw new Error('unreachable');
      // First use: revision 0 became 1, and ready_at_ms is the transaction
      // epoch plus the cooldown, to the millisecond.
      expect(advanced.revision).toBe('1');
      expect(BigInt(advanced.readyAtMs)).toBe(BigInt(advanced.nowMs) + BigInt(COOLDOWN_MS));
      // Uncommitted: a fresh connection still sees nothing.
      expect(await readRow(READY_ACCOUNT)).toBeNull();
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    // Commit before acknowledge: the value is visible to a fresh connection.
    const durable = await readRow(READY_ACCOUNT);
    expect(durable).not.toBeNull();
    expect(durable?.revision).toBe('1');
    const load = await db.loadFreeholdHearth(pool, READY_ACCOUNT);
    expect(load).toEqual({
      kind: 'state',
      state: { readyAtMs: durable?.ready_at_ms, revision: '1' },
    });
    // Still on cooldown, so a second entry in a NEW transaction refuses.
    const second = await pool.connect();
    try {
      await second.query('BEGIN');
      const refused = await db.advanceFreeholdHearthOnClient(second, READY_ACCOUNT, COOLDOWN_MS);
      expect(refused.kind).toBe('cooldown');
      await second.query('COMMIT');
    } finally {
      second.release();
    }
    expect(await readRow(READY_ACCOUNT)).toEqual(durable);
  });

  it('leaves both counters exactly as they were when the caller rolls back', async () => {
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      expect((await db.advanceFreeholdHearthOnClient(seed, ROLLBACK_ACCOUNT, 0)).kind).toBe(
        'advanced',
      );
      await seed.query('COMMIT');
    } finally {
      seed.release();
    }
    const before = await readRow(ROLLBACK_ACCOUNT);
    expect(before?.revision).toBe('1');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Cooldown 0, so this one is eligible and really does write.
      const advanced = await db.advanceFreeholdHearthOnClient(client, ROLLBACK_ACCOUNT, 0);
      expect(advanced.kind).toBe('advanced');
      if (advanced.kind !== 'advanced') throw new Error('unreachable');
      expect(advanced.revision).toBe('2');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // The advance rode the caller's transaction and died with it: no revision
    // burned, no ready_at_ms moved.
    expect(await readRow(ROLLBACK_ACCOUNT)).toEqual(before);
  });

  it('serializes a steady-state same-account race: exactly one advances', async () => {
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      expect((await db.advanceFreeholdHearthOnClient(seed, RACE_ACCOUNT, 0)).kind).toBe('advanced');
      await seed.query('COMMIT');
    } finally {
      seed.release();
    }
    const before = await readRow(RACE_ACCOUNT);

    const winner = await pool.connect();
    const loser = await pool.connect();
    try {
      await winner.query('BEGIN');
      await loser.query('BEGIN');
      const winnerPid = await backendPid(winner);
      const loserPid = await backendPid(loser);
      const winnerResult = await db.advanceFreeholdHearthOnClient(
        winner,
        RACE_ACCOUNT,
        COOLDOWN_MS,
      );
      expect(winnerResult.kind).toBe('advanced');

      // The loser now runs the same entry against the same account. It must
      // NOT be allowed to observe the pre-advance row.
      const started = Date.now();
      const loserPromise = db.advanceFreeholdHearthOnClient(loser, RACE_ACCOUNT, COOLDOWN_MS);
      const blocked = await waitForBlock(winnerPid);
      expect(blocked).not.toBeNull();
      expect(blocked?.pid).toBe(loserPid);
      // The row lock in the locking read is what orders two entries. (The
      // accounts participant lock is FOR KEY SHARE and self-compatible by
      // design, which is exactly why it does not block a concurrent character
      // save either.)
      // MEASURED, not assumed: with the winner's UPDATE already written, the
      // loser queues at the conflict-safe INSERT, one statement earlier than
      // the locking read. ON CONFLICT DO NOTHING must wait on the winning
      // transaction id before it can decide whether its conflicting tuple
      // survives. (The accounts participant lock is NOT where the queue forms:
      // FOR KEY SHARE is self-compatible by design, which is exactly why it
      // does not block a concurrent character save either. The row lock in the
      // locking read is the other serialization point, driven on its own
      // below.)
      expect(blocked?.query).toContain('INSERT INTO account_freehold_hearth');
      expect(blocked?.query).toContain('ON CONFLICT (account_id) DO NOTHING');
      expect(blocked?.waitEvent).toBe('Lock:transactionid');

      await winner.query('COMMIT');
      const loserResult = await loserPromise;
      const elapsedMs = Date.now() - started;
      expect(loserResult.kind).toBe('cooldown');
      if (loserResult.kind !== 'cooldown') throw new Error('unreachable');
      if (winnerResult.kind !== 'advanced') throw new Error('unreachable');
      // The loser reads the ADVANCED value, not the value it would have seen
      // before the winner committed.
      expect(loserResult.readyAtMs).toBe(winnerResult.readyAtMs);
      expect(loserResult.revision).toBe(winnerResult.revision);
      expect(loserResult.readyAtMs).not.toBe(before?.ready_at_ms);
      await loser.query('COMMIT');
      // Exactly one advance landed: revision moved by one, not two.
      const after = await readRow(RACE_ACCOUNT);
      expect(after?.revision).toBe(String(BigInt(before?.revision ?? '0') + 1n));
      expect(after?.ready_at_ms).toBe(winnerResult.readyAtMs);
      expect(blocked?.waitedMs).toBeLessThan(5_000);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await winner.query('ROLLBACK').catch(() => {});
      await loser.query('ROLLBACK').catch(() => {});
      winner.release();
      loser.release();
    }
  }, 30_000);

  it('serializes a FIRST-USE same-account race on the conflict-safe insert', async () => {
    expect(await readRow(FIRST_USE_RACE_ACCOUNT)).toBeNull();
    const winner = await pool.connect();
    const loser = await pool.connect();
    try {
      await winner.query('BEGIN');
      await loser.query('BEGIN');
      const winnerPid = await backendPid(winner);
      const loserPid = await backendPid(loser);
      const winnerResult = await db.advanceFreeholdHearthOnClient(
        winner,
        FIRST_USE_RACE_ACCOUNT,
        COOLDOWN_MS,
      );
      expect(winnerResult.kind).toBe('advanced');

      const loserPromise = db.advanceFreeholdHearthOnClient(
        loser,
        FIRST_USE_RACE_ACCOUNT,
        COOLDOWN_MS,
      );
      const blocked = await waitForBlock(winnerPid);
      expect(blocked).not.toBeNull();
      expect(blocked?.pid).toBe(loserPid);
      // With no row yet, the block lands on the speculative insert, one
      // statement earlier than the steady-state race above. Both arms end the
      // same way: exactly one entry advances.
      expect(blocked?.query).toContain('INSERT INTO account_freehold_hearth');
      expect(blocked?.query).toContain('ON CONFLICT (account_id) DO NOTHING');

      await winner.query('COMMIT');
      const loserResult = await loserPromise;
      expect(loserResult.kind).toBe('cooldown');
      if (loserResult.kind !== 'cooldown') throw new Error('unreachable');
      if (winnerResult.kind !== 'advanced') throw new Error('unreachable');
      expect(loserResult.readyAtMs).toBe(winnerResult.readyAtMs);
      expect(loserResult.revision).toBe('1');
      await loser.query('COMMIT');
      expect(await readRow(FIRST_USE_RACE_ACCOUNT)).toEqual({
        ready_at_ms: winnerResult.readyAtMs,
        revision: '1',
      });
    } finally {
      await winner.query('ROLLBACK').catch(() => {});
      await loser.query('ROLLBACK').catch(() => {});
      winner.release();
      loser.release();
    }
  }, 30_000);

  it('serializes on the locking read when the winner has written nothing yet', async () => {
    // The OTHER serialization point, driven deliberately: the winner has taken
    // the participant lock, run the conflict-safe insert and the locking read,
    // and has written NOTHING (exactly the state a refusal leaves behind for
    // the rest of the caller's transaction). A second entry must still not be
    // allowed to observe the row, and this is the arm where the FOR UPDATE row
    // lock, not the insert, is what holds it. The row must already exist and be
    // COMMITTED: with no row, both contenders queue on the speculative insert
    // instead (the first-use arm below), and the row lock never gets its turn.
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      expect((await db.advanceFreeholdHearthOnClient(seed, ROW_LOCK_RACE_ACCOUNT, 0)).kind).toBe(
        'advanced',
      );
      await seed.query('COMMIT');
    } finally {
      seed.release();
    }

    const winner = await pool.connect();
    const loser = await pool.connect();
    try {
      await winner.query('BEGIN');
      await loser.query('BEGIN');
      const winnerPid = await backendPid(winner);
      const loserPid = await backendPid(loser);
      await winner.query(db.FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL, [ROW_LOCK_RACE_ACCOUNT]);
      await winner.query(db.FREEHOLD_HEARTH_INIT_SQL, [ROW_LOCK_RACE_ACCOUNT]);
      const held = await winner.query(db.FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL, [
        ROW_LOCK_RACE_ACCOUNT,
      ]);
      expect(held.rows[0].revision).toBe('1');

      const started = Date.now();
      const loserPromise = db.advanceFreeholdHearthOnClient(
        loser,
        ROW_LOCK_RACE_ACCOUNT,
        COOLDOWN_MS,
      );
      const blocked = await waitForBlock(winnerPid);
      expect(blocked).not.toBeNull();
      expect(blocked?.pid).toBe(loserPid);
      expect(blocked?.query).toContain('FOR UPDATE');
      expect(blocked?.query).toContain(
        '(EXTRACT(EPOCH FROM now()) * 1000)::bigint::text AS now_ms',
      );
      expect(blocked?.query).not.toContain('INSERT INTO');
      expect(blocked?.waitEvent).toBe('Lock:transactionid');

      // The winner abandons its transaction, so the loser inherits an
      // untouched, fresh row and legitimately advances. The lock delayed it; it
      // never corrupted it.
      await winner.query('ROLLBACK');
      const loserResult = await loserPromise;
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(loserResult.kind).toBe('advanced');
      if (loserResult.kind !== 'advanced') throw new Error('unreachable');
      expect(loserResult.revision).toBe('2');
      await loser.query('COMMIT');
      expect(await readRow(ROW_LOCK_RACE_ACCOUNT)).toEqual({
        ready_at_ms: loserResult.readyAtMs,
        revision: '2',
      });
    } finally {
      await winner.query('ROLLBACK').catch(() => {});
      await loser.query('ROLLBACK').catch(() => {});
      winner.release();
      loser.release();
    }
  }, 30_000);

  it('costs four statements when it advances and three when it refuses', async () => {
    const client = await pool.connect();
    const issued: string[] = [];
    const counting = {
      query: (text: string, values?: unknown[]) => {
        issued.push(text);
        return client.query(text, values as never[]);
      },
    };
    try {
      await client.query('BEGIN');
      expect((await db.advanceFreeholdHearthOnClient(counting, STALE_ACCOUNT, 0)).kind).toBe(
        'advanced',
      );
      // Participant lock, conflict-safe insert, locking read, monotone update.
      expect(issued).toHaveLength(4);
      issued.length = 0;
      expect(
        (await db.advanceFreeholdHearthOnClient(counting, STALE_ACCOUNT, COOLDOWN_MS)).kind,
      ).toBe('advanced');
      issued.length = 0;
      // Now unready: the refusal stops after the locking read and writes nothing.
      expect(
        (await db.advanceFreeholdHearthOnClient(counting, STALE_ACCOUNT, COOLDOWN_MS)).kind,
      ).toBe('cooldown');
      expect(issued).toHaveLength(3);
      expect(issued.some((text) => text.includes('UPDATE account_freehold_hearth'))).toBe(false);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('a stale caller replaying an old epoch cannot lower ready_at_ms or revision', async () => {
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      const advanced = await db.advanceFreeholdHearthOnClient(seed, STALE_ACCOUNT, COOLDOWN_MS);
      expect(advanced.kind).toBe('advanced');
      await seed.query('COMMIT');
    } finally {
      seed.release();
    }
    const before = await readRow(STALE_ACCOUNT);
    expect(before?.revision).toBe('1');

    // The reviewed advance statement, driven directly with a now_ms the
    // eligibility guard could never hand it: a stale caller replaying an epoch
    // from long before the current ready_at_ms. GREATEST is what makes that
    // harmless, and this is the only way to observe its left arm winning.
    const replayed = await pool.query(db.FREEHOLD_HEARTH_ADVANCE_SQL, [
      STALE_ACCOUNT,
      '1',
      '0',
      null,
    ]);
    expect(replayed.rows[0].ready_at_ms).toBe(before?.ready_at_ms);
    // Never lowered, and the revision still only counts up.
    expect(replayed.rows[0].revision).toBe('2');
    expect(BigInt(String(replayed.rows[0].ready_at_ms))).toBeGreaterThan(1n);

    // The other arm of GREATEST, for real: a now_ms far in the FUTURE does move
    // the value forward, so the clamp is not simply ignoring its input.
    const future = String(BigInt(before?.ready_at_ms ?? '0') + 10_000n);
    const forward = await pool.query(db.FREEHOLD_HEARTH_ADVANCE_SQL, [
      STALE_ACCOUNT,
      future,
      '5',
      null,
    ]);
    expect(forward.rows[0].ready_at_ms).toBe(String(BigInt(future) + 5n));
    expect(forward.rows[0].revision).toBe('3');
  });

  it('carries bigint counters past 2^53 as exact text, never a rounded number', async () => {
    const huge = '9007199254740993';
    await pool.query(
      `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision)
       VALUES ($1, $2::bigint, $3::bigint)
       ON CONFLICT (account_id) DO UPDATE SET ready_at_ms = $2::bigint, revision = $3::bigint`,
      [CASCADE_ACCOUNT, huge, huge],
    );
    expect(await db.loadFreeholdHearth(pool, CASCADE_ACCOUNT)).toEqual({
      kind: 'state',
      state: { readyAtMs: huge, revision: huge },
    });
    // The value a Number round trip destroys, proving the ::text cast is doing
    // real work rather than agreeing with a lucky double.
    expect(String(Number(huge))).toBe('9007199254740992');

    // And the key is not ready: a Number comparison would have granted it.
    // Since 07a a stored time this far past the clock plus a cooldown is
    // refused as CORRUPT (no advance writes it; only a bad row or a backward
    // clock step can), which is still a refusal that writes nothing and still
    // carries both counters back exactly. The cooldown arm past 2^53 is the
    // fake-client twin's to drive, since no real clock reaches 2^53 ms.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const refused = await db.advanceFreeholdHearthOnClient(client, CASCADE_ACCOUNT, COOLDOWN_MS);
      expect(refused.kind).toBe('corrupt');
      if (refused.kind !== 'corrupt') throw new Error('unreachable');
      expect(refused.readyAtMs).toBe(huge);
      expect(refused.revision).toBe(huge);
      expect(BigInt(refused.nowMs)).toBeLessThan(BigInt(huge));
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await readRow(CASCADE_ACCOUNT)).toEqual({ ready_at_ms: huge, revision: huge });
  });

  it('renders both counters as text in the DATABASE, not by driver luck', async () => {
    // node-pg happens to hand BIGINT back as a string today, so dropping the
    // ::text casts would look harmless from here. It is not: the cast is the
    // module's OWN guarantee, and a caller that configures an int8 type parser
    // (or a future driver default) must not be able to round a cooldown. This
    // pool does exactly that, on its own connection, touching no global.
    const { Pool, types } = await import('pg');
    const numeric = new Pool({
      connectionString: url,
      max: 1,
      options: `-c search_path=${SCHEMA}`,
      application_name: `${SCHEMA}_numeric`,
      types: {
        getTypeParser: (oid: number, format?: unknown) =>
          oid === 20
            ? (value: string) => Number(value)
            : (types.getTypeParser as (o: number, f?: unknown) => unknown)(oid, format),
      },
    } as never);
    try {
      const huge = '9007199254740993';
      await numeric.query(
        `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision)
         VALUES ($1, $2::bigint, $2::bigint)`,
        [NUMERIC_PARSER_ACCOUNT, huge],
      );
      // Anti-vacuity: the override really bites on an uncast bigint, and really
      // destroys the value.
      const raw = await numeric.query(
        'SELECT ready_at_ms FROM account_freehold_hearth WHERE account_id = $1',
        [NUMERIC_PARSER_ACCOUNT],
      );
      expect(typeof raw.rows[0].ready_at_ms).toBe('number');
      expect(String(raw.rows[0].ready_at_ms)).toBe('9007199254740992');
      // The module's own read survives it, exactly.
      expect(await db.loadFreeholdHearth(numeric, NUMERIC_PARSER_ACCOUNT)).toEqual({
        kind: 'state',
        state: { readyAtMs: huge, revision: huge },
      });
      const exported = await db.freeholdHearthForExport(numeric, NUMERIC_PARSER_ACCOUNT);
      expect(exported?.ready_at_ms).toBe(huge);
      expect(exported?.revision).toBe(huge);
      const client = await numeric.connect();
      try {
        await client.query('BEGIN');
        const refused = await db.advanceFreeholdHearthOnClient(
          client,
          NUMERIC_PARSER_ACCOUNT,
          COOLDOWN_MS,
        );
        // Refused as corrupt (2^53 ms is far past the clock plus a cooldown);
        // the refusal arm's counters must survive the parser all the same.
        expect(refused.kind).toBe('corrupt');
        if (refused.kind !== 'corrupt') throw new Error('unreachable');
        expect(refused.readyAtMs).toBe(huge);
        expect(refused.revision).toBe(huge);
        // And the ADVANCE arm: with the key made ready, the RETURNING clause
        // must also survive the parser, counter and all.
        await client.query(
          'UPDATE account_freehold_hearth SET ready_at_ms = 0 WHERE account_id = $1',
          [NUMERIC_PARSER_ACCOUNT],
        );
        const advanced = await db.advanceFreeholdHearthOnClient(client, NUMERIC_PARSER_ACCOUNT, 0);
        expect(advanced.kind).toBe('advanced');
        if (advanced.kind !== 'advanced') throw new Error('unreachable');
        expect(advanced.revision).toBe('9007199254740994');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    } finally {
      await numeric.end();
    }
  });

  it('cascades on account deletion, and survives character deletion untouched', async () => {
    // Character deletion PRESERVES the account cooldown: deleting a character
    // must never be a way to reset the shared clock.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(
        (await db.advanceFreeholdHearthOnClient(client, CHARACTER_ACCOUNT, COOLDOWN_MS)).kind,
      ).toBe('advanced');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const before = await readRow(CHARACTER_ACCOUNT);
    expect(before?.revision).toBe('1');
    await pool.query('DELETE FROM characters WHERE account_id = $1', [CHARACTER_ACCOUNT]);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM characters WHERE account_id = $1', [
          CHARACTER_ACCOUNT,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(await readRow(CHARACTER_ACCOUNT)).toEqual(before);

    // True account deletion DOES take it, through the primary key's own FK.
    expect(await readRow(CASCADE_ACCOUNT)).not.toBeNull();
    await pool.query('DELETE FROM accounts WHERE id = $1', [CASCADE_ACCOUNT]);
    expect(await readRow(CASCADE_ACCOUNT)).toBeNull();
  });

  it('exports the one row for the subject-access bundle, and null without one', async () => {
    expect(await db.freeholdHearthForExport(pool, EXPORT_ACCOUNT)).toBeNull();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(
        (await db.advanceFreeholdHearthOnClient(client, EXPORT_ACCOUNT, COOLDOWN_MS)).kind,
      ).toBe('advanced');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const exported = await db.freeholdHearthForExport(pool, EXPORT_ACCOUNT);
    expect(exported).not.toBeNull();
    expect(Object.keys(exported ?? {}).sort()).toEqual(['ready_at_ms', 'revision', 'updated_at']);
    expect(exported?.revision).toBe('1');
    expect(typeof exported?.ready_at_ms).toBe('string');
    expect(exported?.updated_at).toBeInstanceOf(Date);
  });

  const readToken = async (accountId: number) =>
    (
      await pool.query(
        'SELECT advance_token, revision::text AS revision FROM account_freehold_hearth WHERE account_id = $1',
        [accountId],
      )
    ).rows[0] ?? null;

  it('stamps the attempt token with the advance, and the verify reads it back only after COMMIT', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const advanced = await db.advanceFreeholdHearthOnClient(
        client,
        TOKEN_ACCOUNT,
        COOLDOWN_MS,
        TOKEN,
      );
      expect(advanced).toMatchObject({ kind: 'advanced', revision: '1' });
      // Uncommitted first advance: the verify on another connection sees no
      // row, so it cannot claim an attempt landed that may still roll back.
      expect(await db.freeholdHearthAdvanceLandedOnClient(pool, TOKEN_ACCOUNT, TOKEN)).toBe(false);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await readToken(TOKEN_ACCOUNT)).toEqual({
      advance_token: '0123456789abcdef0123456789abcdef',
      revision: '1',
    });
    expect(await db.freeholdHearthAdvanceLandedOnClient(pool, TOKEN_ACCOUNT, TOKEN)).toBe(true);
    expect(await db.freeholdHearthAdvanceLandedOnClient(pool, TOKEN_ACCOUNT, OTHER_TOKEN)).toBe(
      false,
    );

    // A refused attempt writes nothing, its token included.
    const refusedClient = await pool.connect();
    try {
      await refusedClient.query('BEGIN');
      expect(
        await db.advanceFreeholdHearthOnClient(
          refusedClient,
          TOKEN_ACCOUNT,
          COOLDOWN_MS,
          OTHER_TOKEN,
        ),
      ).toMatchObject({ kind: 'cooldown' });
      await refusedClient.query('COMMIT');
    } finally {
      refusedClient.release();
    }
    expect(await readToken(TOKEN_ACCOUNT)).toEqual({
      advance_token: '0123456789abcdef0123456789abcdef',
      revision: '1',
    });

    // The next accepted advance replaces it: the token names ONE attempt.
    await pool.query('UPDATE account_freehold_hearth SET ready_at_ms = 0 WHERE account_id = $1', [
      TOKEN_ACCOUNT,
    ]);
    const next = await pool.connect();
    try {
      await next.query('BEGIN');
      expect(
        await db.advanceFreeholdHearthOnClient(next, TOKEN_ACCOUNT, COOLDOWN_MS, OTHER_TOKEN),
      ).toMatchObject({ kind: 'advanced', revision: '2' });
      await next.query('COMMIT');
    } finally {
      next.release();
    }
    expect(await readToken(TOKEN_ACCOUNT)).toEqual({
      advance_token: 'fedcba9876543210fedcba9876543210',
      revision: '2',
    });
    expect(await db.freeholdHearthAdvanceLandedOnClient(pool, TOKEN_ACCOUNT, TOKEN)).toBe(false);
    expect(await db.freeholdHearthAdvanceLandedOnClient(pool, TOKEN_ACCOUNT, OTHER_TOKEN)).toBe(
      true,
    );
  });

  it('a second advance inside the cooldown another realm started answers cooldown and writes nothing', async () => {
    // The advance takes no caller reading as input (account, cooldown, token):
    // it decides from the row it locks. So what this proves is the second
    // advance, not a cached value overridden. The load only shows that a reader
    // could have seen the key READY (absent) before the other realm advanced.
    expect(await db.loadFreeholdHearth(pool, SECOND_ADVANCE_ACCOUNT)).toEqual({ kind: 'absent' });
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      expect(
        await db.advanceFreeholdHearthOnClient(other, SECOND_ADVANCE_ACCOUNT, COOLDOWN_MS, TOKEN),
      ).toMatchObject({ kind: 'advanced', revision: '1' });
      await other.query('COMMIT');
    } finally {
      other.release();
    }
    const durable = await readToken(SECOND_ADVANCE_ACCOUNT);
    // The second advance during the cooldown: answered from the locked row.
    const second = await pool.connect();
    try {
      await second.query('BEGIN');
      expect(
        await db.advanceFreeholdHearthOnClient(
          second,
          SECOND_ADVANCE_ACCOUNT,
          COOLDOWN_MS,
          OTHER_TOKEN,
        ),
      ).toMatchObject({ kind: 'cooldown', revision: '1' });
      await second.query('COMMIT');
    } finally {
      second.release();
    }
    expect(await readToken(SECOND_ADVANCE_ACCOUNT)).toEqual(durable);
    expect(durable).toEqual({ advance_token: TOKEN, revision: '1' });
  });

  it('a commit whose ACK was lost is proved landed by its token, and its retry never advances twice', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await db.advanceFreeholdHearthOnClient(client, ACK_LOST_ACCOUNT, COOLDOWN_MS, TOKEN);
      // COMMIT lands; the caller is treated as never having heard the answer.
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    // The verify decides from durable truth: this attempt's token is on the row.
    expect(await db.freeholdHearthAdvanceLandedOnClient(pool, ACK_LOST_ACCOUNT, TOKEN)).toBe(true);
    // A retry of the SAME attempt (the same token) is refused by the cooldown
    // it set, writing nothing: one landed attempt, one advance.
    const retry = await pool.connect();
    try {
      await retry.query('BEGIN');
      expect(
        await db.advanceFreeholdHearthOnClient(retry, ACK_LOST_ACCOUNT, COOLDOWN_MS, TOKEN),
      ).toMatchObject({ kind: 'cooldown', revision: '1' });
      await retry.query('COMMIT');
    } finally {
      retry.release();
    }
    expect(await readToken(ACK_LOST_ACCOUNT)).toEqual({ advance_token: TOKEN, revision: '1' });
    expect(await db.freeholdHearthAdvanceLandedOnClient(pool, ACK_LOST_ACCOUNT, TOKEN)).toBe(true);
  });

  it('refuses a stored ready time past the clock plus a cooldown as corrupt, and writes nothing', async () => {
    // One minute past anything an advance can write, set by the DATABASE clock.
    await pool.query(
      `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision, advance_token)
       VALUES ($1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint + $2::bigint, 6, $3)`,
      [CORRUPT_ACCOUNT, String(COOLDOWN_MS + 60_000), TOKEN],
    );
    const before = await readRow(CORRUPT_ACCOUNT);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const refused = await db.advanceFreeholdHearthOnClient(
        client,
        CORRUPT_ACCOUNT,
        COOLDOWN_MS,
        OTHER_TOKEN,
      );
      expect(refused.kind).toBe('corrupt');
      if (refused.kind !== 'corrupt') throw new Error('unreachable');
      expect(refused.readyAtMs).toBe(before?.ready_at_ms);
      expect(refused.revision).toBe('6');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    // Never trusted, never repaired: both counters and the token unchanged.
    expect(await readRow(CORRUPT_ACCOUNT)).toEqual(before);
    expect((await readToken(CORRUPT_ACCOUNT))?.advance_token).toBe(TOKEN);
  });

  it('answers cooldown, not corrupt, for a ready time written AT the clock plus the cooldown', async () => {
    // The control: exactly what an advance writes. The read's clock is later
    // than the insert's, so the distance is at most the cooldown.
    await pool.query(
      `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision)
       VALUES ($1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint + $2::bigint, 6)`,
      [BOUNDARY_ACCOUNT, String(COOLDOWN_MS)],
    );
    const before = await readRow(BOUNDARY_ACCOUNT);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const refused = await db.advanceFreeholdHearthOnClient(client, BOUNDARY_ACCOUNT, COOLDOWN_MS);
      expect(refused).toMatchObject({
        kind: 'cooldown',
        readyAtMs: before?.ready_at_ms,
        revision: '6',
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await readRow(BOUNDARY_ACCOUNT)).toEqual(before);
  });

  it('judges corrupt on the clock AFTER the lock wait: a later-started advance is a cooldown', async () => {
    // The race clock_ms exists for: the loser's transaction STARTS first, the
    // winner starts later and advances, the loser queues behind it. The ready
    // time the loser then reads is more than a cooldown past its own now(),
    // and must still read as an ordinary cooldown.
    const loser = await pool.connect();
    const winner = await pool.connect();
    try {
      await loser.query('BEGIN');
      await loser.query('SELECT 1');
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      await winner.query('BEGIN');
      const winnerPid = await backendPid(winner);
      const loserPid = await backendPid(loser);
      const winnerResult = await db.advanceFreeholdHearthOnClient(
        winner,
        CLOCK_RACE_ACCOUNT,
        COOLDOWN_MS,
      );
      expect(winnerResult.kind).toBe('advanced');
      if (winnerResult.kind !== 'advanced') throw new Error('unreachable');
      const loserPromise = db.advanceFreeholdHearthOnClient(loser, CLOCK_RACE_ACCOUNT, COOLDOWN_MS);
      const blocked = await waitForBlock(winnerPid);
      expect(blocked?.pid).toBe(loserPid);
      await winner.query('COMMIT');
      const loserResult = await loserPromise;
      expect(loserResult.kind).toBe('cooldown');
      if (loserResult.kind !== 'cooldown') throw new Error('unreachable');
      expect(loserResult.readyAtMs).toBe(winnerResult.readyAtMs);
      // ANTI-VACUITY: the premise held. The loser started first, and against
      // its now() the stored time IS past a whole cooldown, so a corrupt test
      // judged on now_ms would have refused this ordinary race as corrupt.
      expect(BigInt(winnerResult.nowMs)).toBeGreaterThan(BigInt(loserResult.nowMs));
      expect(BigInt(loserResult.readyAtMs) - BigInt(loserResult.nowMs)).toBeGreaterThan(
        BigInt(COOLDOWN_MS),
      );
      await loser.query('COMMIT');
    } finally {
      await winner.query('ROLLBACK').catch(() => {});
      await loser.query('ROLLBACK').catch(() => {});
      winner.release();
      loser.release();
    }
  }, 30_000);
});
