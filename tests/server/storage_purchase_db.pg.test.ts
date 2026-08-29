// Bank Storage phase 11: the EXECUTED proof for storage_purchase_db.ts
// against real PostgreSQL (the novel-SQL rule: a fake pool cannot tell whether
// SQL parses, locks converge, or a partial unique index is authoritative).
// The PG16 CI shard provides TEST_DATABASE_URL; local runs without it skip and
// retain the always-on text pins in storage_purchase_db.test.ts.
//
// The FK parents are MINIMAL STAND-INS (id-only accounts/characters): this
// suite proves the storage_purchases DDL and queries, not the core schema,
// and the production parents exist long before ensureSchema reaches this
// module.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL ?? '';
const d = url === '' ? describe.skip : describe;

// A PRIVATE schema, the repo idiom for every other database-gated suite
// (tests/discord_db_integration.test.ts, admin_account_db_integration.test.ts,
// daily_rewards_db_integration.test.ts). It is not tidiness: this suite
// DROPS its table in both beforeAll and afterAll, and the module functions it
// drives issue UNQUALIFIED SQL, so without an isolated search_path a developer
// who points TEST_DATABASE_URL at a database that already carries the game
// schema (the documented local dev database is on the same 127.0.0.1:5433 the
// user-space Postgres harness uses) destroys the REAL storage_purchases table.
// That table is the only durable record of a paid-but-unapplied grant, and
// 'unresolved' rows are documented as kept forever for operator attention, so
// dropping it loses money records that nothing can reconstruct. Proven on a
// live database during the Bank Storage phase 11 QA go-live pass: the suite
// dropped 13 real rows and then failed anyway, because CREATE TABLE IF NOT
// EXISTS accounts found the real accounts table and the id-only INSERT
// violated its NOT NULL columns.
const SCHEMA = 'storage_purchase_pg_test';

