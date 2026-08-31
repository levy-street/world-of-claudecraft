// Executed PostgreSQL proof for the database-wide bank-ledger ceiling. The
// always-on sibling pins DDL text and error decoding; this suite proves actual
// transition-row counts, rollback, receipt idempotency, and concurrent writers.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL ?? '';
const d = url === '' ? describe.skip : describe;
const SCHEMA = 'bank_ledger_growth_budget_pg_test';
const OVER_CAP_SCHEMA = 'bank_ledger_growth_over_cap_pg_test';
const MULTI_STATEMENT_SCHEMA = 'bank_ledger_growth_multi_statement_pg_test';
const BOOTSTRAP_RACE_SCHEMA = 'bank_ledger_growth_bootstrap_race_pg_test';
const CONFIG_DRIFT_SCHEMA = 'bank_ledger_growth_config_drift_pg_test';
const priorLimit = process.env.BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS;
if (url !== '') process.env.BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS = '4';

d('bank ledger durable growth budget against real PostgreSQL', () => {
  let pool: import('pg').Pool;
  let growth: typeof import('../../server/bank_ledger_growth_budget');
  let batchDb: typeof import('../../server/bank_ledger_batch_db');
  let growthSchema: string;

  const ledgerValues = (itemId: string) => [
    'pg-growth',
    1,
    1,
    'deposit',
    itemId,
    1,
    null,
    0,
    0,
    'personal',
    null,
    null,
    null,
  ];

  const insertSql = `INSERT INTO "${SCHEMA}".bank_ledger
    (realm, character_id, account_id, op, item_id, count, instance,
     copper_delta, purchased_slots_after, container, container_id,
     counterparty_copper_delta, counterparty_count)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`;

  const receiptBatch = {
    batchKey: 'growth.pg.receipt',
    encodedBytes: 1,
    rows: [
      {
        realm: 'pg-growth',
        characterId: 1,
        accountId: 1,
        op: 'deposit',
        itemId: 'receipt_writer',
        count: 1,
        instanceJson: null,
        copperDelta: 0,
        purchasedSlotsAfter: 0,
        container: 'personal',
        containerId: null,
        counterpartyCopperDelta: null,
        counterpartyCount: null,
      },
    ],
  } as const;

  const budgetRows = async (): Promise<number> =>
    Number(
      (await pool.query(`SELECT committed_rows FROM "${SCHEMA}".bank_ledger_growth_budget`)).rows[0]
        .committed_rows,
    );

  beforeAll(async () => {
    const { Pool } = await import('pg');
    growth = await import('../../server/bank_ledger_growth_budget');
    batchDb = await import('../../server/bank_ledger_batch_db');
    expect(growth.BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS).toBe(4);

    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    await admin.end();
    pool = new Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${SCHEMA}`,
      application_name: SCHEMA,
    });
    await pool.query(`CREATE TABLE "${SCHEMA}".accounts (id INT PRIMARY KEY)`);
    await pool.query(`CREATE TABLE "${SCHEMA}".characters (
      id INT PRIMARY KEY,
      account_id INT NOT NULL REFERENCES "${SCHEMA}".accounts(id)
    )`);
    await pool.query(`CREATE TABLE "${SCHEMA}".bank_ledger (
      id BIGSERIAL PRIMARY KEY,
      realm TEXT NOT NULL,
      character_id INT NOT NULL REFERENCES "${SCHEMA}".characters(id) ON DELETE CASCADE,
      account_id INT NOT NULL REFERENCES "${SCHEMA}".accounts(id) ON DELETE CASCADE,
      op TEXT NOT NULL,
      item_id TEXT,
      count INT,
      instance JSONB,
      copper_delta BIGINT NOT NULL DEFAULT 0,
      purchased_slots_after INT NOT NULL,
      container TEXT NOT NULL,
      container_id BIGINT,
      counterparty_copper_delta BIGINT,
      counterparty_count INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await pool.query(`INSERT INTO "${SCHEMA}".accounts (id) VALUES (1)`);
    await pool.query(`INSERT INTO "${SCHEMA}".characters (id, account_id) VALUES (1, 1)`);
    await pool.query(insertSql, ledgerValues('legacy_before_guard'));
    await pool.query(batchDb.BANK_LEDGER_BATCH_RECEIPTS_SCHEMA);
    growthSchema = growth.bankLedgerGrowthBudgetSchema(SCHEMA);
    await pool.query(growthSchema);
  }, 30_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (url !== '') {
      const { Pool } = await import('pg');
      const admin = new Pool({ connectionString: url, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS "${OVER_CAP_SCHEMA}" CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS "${MULTI_STATEMENT_SCHEMA}" CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS "${BOOTSTRAP_RACE_SCHEMA}" CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS "${CONFIG_DRIFT_SCHEMA}" CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}_counterfeit" CASCADE`);
      await admin.end();
    }
    if (priorLimit === undefined) delete process.env.BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS;
    else process.env.BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS = priorLimit;
  });

  it('counts legacy, raw, and receipt writes exactly, including rollback and replay', async () => {
    expect(await budgetRows()).toBe(1);
    const trigger = await pool.query(
      `SELECT t.tgenabled, t.tgtype, t.tgnargs,
              pg_catalog.octet_length(t.tgargs) AS arg_bytes,
              t.tgattr::text AS tgattr, t.tgqual,
              t.tgnewtable, t.tgoldtable,
              n.nspname AS function_schema, p.proname AS function_name
         FROM pg_catalog.pg_trigger AS t
         JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
         JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE t.tgrelid = '"${SCHEMA}".bank_ledger'::pg_catalog.regclass
          AND t.tgname = 'bank_ledger_growth_budget_insert'`,
    );
    expect(trigger.rows).toEqual([
      {
        tgenabled: 'O',
        tgtype: 4,
        tgnargs: 0,
        arg_bytes: 0,
        tgattr: '',
        tgqual: null,
        tgnewtable: 'inserted_bank_ledger_rows',
        tgoldtable: null,
        function_schema: SCHEMA,
        function_name: 'accumulate_bank_ledger_growth_budget',
      },
    ]);
    const commitTrigger = await pool.query(
      `SELECT t.tgenabled, t.tgtype, t.tgnargs,
              pg_catalog.octet_length(t.tgargs) AS arg_bytes,
              t.tgattr::text AS tgattr, t.tgqual,
              t.tgdeferrable, t.tginitdeferred,
              t.tgnewtable, t.tgoldtable, n.nspname AS function_schema,
              p.proname AS function_name
         FROM pg_catalog.pg_trigger AS t
         JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
         JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE t.tgrelid = '"${SCHEMA}".bank_ledger_growth_pending'::pg_catalog.regclass
          AND t.tgname = 'bank_ledger_growth_budget_commit'`,
    );
    expect(commitTrigger.rows).toEqual([
      {
        tgenabled: 'O',
        tgtype: 21,
        tgnargs: 0,
        arg_bytes: 0,
        tgattr: '',
        tgqual: null,
        tgdeferrable: true,
        tginitdeferred: true,
        tgnewtable: null,
        tgoldtable: null,
        function_schema: SCHEMA,
        function_name: 'enforce_bank_ledger_growth_budget',
      },
    ]);

    await pool.query(insertSql, ledgerValues('raw_writer'));
    expect(await budgetRows()).toBe(2);

    const rolledBack = await pool.connect();
    try {
      await rolledBack.query('BEGIN');
      await rolledBack.query(insertSql, ledgerValues('rolled_back'));
      expect(
        Number(
          (
            await rolledBack.query(
              `SELECT committed_rows FROM "${SCHEMA}".bank_ledger_growth_budget`,
            )
          ).rows[0].committed_rows,
        ),
      ).toBe(2);
      expect(
        Number(
          (
            await rolledBack.query(
              `SELECT inserted_rows FROM "${SCHEMA}".bank_ledger_growth_pending
                WHERE transaction_id = pg_catalog.pg_current_xact_id()`,
            )
          ).rows[0].inserted_rows,
        ),
      ).toBe(1);
      await rolledBack.query('ROLLBACK');
    } finally {
      await rolledBack.query('ROLLBACK').catch(() => {});
      rolledBack.release();
    }
    expect(await budgetRows()).toBe(2);
    expect(
      Number(
        (await pool.query(`SELECT count(*) FROM "${SCHEMA}".bank_ledger_growth_pending`)).rows[0]
          .count,
      ),
    ).toBe(0);

    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await batchDb.writeBankLedgerCommandBatches(
          client,
          { realm: 'pg-growth', characterId: 1, accountId: 1 },
          [receiptBatch],
        );
        await client.query('COMMIT');
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    }
    expect(await budgetRows()).toBe(3);
    expect(
      Number(
        (
          await pool.query(
            `SELECT count(*) FROM "${SCHEMA}".bank_ledger WHERE item_id = 'receipt_writer'`,
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  });

  it('serializes concurrent raw writers at the last slot and refuses every later insert', async () => {
    const twoRowsSql = `${insertSql.replace(/;?$/, '')},
      ($1, $2, $3, $4, 'too_many_b', $6, $7, $8, $9, $10, $11, $12, $13)`;
    await expect(pool.query(twoRowsSql, ledgerValues('too_many_a'))).rejects.toMatchObject({
      code: growth.BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: growth.BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
    });
    expect(await budgetRows()).toBe(3);
    expect(
      Number(
        (
          await pool.query(
            `SELECT count(*) FROM "${SCHEMA}".bank_ledger
              WHERE item_id IN ('too_many_a', 'too_many_b')`,
          )
        ).rows[0].count,
      ),
    ).toBe(0);

    const results = await Promise.allSettled([
      pool.query(insertSql, ledgerValues('concurrent_a')),
      pool.query(insertSql, ledgerValues('concurrent_b')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toBeDefined();
    if (rejection?.status === 'rejected') {
      expect(rejection.reason).toMatchObject({
        code: growth.BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
        constraint: growth.BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      });
      expect(growth.bankLedgerGrowthLimitFromError(rejection.reason)).toMatchObject({
        committedRows: 4,
        attemptedRows: 1,
        hardLimitRows: 4,
      });
    }
    expect(await budgetRows()).toBe(4);
    expect(
      Number((await pool.query(`SELECT count(*) FROM "${SCHEMA}".bank_ledger`)).rows[0].count),
    ).toBe(4);

    await expect(pool.query(insertSql, ledgerValues('past_limit'))).rejects.toMatchObject({
      code: growth.BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: growth.BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
    });
    expect(await budgetRows()).toBe(4);

    const replay = await pool.connect();
    try {
      await replay.query('BEGIN');
      await batchDb.writeBankLedgerCommandBatches(
        replay,
        { realm: 'pg-growth', characterId: 1, accountId: 1 },
        [receiptBatch],
      );
      await replay.query('COMMIT');
    } finally {
      await replay.query('ROLLBACK').catch(() => {});
      replay.release();
    }
    expect(await budgetRows()).toBe(4);

    const counterfeit = `${SCHEMA}_counterfeit`;
    // Self-healing against a prior local run that died before afterAll: CI
    // always starts fresh, a developer database does not.
    await pool.query(`DROP SCHEMA IF EXISTS "${counterfeit}" CASCADE`);
    await pool.query(`CREATE SCHEMA "${counterfeit}"`);
    await pool.query(`CREATE TABLE "${counterfeit}".bank_ledger_growth_budget (
      singleton BOOLEAN PRIMARY KEY,
      committed_rows BIGINT NOT NULL,
      hard_limit_rows BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`);
    await pool.query(
      `INSERT INTO "${counterfeit}".bank_ledger_growth_budget
       VALUES (TRUE, 0, 999999999, now())`,
    );
    const redirected = await pool.connect();
    try {
      await redirected.query('BEGIN');
      await redirected.query(`SET LOCAL search_path = "${counterfeit}", "${SCHEMA}"`);
      await expect(
        redirected.query(insertSql, ledgerValues('search_path_bypass')),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(redirected.query('COMMIT')).rejects.toMatchObject({
        code: growth.BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
        constraint: growth.BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      });
    } finally {
      await redirected.query('ROLLBACK').catch(() => {});
      redirected.release();
    }
    expect(await budgetRows()).toBe(4);
    expect(
      Number(
        (await pool.query(`SELECT committed_rows FROM "${counterfeit}".bank_ledger_growth_budget`))
          .rows[0].committed_rows,
      ),
    ).toBe(0);
  });

  it('seeds an already-over-cap ledger exactly and refuses only later ledger inserts', async () => {
    await pool.query(`CREATE SCHEMA "${OVER_CAP_SCHEMA}"`);
    await pool.query(`CREATE TABLE "${OVER_CAP_SCHEMA}".bank_ledger (id BIGSERIAL PRIMARY KEY)`);
    await pool.query(
      `INSERT INTO "${OVER_CAP_SCHEMA}".bank_ledger
       SELECT FROM pg_catalog.generate_series(1, 5)`,
    );

    await pool.query(growth.bankLedgerGrowthBudgetSchema(OVER_CAP_SCHEMA));
    const boot = await pool.query(
      `SELECT committed_rows, hard_limit_rows
         FROM "${OVER_CAP_SCHEMA}".bank_ledger_growth_budget`,
    );
    expect(boot.rows).toEqual([{ committed_rows: '5', hard_limit_rows: '4' }]);
    await expect(
      pool.query(`INSERT INTO "${OVER_CAP_SCHEMA}".bank_ledger DEFAULT VALUES`),
    ).rejects.toMatchObject({
      code: growth.BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: growth.BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
    });
    expect(
      Number(
        (await pool.query(`SELECT count(*) FROM "${OVER_CAP_SCHEMA}".bank_ledger`)).rows[0].count,
      ),
    ).toBe(5);
  });

  it('applies the storage parameters to both budget tables', async () => {
    const opts = await pool.query(
      `SELECT relname, reloptions
         FROM pg_catalog.pg_class
        WHERE oid IN ('"${SCHEMA}".bank_ledger_growth_pending'::pg_catalog.regclass,
                      '"${SCHEMA}".bank_ledger_growth_budget'::pg_catalog.regclass)
        ORDER BY relname`,
    );
    expect(opts.rows).toEqual([
      {
        relname: 'bank_ledger_growth_budget',
        reloptions: expect.arrayContaining([
          'autovacuum_vacuum_scale_factor=0',
          'autovacuum_vacuum_threshold=1000',
        ]),
      },
      {
        relname: 'bank_ledger_growth_pending',
        reloptions: expect.arrayContaining([
          'autovacuum_vacuum_scale_factor=0',
          'autovacuum_vacuum_threshold=100',
        ]),
      },
    ]);
  });

  it('converges a drifted receipts key shape as NOT VALID: boot survives bad rows, new writes enforce, VALIDATE proves out of boot', async () => {
    const schema = 'bank_ledger_batch_key_shape_pg_test';
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path = "${schema}"`);
      await client.query('CREATE TABLE accounts (id INT PRIMARY KEY)');
      await client.query(
        'CREATE TABLE characters (id INT PRIMARY KEY, account_id INT NOT NULL REFERENCES accounts(id))',
      );
      await client.query('INSERT INTO accounts (id) VALUES (1)');
      await client.query('INSERT INTO characters (id, account_id) VALUES (1, 1)');
      // A pre-existing install whose key-shape constraint drifted PERMISSIVE,
      // holding a row the CURRENT shape refuses.
      await client.query(`CREATE TABLE bank_ledger_batch_receipts (
        batch_key TEXT PRIMARY KEY,
        realm TEXT NOT NULL,
        character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        row_count INT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT bank_ledger_batch_receipts_key_shape CHECK (char_length(batch_key) >= 1)
      )`);
      const insertReceipt = (key: string) =>
        client.query(
          `INSERT INTO bank_ledger_batch_receipts
             (batch_key, realm, character_id, account_id, row_count, payload_sha256)
           VALUES ($1, 'pg-growth', 1, 1, 1, $2)`,
          [key, 'a'.repeat(64)],
        );
      await insertReceipt('violates!current!shape');

      // Boot applies the schema WITHOUT scanning the existing rows: it must
      // survive the violating row (the old drop-and-revalidate shape aborted
      // boot here) and land the re-added constraint NOT VALID.
      await client.query(batchDb.BANK_LEDGER_BATCH_RECEIPTS_SCHEMA);
      const converged = await client.query(
        `SELECT oid, convalidated FROM pg_constraint
          WHERE conname = 'bank_ledger_batch_receipts_key_shape'
            AND conrelid = 'bank_ledger_batch_receipts'::regclass`,
      );
      expect(converged.rows).toEqual([{ oid: expect.anything(), convalidated: false }]);
      // Re-applying the schema INSIDE the NOT VALID window must not re-fire
      // the drop-and-add: the probe matches the definition alone, so keying
      // it on convalidated again would churn an ACCESS EXCLUSIVE constraint
      // rebuild on every boot until the post-listen VALIDATE lands.
      await client.query(batchDb.BANK_LEDGER_BATCH_RECEIPTS_SCHEMA);
      const midWindow = await client.query(
        `SELECT oid, convalidated FROM pg_constraint
          WHERE conname = 'bank_ledger_batch_receipts_key_shape'
            AND conrelid = 'bank_ledger_batch_receipts'::regclass`,
      );
      expect(midWindow.rows).toEqual([{ oid: converged.rows[0].oid, convalidated: false }]);
      // Enforcement of NEW writes is immediate despite NOT VALID.
      await expect(insertReceipt('also!bad')).rejects.toMatchObject({ code: '23514' });
      await expect(insertReceipt('good.key')).resolves.toMatchObject({ rowCount: 1 });
      // The raw fragment is loud on the surviving bad row; the boot helper
      // wraps exactly that failure without throwing (boot must stay green),
      // resolves false, and leaves the constraint NOT VALID and still
      // enforcing, for the next boot to retry.
      await expect(
        client.query(batchDb.BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL),
      ).rejects.toMatchObject({ code: '23514' });
      // The helper's bounds are TRANSACTION-LOCAL (SET LOCAL): observe them
      // from inside the transaction, on the same client, at the moment the
      // VALIDATE fragment is issued. After the helper returns the session
      // must be back at its prior values, so the exported helper can never
      // leave a 60s setting on a future pooled caller.
      const sessionTimeouts = async () =>
        (
          await client.query(
            "SELECT current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt",
          )
        ).rows[0];
      const timeoutsBefore = await sessionTimeouts();
      expect(timeoutsBefore).not.toEqual({ st: '1min', lt: '5s' });
      const inTxBounds: Array<Record<string, unknown>> = [];
      const observing = {
        query: async (text: string, values?: unknown[]) => {
          if (text.includes('VALIDATE CONSTRAINT bank_ledger_batch_receipts_key_shape')) {
            inTxBounds.push(await sessionTimeouts());
          }
          return client.query(text, values);
        },
      };
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(batchDb.validateBankLedgerBatchReceiptsKeyShape(observing)).resolves.toBe(
          false,
        );
        expect(errors).toHaveBeenCalledTimes(1);
        expect(String(errors.mock.calls[0][0])).toContain('key-shape VALIDATE failed');
      } finally {
        errors.mockRestore();
      }
      const stillNotValid = await client.query(
        `SELECT convalidated FROM pg_constraint
          WHERE conname = 'bank_ledger_batch_receipts_key_shape'
            AND conrelid = 'bank_ledger_batch_receipts'::regclass`,
      );
      expect(stillNotValid.rows).toEqual([{ convalidated: false }]);
      await expect(insertReceipt('still!bad')).rejects.toMatchObject({ code: '23514' });
      // Both bounds were armed at the VALIDATE, and the failed (rolled-back)
      // attempt leaked nothing onto the session.
      expect(inTxBounds).toEqual([{ st: '1min', lt: '5s' }]);
      await expect(sessionTimeouts()).resolves.toEqual(timeoutsBefore);
      // Once the operator reconciles the surviving row, the same helper
      // proves the table and settles.
      await client.query(
        `DELETE FROM bank_ledger_batch_receipts WHERE batch_key = 'violates!current!shape'`,
      );
      await expect(batchDb.validateBankLedgerBatchReceiptsKeyShape(observing)).resolves.toBe(true);
      // The successful (committed) attempt leaks nothing either.
      expect(inTxBounds).toEqual([
        { st: '1min', lt: '5s' },
        { st: '1min', lt: '5s' },
      ]);
      await expect(sessionTimeouts()).resolves.toEqual(timeoutsBefore);
      const validated = await client.query(
        `SELECT convalidated FROM pg_constraint
          WHERE conname = 'bank_ledger_batch_receipts_key_shape'
            AND conrelid = 'bank_ledger_batch_receipts'::regclass`,
      );
      expect(validated.rows).toEqual([{ convalidated: true }]);
      // Steady state: another boot apply leaves the validated constraint alone.
      await client.query(batchDb.BANK_LEDGER_BATCH_RECEIPTS_SCHEMA);
      const settled = await client.query(
        `SELECT convalidated FROM pg_constraint
          WHERE conname = 'bank_ledger_batch_receipts_key_shape'
            AND conrelid = 'bank_ledger_batch_receipts'::regclass`,
      );
      expect(settled.rows).toEqual([{ convalidated: true }]);
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  });

  it('an advisory-lock waiter behind the VALIDATE holds no table locks', async () => {
    // The serialization property the in-lock VALIDATE placement buys, proven
    // against real PostgreSQL: while one boot client HOLDS the session
    // advisory lock and runs the VALIDATE scan, a second booting realm waits
    // at pg_advisory_lock holding NOTHING, so live traffic has nothing to
    // queue behind. (Run after the unlock instead, that second realm would
    // already be executing boot DDL, whose IF NOT EXISTS statements take
    // ACCESS EXCLUSIVE / SHARE locks even when skipping, and would block
    // mid-DDL behind the scan.) The key literal mirrors db.ts
    // SCHEMA_ADVISORY_LOCK_KEY (not exported; tests/schema_wiring.test.ts
    // pins the lock-to-VALIDATE wiring around that constant).
    const SCHEMA_ADVISORY_LOCK_KEY = 0x57_4f_43_01;
    const schema = 'bank_ledger_batch_validate_serialize_pg_test';
    const { Client } = await import('pg');
    const holder = new Client({ connectionString: url });
    const waiter = new Client({ connectionString: url });
    await holder.connect();
    await waiter.connect();
    try {
      await holder.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await holder.query(`CREATE SCHEMA "${schema}"`);
      await holder.query(`SET search_path = "${schema}"`);
      await holder.query('CREATE TABLE accounts (id INT PRIMARY KEY)');
      await holder.query(
        'CREATE TABLE characters (id INT PRIMARY KEY, account_id INT NOT NULL REFERENCES accounts(id))',
      );
      // A drifted constraint, so the boot fragment re-adds it NOT VALID and
      // the in-lock VALIDATE below has real work to do.
      await holder.query(`CREATE TABLE bank_ledger_batch_receipts (
        batch_key TEXT PRIMARY KEY,
        realm TEXT NOT NULL,
        character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        row_count INT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT bank_ledger_batch_receipts_key_shape CHECK (char_length(batch_key) >= 1)
      )`);
      await holder.query(batchDb.BANK_LEDGER_BATCH_RECEIPTS_SCHEMA);

      await holder.query('SELECT pg_advisory_lock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
      const waiterPid = Number((await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      // The second realm's boot, parked at the advisory acquire. The promise
      // is settle-captured at creation so a rejection inside the window fails
      // the test instead of crashing as an unhandled rejection.
      let acquireSettled = false;
      const waiterAcquire = waiter
        .query('SELECT pg_advisory_lock($1)', [SCHEMA_ADVISORY_LOCK_KEY])
        .then(
          () => {
            acquireSettled = true;
          },
          () => {
            acquireSettled = true;
          },
        );
      // Observe the wait from a SEPARATE autocommit connection: a transaction
      // freezes its stats snapshot at the first read, so an in-transaction
      // poller could never see a wait that starts afterwards.
      let waiting = false;
      for (let i = 0; i < 400 && !waiting; i++) {
        const parked = await pool.query(
          "SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted",
          [waiterPid],
        );
        waiting = (parked.rowCount ?? 0) > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);

      // The holder runs the real VALIDATE while the waiter is parked.
      await expect(batchDb.validateBankLedgerBatchReceiptsKeyShape(holder)).resolves.toBe(true);

      // Still parked, and holding NOTHING beyond the ungranted advisory wait
      // itself (and its own virtualxid): no relation, tuple, or transaction
      // lock a login or save could ever queue behind.
      expect(acquireSettled).toBe(false);
      const waiterLocks = await pool.query(
        `SELECT locktype, granted FROM pg_locks
          WHERE pid = $1 AND locktype NOT IN ('advisory', 'virtualxid')`,
        [waiterPid],
      );
      expect(waiterLocks.rows).toEqual([]);

      await holder.query('SELECT pg_advisory_unlock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
      await waiterAcquire;
      expect(acquireSettled).toBe(true);
      await waiter.query('SELECT pg_advisory_unlock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
      await holder.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await waiter.end().catch(() => {});
      await holder.end().catch(() => {});
    }
  }, 30_000);

  it('converges by parsed reloption values, so a rendering difference never re-fires the ALTER', async () => {
    const schema = 'bank_ledger_growth_reloptions_pg_test';
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    // A pre-existing install: the pending table carries value-identical
    // settings under a DIFFERENT text rendering ('0.0', plus the retired
    // fillfactor an earlier build set), and the budget table predates any
    // storage parameters.
    await pool.query(`CREATE TABLE "${schema}".bank_ledger (id BIGSERIAL PRIMARY KEY)`);
    await pool.query(
      `CREATE TABLE "${schema}".bank_ledger_growth_pending (
         transaction_id xid8 PRIMARY KEY,
         inserted_rows BIGINT NOT NULL CHECK (inserted_rows > 0)
       ) WITH (autovacuum_vacuum_scale_factor = 0.0, autovacuum_vacuum_threshold = 100, fillfactor = 70)`,
    );
    // A hand-tuned NON-NUMERIC reloption rides along: the probe's CASE keeps
    // the numeric cast away from it, so the boot transaction cannot abort on
    // "invalid input syntax for type numeric".
    await pool.query(
      `ALTER TABLE "${schema}".bank_ledger_growth_pending SET (autovacuum_enabled = false)`,
    );
    await pool.query(
      `CREATE TABLE "${schema}".bank_ledger_growth_budget (
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
         committed_rows BIGINT NOT NULL CHECK (committed_rows >= 0),
         hard_limit_rows BIGINT NOT NULL CHECK (hard_limit_rows > 0),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const optionsOf = async (table: string): Promise<readonly string[]> =>
      (
        await pool.query(
          `SELECT reloptions FROM pg_catalog.pg_class
            WHERE oid = '"${schema}".${table}'::pg_catalog.regclass`,
        )
      ).rows[0].reloptions;
    const versionOf = async (table: string): Promise<string> =>
      (
        await pool.query(
          `SELECT xmin::text AS v FROM pg_catalog.pg_class
            WHERE oid = '"${schema}".${table}'::pg_catalog.regclass`,
        )
      ).rows[0].v;

    await pool.query(growth.bankLedgerGrowthBudgetSchema(schema));
    // The '0.0' rendering parses equal, so the pending ALTER must be skipped:
    // an ALTER SET would have rewritten the stored text to '0' and this pin
    // would see it. The retired fillfactor rides along untouched. The bare
    // budget table converges once.
    expect(await optionsOf('bank_ledger_growth_pending')).toEqual(
      expect.arrayContaining([
        'autovacuum_vacuum_scale_factor=0.0',
        'autovacuum_vacuum_threshold=100',
        'fillfactor=70',
        'autovacuum_enabled=false',
      ]),
    );
    expect(await optionsOf('bank_ledger_growth_budget')).toEqual(
      expect.arrayContaining([
        'autovacuum_vacuum_scale_factor=0',
        'autovacuum_vacuum_threshold=1000',
      ]),
    );
    // PARTIAL drift: one option right, one wrong. The count-of-two probe
    // must see 1 and FIRE the ALTER (a probe that any-matched would skip).
    await pool.query(
      `ALTER TABLE "${schema}".bank_ledger_growth_budget SET (autovacuum_vacuum_threshold = 7)`,
    );
    await pool.query(growth.bankLedgerGrowthBudgetSchema(schema));
    expect(await optionsOf('bank_ledger_growth_budget')).toEqual(
      expect.arrayContaining([
        'autovacuum_vacuum_scale_factor=0',
        'autovacuum_vacuum_threshold=1000',
      ]),
    );
    // Steady state after convergence: a second apply touches neither table's
    // pg_class row at all (triggers exist, tables exist, both probes skip).
    const pendingAfter = await versionOf('bank_ledger_growth_pending');
    const budgetAfter = await versionOf('bank_ledger_growth_budget');
    await pool.query(growth.bankLedgerGrowthBudgetSchema(schema));
    expect(await versionOf('bank_ledger_growth_pending')).toBe(pendingAfter);
    expect(await versionOf('bank_ledger_growth_budget')).toBe(budgetAfter);
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  });

  it('raises config drift, not capacity, when the singleton limit moves under a running process', async () => {
    await pool.query(`CREATE SCHEMA "${CONFIG_DRIFT_SCHEMA}"`);
    await pool.query(
      `CREATE TABLE "${CONFIG_DRIFT_SCHEMA}".bank_ledger (id BIGSERIAL PRIMARY KEY)`,
    );
    await pool.query(growth.bankLedgerGrowthBudgetSchema(CONFIG_DRIFT_SCHEMA));
    await pool.query(`INSERT INTO "${CONFIG_DRIFT_SCHEMA}".bank_ledger DEFAULT VALUES`);

    // The operator raised the singleton while this process still holds its
    // compiled limit of 4. The next insert is visibly UNDER both limits, so
    // the generic capacity error would carry self-contradicting evidence; the
    // enforcer must name the drift instead.
    await pool.query(
      `UPDATE "${CONFIG_DRIFT_SCHEMA}".bank_ledger_growth_budget SET hard_limit_rows = 9`,
    );
    let driftError: unknown;
    try {
      await pool.query(`INSERT INTO "${CONFIG_DRIFT_SCHEMA}".bank_ledger DEFAULT VALUES`);
      expect.unreachable('the drifted insert must be refused');
    } catch (error) {
      driftError = error;
    }
    expect(driftError).toMatchObject({
      code: '22023',
      message: expect.stringContaining('BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS config drift'),
    });
    expect(JSON.parse(String((driftError as { detail?: string }).detail ?? 'null'))).toMatchObject({
      stored_hard_limit_rows: 9,
      configured_hard_limit_rows: 4,
    });
    // Drift is NOT a growth refusal: the client-side converter must leave it
    // alone so it surfaces as the distinct operator emergency it is.
    expect(growth.bankLedgerGrowthLimitFromError(driftError)).toBeNull();

    // The refused transaction rolled back whole: no ledger row landed, no
    // pending row leaked, and the singleton kept its pre-drift count.
    const state = await pool.query(
      `SELECT (SELECT count(*) FROM "${CONFIG_DRIFT_SCHEMA}".bank_ledger) AS ledger_rows,
              (SELECT count(*) FROM "${CONFIG_DRIFT_SCHEMA}".bank_ledger_growth_pending) AS pending_rows,
              (SELECT committed_rows FROM "${CONFIG_DRIFT_SCHEMA}".bank_ledger_growth_budget) AS committed_rows`,
    );
    expect(state.rows).toEqual([{ ledger_rows: '1', pending_rows: '0', committed_rows: '1' }]);
  });

  it('accumulates separate INSERT statements once per transaction and rejects their combined excess', async () => {
    await pool.query(`CREATE SCHEMA "${MULTI_STATEMENT_SCHEMA}"`);
    await pool.query(`CREATE TABLE "${MULTI_STATEMENT_SCHEMA}".bank_ledger (
      id BIGSERIAL PRIMARY KEY,
      item_id TEXT NOT NULL
    )`);
    await pool.query(growth.bankLedgerGrowthBudgetSchema(MULTI_STATEMENT_SCHEMA));

    const admitted = await pool.connect();
    try {
      await admitted.query('BEGIN');
      await admitted.query(
        `INSERT INTO "${MULTI_STATEMENT_SCHEMA}".bank_ledger (item_id) VALUES ('first')`,
      );
      await admitted.query(
        `INSERT INTO "${MULTI_STATEMENT_SCHEMA}".bank_ledger (item_id) VALUES ('second')`,
      );
      expect(
        Number(
          (
            await admitted.query(
              `SELECT inserted_rows FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger_growth_pending
                WHERE transaction_id = pg_catalog.pg_current_xact_id()`,
            )
          ).rows[0].inserted_rows,
        ),
      ).toBe(2);
      expect(
        Number(
          (
            await admitted.query(
              `SELECT committed_rows FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger_growth_budget`,
            )
          ).rows[0].committed_rows,
        ),
      ).toBe(0);
      await admitted.query('COMMIT');
    } finally {
      await admitted.query('ROLLBACK').catch(() => {});
      admitted.release();
    }
    expect(
      Number(
        (
          await pool.query(
            `SELECT committed_rows FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger_growth_budget`,
          )
        ).rows[0].committed_rows,
      ),
    ).toBe(2);
    expect(
      Number(
        (
          await pool.query(
            `SELECT count(*) FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger_growth_pending`,
          )
        ).rows[0].count,
      ),
    ).toBe(0);

    const refused = await pool.connect();
    try {
      await refused.query('BEGIN');
      await refused.query(
        `INSERT INTO "${MULTI_STATEMENT_SCHEMA}".bank_ledger (item_id) VALUES ('third')`,
      );
      await refused.query(
        `INSERT INTO "${MULTI_STATEMENT_SCHEMA}".bank_ledger (item_id)
         VALUES ('fourth'), ('fifth')`,
      );
      expect(
        Number(
          (
            await refused.query(
              `SELECT inserted_rows FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger_growth_pending
                WHERE transaction_id = pg_catalog.pg_current_xact_id()`,
            )
          ).rows[0].inserted_rows,
        ),
      ).toBe(3);
      await expect(refused.query('COMMIT')).rejects.toMatchObject({
        code: growth.BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
        constraint: growth.BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      });
    } finally {
      await refused.query('ROLLBACK').catch(() => {});
      refused.release();
    }
    expect(
      Number(
        (
          await pool.query(
            `SELECT committed_rows FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger_growth_budget`,
          )
        ).rows[0].committed_rows,
      ),
    ).toBe(2);
    expect(
      Number(
        (await pool.query(`SELECT count(*) FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger`)).rows[0]
          .count,
      ),
    ).toBe(2);
    expect(
      Number(
        (
          await pool.query(
            `SELECT count(*) FROM "${MULTI_STATEMENT_SCHEMA}".bank_ledger_growth_pending`,
          )
        ).rows[0].count,
      ),
    ).toBe(0);
  });

  it('counts a raw writer that held the ledger lock before bootstrap published triggers', async () => {
    await pool.query(`CREATE SCHEMA "${BOOTSTRAP_RACE_SCHEMA}"`);
    await pool.query(`CREATE TABLE "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger (
      id BIGSERIAL PRIMARY KEY,
      item_id TEXT NOT NULL
    )`);
    const writer = await pool.connect();
    const bootstrap = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`LOCK TABLE "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger IN ROW EXCLUSIVE MODE`);
      const bootstrapPid = Number(
        (await bootstrap.query('SELECT pg_catalog.pg_backend_pid() AS pid')).rows[0].pid,
      );
      const boot = bootstrap.query(growth.bankLedgerGrowthBudgetSchema(BOOTSTRAP_RACE_SCHEMA));

      let sawBootstrapWait = false;
      for (let attempt = 0; attempt < 100 && !sawBootstrapWait; attempt++) {
        sawBootstrapWait = Boolean(
          (
            await writer.query(
              `SELECT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_stat_activity
                  WHERE pid = $1 AND wait_event_type = 'Lock'
               ) AS waiting`,
              [bootstrapPid],
            )
          ).rows[0].waiting,
        );
        if (!sawBootstrapWait) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(sawBootstrapWait).toBe(true);

      await writer.query(
        `INSERT INTO "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger (item_id)
         VALUES ('pre-bootstrap-raw')`,
      );
      await writer.query('COMMIT');
      await boot;
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
      bootstrap.release();
    }

    expect(
      (
        await pool.query(
          `SELECT committed_rows, hard_limit_rows
             FROM "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger_growth_budget`,
        )
      ).rows,
    ).toEqual([{ committed_rows: '1', hard_limit_rows: '4' }]);
    await pool.query(
      `INSERT INTO "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger (item_id)
       VALUES ('post-bootstrap-guarded')`,
    );
    expect(
      Number(
        (
          await pool.query(
            `SELECT committed_rows
               FROM "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger_growth_budget`,
          )
        ).rows[0].committed_rows,
      ),
    ).toBe(2);

    const shadowed = await pool.connect();
    try {
      await shadowed.query('BEGIN');
      await shadowed.query('CREATE TEMP TABLE inserted_bank_ledger_rows (id INT) ON COMMIT DROP');
      await shadowed.query(
        'INSERT INTO pg_temp.inserted_bank_ledger_rows SELECT FROM pg_catalog.generate_series(1, 100)',
      );
      await shadowed.query(
        `INSERT INTO "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger (item_id)
         VALUES ('transition-table-not-temp-shadow')`,
      );
      await shadowed.query('COMMIT');
    } finally {
      await shadowed.query('ROLLBACK').catch(() => {});
      shadowed.release();
    }
    expect(
      Number(
        (
          await pool.query(
            `SELECT committed_rows
               FROM "${BOOTSTRAP_RACE_SCHEMA}".bank_ledger_growth_budget`,
          )
        ).rows[0].committed_rows,
      ),
    ).toBe(3);
  });

  it('fails boot on enabled wrong-function and WHEN-false trigger replacements', async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION "${SCHEMA}".ignore_bank_ledger_growth()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog, "${SCHEMA}"
      AS $wrong_growth$
      BEGIN
        RETURN NULL;
      END
      $wrong_growth$`);
    await pool.query(
      `DROP TRIGGER bank_ledger_growth_budget_insert ON "${SCHEMA}".bank_ledger;
       CREATE TRIGGER bank_ledger_growth_budget_insert
       AFTER INSERT ON "${SCHEMA}".bank_ledger
       REFERENCING NEW TABLE AS inserted_bank_ledger_rows
       FOR EACH STATEMENT
       EXECUTE FUNCTION "${SCHEMA}".ignore_bank_ledger_growth()`,
    );
    await expect(pool.query(growthSchema)).rejects.toThrow(/insert has an unsafe definition/);
    await pool.query(
      `DROP TRIGGER bank_ledger_growth_budget_insert ON "${SCHEMA}".bank_ledger;
       CREATE TRIGGER bank_ledger_growth_budget_insert
       AFTER INSERT ON "${SCHEMA}".bank_ledger
       REFERENCING NEW TABLE AS inserted_bank_ledger_rows
       FOR EACH STATEMENT
       EXECUTE FUNCTION "${SCHEMA}".accumulate_bank_ledger_growth_budget()`,
    );

    await pool.query(
      `DROP TRIGGER bank_ledger_growth_budget_commit
         ON "${SCHEMA}".bank_ledger_growth_pending;
       CREATE CONSTRAINT TRIGGER bank_ledger_growth_budget_commit
       AFTER INSERT OR UPDATE ON "${SCHEMA}".bank_ledger_growth_pending
       DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW
       WHEN (FALSE)
       EXECUTE FUNCTION "${SCHEMA}".enforce_bank_ledger_growth_budget()`,
    );
    await expect(pool.query(growthSchema)).rejects.toThrow(/commit has an unsafe definition/);
    await pool.query(
      `DROP TRIGGER bank_ledger_growth_budget_commit
         ON "${SCHEMA}".bank_ledger_growth_pending;
       CREATE CONSTRAINT TRIGGER bank_ledger_growth_budget_commit
       AFTER INSERT OR UPDATE ON "${SCHEMA}".bank_ledger_growth_pending
       DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW
       EXECUTE FUNCTION "${SCHEMA}".enforce_bank_ledger_growth_budget()`,
    );
    await expect(pool.query(growthSchema)).resolves.toBeDefined();
  });

  it('fails boot on a durable limit mismatch or orphaned transaction accumulator', async () => {
    await pool.query(
      `UPDATE "${SCHEMA}".bank_ledger_growth_budget SET hard_limit_rows = 3 WHERE singleton`,
    );
    await expect(pool.query(growthSchema)).rejects.toMatchObject({ code: '22023' });
    await pool.query(
      `UPDATE "${SCHEMA}".bank_ledger_growth_budget SET hard_limit_rows = 4 WHERE singleton`,
    );

    await pool.query(
      `ALTER TABLE "${SCHEMA}".bank_ledger_growth_pending
       DISABLE TRIGGER bank_ledger_growth_budget_commit`,
    );
    await pool.query(
      `INSERT INTO "${SCHEMA}".bank_ledger_growth_pending (transaction_id, inserted_rows)
       VALUES (pg_catalog.pg_current_xact_id(), 1)`,
    );
    await pool.query(
      `ALTER TABLE "${SCHEMA}".bank_ledger_growth_pending
       ENABLE TRIGGER bank_ledger_growth_budget_commit`,
    );
    await expect(pool.query(growthSchema)).rejects.toThrow(/orphaned pending rows/);
    await pool.query(`DELETE FROM "${SCHEMA}".bank_ledger_growth_pending`);
    await expect(pool.query(growthSchema)).resolves.toBeDefined();
  });

  it('fails boot if the named trigger was disabled or replaced', async () => {
    await pool.query(
      `ALTER TABLE "${SCHEMA}".bank_ledger DISABLE TRIGGER bank_ledger_growth_budget_insert`,
    );
    await expect(pool.query(growthSchema)).rejects.toThrow(/unsafe definition/);
    await pool.query(
      `ALTER TABLE "${SCHEMA}".bank_ledger ENABLE TRIGGER bank_ledger_growth_budget_insert`,
    );
    await expect(pool.query(growthSchema)).resolves.toBeDefined();

    await pool.query(
      `ALTER TABLE "${SCHEMA}".bank_ledger_growth_pending
       DISABLE TRIGGER bank_ledger_growth_budget_commit`,
    );
    await expect(pool.query(growthSchema)).rejects.toThrow(/unsafe definition/);
    await pool.query(
      `ALTER TABLE "${SCHEMA}".bank_ledger_growth_pending
       ENABLE TRIGGER bank_ledger_growth_budget_commit`,
    );
    await expect(pool.query(growthSchema)).resolves.toBeDefined();

    await pool.query(`DROP TRIGGER bank_ledger_growth_budget_insert ON "${SCHEMA}".bank_ledger`);
    await pool.query(insertSql, ledgerValues('missing_trigger_gap'));
    expect(await budgetRows()).toBe(4);
    expect(
      Number((await pool.query(`SELECT count(*) FROM "${SCHEMA}".bank_ledger`)).rows[0].count),
    ).toBe(5);
    await expect(pool.query(growthSchema)).rejects.toThrow(/missing an enforcement trigger/);
    expect(await budgetRows()).toBe(4);
  });
});