d('storage_purchases against real PostgreSQL', () => {
  // Imported lazily so the suite skips clean without pg installed state.
  let pool: import('pg').Pool;
  let db: {
    beginStoragePurchase: typeof import('../../server/storage_purchase_db').beginStoragePurchase;
    claimStoragePurchaseSpend: typeof import('../../server/storage_purchase_db').claimStoragePurchaseSpend;
    storagePurchaseByKey: typeof import('../../server/storage_purchase_db').storagePurchaseByKey;
    settleStoragePurchase: typeof import('../../server/storage_purchase_db').settleStoragePurchase;
    deletePendingStoragePurchaseWithoutDebit: typeof import('../../server/storage_purchase_db').deletePendingStoragePurchaseWithoutDebit;
    openStoragePurchaseForCharacter: typeof import('../../server/storage_purchase_db').openStoragePurchaseForCharacter;
    pendingStoragePurchasesForCharacter: typeof import('../../server/storage_purchase_db').pendingStoragePurchasesForCharacter;
    renewStoragePurchaseSpendClaim: typeof import('../../server/storage_purchase_db').renewStoragePurchaseSpendClaim;
    lockStorageAppliedEffectAccountsOnClient: typeof import('../../server/storage_purchase_db').lockStorageAppliedEffectAccountsOnClient;
    writeStorageAppliedEffectsOnClient: typeof import('../../server/storage_purchase_db').writeStorageAppliedEffectsOnClient;
    StoragePurchaseDbAborted: typeof import('../../server/storage_purchase_db').StoragePurchaseDbAborted;
    storagePurchaseSchema: typeof import('../../server/storage_purchase_db').storagePurchaseSchema;
    STORAGE_PURCHASE_SIGNAL_STATEMENT_TIMEOUT_MS: number;
    STORAGE_PURCHASE_TX_LOCK_TIMEOUT_MS: number;
  };
  let storageSchema: string;

  const ROW = {
    realm: 'pgtest',
    accountId: 1,
    characterId: 1,
    itemId: 'strongbox_rung_01',
    expectedCostClaudium: 100,
    idempotencyKey: 'pg-key-1',
    claimToken: '00000000-0000-4000-8000-000000000001',
  };

  beforeAll(async () => {
    const { Pool } = await import('pg');
    db = await import('../../server/storage_purchase_db');
    // search_path is a STARTUP option so the module functions, which take the
    // pool and issue unqualified SQL, land in the private schema.
    pool = new Pool({
      connectionString: url,
      max: 2,
      options: `-c search_path=${SCHEMA}`,
      application_name: SCHEMA,
      statement_timeout: 15_000,
    });
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    await pool.query('CREATE TABLE accounts (id SERIAL PRIMARY KEY)');
    await pool.query('CREATE TABLE characters (id SERIAL PRIMARY KEY)');
    await pool.query(`CREATE TABLE bank_ledger (
      id BIGSERIAL PRIMARY KEY,
      realm TEXT NOT NULL,
      character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      op TEXT NOT NULL,
      item_id TEXT,
      count INT,
      instance JSONB,
      copper_delta BIGINT NOT NULL DEFAULT 0,
      purchased_slots_after INT NOT NULL,
      container TEXT NOT NULL,
      container_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const growth = await import('../../server/bank_ledger_growth_budget');
    await pool.query(growth.bankLedgerGrowthBudgetSchema(SCHEMA));
    await pool.query('INSERT INTO accounts (id) VALUES (1), (2)');
    await pool.query('INSERT INTO characters (id) VALUES (1), (2)');
    // The DDL executes for real, twice: idempotency is part of the contract
    // (ensureSchema re-runs it at every boot).
    storageSchema = db.storagePurchaseSchema(SCHEMA);
    await pool.query(storageSchema);
    await pool.query(storageSchema);
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    await pool.end();
    // Drop the whole private schema, never a bare table name: a DROP TABLE
    // here would resolve through whatever search_path the connection ended up
    // with and could take the real table with it.
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  });

  it("runs entirely inside its private schema, never the caller's default", async () => {
    // The isolation IS the safety property, so it gets its own decisive pin:
    // every unqualified write the module makes must land in SCHEMA. A regression
    // that drops the search_path option shows up here rather than as a silently
    // destroyed production table.
    const where = await pool.query('SELECT current_schema() AS s');
    expect(where.rows[0].s).toBe(SCHEMA);
    const owner = await pool.query(
      "SELECT schemaname FROM pg_tables WHERE tablename = 'storage_purchases'",
    );
    expect(owner.rows.map((r: { schemaname: string }) => r.schemaname)).toContain(SCHEMA);
  });

  it("restores a caller's transaction-scoped search_path after the fragment", async () => {
    // The restore is ENFORCED, not a precondition on the boot client: the
    // fragment captures the in-flight search_path before its own SET LOCAL
    // and replays it at the end. Drive the case the old TO DEFAULT tail got
    // wrong: a caller with its own SET LOCAL search_path in flight. After the
    // fragment the caller's value (pg_catalog here, NOT the session default,
    // which this pool pins to SCHEMA via its startup option) must still be
    // live, and COMMIT must still drop back to the session default so nothing
    // leaks across transactions on the pooled connection.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path = pg_catalog');
      await client.query(storageSchema);
      const inTx = await client.query("SELECT current_setting('search_path') AS sp");
      expect(inTx.rows[0].sp).toBe('pg_catalog');
      await client.query('COMMIT');
      const after = await client.query("SELECT current_setting('search_path') AS sp");
      expect(after.rows[0].sp).toBe(SCHEMA);
    } finally {
      client.release();
    }
  });

  it('a discarded capture degrades to the session default, never an empty search_path', async () => {
    // The replay's precondition is the whole fragment in ONE transaction with
    // no savepoint rollback in between: a rollback to a savepoint taken
    // before the capture DISCARDS the transaction-scoped GUC, after which
    // current_setting answers EMPTY STRING, and an unguarded replay would
    // silently SET search_path to empty for the rest of the transaction.
    // Drive that path with the replay statement extracted from the LIVE
    // fragment and prove the guarded fallback lands on the session default
    // (the old TO DEFAULT behavior) instead.
    const replay = storageSchema.slice(storageSchema.lastIndexOf('SELECT set_config('));
    expect(replay).toContain("current_setting('woc.storage_purchase_prior_search_path', true)");
    expect(replay).toContain("(SELECT reset_val FROM pg_settings WHERE name = 'search_path')");
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SAVEPOINT capture_window');
      await client.query(
        "SELECT set_config('woc.storage_purchase_prior_search_path', current_setting('search_path'), true)",
      );
      await client.query('ROLLBACK TO SAVEPOINT capture_window');
      await client.query(replay);
      const sp = await client.query("SELECT current_setting('search_path') AS sp");
      expect(sp.rows[0].sp).toBe(SCHEMA);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // The never-registered arm: on a session that has never set the GUC the
    // unguarded read raised 42704; the guarded replay must instead settle on
    // the session default. A dedicated connection, because the pool's
    // sessions may have registered the GUC through earlier fragment runs.
    const { Client } = await import('pg');
    const fresh = new Client({ connectionString: url });
    await fresh.connect();
    try {
      const def = await fresh.query("SELECT reset_val FROM pg_settings WHERE name = 'search_path'");
      await fresh.query('BEGIN');
      await fresh.query(replay);
      const sp = await fresh.query("SELECT current_setting('search_path') AS sp");
      expect(sp.rows[0].sp).toBe(def.rows[0].reset_val);
      await fresh.query('COMMIT');
    } finally {
      await fresh.end();
    }
  });

  it('materialized operational rows, deletion-proof receipts, triggers, and indexes', async () => {
    const reg = await pool.query(`SELECT to_regclass('${SCHEMA}.storage_purchases') AS reg`);
    expect(reg.rows[0].reg).toBe('storage_purchases');
    const idx = await pool.query(
      'SELECT indexname, indexdef FROM pg_indexes ' +
        `WHERE schemaname = '${SCHEMA}' AND tablename = 'storage_purchases' ORDER BY indexname`,
    );
    const defs = new Map<string, string>(
      idx.rows.map((r: { indexname: string; indexdef: string }) => [r.indexname, r.indexdef]),
    );
    // The FK indexes are FULL (no WHERE): they must serve the ON DELETE
    // CASCADE lookups, which a partial index cannot.
    expect(defs.has('storage_purchases_character')).toBe(true);
    expect(defs.get('storage_purchases_character')).not.toContain('WHERE');
    expect(defs.has('storage_purchases_account')).toBe(true);
    expect(defs.get('storage_purchases_account')).not.toContain('WHERE');
    expect(defs.has('storage_purchases_character_pending')).toBe(false);
    expect(defs.has('storage_purchases_one_pending_per_character')).toBe(false);
    const openDef = defs.get('storage_purchases_one_open_per_character') ?? '';
    expect(openDef).toContain('UNIQUE INDEX');
    expect(openDef).toContain('USING btree (character_id)');
    expect(openDef).toContain("WHERE (status = ANY (ARRAY['pending'::text, 'unresolved'::text]))");
    const openAuthority = await pool.query(
      `SELECT indexrelid::regclass::text AS name, indisunique, indisvalid, indisready,
              pg_get_expr(indpred, indrelid) AS predicate
         FROM pg_index
        WHERE indexrelid = '${SCHEMA}.storage_purchases_one_open_per_character'::regclass`,
    );
    expect(openAuthority.rows).toEqual([
      expect.objectContaining({
        name: 'storage_purchases_one_open_per_character',
        indisunique: true,
        indisvalid: true,
        indisready: true,
        predicate: "(status = ANY (ARRAY['pending'::text, 'unresolved'::text]))",
      }),
    ]);
    expect(defs.has('storage_purchases_refused')).toBe(false);

    const receipt = await pool.query(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'storage_purchase_applied_receipts'`,
      [SCHEMA],
    );
    const receiptColumns = new Map(
      receipt.rows.map((row: { column_name: string; is_nullable: string }) => [
        row.column_name,
        row.is_nullable,
      ]),
    );
    expect(receiptColumns.get('character_id')).toBe('NO');
    expect(receiptColumns.get('purchased_slots_before')).toBe('YES');
    expect(receiptColumns.get('purchased_slots_after')).toBe('YES');
    const receiptConstraints = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = '${SCHEMA}.storage_purchase_applied_receipts'::regclass`,
    );
    const constraintText = receiptConstraints.rows
      .map((row: { def: string }) => row.def)
      .join('\n');
    const fkText = receiptConstraints.rows
      .map((row: { def: string }) => row.def)
      .filter((def: string) => def.startsWith('FOREIGN KEY'))
      .join('\n');
    expect(fkText).toContain('account_id');
    expect(fkText).not.toContain('character_id');
    expect(constraintText).toContain('purchased_slots_after > purchased_slots_before');
    const triggers = await pool.query(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = '${SCHEMA}.storage_purchases'::regclass AND NOT tgisinternal`,
    );
    expect(triggers.rows.map((row: { tgname: string }) => row.tgname).sort()).toEqual([
      'storage_purchase_archive_applied',
      'storage_purchase_guard_consumed_key',
    ]);

    const functions = await pool.query(
      `SELECT proname, proconfig
         FROM pg_catalog.pg_proc
        WHERE pronamespace = '${SCHEMA}'::pg_catalog.regnamespace
          AND proname = ANY($1::text[])
        ORDER BY proname`,
      [
        [
          'archive_storage_purchase_applied_receipt',
          'guard_pending_storage_purchase_parent_delete',
          'guard_storage_purchase_consumed_key',
        ],
      ],
    );
    expect(functions.rows).toEqual([
      {
        proname: 'archive_storage_purchase_applied_receipt',
        proconfig: [`search_path=pg_catalog, ${SCHEMA}, pg_temp`],
      },
      {
        proname: 'guard_pending_storage_purchase_parent_delete',
        proconfig: [`search_path=pg_catalog, ${SCHEMA}, pg_temp`],
      },
      {
        proname: 'guard_storage_purchase_consumed_key',
        proconfig: [`search_path=pg_catalog, ${SCHEMA}, pg_temp`],
      },
    ]);
  });

  it('keeps trigger authority under counterfeit and temporary relation shadows', async () => {
    const counterfeit = `${SCHEMA}_counterfeit`;
    await pool.query(`DROP SCHEMA IF EXISTS "${counterfeit}" CASCADE`);
    await pool.query(`CREATE SCHEMA "${counterfeit}"`);
    await pool.query(`CREATE TABLE "${counterfeit}".accounts (id INT PRIMARY KEY)`);
    await pool.query(`CREATE TABLE "${counterfeit}".characters (id INT PRIMARY KEY)`);
    await pool.query(`CREATE TABLE "${counterfeit}".storage_purchases (
      account_id INT NOT NULL,
      character_id INT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL
    )`);
    await pool.query(
      `CREATE TABLE "${counterfeit}".storage_purchase_applied_receipts AS
       SELECT * FROM "${SCHEMA}".storage_purchase_applied_receipts WITH NO DATA`,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TEMP TABLE accounts (id INT PRIMARY KEY) ON COMMIT DROP');
      await client.query('CREATE TEMP TABLE characters (id INT PRIMARY KEY) ON COMMIT DROP');
      await client.query(`CREATE TEMP TABLE storage_purchases (
        account_id INT NOT NULL,
        character_id INT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL
      ) ON COMMIT DROP`);
      await client.query(
        `CREATE TEMP TABLE storage_purchase_applied_receipts
         ON COMMIT DROP AS
         SELECT * FROM "${SCHEMA}".storage_purchase_applied_receipts WITH NO DATA`,
      );
      await client.query(`SET LOCAL search_path = "${counterfeit}", "${SCHEMA}"`);
      await client.query(`INSERT INTO "${SCHEMA}".accounts (id) VALUES (91), (92)`);
      await client.query(`INSERT INTO "${SCHEMA}".characters (id) VALUES (91), (92)`);
      await client.query(`INSERT INTO "${counterfeit}".accounts (id) VALUES (91), (92)`);
      await client.query(`INSERT INTO "${counterfeit}".characters (id) VALUES (91), (92)`);
      await client.query('INSERT INTO pg_temp.accounts (id) VALUES (91), (92)');
      await client.query('INSERT INTO pg_temp.characters (id) VALUES (91), (92)');
      await client.query(
        `INSERT INTO "${counterfeit}".storage_purchases
           (account_id, character_id, idempotency_key, status)
         VALUES (91, 91, 'counterfeit-open', 'pending')`,
      );
      await client.query(
        `INSERT INTO pg_temp.storage_purchases
           (account_id, character_id, idempotency_key, status)
         VALUES (91, 91, 'temporary-open', 'pending')`,
      );

      // The trusted parent-delete guard must not consult the counterfeit open
      // row even though that schema appears first in the caller's path.
      await expect(
        client.query(`DELETE FROM "${SCHEMA}".characters WHERE id = 91`),
      ).resolves.toMatchObject({ rowCount: 1 });

      await client.query(
        `INSERT INTO "${counterfeit}".storage_purchase_applied_receipts
           (source_purchase_id, realm, account_id, character_id, item_id,
            expected_cost_claudium, idempotency_key, purchased_slots_before,
            purchased_slots_after, applied_at)
         VALUES (999, 'counterfeit', 92, 92, 'fake', 1, 'trusted-authority-key',
                 NULL, NULL, now())`,
      );
      await client.query(
        `INSERT INTO pg_temp.storage_purchase_applied_receipts
           (source_purchase_id, realm, account_id, character_id, item_id,
            expected_cost_claudium, idempotency_key, purchased_slots_before,
            purchased_slots_after, applied_at)
         VALUES (998, 'temporary', 92, 92, 'fake', 1, 'trusted-authority-key',
                 NULL, NULL, now())`,
      );
      const inserted = await client.query(
        `INSERT INTO "${SCHEMA}".storage_purchases
           (realm, account_id, character_id, item_id, expected_cost_claudium,
            idempotency_key)
         VALUES ('pgtest', 92, 92, 'strongbox_rung_01', 100, 'trusted-authority-key')`,
      );
      expect(inserted.rowCount).toBe(1);
      await client.query(
        `UPDATE "${SCHEMA}".storage_purchases
            SET status = 'applied', resolved_at = now()
          WHERE idempotency_key = 'trusted-authority-key'`,
      );
      expect(
        Number(
          (
            await client.query(
              `SELECT count(*) FROM "${SCHEMA}".storage_purchase_applied_receipts
                WHERE idempotency_key = 'trusted-authority-key'`,
            )
          ).rows[0].count,
        ),
      ).toBe(1);
      expect(
        Number(
          (
            await client.query(
              `SELECT count(*) FROM pg_temp.storage_purchase_applied_receipts
                WHERE idempotency_key = 'trusted-authority-key'`,
            )
          ).rows[0].count,
        ),
      ).toBe(1);
      expect(
        Number(
          (
            await client.query(
              `SELECT count(*) FROM "${counterfeit}".storage_purchase_applied_receipts
                WHERE idempotency_key = 'trusted-authority-key'`,
            )
          ).rows[0].count,
        ),
      ).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      await pool.query(`DROP SCHEMA IF EXISTS "${counterfeit}" CASCADE`);
    }
  });

  it('repairs a same-named but non-authoritative open-rail index', async () => {
    await pool.query('DROP INDEX storage_purchases_one_open_per_character');
    await pool.query(`CREATE UNIQUE INDEX storage_purchases_one_open_per_character
      ON storage_purchases (id) WHERE status = 'unresolved'`);
    await pool.query(storageSchema);
    const repaired = await pool.query(
      `SELECT i.indisunique, a.attname,
              pg_get_expr(i.indpred, i.indrelid) AS predicate
         FROM pg_index i
         JOIN pg_attribute a
           ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indexrelid = '${SCHEMA}.storage_purchases_one_open_per_character'::regclass`,
    );
    expect(repaired.rows).toEqual([
      {
        indisunique: true,
        attname: 'character_id',
        predicate: "(status = ANY (ARRAY['pending'::text, 'unresolved'::text]))",
      },
    ]);
  });

  it('fails schema repair closed when legacy data has two open rows for one character', async () => {
    const first = {
      ...ROW,
      accountId: 2,
      characterId: 2,
      idempotencyKey: 'pg-duplicate-open-unresolved',
      claimToken: '00000000-0000-4000-8000-000000000071',
    };
    const second = {
      ...first,
      idempotencyKey: 'pg-duplicate-open-pending',
      claimToken: '00000000-0000-4000-8000-000000000072',
    };
    await pool.query('DROP INDEX storage_purchases_one_open_per_character');
    try {
      await db.beginStoragePurchase(pool, first);
      await db.settleStoragePurchase(pool, first.idempotencyKey, 'unresolved', first.claimToken);
      await db.beginStoragePurchase(pool, second);

      await expect(pool.query(storageSchema)).rejects.toMatchObject({ code: '23505' });
      const preserved = await pool.query(
        `SELECT idempotency_key, status FROM storage_purchases
          WHERE character_id = 2 AND status IN ('pending', 'unresolved')
          ORDER BY idempotency_key`,
      );
      expect(preserved.rows).toEqual([
        { idempotency_key: second.idempotencyKey, status: 'pending' },
        { idempotency_key: first.idempotencyKey, status: 'unresolved' },
      ]);
    } finally {
      await pool.query(
        `DELETE FROM storage_purchases
          WHERE idempotency_key = ANY($1::text[])`,
        [[first.idempotencyKey, second.idempotencyKey]],
      );
      await pool.query(storageSchema);
    }
  });

  it('repairs a same-named weak or unvalidated spend-claim constraint', async () => {
    await pool.query('ALTER TABLE storage_purchases DROP CONSTRAINT storage_purchases_claim_pair');
    await pool.query(`ALTER TABLE storage_purchases
      ADD CONSTRAINT storage_purchases_claim_pair
      CHECK (spend_claim_token IS NULL OR spend_claim_token IS NOT NULL) NOT VALID`);
    await pool.query(storageSchema);
    const repaired = await pool.query(
      `SELECT convalidated, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname = 'storage_purchases_claim_pair'
          AND conrelid = 'storage_purchases'::regclass`,
    );
    expect(repaired.rows).toEqual([
      expect.objectContaining({
        convalidated: true,
        def: expect.stringContaining('spend_claim_expires_at IS NOT NULL'),
      }),
    ]);
    await expect(
      pool.query(
        `INSERT INTO storage_purchases
           (realm, account_id, character_id, item_id, expected_cost_claudium,
            idempotency_key, spend_claim_expires_at)
         VALUES ('pgtest', 2, 2, 'strongbox_rung_01', 100,
                 'pg-invalid-claim-pair', now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('does not execute the legacy refused-row DELETE on steady-state schema boot', async () => {
    const probe = await pool.connect();
    await probe.query('CREATE TEMP TABLE storage_boot_delete_probe (calls int NOT NULL)');
    await probe.query('INSERT INTO storage_boot_delete_probe VALUES (0)');
    await probe.query(`CREATE FUNCTION storage_boot_note_delete() RETURNS trigger
      LANGUAGE plpgsql AS $probe$
      BEGIN
        UPDATE storage_boot_delete_probe SET calls = calls + 1;
        RETURN NULL;
      END
      $probe$`);
    await probe.query(`CREATE TRIGGER storage_boot_delete_probe_trigger
      AFTER DELETE ON storage_purchases
      FOR EACH STATEMENT EXECUTE FUNCTION storage_boot_note_delete()`);
    try {
      await probe.query(storageSchema);
      expect((await probe.query('SELECT calls FROM storage_boot_delete_probe')).rows[0].calls).toBe(
        0,
      );
    } finally {
      await probe.query(
        'DROP TRIGGER IF EXISTS storage_boot_delete_probe_trigger ON storage_purchases',
      );
      await probe.query('DROP FUNCTION IF EXISTS storage_boot_note_delete()');
      probe.release();
    }
  });

  it('keeps the open index and every trigger catalog row stable on a steady-state second boot', async () => {
    const readTriggerIdentity = () =>
      pool.query(
        // Scoped to THIS suite's schema: the catalog is database-wide, and a
        // sibling pg suite's ensureSchema leaves the same-named triggers on
        // public, which would double the identity rows on a shared dev DB.
        `SELECT c.relname, t.tgname, t.oid::text AS oid, t.xmin::text AS xmin
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE NOT t.tgisinternal
            AND t.tgname LIKE 'storage_purchase_%'
            AND n.nspname = '${SCHEMA}'
          ORDER BY c.relname, t.tgname`,
      );
    const readIndexIdentity = () =>
      pool.query(
        `SELECT index_rel.oid::text AS oid, index_rel.xmin::text AS xmin
           FROM pg_class index_rel
          WHERE index_rel.oid =
                '${SCHEMA}.storage_purchases_one_open_per_character'::regclass`,
      );
    const triggerBefore = await readTriggerIdentity();
    const indexBefore = await readIndexIdentity();
    expect(triggerBefore.rows).toHaveLength(4);
    expect(indexBefore.rows).toHaveLength(1);
    await pool.query(storageSchema);
    expect((await readTriggerIdentity()).rows).toEqual(triggerBefore.rows);
    expect((await readIndexIdentity()).rows).toEqual(indexBefore.rows);
  });

  it('repairs malformed same-named triggers to their exact catalog definitions', async () => {
    await pool.query(
      'DROP TRIGGER storage_purchase_guard_character_delete ON characters; ' +
        'CREATE TRIGGER storage_purchase_guard_character_delete AFTER DELETE ON characters ' +
        'FOR EACH ROW EXECUTE FUNCTION guard_pending_storage_purchase_parent_delete()',
    );
    await pool.query(
      'DROP TRIGGER storage_purchase_guard_account_delete ON accounts; ' +
        'CREATE TRIGGER storage_purchase_guard_account_delete BEFORE UPDATE ON accounts ' +
        'FOR EACH ROW EXECUTE FUNCTION guard_pending_storage_purchase_parent_delete()',
    );
    await pool.query(
      'DROP TRIGGER storage_purchase_guard_consumed_key ON storage_purchases; ' +
        'CREATE TRIGGER storage_purchase_guard_consumed_key AFTER INSERT ON storage_purchases ' +
        'FOR EACH ROW EXECUTE FUNCTION guard_storage_purchase_consumed_key()',
    );
    await pool.query(
      'DROP TRIGGER storage_purchase_archive_applied ON storage_purchases; ' +
        'CREATE TRIGGER storage_purchase_archive_applied AFTER UPDATE ON storage_purchases ' +
        'FOR EACH ROW EXECUTE FUNCTION archive_storage_purchase_applied_receipt()',
    );

    await pool.query(storageSchema);
    const definitions = await pool.query(
      `SELECT c.relname,
              t.tgname,
              t.tgtype::int AS tgtype,
              t.tgenabled,
              t.tgnargs,
              octet_length(t.tgargs) AS arg_bytes,
              t.tgattr::text AS tgattr,
              pg_get_expr(t.tgqual, t.tgrelid) AS qualifier,
              p.proname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal
          AND t.tgname LIKE 'storage_purchase_%'
          AND n.nspname = '${SCHEMA}'
        ORDER BY c.relname, t.tgname`,
    );
    expect(definitions.rows).toEqual([
      expect.objectContaining({
        relname: 'accounts',
        tgname: 'storage_purchase_guard_account_delete',
        tgtype: 11,
        tgenabled: 'O',
        tgnargs: 0,
        arg_bytes: 0,
        tgattr: '',
        qualifier: null,
        proname: 'guard_pending_storage_purchase_parent_delete',
      }),
      expect.objectContaining({
        relname: 'characters',
        tgname: 'storage_purchase_guard_character_delete',
        tgtype: 11,
        tgenabled: 'O',
        tgnargs: 0,
        arg_bytes: 0,
        tgattr: '',
        qualifier: null,
        proname: 'guard_pending_storage_purchase_parent_delete',
      }),
      expect.objectContaining({
        relname: 'storage_purchases',
        tgname: 'storage_purchase_archive_applied',
        tgtype: 21,
        tgenabled: 'O',
        tgnargs: 0,
        arg_bytes: 0,
        qualifier: null,
        proname: 'archive_storage_purchase_applied_receipt',
      }),
      expect.objectContaining({
        relname: 'storage_purchases',
        tgname: 'storage_purchase_guard_consumed_key',
        tgtype: 7,
        tgenabled: 'O',
        tgnargs: 0,
        arg_bytes: 0,
        tgattr: '',
        qualifier: null,
        proname: 'guard_storage_purchase_consumed_key',
      }),
    ]);
    expect(definitions.rows[2].tgattr).not.toBe('');
  });

  it('serializes two clients racing different keys onto one open character authority', async () => {
    await pool.query(
      "DELETE FROM storage_purchases WHERE character_id = 2 AND status IN ('pending', 'unresolved')",
    );
    const attempts = await Promise.all([
      db.beginStoragePurchase(pool, {
        ...ROW,
        accountId: 2,
        characterId: 2,
        idempotencyKey: 'pg-character-race-a',
        claimToken: '00000000-0000-4000-8000-00000000000a',
      }),
      db.beginStoragePurchase(pool, {
        ...ROW,
        accountId: 2,
        characterId: 2,
        idempotencyKey: 'pg-character-race-b',
        claimToken: '00000000-0000-4000-8000-00000000000b',
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.inserted)).toHaveLength(1);
    const loser = attempts.find((attempt) => !attempt.inserted);
    expect(loser?.existing).toBeNull();
    expect(loser?.blockedByOpen?.idempotencyKey).toMatch(/^pg-character-race-[ab]$/);
    const rows = await pool.query(
      "SELECT idempotency_key FROM storage_purchases WHERE character_id = 2 AND status = 'pending'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].idempotency_key).toBe(
      attempts.find((attempt) => attempt.inserted)?.existing?.idempotencyKey,
    );
    await pool.query(
      "DELETE FROM storage_purchases WHERE character_id = 2 AND status IN ('pending', 'unresolved')",
    );
  });

  it('makes a concurrent unresolved transition block a new key after the wait', async () => {
    const oldKey = 'pg-unresolved-race-old';
    const newKey = 'pg-unresolved-race-new';
    const oldToken = '00000000-0000-4000-8000-000000000073';
    await db.beginStoragePurchase(pool, {
      ...ROW,
      accountId: 2,
      characterId: 2,
      idempotencyKey: oldKey,
      claimToken: oldToken,
    });
    const resolver = await pool.connect();
    try {
      await resolver.query('BEGIN');
      await resolver.query(
        `UPDATE storage_purchases
            SET status = 'unresolved', resolved_at = now(),
                spend_claim_token = NULL, spend_claim_expires_at = NULL
          WHERE idempotency_key = $1 AND spend_claim_token = $2`,
        [oldKey, oldToken],
      );
      let resolved = false;
      const racingBegin = db
        .beginStoragePurchase(pool, {
          ...ROW,
          accountId: 2,
          characterId: 2,
          idempotencyKey: newKey,
          claimToken: '00000000-0000-4000-8000-000000000074',
        })
        .then((result) => {
          resolved = true;
          return result;
        });
      let sawWait = false;
      for (let attempt = 0; attempt < 100 && !sawWait; attempt++) {
        await resolver.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await resolver.query(
          `SELECT count(*)::int AS n
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE 'INSERT INTO storage_purchases%'`,
        );
        sawWait = waiting.rows[0].n > 0;
        if (!sawWait) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(sawWait).toBe(true);
      expect(resolved).toBe(false);
      await resolver.query('COMMIT');
      const loser = await racingBegin;
      expect(loser).toMatchObject({
        inserted: false,
        existing: null,
        blockedByOpen: { idempotencyKey: oldKey, status: 'unresolved' },
      });
      expect(await db.storagePurchaseByKey(pool, newKey)).toBeNull();
    } finally {
      await resolver.query('ROLLBACK').catch(() => {});
      resolver.release();
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = ANY($1::text[])', [
        [oldKey, newKey],
      ]);
    }
  });

  it('gives only one of two same-key begin clients the initial spend claim', async () => {
    await pool.query("DELETE FROM storage_purchases WHERE character_id = 2 AND status = 'pending'");
    const key = 'pg-same-key-race';
    const attempts = await Promise.all([
      db.beginStoragePurchase(pool, {
        ...ROW,
        accountId: 2,
        characterId: 2,
        idempotencyKey: key,
        claimToken: '00000000-0000-4000-8000-00000000001a',
      }),
      db.beginStoragePurchase(pool, {
        ...ROW,
        accountId: 2,
        characterId: 2,
        idempotencyKey: key,
        claimToken: '00000000-0000-4000-8000-00000000001b',
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.inserted)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.inserted)).toEqual([
      expect.objectContaining({
        existing: expect.objectContaining({ idempotencyKey: key, status: 'pending' }),
      }),
    ]);
    const stored = await pool.query(
      'SELECT spend_claim_token FROM storage_purchases WHERE idempotency_key = $1',
      [key],
    );
    expect([
      '00000000-0000-4000-8000-00000000001a',
      '00000000-0000-4000-8000-00000000001b',
    ]).toContain(stored.rows[0].spend_claim_token);
    await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [key]);
  });

  it('bounds a contended begin before it can camp on the character lock', async () => {
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('UPDATE characters SET id = id WHERE id = 2');
      const started = performance.now();
      await expect(
        db.beginStoragePurchase(pool, {
          ...ROW,
          accountId: 2,
          characterId: 2,
          idempotencyKey: 'pg-lock-timeout',
          claimToken: '00000000-0000-4000-8000-00000000001c',
        }),
      ).rejects.toMatchObject({ code: '55P03' });
      expect(performance.now() - started).toBeLessThan(
        db.STORAGE_PURCHASE_TX_LOCK_TIMEOUT_MS + 1_500,
      );
      expect(await db.storagePurchaseByKey(pool, 'pg-lock-timeout')).toBeNull();
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
  });

  it('cancels a queued checkout, destroys its late client, and leaves the pool healthy', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    const controller = new AbortController();
    let secondReleased = false;
    let settled:
      | Promise<
          | {
              value: import('../../server/storage_purchase_db').StoragePurchaseRow | null;
              error: null;
            }
          | { value: null; error: unknown }
        >
      | undefined;
    try {
      const pending = db.pendingStoragePurchasesForCharacter(pool, 1, controller.signal);
      settled = pending.then(
        (value) => ({ value, error: null as null }),
        (error: unknown) => ({ value: null, error }),
      );
      for (let attempt = 0; attempt < 100 && pool.waitingCount === 0; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(pool.totalCount).toBe(2);
      expect(pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(1);

      controller.abort();
      expect((await settled).error).toBeInstanceOf(db.StoragePurchaseDbAborted);
      // node-postgres cannot dequeue the already-issued connect request. The
      // helper destroys the client as soon as that queued request receives it.
      second.release();
      secondReleased = true;
      for (
        let attempt = 0;
        attempt < 100 && (pool.waitingCount !== 0 || pool.totalCount !== 1);
        attempt++
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(pool.waitingCount).toBe(0);
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(0);
    } finally {
      controller.abort();
      if (!secondReleased) second.release();
      if (settled) await settled;
      first.release();
    }

    expect(await pool.query('SELECT 1 AS healthy')).toMatchObject({
      rows: [{ healthy: 1 }],
    });
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBeGreaterThan(0);
  });

  it('settles an aborted recovery SELECT promptly and bounds its detached backend', async () => {
    const blocker = await pool.connect();
    const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const controller = new AbortController();
    let settled:
      | Promise<
          | {
              value: import('../../server/storage_purchase_db').StoragePurchaseRow | null;
              error: null;
            }
          | { value: null; error: unknown }
        >
      | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE storage_purchases IN ACCESS EXCLUSIVE MODE');
      const pending = db.openStoragePurchaseForCharacter(pool, 1, controller.signal);
      settled = pending.then(
        (value) => ({ value, error: null as null }),
        (error: unknown) => ({ value: null, error }),
      );

      let blockedPid: number | null = null;
      for (let attempt = 0; attempt < 100 && blockedPid === null; attempt++) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await blocker.query(
          `SELECT pid
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND application_name = $1
              AND wait_event_type = 'Lock'
              AND $2::int = ANY(pg_blocking_pids(pid))
              AND query LIKE 'SELECT %FROM storage_purchases%status IN%'
            ORDER BY pid
            LIMIT 1`,
          [SCHEMA, blockerPid],
        );
        blockedPid = waiting.rows[0] ? Number(waiting.rows[0].pid) : null;
        if (blockedPid === null) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedPid).not.toBeNull();
      expect(pool.totalCount).toBe(2);

      const abortedAt = Date.now();
      controller.abort();
      expect((await settled).error).toBeInstanceOf(db.StoragePurchaseDbAborted);
      expect(Date.now() - abortedAt).toBeLessThan(500);
      for (let attempt = 0; attempt < 100 && pool.totalCount !== 1; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(0);

      // Socket teardown settles Node promptly, but PostgreSQL may not notice a
      // disconnect while lock-waiting. The session-level 2s timeout is the
      // independent server bound; keep the blocker held while proving it.
      let backendAlive = true;
      const backendDeadline = Date.now() + db.STORAGE_PURCHASE_SIGNAL_STATEMENT_TIMEOUT_MS + 2_000;
      while (Date.now() < backendDeadline && backendAlive) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const active = await blocker.query(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1) AS alive',
          [blockedPid],
        );
        backendAlive = active.rows[0].alive;
        if (backendAlive) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(backendAlive).toBe(false);
    } finally {
      controller.abort();
      if (settled) await settled;
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }

    const healthySignal = new AbortController();
    expect(await db.openStoragePurchaseForCharacter(pool, 1, healthySignal.signal)).toBeNull();
    const reused = await pool.connect();
    try {
      expect((await reused.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('15s');
    } finally {
      reused.release();
    }
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBeGreaterThan(0);
  });

  it('aborts a begin blocked on its advisory lock and rolls back every acquired lock', async () => {
    const key = 'pg-abort-begin-advisory';
    await pool.query(
      "DELETE FROM storage_purchases WHERE character_id = 2 AND status IN ('pending', 'unresolved')",
    );
    const blocker = await pool.connect();
    const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const controller = new AbortController();
    let settled: Promise<{ error: unknown }> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [key]);
      const pending = db.beginStoragePurchase(
        pool,
        {
          ...ROW,
          accountId: 2,
          characterId: 2,
          idempotencyKey: key,
          claimToken: '00000000-0000-4000-8000-000000000075',
        },
        controller.signal,
      );
      settled = pending.then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );

      let blockedPid: number | null = null;
      for (let attempt = 0; attempt < 100 && blockedPid === null; attempt++) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await blocker.query(
          `SELECT pid
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND application_name = $1
              AND state = 'active'
              AND wait_event_type = 'Lock'
              AND $2::int = ANY(pg_blocking_pids(pid))
              AND query LIKE 'SELECT pg_advisory_xact_lock(hashtextextended%'
            ORDER BY pid
            LIMIT 1`,
          [SCHEMA, blockerPid],
        );
        blockedPid = waiting.rows[0] ? Number(waiting.rows[0].pid) : null;
        if (blockedPid === null) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedPid).not.toBeNull();

      controller.abort();
      expect((await settled).error).toMatchObject({
        name: 'DbTransactionAborted',
        code: 'DB_TRANSACTION_ABORTED',
        commitMayHaveSucceeded: false,
      });
      let backendAlive = true;
      const backendDeadline = Date.now() + db.STORAGE_PURCHASE_TX_LOCK_TIMEOUT_MS + 2_000;
      while (Date.now() < backendDeadline && backendAlive) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const active = await blocker.query(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1) AS alive',
          [blockedPid],
        );
        backendAlive = active.rows[0].alive;
        if (backendAlive) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(backendAlive).toBe(false);
      expect(
        (
          await blocker.query('SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1', [
            blockedPid,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await blocker.query(
            'SELECT count(*)::int AS n FROM storage_purchases WHERE idempotency_key = $1',
            [key],
          )
        ).rows[0].n,
      ).toBe(0);
      // The aborted begin acquired the character lock before the advisory
      // wait. This write completes while the blocker still holds the advisory
      // lock, proving the destroyed transaction released its earlier locks.
      await pool.query('UPDATE characters SET id = id WHERE id = 2');
    } finally {
      controller.abort();
      if (settled) await settled;
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [key]);
    }
  });

  it('marks an interrupted live COMMIT ambiguous and converges on one retry', async () => {
    const key = 'pg-abort-begin-commit';
    await pool.query(
      "DELETE FROM storage_purchases WHERE character_id = 2 AND status IN ('pending', 'unresolved')",
    );
    const observer = await pool.connect();
    const controller = new AbortController();
    let settled: Promise<{ error: unknown }> | undefined;
    try {
      await observer.query(`CREATE FUNCTION storage_purchase_test_delay_commit()
        RETURNS trigger LANGUAGE plpgsql AS $delay$
        BEGIN
          PERFORM pg_sleep(0.25);
          RETURN NEW;
        END
        $delay$`);
      await observer.query(`CREATE CONSTRAINT TRIGGER storage_purchase_test_delay_commit
        AFTER INSERT ON storage_purchases
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION storage_purchase_test_delay_commit()`);

      const pending = db.beginStoragePurchase(
        pool,
        {
          ...ROW,
          accountId: 2,
          characterId: 2,
          idempotencyKey: key,
          claimToken: '00000000-0000-4000-8000-000000000076',
        },
        controller.signal,
      );
      settled = pending.then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );

      let committingPid: number | null = null;
      for (let attempt = 0; attempt < 100 && committingPid === null; attempt++) {
        await observer.query('SELECT pg_stat_clear_snapshot()');
        const committing = await observer.query(
          `SELECT pid
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND application_name = $1
              AND state = 'active'
              AND query = 'COMMIT'
              AND wait_event = 'PgSleep'
            ORDER BY pid
            LIMIT 1`,
          [SCHEMA],
        );
        committingPid = committing.rows[0] ? Number(committing.rows[0].pid) : null;
        if (committingPid === null) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(committingPid).not.toBeNull();

      controller.abort();
      expect((await settled).error).toMatchObject({
        name: 'DbTransactionAborted',
        code: 'DB_TRANSACTION_ABORTED',
        commitMayHaveSucceeded: true,
      });
      let backendAlive = true;
      const backendDeadline = Date.now() + 3_000;
      while (Date.now() < backendDeadline && backendAlive) {
        await observer.query('SELECT pg_stat_clear_snapshot()');
        const active = await observer.query(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1) AS alive',
          [committingPid],
        );
        backendAlive = active.rows[0].alive;
        if (backendAlive) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(backendAlive).toBe(false);
    } finally {
      controller.abort();
      if (settled) await settled;
      await observer.query(
        'DROP TRIGGER IF EXISTS storage_purchase_test_delay_commit ON storage_purchases',
      );
      await observer.query('DROP FUNCTION IF EXISTS storage_purchase_test_delay_commit()');
      observer.release();
    }

    try {
      const landedBeforeRetry = Number(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM storage_purchases WHERE idempotency_key = $1',
            [key],
          )
        ).rows[0].n,
      );
      expect([0, 1]).toContain(landedBeforeRetry);
      const retry = await db.beginStoragePurchase(pool, {
        ...ROW,
        accountId: 2,
        characterId: 2,
        idempotencyKey: key,
        claimToken: '00000000-0000-4000-8000-000000000077',
      });
      expect(retry.inserted).toBe(landedBeforeRetry === 0);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM storage_purchases WHERE idempotency_key = $1',
            [key],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [key]);
    }
  });

  it('permits stale-claim takeover but rejects every terminal write by the old token', async () => {
    const key = 'pg-stale-claim';
    const oldToken = '00000000-0000-4000-8000-00000000002a';
    const newToken = '00000000-0000-4000-8000-00000000002b';
    await db.beginStoragePurchase(pool, {
      ...ROW,
      accountId: 2,
      characterId: 2,
      idempotencyKey: key,
      claimToken: oldToken,
    });
    expect(await db.claimStoragePurchaseSpend(pool, key, newToken)).toBe(false);
    await pool.query(
      "UPDATE storage_purchases SET spend_claim_expires_at = now() - interval '1 second' WHERE idempotency_key = $1",
      [key],
    );
    expect(await db.claimStoragePurchaseSpend(pool, key, newToken)).toBe(true);
    expect(await db.renewStoragePurchaseSpendClaim(pool, key, oldToken)).toBe(false);
    expect(await db.deletePendingStoragePurchaseWithoutDebit(pool, key, oldToken)).toBe(false);
    expect(await db.settleStoragePurchase(pool, key, 'unresolved', oldToken)).toBe(false);
    expect(await db.deletePendingStoragePurchaseWithoutDebit(pool, key, newToken)).toBe(true);
  });

  it('refuses direct and cascaded parent deletion while a purchase is pending', async () => {
    const pending = {
      ...ROW,
      accountId: 2,
      characterId: 2,
      idempotencyKey: 'pg-parent-delete-guard',
      claimToken: '00000000-0000-4000-8000-00000000002c',
    };
    await db.beginStoragePurchase(pool, pending);
    await expect(pool.query('DELETE FROM characters WHERE id = 2')).rejects.toMatchObject({
      code: '55006',
      constraint: 'storage_purchases_open_delete_guard',
      message: 'storage_purchase_open',
    });
    await expect(pool.query('DELETE FROM accounts WHERE id = 2')).rejects.toMatchObject({
      code: '55006',
      constraint: 'storage_purchases_open_delete_guard',
      message: 'storage_purchase_open',
    });
    expect(await db.storagePurchaseByKey(pool, pending.idempotencyKey)).toMatchObject({
      status: 'pending',
    });
    await db.settleStoragePurchase(pool, pending.idempotencyKey, 'applied', pending.claimToken);
    await pool.query('DELETE FROM characters WHERE id = 2');
    expect(await db.storagePurchaseByKey(pool, pending.idempotencyKey)).toMatchObject({
      status: 'applied',
    });
    await pool.query('INSERT INTO characters (id) VALUES (2)');

    const unresolved = {
      ...pending,
      idempotencyKey: 'pg-unresolved-delete-guard',
      claimToken: '00000000-0000-4000-8000-00000000002d',
    };
    await db.beginStoragePurchase(pool, unresolved);
    await db.settleStoragePurchase(
      pool,
      unresolved.idempotencyKey,
      'unresolved',
      unresolved.claimToken,
    );
    await expect(pool.query('DELETE FROM characters WHERE id = 2')).rejects.toMatchObject({
      code: '55006',
      constraint: 'storage_purchases_open_delete_guard',
    });
    await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [
      unresolved.idempotencyKey,
    ]);
  });

  it('sees a pending insert that commits while character deletion waits', async () => {
    await pool.query('INSERT INTO accounts (id) VALUES (6)');
    await pool.query('INSERT INTO characters (id) VALUES (6)');
    const writer = await pool.connect();
    const token = '00000000-0000-4000-8000-00000000006a';
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT id FROM accounts WHERE id = 6 FOR KEY SHARE');
      await writer.query('SELECT id FROM characters WHERE id = 6 FOR UPDATE');
      await writer.query(
        `INSERT INTO storage_purchases
           (realm, account_id, character_id, item_id, expected_cost_claudium,
            idempotency_key, spend_claim_token, spend_claim_expires_at)
         VALUES ('pgtest', 6, 6, 'strongbox_rung_01', 100,
                 'pg-delete-race', $1, now() + interval '15 seconds')`,
        [token],
      );
      const deleting = pool.query('DELETE FROM characters WHERE id = 6').then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      let sawDeleteWait = false;
      for (let attempt = 0; attempt < 100 && !sawDeleteWait; attempt++) {
        await writer.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await writer.query(
          `SELECT count(*)::int AS n
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE 'DELETE FROM characters WHERE id = 6%'`,
        );
        sawDeleteWait = waiting.rows[0].n > 0;
        if (!sawDeleteWait) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(sawDeleteWait).toBe(true);
      await writer.query('COMMIT');
      const deleted = await deleting;
      expect(deleted.value).toBeNull();
      expect(deleted.error).toMatchObject({
        code: '55006',
        constraint: 'storage_purchases_open_delete_guard',
      });
      expect(await db.storagePurchaseByKey(pool, 'pg-delete-race')).toMatchObject({
        status: 'pending',
      });
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
      await pool.query("DELETE FROM storage_purchases WHERE idempotency_key = 'pg-delete-race'");
      await pool.query('DELETE FROM characters WHERE id = 6');
      await pool.query('DELETE FROM accounts WHERE id = 6');
    }
  });

  it('blocks same-key begin behind receipt archival and returns the committed receipt', async () => {
    const key = 'pg-archive-begin-race';
    const oldToken = '00000000-0000-4000-8000-00000000003a';
    await db.beginStoragePurchase(pool, {
      ...ROW,
      accountId: 2,
      characterId: 2,
      idempotencyKey: key,
      claimToken: oldToken,
    });
    const effect = {
      realm: ROW.realm,
      accountId: 2,
      characterId: 2,
      itemId: ROW.itemId,
      expectedCostClaudium: ROW.expectedCostClaudium,
      idempotencyKey: key,
      spendClaimToken: oldToken,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
    };
    const saver = await pool.connect();
    try {
      await saver.query('BEGIN');
      await db.lockStorageAppliedEffectAccountsOnClient(saver, [effect]);
      await saver.query('UPDATE characters SET id = id WHERE id = 2');
      await db.writeStorageAppliedEffectsOnClient(saver, [effect]);

      let resolved = false;
      const racingBegin = db
        .beginStoragePurchase(pool, {
          ...ROW,
          // A different parent pair proves the wait is the SAME-KEY advisory
          // authority, not the character row lock the saver already holds.
          accountId: 1,
          characterId: 1,
          idempotencyKey: key,
          claimToken: '00000000-0000-4000-8000-00000000003b',
        })
        .then((result) => {
          resolved = true;
          return result;
        });
      let sawAdvisoryWait = false;
      for (let attempt = 0; attempt < 100 && !sawAdvisoryWait; attempt++) {
        await saver.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await saver.query(
          `SELECT count(*)::int AS n
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE 'SELECT pg_advisory_xact_lock(hashtextextended%'`,
        );
        sawAdvisoryWait = waiting.rows[0].n > 0;
        if (!sawAdvisoryWait) {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
      }
      expect(sawAdvisoryWait).toBe(true);
      expect(resolved).toBe(false);
      await saver.query('COMMIT');
      const result = await racingBegin;
      expect(result).toMatchObject({
        inserted: false,
        existing: { idempotencyKey: key, status: 'applied' },
      });
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM storage_purchases WHERE idempotency_key = $1',
            [key],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await saver.query('ROLLBACK').catch(() => {});
      saver.release();
    }
  });

  it('suppresses an old-shape insert that waited behind receipt archival and deletion', async () => {
    const key = 'pg-old-shape-consumed-race';
    const token = '00000000-0000-4000-8000-000000000075';
    const effect = {
      realm: ROW.realm,
      accountId: 2,
      characterId: 2,
      itemId: 'strongbox_old_shape_test',
      expectedCostClaudium: ROW.expectedCostClaudium,
      idempotencyKey: key,
      spendClaimToken: token,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
    };
    await db.beginStoragePurchase(pool, { ...effect, claimToken: token });
    const saver = await pool.connect();
    try {
      await saver.query('BEGIN');
      await db.lockStorageAppliedEffectAccountsOnClient(saver, [effect]);
      await saver.query('UPDATE characters SET id = id WHERE id = 2');
      await db.writeStorageAppliedEffectsOnClient(saver, [effect]);

      let resolved = false;
      const legacyInsert = pool
        .query(
          `INSERT INTO storage_purchases
             (realm, account_id, character_id, item_id, expected_cost_claudium,
              idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          // Different parents prove this wait is the idempotency-key advisory
          // authority inside the legacy INSERT trigger, not the saver-held
          // character lock.
          [effect.realm, 1, 1, effect.itemId, effect.expectedCostClaudium, key],
        )
        .then((result) => {
          resolved = true;
          return result;
        });
      let sawWait = false;
      for (let attempt = 0; attempt < 100 && !sawWait; attempt++) {
        await saver.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await saver.query(
          `SELECT count(*)::int AS n
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE 'INSERT INTO storage_purchases%'`,
        );
        sawWait = waiting.rows[0].n > 0;
        if (!sawWait) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(sawWait).toBe(true);
      expect(resolved).toBe(false);
      await saver.query('COMMIT');
      expect((await legacyInsert).rowCount).toBe(0);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM storage_purchases WHERE idempotency_key = $1',
            [key],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(await db.storagePurchaseByKey(pool, key)).toMatchObject({ status: 'applied' });
    } finally {
      await saver.query('ROLLBACK').catch(() => {});
      saver.release();
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [key]);
      await pool.query('DELETE FROM storage_purchase_applied_receipts WHERE idempotency_key = $1', [
        key,
      ]);
      await pool.query('DELETE FROM bank_ledger WHERE item_id = $1', [effect.itemId]);
    }
  });

  it('lets a waiting old-shape insert proceed when the competing receipt rolls back', async () => {
    const key = 'pg-old-shape-receipt-rollback';
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [key]);
      await writer.query(
        `INSERT INTO storage_purchase_applied_receipts
           (source_purchase_id, realm, account_id, character_id, item_id,
            expected_cost_claudium, idempotency_key, applied_at)
         VALUES (nextval('storage_purchases_id_seq'), 'pgtest', 2, 2,
                 'rollback_probe', 100, $1, now())`,
        [key],
      );
      let resolved = false;
      const legacyInsert = pool
        .query(
          `INSERT INTO storage_purchases
             (realm, account_id, character_id, item_id, expected_cost_claudium,
              idempotency_key)
           VALUES ('pgtest', 2, 2, 'rollback_probe', 100, $1)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [key],
        )
        .then((result) => {
          resolved = true;
          return result;
        });
      let sawWait = false;
      for (let attempt = 0; attempt < 100 && !sawWait; attempt++) {
        await writer.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await writer.query(
          `SELECT count(*)::int AS n
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE 'INSERT INTO storage_purchases%'`,
        );
        sawWait = waiting.rows[0].n > 0;
        if (!sawWait) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(sawWait).toBe(true);
      expect(resolved).toBe(false);
      await writer.query('ROLLBACK');
      expect((await legacyInsert).rowCount).toBe(1);
      expect(await db.storagePurchaseByKey(pool, key)).toMatchObject({ status: 'pending' });
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [key]);
      await pool.query('DELETE FROM storage_purchase_applied_receipts WHERE idempotency_key = $1', [
        key,
      ]);
    }
  });

  it('fails a mixed-release update/key-lock inversion closed and converges after retry', async () => {
    const key = 'pg-legacy-update-deadlock';
    const token = '00000000-0000-4000-8000-000000000076';
    const itemId = 'legacy_update_deadlock_probe';
    const effect = {
      realm: ROW.realm,
      accountId: 2,
      characterId: 2,
      itemId,
      expectedCostClaudium: ROW.expectedCostClaudium,
      idempotencyKey: key,
      spendClaimToken: token,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
    };
    await db.beginStoragePurchase(pool, { ...effect, claimToken: token });
    const saver = await pool.connect();
    const legacy = await pool.connect();
    try {
      await saver.query('BEGIN');
      await db.lockStorageAppliedEffectAccountsOnClient(saver, [effect]);
      await saver.query('UPDATE characters SET id = id WHERE id = 2');
      // Current writers acquire key -> operational row. Hold only the key so
      // the old UPDATE can first lock the row, then block inside its AFTER
      // trigger while trying to acquire the same key.
      await saver.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [key]);
      await legacy.query('BEGIN');
      const legacyUpdate = legacy
        .query(
          `UPDATE storage_purchases
                SET status = 'applied', resolved_at = now()
              WHERE idempotency_key = $1`,
          [key],
        )
        .then(
          (value) => ({ value, error: null as unknown }),
          (error: unknown) => ({ value: null, error }),
        );
      let sawLegacyWait = false;
      for (let attempt = 0; attempt < 100 && !sawLegacyWait; attempt++) {
        await saver.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await saver.query(
          `SELECT count(*)::int AS n
               FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND query LIKE 'UPDATE storage_purchases%'`,
        );
        sawLegacyWait = waiting.rows[0].n > 0;
        if (!sawLegacyWait) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(sawLegacyWait).toBe(true);

      const currentWrite = db.writeStorageAppliedEffectsOnClient(saver, [effect]).then(
        () => ({ error: null as unknown }),
        (error: unknown) => ({ error }),
      );
      const [legacyResult, currentResult] = await Promise.all([legacyUpdate, currentWrite]);
      const legacyCode = (legacyResult.error as { code?: string } | null)?.code;
      const currentCode = (currentResult.error as { code?: string } | null)?.code;
      expect([legacyCode, currentCode].filter((code) => code === '40P01')).toHaveLength(1);

      if (legacyCode === '40P01') {
        await legacy.query('ROLLBACK');
        await saver.query('COMMIT');
        // Retry the deadlock victim after the current receipt+delete commits.
        // The old writer sees no operational row and creates no second receipt.
        const retry = await legacy.query(
          `UPDATE storage_purchases
                SET status = 'applied', resolved_at = now()
              WHERE idempotency_key = $1`,
          [key],
        );
        expect(retry.rowCount).toBe(0);
      } else {
        expect(currentCode).toBe('40P01');
        await saver.query('ROLLBACK');
        await legacy.query('COMMIT');
        // Retry the current writer against the receipt archived by the old
        // writer. It validates the fingerprint and must not duplicate audit.
        await saver.query('BEGIN');
        await db.lockStorageAppliedEffectAccountsOnClient(saver, [effect]);
        await saver.query('UPDATE characters SET id = id WHERE id = 2');
        await db.writeStorageAppliedEffectsOnClient(saver, [effect]);
        await saver.query('COMMIT');
      }

      expect(
        (
          await saver.query(
            'SELECT count(*)::int AS n FROM storage_purchase_applied_receipts ' +
              'WHERE idempotency_key = $1',
            [key],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await saver.query(
            `SELECT count(*)::int AS n FROM storage_purchases
                WHERE idempotency_key = $1 AND status IN ('pending', 'unresolved')`,
            [key],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await saver.query('SELECT count(*)::int AS n FROM bank_ledger WHERE item_id = $1', [
            itemId,
          ])
        ).rows[0].n,
      ).toBeLessThanOrEqual(1);
      const replay = await saver.query(
        `INSERT INTO storage_purchases
             (realm, account_id, character_id, item_id, expected_cost_claudium,
              idempotency_key)
           VALUES ('pgtest', 2, 2, $1, 100, $2)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
        [itemId, key],
      );
      expect(replay.rowCount).toBe(0);
    } finally {
      await saver.query('ROLLBACK').catch(() => {});
      await legacy.query('ROLLBACK').catch(() => {});
      saver.release();
      legacy.release();
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [key]);
      await pool.query('DELETE FROM storage_purchase_applied_receipts WHERE idempotency_key = $1', [
        key,
      ]);
      await pool.query('DELETE FROM bank_ledger WHERE item_id = $1', [itemId]);
    }
  }, 15_000);

  it('commits the character-side receipt and Claudium ledger exactly once', async () => {
    const effect = {
      realm: 'pgtest',
      accountId: 1,
      characterId: 1,
      itemId: 'strongbox_atomic_apply_test',
      expectedCostClaudium: 100,
      idempotencyKey: 'pg-atomic-apply',
      claimToken: ROW.claimToken,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
      spendClaimToken: ROW.claimToken,
    };
    try {
      const budgetBefore = Number(
        (await pool.query('SELECT committed_rows FROM bank_ledger_growth_budget')).rows[0]
          .committed_rows,
      );
      await db.beginStoragePurchase(pool, effect);

      const rolledBack = await pool.connect();
      try {
        await rolledBack.query('BEGIN');
        await db.lockStorageAppliedEffectAccountsOnClient(rolledBack, [effect]);
        await db.writeStorageAppliedEffectsOnClient(rolledBack, [effect]);
        await rolledBack.query('ROLLBACK');
      } finally {
        rolledBack.release();
      }
      expect((await db.storagePurchaseByKey(pool, effect.idempotencyKey))?.status).toBe('pending');
      expect(
        (
          await pool.query('SELECT count(*)::int AS n FROM bank_ledger WHERE item_id = $1', [
            effect.itemId,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        Number(
          (await pool.query('SELECT committed_rows FROM bank_ledger_growth_budget')).rows[0]
            .committed_rows,
        ),
      ).toBe(budgetBefore);

      const committed = await pool.connect();
      try {
        await committed.query('BEGIN');
        await db.lockStorageAppliedEffectAccountsOnClient(committed, [effect]);
        await db.writeStorageAppliedEffectsOnClient(committed, [effect]);
        await committed.query('COMMIT');
      } finally {
        committed.release();
      }
      expect(await db.storagePurchaseByKey(pool, effect.idempotencyKey)).toMatchObject({
        characterId: 1,
        status: 'applied',
      });
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM storage_purchases WHERE idempotency_key = $1',
            [effect.idempotencyKey],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM bank_ledger WHERE item_id = $1 AND instance->>'paidWith' = 'claudium'",
            [effect.itemId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        Number(
          (await pool.query('SELECT committed_rows FROM bank_ledger_growth_budget')).rows[0]
            .committed_rows,
        ),
      ).toBe(budgetBefore + 1);

      const replay = await pool.connect();
      try {
        await replay.query('BEGIN');
        await db.lockStorageAppliedEffectAccountsOnClient(replay, [effect]);
        await db.writeStorageAppliedEffectsOnClient(replay, [effect]);
        await replay.query('COMMIT');
      } finally {
        replay.release();
      }
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM bank_ledger WHERE item_id = $1 AND instance->>'paidWith' = 'claudium'",
            [effect.itemId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        Number(
          (await pool.query('SELECT committed_rows FROM bank_ledger_growth_budget')).rows[0]
            .committed_rows,
        ),
      ).toBe(budgetBefore + 1);
    } finally {
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [
        effect.idempotencyKey,
      ]);
      await pool.query('DELETE FROM storage_purchase_applied_receipts WHERE idempotency_key = $1', [
        effect.idempotencyKey,
      ]);
      await pool.query('DELETE FROM bank_ledger WHERE item_id = $1', [effect.itemId]);
    }
  });

  it('rejects an incompressible key past the btree tuple bound at the raw layer', async () => {
    // The wire gate (STORAGE_KEY_PATTERN, 200 chars) refuses long before
    // this, but the raw-layer behavior is worth an executed pin: a ~2800
    // byte random key overflows the unique index tuple and the INSERT
    // throws instead of silently truncating. crypto hex is incompressible,
    // which is what actually trips the bound.
    const { randomBytes } = await import('node:crypto');
    const longKey = randomBytes(1400).toString('hex');
    await expect(
      db.beginStoragePurchase(pool, { ...ROW, idempotencyKey: longKey }),
    ).rejects.toThrow(/index row/);
  });

  it('runs the whole lifecycle: upsert convergence, one-row recovery, and no-debit delete', async () => {
    // Fresh insert.
    const first = await db.beginStoragePurchase(pool, ROW);
    expect(first.inserted).toBe(true);
    expect(first.existing?.status).toBe('pending');
    // Same-key retry converges on the SAME row (ON CONFLICT for real).
    const retry = await db.beginStoragePurchase(pool, { ...ROW, accountId: 2 });
    expect(retry.inserted).toBe(false);
    expect(retry.existing?.accountId).toBe(1);
    // The recovery scan sees the pending row.
    const pending = await db.pendingStoragePurchasesForCharacter(pool, 1);
    expect(pending?.idempotencyKey).toBe('pg-key-1');
    expect(
      await db.deletePendingStoragePurchaseWithoutDebit(pool, 'pg-key-1', ROW.claimToken),
    ).toBe(true);
    expect(
      await db.deletePendingStoragePurchaseWithoutDebit(pool, 'pg-key-1', ROW.claimToken),
    ).toBe(false);
    expect(await db.storagePurchaseByKey(pool, 'pg-key-1')).toBeNull();
    // No refusal tombstone blocks a legitimate same-key retry.
    expect((await db.beginStoragePurchase(pool, ROW)).inserted).toBe(true);
    expect(await db.settleStoragePurchase(pool, 'pg-key-1', 'unresolved', ROW.claimToken)).toBe(
      true,
    );
    expect(await db.settleStoragePurchase(pool, 'pg-key-1', 'applied', ROW.claimToken)).toBe(false);
    expect((await db.storagePurchaseByKey(pool, 'pg-key-1'))?.status).toBe('unresolved');
    expect(await db.pendingStoragePurchasesForCharacter(pool, 1)).toBeNull();

    const blocked = await db.beginStoragePurchase(pool, {
      ...ROW,
      idempotencyKey: 'pg-key-2',
    });
    expect(blocked).toMatchObject({
      inserted: false,
      existing: null,
      blockedByOpen: { idempotencyKey: 'pg-key-1', status: 'unresolved' },
    });
    expect(await db.storagePurchaseByKey(pool, 'pg-key-2')).toBeNull();
    // Model the explicit support resolution before proving the rail can open
    // for a later key. Unresolved is not a recovery retry and cannot be closed
    // through the no-debit helper.
    await pool.query("DELETE FROM storage_purchases WHERE idempotency_key = 'pg-key-1'");
    expect(
      (await db.beginStoragePurchase(pool, { ...ROW, idempotencyKey: 'pg-key-2' })).inserted,
    ).toBe(true);
    expect((await db.pendingStoragePurchasesForCharacter(pool, 1))?.idempotencyKey).toBe(
      'pg-key-2',
    );
    expect(
      await db.deletePendingStoragePurchaseWithoutDebit(pool, 'pg-key-2', ROW.claimToken),
    ).toBe(true);
  });

  it('character deletion preserves applied identity and blocks replacement replay', async () => {
    // The two REFERENCES clauses were declared and never executed by either
    // suite, so a cascade dropped in a future edit (or a FK pointed at the
    // wrong parent) would ship green. This matters beyond tidiness: the whole
    // reason the FK indexes are FULL rather than partial is that a cascade
    // cannot use a partial index, and ruling 9 turns on what a character
    // delete actually erases.
    await pool.query('INSERT INTO accounts (id) VALUES (3)');
    await pool.query('INSERT INTO characters (id) VALUES (3)');
    // A control row on the parents this test never deletes, minted here rather
    // than relying on an earlier case's leftovers (the lifecycle case removes
    // its own rows, so borrowing one makes this assertion order-dependent).
    await db.beginStoragePurchase(pool, { ...ROW, idempotencyKey: 'pg-cascade-control' });
    const applied = {
      ...ROW,
      accountId: 3,
      characterId: 3,
      idempotencyKey: 'pg-cascade-applied',
    };
    await db.beginStoragePurchase(pool, applied);
    await db.settleStoragePurchase(pool, applied.idempotencyKey, 'applied', applied.claimToken);
    await db.beginStoragePurchase(pool, {
      ...applied,
      idempotencyKey: 'pg-cascade-pending',
    });
    // An open paid operation blocks CHARACTER deletion and survives the
    // rejected statement. Close that control row explicitly before proving
    // that the eventual cascade takes only closed operational history, never
    // the deletion-proof applied receipt.
    await expect(pool.query('DELETE FROM characters WHERE id = 3')).rejects.toMatchObject({
      code: '55006',
      constraint: 'storage_purchases_open_delete_guard',
      message: 'storage_purchase_open',
    });
    expect(await db.storagePurchaseByKey(pool, 'pg-cascade-pending')).toMatchObject({
      status: 'pending',
    });
    expect(
      await db.deletePendingStoragePurchaseWithoutDebit(
        pool,
        'pg-cascade-pending',
        applied.claimToken,
      ),
    ).toBe(true);
    await pool.query('DELETE FROM characters WHERE id = 3');
    expect(await db.storagePurchaseByKey(pool, 'pg-cascade-pending')).toBeNull();
    expect(await db.storagePurchaseByKey(pool, applied.idempotencyKey)).toMatchObject({
      accountId: 3,
      characterId: 3,
      status: 'applied',
    });

    await pool.query('INSERT INTO characters (id) VALUES (5)');
    const replacement = await db.beginStoragePurchase(pool, {
      ...applied,
      characterId: 5,
    });
    expect(replacement.inserted).toBe(false);
    expect(replacement.existing?.characterId).toBe(3);
    const legacyInsert = await pool.query(
      `INSERT INTO storage_purchases
         (realm, account_id, character_id, item_id, expected_cost_claudium, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [applied.realm, applied.accountId, 5, applied.itemId, 100, applied.idempotencyKey],
    );
    expect(legacyInsert.rowCount).toBe(0);

    await pool.query('INSERT INTO characters (id) VALUES (4)');
    const accountApplied = {
      ...ROW,
      accountId: 3,
      characterId: 4,
      idempotencyKey: 'pg-cascade-account',
    };
    await db.beginStoragePurchase(pool, accountApplied);
    await db.settleStoragePurchase(
      pool,
      accountApplied.idempotencyKey,
      'applied',
      accountApplied.claimToken,
    );
    // ... and so does an ACCOUNT delete, through the other reference.
    await pool.query('DELETE FROM accounts WHERE id = 3');
    expect(await db.storagePurchaseByKey(pool, 'pg-cascade-account')).toBeNull();
    expect(await db.storagePurchaseByKey(pool, applied.idempotencyKey)).toBeNull();

    // Unrelated rows are untouched: the cascade is scoped, not a wipe.
    expect(await db.storagePurchaseByKey(pool, 'pg-cascade-control')).not.toBeNull();
  });

  it('the default planner uses the open-rail index at realistic closed-row cardinality', async () => {
    await pool.query('INSERT INTO accounts (id) VALUES (7)');
    await pool.query('INSERT INTO characters (id) VALUES (7)');
    try {
      await pool.query(
        `INSERT INTO storage_purchases
           (realm, account_id, character_id, item_id, expected_cost_claudium,
            idempotency_key, status, resolved_at)
         SELECT 'pgtest', 7, 7, 'planner_closed', 100,
                'pg-planner-closed-' || n::text, 'applied', now()
           FROM generate_series(1, 1500) AS n`,
      );
      await db.beginStoragePurchase(pool, {
        ...ROW,
        accountId: 7,
        characterId: 7,
        idempotencyKey: 'pg-planner-open',
        claimToken: '00000000-0000-4000-8000-000000000077',
      });
      await pool.query('ANALYZE storage_purchases');
      const plan = await pool.query(
        'EXPLAIN (FORMAT JSON) SELECT id FROM storage_purchases ' +
          "WHERE character_id = 7 AND status IN ('pending', 'unresolved') " +
          'ORDER BY created_at, id LIMIT 1',
      );
      expect(JSON.stringify(plan.rows[0])).toContain('storage_purchases_one_open_per_character');
      expect(await db.openStoragePurchaseForCharacter(pool, 7)).toMatchObject({
        idempotencyKey: 'pg-planner-open',
        status: 'pending',
      });
    } finally {
      await pool.query("DELETE FROM storage_purchases WHERE account_id = 7 AND status = 'pending'");
      await pool.query('DELETE FROM characters WHERE id = 7');
      await pool.query('DELETE FROM accounts WHERE id = 7');
    }
  });
  it('rejects persistent refused history at the database boundary', async () => {
    await expect(
      pool.query(
        `INSERT INTO storage_purchases
           (realm, account_id, character_id, item_id, expected_cost_claudium,
            idempotency_key, status)
         VALUES ('r', 1, 1, 'strongbox_rung_01', 100, 'pg-refused', 'refused')`,
      ),
    ).rejects.toThrow(/storage_purchases_status_allowed/);
  });
});
