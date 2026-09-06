import { describe, expect, it } from 'vitest';
import {
  AUDIT_GROWTH_BYTE_TABLES,
  AUDIT_GROWTH_SOURCES,
  auditGrowthBytesSql,
  auditGrowthTriggers,
} from '../../server/audit_growth_sources';
import {
  BANK_LEDGER_GROWTH_BUDGET_REVISION,
  BANK_LEDGER_GROWTH_BUDGET_SCHEMA,
  BANK_LEDGER_GROWTH_DEFAULT_HARD_LIMIT_ROWS,
  BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS,
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_ENV,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  BANK_LEDGER_GROWTH_UNDERFLOW_MESSAGE,
  BANK_LEDGER_GROWTH_UNDERFLOW_SQLSTATE,
  BankLedgerGrowthLimitExceeded,
  bankLedgerGrowthBudgetReadbackSql,
  bankLedgerGrowthBudgetReadout,
  bankLedgerGrowthBudgetSchema,
  bankLedgerGrowthHardLimitFromEnv,
  bankLedgerGrowthLimitFromError,
  beginBankLedgerGrowthObservation,
  observeBankLedgerGrowthBudget,
  observeBankLedgerGrowthBytes,
} from '../../server/bank_ledger_growth_budget';
import {
  MATERIAL_SOURCE_CONTAINERS_TABLE,
  MATERIAL_SOURCE_JOURNAL_TABLE,
} from '../../server/material_source_journal_db';

const folded = BANK_LEDGER_GROWTH_BUDGET_SCHEMA.replace(/\s+/g, ' ');
/** The same text with SQL comments stripped: prose must never satisfy, or
 *  defeat, a code-level assertion. */
const code = BANK_LEDGER_GROWTH_BUDGET_SCHEMA.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

const LEDGER_COUNT = '(SELECT count(*)::bigint FROM "public".bank_ledger)';
const JOURNAL_COUNT = '(SELECT count(*)::bigint FROM "public".material_source_journal)';
const AGGREGATE_COUNT = `${LEDGER_COUNT} + ${JOURNAL_COUNT}`;

describe('bank ledger durable growth budget', () => {
  it('parses one shared positive safe-integer hard limit and pins its default', () => {
    expect(BANK_LEDGER_GROWTH_DEFAULT_HARD_LIMIT_ROWS).toBe(10_000_000);
    expect(BANK_LEDGER_GROWTH_LIMIT_ENV).toBe('BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS');
    expect(bankLedgerGrowthHardLimitFromEnv({})).toBe(10_000_000);
    expect(bankLedgerGrowthHardLimitFromEnv({ [BANK_LEDGER_GROWTH_LIMIT_ENV]: '37' })).toBe(37);

    for (const invalid of ['0', '-1', ' 4', '4 ', '01', '1.5', '9007199254740992']) {
      expect(() =>
        bankLedgerGrowthHardLimitFromEnv({ [BANK_LEDGER_GROWTH_LIMIT_ENV]: invalid }),
      ).toThrow(/positive safe integer/);
    }
  });

  it('counts both audit tables against ONE budget, env knob and ceiling', () => {
    // The aggregate surface, spelled out. A second budget row, a second env
    // name, or a per-source ceiling is the shape this pin exists to refuse.
    expect(AUDIT_GROWTH_SOURCES.map((source) => source.table)).toEqual([
      'bank_ledger',
      'material_source_journal',
    ]);
    // Pinned against the journal module's own exported names so the registry
    // cannot drift away from the table the writer actually inserts into.
    expect(AUDIT_GROWTH_SOURCES[1]?.table).toBe(MATERIAL_SOURCE_JOURNAL_TABLE);
    // The anchor table is NOT counted: an anchor is minted with its first
    // journal row and reaped by the same cascade that reaps its last, so its
    // cardinality is already bounded by counted rows. Its BYTES still count.
    expect(AUDIT_GROWTH_SOURCES.map((source) => source.table)).not.toContain(
      MATERIAL_SOURCE_CONTAINERS_TABLE,
    );
    expect(AUDIT_GROWTH_BYTE_TABLES).toEqual([
      'bank_ledger',
      MATERIAL_SOURCE_CONTAINERS_TABLE,
      MATERIAL_SOURCE_JOURNAL_TABLE,
    ]);
    // One ceiling, one singleton, one accumulator table for BOTH sources: two
    // CREATE TABLEs total, one hard_limit_rows column, and exactly one place
    // where a write is measured against the configured limit.
    expect(folded.split('CREATE TABLE IF NOT EXISTS')).toHaveLength(3);
    expect(folded.split('hard_limit_rows BIGINT NOT NULL')).toHaveLength(2);
    expect(folded.split(`hard_limit_rows = ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}`)).toHaveLength(2);
  });

  it('installs one accumulator per source table, both directions, and one deferred ceiling', () => {
    expect(folded).toContain(
      'CREATE OR REPLACE FUNCTION "public".accumulate_bank_ledger_growth_budget()',
    );
    expect(folded).toContain(
      'CREATE OR REPLACE FUNCTION "public".accumulate_material_source_journal_growth_budget()',
    );
    expect(folded).toContain(
      'CREATE OR REPLACE FUNCTION "public".enforce_bank_ledger_growth_budget()',
    );
    // Three functions, three hardened search paths.
    expect(folded.split('SET search_path = pg_catalog, "public", pg_temp')).toHaveLength(4);

    // Each source gets ONE function whose branches name transition tables of
    // ONE row type: a shared transition-table name across two differently
    // shaped tables would hand a cached plan the wrong tuple descriptor.
    expect(folded).toContain(
      "IF TG_OP = 'INSERT' THEN SELECT count(*)::bigint INTO changed_rows FROM inserted_bank_ledger_rows;",
    );
    expect(folded).toContain(
      "IF TG_OP = 'DELETE' THEN SELECT count(*)::bigint INTO changed_rows FROM deleted_bank_ledger_rows;",
    );
    expect(folded).toContain(
      "IF TG_OP = 'INSERT' THEN SELECT count(*)::bigint INTO changed_rows FROM inserted_material_source_journal_rows;",
    );
    expect(folded).toContain(
      "IF TG_OP = 'DELETE' THEN SELECT count(*)::bigint INTO changed_rows FROM deleted_material_source_journal_rows;",
    );
    // A zero-row statement books nothing at all: an idempotent retry that
    // writes no audit row must consume no budget.
    expect(folded.split('IF changed_rows = 0 THEN RETURN NULL; END IF;')).toHaveLength(5);
    // Inserts and deletes accumulate into their OWN column, and several
    // statements in one transaction add into the same pending row.
    expect(folded).toContain(
      'VALUES (pg_catalog.pg_current_xact_id(), changed_rows, 0) ON CONFLICT (transaction_id) DO UPDATE SET inserted_rows = "public".bank_ledger_growth_pending.inserted_rows + EXCLUDED.inserted_rows;',
    );
    expect(folded).toContain(
      'VALUES (pg_catalog.pg_current_xact_id(), 0, changed_rows) ON CONFLICT (transaction_id) DO UPDATE SET deleted_rows = "public".bank_ledger_growth_pending.deleted_rows + EXCLUDED.deleted_rows;',
    );
    expect(folded).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(folded).toContain(
      'DELETE FROM "public".bank_ledger_growth_pending WHERE transaction_id',
    );
    expect(folded).toContain(
      'RETURNING inserted_rows, deleted_rows INTO attempted_inserted_rows, attempted_deleted_rows;',
    );
    expect(folded).toContain('attempted_rows := attempted_inserted_rows - attempted_deleted_rows;');
    expect(folded).not.toMatch(/nextval|currval|last_value/i);
    expect(code).not.toContain('PERFORM');
  });

  it('carries the two accumulator counters and the revision marker on the durable tables', () => {
    expect(folded).toContain(
      'CREATE TABLE IF NOT EXISTS "public".bank_ledger_growth_budget ' +
        '( singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), ' +
        'committed_rows BIGINT NOT NULL CHECK (committed_rows >= 0), ' +
        'hard_limit_rows BIGINT NOT NULL CHECK (hard_limit_rows > 0), ' +
        'budget_revision INT NOT NULL DEFAULT 1 CHECK (budget_revision > 0), ' +
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT now() )',
    );
    // Two counters rather than one signed column: each accumulator adds in its
    // own direction and the enforcer nets them exactly once.
    expect(folded).toContain(
      'CREATE TABLE IF NOT EXISTS "public".bank_ledger_growth_pending ' +
        '( transaction_id xid8 PRIMARY KEY, ' +
        'inserted_rows BIGINT NOT NULL DEFAULT 0, ' +
        'deleted_rows BIGINT NOT NULL DEFAULT 0, ' +
        'CONSTRAINT bank_ledger_growth_pending_delta ' +
        'CHECK (inserted_rows >= 0 AND deleted_rows >= 0 AND inserted_rows + deleted_rows > 0) )',
    );
    // The legacy shape allowed only positive inserts; a delete-only
    // transaction would violate it.
    expect(code).not.toContain('inserted_rows BIGINT NOT NULL CHECK (inserted_rows > 0)');
  });

  it('converges a legacy install additively, gated so a steady-state boot alters nothing', () => {
    // Every converge is behind a catalog probe: an unconditional ADD COLUMN or
    // ALTER takes ACCESS EXCLUSIVE and writes the catalog on EVERY boot of
    // every realm, which is exactly the churn the revision marker exists to
    // avoid.
    const revisionProbe = folded.indexOf(
      "FROM pg_catalog.pg_attribute WHERE attrelid = '\"public\".bank_ledger_growth_budget'::pg_catalog.regclass AND attname = 'budget_revision' AND NOT attisdropped",
    );
    const revisionAlter = folded.indexOf(
      'ALTER TABLE "public".bank_ledger_growth_budget ADD COLUMN budget_revision INT NOT NULL DEFAULT 1 CHECK (budget_revision > 0);',
    );
    expect(revisionProbe).toBeGreaterThanOrEqual(0);
    expect(revisionProbe).toBeLessThan(revisionAlter);

    const deletedProbe = folded.indexOf(
      "FROM pg_catalog.pg_attribute WHERE attrelid = '\"public\".bank_ledger_growth_pending'::pg_catalog.regclass AND attname = 'deleted_rows' AND NOT attisdropped",
    );
    const deletedAlter = folded.indexOf(
      'ALTER TABLE "public".bank_ledger_growth_pending ADD COLUMN deleted_rows BIGINT NOT NULL DEFAULT 0;',
    );
    expect(deletedProbe).toBeGreaterThanOrEqual(0);
    expect(deletedProbe).toBeLessThan(deletedAlter);

    // The legacy CHECK is found by DEFINITION and dropped by quoted identity:
    // its name is system generated, so a hard-coded name would silently miss.
    expect(folded).toContain(
      "AND c.conname <> 'bank_ledger_growth_pending_delta' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%inserted_rows > 0%'",
    );
    expect(folded).toContain(
      'EXECUTE \'ALTER TABLE "public".bank_ledger_growth_pending DROP CONSTRAINT \' || pg_catalog.quote_ident(legacy_check.conname);',
    );
    // The drop is scoped to the budget's OWN accumulator table, never a source
    // table.
    expect(folded).toContain(
      'FROM pg_catalog.pg_constraint c WHERE c.conrelid = \'"public".bank_ledger_growth_pending\'::pg_catalog.regclass',
    );
    // The ONLY constraint drop is the discovered one: no statically named
    // constraint (on any table) is dropped by this fragment.
    expect(code).not.toMatch(/DROP CONSTRAINT \w/);
    expect(folded).toContain(
      'ADD CONSTRAINT bank_ledger_growth_pending_delta CHECK (inserted_rows >= 0 AND deleted_rows >= 0 AND inserted_rows + deleted_rows > 0);',
    );
    // Nothing in this fragment drops or truncates an audited table.
    expect(code).not.toMatch(/\bDROP\s+(?:TABLE|INDEX|TRIGGER|FUNCTION)\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('probes every enforcement trigger by exact definition and refuses a tampered one', () => {
    for (const trigger of [
      {
        relation: '"public".bank_ledger_growth_pending',
        name: 'bank_ledger_growth_budget_commit',
        variable: 'commit',
      },
      {
        relation: '"public".bank_ledger',
        name: 'bank_ledger_growth_budget_insert',
        variable: 'bank_ledger_insert',
      },
      {
        relation: '"public".bank_ledger',
        name: 'bank_ledger_growth_budget_delete',
        variable: 'bank_ledger_delete',
      },
      {
        relation: '"public".material_source_journal',
        name: 'material_source_journal_growth_budget_insert',
        variable: 'material_source_journal_insert',
      },
      {
        relation: '"public".material_source_journal',
        name: 'material_source_journal_growth_budget_delete',
        variable: 'material_source_journal_delete',
      },
    ]) {
      expect(folded).toContain(
        `FROM pg_catalog.pg_trigger WHERE tgrelid = '${trigger.relation}'::pg_catalog.regclass ` +
          `AND tgname = '${trigger.name}' AND NOT tgisinternal ) INTO named_${trigger.variable}_trigger;`,
      );
      expect(folded).toContain(`) INTO valid_${trigger.variable}_trigger;`);
      expect(folded).toContain(
        `IF named_${trigger.variable}_trigger AND NOT valid_${trigger.variable}_trigger THEN`,
      );
      expect(folded).toContain(`MESSAGE = '${trigger.name} has an unsafe definition';`);
    }
    // Five triggers, five full definition probes.
    expect(folded.split('AND tgqual IS NULL')).toHaveLength(6);
    expect(folded.split('AND tgnargs = 0 AND pg_catalog.octet_length(tgargs) = 0')).toHaveLength(6);
    expect(auditGrowthTriggers()).toHaveLength(5);

    // The statement accumulators: AFTER INSERT (tgtype 4) and AFTER DELETE
    // (tgtype 8) with the matching transition table, and NOT a constraint
    // trigger. The commit trigger is the deferred row trigger (tgtype 21).
    expect(folded).toContain(
      "AND tgenabled = 'O' AND tgtype = 4 AND tgfoid = '\"public\".accumulate_bank_ledger_growth_budget()'::pg_catalog.regprocedure",
    );
    expect(folded).toContain(
      "AND tgenabled = 'O' AND tgtype = 8 AND tgfoid = '\"public\".accumulate_bank_ledger_growth_budget()'::pg_catalog.regprocedure",
    );
    expect(folded).toContain(
      "AND tgenabled = 'O' AND tgtype = 4 AND tgfoid = '\"public\".accumulate_material_source_journal_growth_budget()'::pg_catalog.regprocedure",
    );
    expect(folded).toContain(
      "AND tgenabled = 'O' AND tgtype = 8 AND tgfoid = '\"public\".accumulate_material_source_journal_growth_budget()'::pg_catalog.regprocedure",
    );
    expect(folded).toContain(
      "AND tgenabled = 'O' AND tgtype = 21 AND tgfoid = '\"public\".enforce_bank_ledger_growth_budget()'::pg_catalog.regprocedure",
    );
    expect(folded).toContain(
      "AND tgconstraint = 0 AND tgnewtable = 'inserted_bank_ledger_rows' AND tgoldtable IS NULL",
    );
    expect(folded).toContain(
      "AND tgconstraint = 0 AND tgnewtable IS NULL AND tgoldtable = 'deleted_bank_ledger_rows'",
    );
    expect(folded).toContain(
      "AND tgconstraint = 0 AND tgnewtable = 'inserted_material_source_journal_rows' AND tgoldtable IS NULL",
    );
    expect(folded).toContain(
      "AND tgconstraint = 0 AND tgnewtable IS NULL AND tgoldtable = 'deleted_material_source_journal_rows'",
    );
    expect(folded).toContain(
      'AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred AND tgnewtable IS NULL AND tgoldtable IS NULL',
    );

    // What a bootstrap actually publishes, spelled out: the transition table a
    // probe demands is worthless if the CREATE names a different one.
    expect(folded).toContain(
      "EXECUTE 'CREATE TRIGGER bank_ledger_growth_budget_delete " +
        'AFTER DELETE ON "public".bank_ledger ' +
        'REFERENCING OLD TABLE AS deleted_bank_ledger_rows FOR EACH STATEMENT ' +
        'EXECUTE FUNCTION "public".accumulate_bank_ledger_growth_budget()\'',
    );
    expect(folded).toContain(
      "EXECUTE 'CREATE TRIGGER material_source_journal_growth_budget_insert " +
        'AFTER INSERT ON "public".material_source_journal ' +
        'REFERENCING NEW TABLE AS inserted_material_source_journal_rows FOR EACH STATEMENT ' +
        'EXECUTE FUNCTION "public".accumulate_material_source_journal_growth_budget()\'',
    );
    expect(folded).toContain(
      "EXECUTE 'CREATE TRIGGER material_source_journal_growth_budget_delete " +
        'AFTER DELETE ON "public".material_source_journal ' +
        'REFERENCING OLD TABLE AS deleted_material_source_journal_rows FOR EACH STATEMENT ' +
        'EXECUTE FUNCTION "public".accumulate_material_source_journal_growth_budget()\'',
    );
  });

  it('keeps the missing-trigger refusal, judged against the set the stored revision owes', () => {
    // An initialized budget with a missing trigger is an unaudited write
    // window; recreating it silently would leave the counter wrong forever.
    expect(folded).toContain(
      `IF budget_initialized AND stored_revision >= ${BANK_LEDGER_GROWTH_BUDGET_REVISION} ` +
        'AND NOT (valid_commit_trigger AND valid_bank_ledger_insert_trigger ' +
        'AND valid_bank_ledger_delete_trigger AND valid_material_source_journal_insert_trigger ' +
        'AND valid_material_source_journal_delete_trigger) THEN',
    );
    // A legacy install has not been migrated yet, so the aggregate triggers
    // are legitimately absent; the two originals are still mandatory, exactly
    // as before this change.
    expect(folded).toContain(
      `IF budget_initialized AND stored_revision < ${BANK_LEDGER_GROWTH_BUDGET_REVISION} ` +
        'AND NOT (valid_commit_trigger AND valid_bank_ledger_insert_trigger) THEN',
    );
    expect(
      folded.split(
        "MESSAGE = 'initialized bank ledger growth budget is missing an enforcement trigger';",
      ),
    ).toHaveLength(3);
    expect(folded).toContain("MESSAGE = 'bank ledger growth budget has orphaned pending rows';");
  });

  it('seeds and migrates exactly once, under both source locks, then never scans again', () => {
    expect(BANK_LEDGER_GROWTH_BUDGET_REVISION).toBe(2);
    // The counted tables must exist first: this fragment is applied last so
    // they do, and a missing one is named rather than surfacing as a bare
    // regclass cast failure.
    expect(folded).toContain(
      'IF pg_catalog.to_regclass(\'"public".material_source_journal\') IS NULL THEN',
    );
    expect(folded).toContain(
      "MESSAGE = 'audit growth budget requires material_source_journal to exist first';",
    );

    const locks =
      'LOCK TABLE "public".bank_ledger IN SHARE ROW EXCLUSIVE MODE; ' +
      'LOCK TABLE "public".material_source_journal IN SHARE ROW EXCLUSIVE MODE;';
    // Both paths that count take BOTH locks: the first install and the ONE
    // aggregate migration.
    expect(folded.split(locks)).toHaveLength(3);

    const firstLock = folded.indexOf(locks);
    const seedCreateCommit = folded.indexOf(
      "EXECUTE 'CREATE CONSTRAINT TRIGGER bank_ledger_growth_budget_commit",
    );
    const seed = folded.indexOf(
      `SELECT TRUE, ${AGGREGATE_COUNT}, ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}, ${BANK_LEDGER_GROWTH_BUDGET_REVISION};`,
    );
    // Lock, then publish triggers, then count: a writer that slipped between
    // the count and the trigger becoming visible would be lost forever.
    expect(firstLock).toBeGreaterThanOrEqual(0);
    expect(firstLock).toBeLessThan(seedCreateCommit);
    expect(seedCreateCommit).toBeLessThan(seed);

    const migrationArm = folded.indexOf(
      `ELSIF stored_revision < ${BANK_LEDGER_GROWTH_BUDGET_REVISION} THEN`,
    );
    const migrationLock = folded.indexOf(locks, migrationArm);
    const recount = folded.indexOf(
      'UPDATE "public".bank_ledger_growth_budget ' +
        `SET committed_rows = ${AGGREGATE_COUNT}, ` +
        `budget_revision = ${BANK_LEDGER_GROWTH_BUDGET_REVISION}, updated_at = now() ` +
        'WHERE singleton = TRUE;',
    );
    expect(migrationArm).toBeGreaterThan(seed);
    expect(migrationLock).toBeGreaterThan(migrationArm);
    expect(recount).toBeGreaterThan(migrationLock);
    // The legacy counter was a lifetime insert tally cascades never credited
    // back, so the migration REPLACES it with the exact live aggregate (the
    // recount pin above) rather than adjusting it by a delta.
    expect(code).not.toContain('SET committed_rows = committed_rows + (SELECT');
    // Both counting paths are inside the ONE conditional pair, so a converged
    // install issues no COUNT and takes no source lock at all.
    expect(folded.split('count(*)::bigint FROM "public".bank_ledger)')).toHaveLength(3);
    expect(folded.split('count(*)::bigint FROM "public".material_source_journal)')).toHaveLength(3);

    // The downgrade fence: an older binary must not maintain a counter a newer
    // one migrated to different rules.
    expect(folded).toContain(`AND budget_revision <> ${BANK_LEDGER_GROWTH_BUDGET_REVISION} ) THEN`);
    expect(folded).toContain(
      "MESSAGE = 'bank ledger growth budget revision disagrees with this process';",
    );
  });

  it('refuses net growth past the ceiling, admits removals, refuses underflow', () => {
    // The capacity arm applies ONLY to a transaction that grows the audit
    // surface. That is what lets an over-limit database recover: deletions
    // (including a cascading owner delete) still commit and give capacity back.
    expect(folded).toContain(
      `WHERE singleton = TRUE AND hard_limit_rows = ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS} ` +
        'AND committed_rows + attempted_rows >= 0 ' +
        'AND (attempted_rows <= 0 OR committed_rows + attempted_rows <= hard_limit_rows)',
    );
    // Never clamp a miscount to zero and never let the counter wrap: an
    // impossible removal is its own named refusal carrying both directions.
    expect(folded).toContain('IF before_rows + attempted_rows < 0 THEN');
    expect(folded).toContain(`ERRCODE = '${BANK_LEDGER_GROWTH_UNDERFLOW_SQLSTATE}'`);
    expect(folded).toContain(`MESSAGE = '${BANK_LEDGER_GROWTH_UNDERFLOW_MESSAGE}'`);
    expect(folded).toContain(
      "'attempted_inserted_rows', attempted_inserted_rows, 'attempted_deleted_rows', attempted_deleted_rows",
    );
    expect(code).not.toMatch(/GREATEST\s*\(\s*0/);
    expect(code).not.toMatch(/committed_rows = 0/);

    // Diagnosis order: config drift, then underflow, then capacity. Each later
    // arm may only be reached once the earlier explanations are excluded.
    const drift = folded.indexOf('config drift: this process disagrees');
    const underflow = folded.indexOf(`MESSAGE = '${BANK_LEDGER_GROWTH_UNDERFLOW_MESSAGE}'`);
    const capacity = folded.indexOf("MESSAGE = 'bank ledger growth limit exceeded'");
    expect(drift).toBeGreaterThanOrEqual(0);
    expect(underflow).toBeGreaterThan(drift);
    expect(capacity).toBeGreaterThan(underflow);
  });

  it('names enforcement-time config drift distinctly from the capacity refusal', () => {
    // An env/singleton mismatch on a RUNNING process fails the guarded UPDATE
    // on the limit predicate, not the capacity one; reporting it as the
    // generic P0001 would carry a self-contradicting DETAIL (committed +
    // attempted visibly under the stored limit). The enforcer gives the
    // mismatch its own arm, keyed on the stored limit disagreeing with this
    // process's compiled value.
    expect(folded).toContain(`IF stored_limit <> ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS} THEN`);
    expect(folded).toContain(
      "MESSAGE = 'BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS config drift: this process disagrees with the durable bank-ledger limit'",
    );
    expect(folded).toContain("'stored_hard_limit_rows', stored_limit");
    expect(folded).toContain(`'configured_hard_limit_rows', ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}`);
    // The same 22023 class as the boot-time guard, so both drift detections
    // read as invalid-parameter, never as capacity: once at boot, once at
    // enforcement.
    expect(folded.split("ERRCODE = '22023'")).toHaveLength(3);
    expect(folded).toContain("ERRCODE = 'P0001'");
    expect(folded).toContain("CONSTRAINT = 'bank_ledger_growth_hard_limit'");
  });

  it('rejects an unsafe schema name and pins the boot readback literal', () => {
    expect(bankLedgerGrowthBudgetSchema('isolated_test')).toContain(
      '"isolated_test".bank_ledger_growth_budget',
    );
    expect(bankLedgerGrowthBudgetSchema('isolated_test')).toContain(
      '"isolated_test".material_source_journal',
    );
    // The boot readback's LITERAL, pinned here so the exported-builder
    // equality pins in schema_wiring and the save-effects boot test are
    // anchored to real SQL rather than comparing the builder to itself. It
    // stays two columns: db.ts feeds the gauge from it and acts on nothing
    // else, so the revision marker has no business widening a boot read.
    expect(bankLedgerGrowthBudgetReadbackSql()).toBe(
      'SELECT committed_rows, hard_limit_rows FROM "public".bank_ledger_growth_budget WHERE singleton = TRUE',
    );
    expect(() => bankLedgerGrowthBudgetReadbackSql('bad; DROP')).toThrow(
      /simple lowercase identifier/,
    );
    expect(() => bankLedgerGrowthBudgetSchema('public; DROP TABLE bank_ledger')).toThrow(
      /simple lowercase identifier/,
    );
    expect(() => auditGrowthBytesSql('public; DROP TABLE bank_ledger')).toThrow(
      /simple lowercase identifier/,
    );
  });

  it('measures bytes across the whole audit surface in one lock-free expression', () => {
    // Rows bound the ceiling; bytes are what an operator sizes disk against.
    // One expression, every audit table, resolved through to_regclass so a
    // database that has not applied the source DDL yet still answers.
    const bytes = auditGrowthBytesSql().replace(/\s+/g, ' ');
    expect(bytes).toContain('pg_catalog.sum(pg_catalog.pg_total_relation_size(audit_table.oid))');
    for (const table of AUDIT_GROWTH_BYTE_TABLES) {
      expect(bytes).toContain(`pg_catalog.to_regclass('public.${table}')`);
    }
    expect(bytes).toContain('WHERE audit_table.oid IS NOT NULL');
    // No heap scan and no lock STATEMENT. It is not lock-free:
    // pg_total_relation_size takes AccessShareLock per relation, proven (and
    // bounded by the caller's statement timeout) in the monitor pg suite.
    expect(bytes).not.toMatch(/count\(\*\)|FROM public\.\w|LOCK TABLE/);
  });

  it('tunes both budget tables for their dead-tuple churn', () => {
    // One INSERT plus one DELETE per audit transaction against zero committed
    // rows is the queue-table autovacuum shape: a scale-factor trigger against
    // zero live rows barely ever fires, so the pending table pins a fixed
    // dead-tuple threshold. No fillfactor: its rows die inside their own
    // transaction, so update headroom buys nothing.
    const pendingParams = '(autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 100)';
    expect(folded).toContain(
      `CHECK (inserted_rows >= 0 AND deleted_rows >= 0 AND inserted_rows + deleted_rows > 0) ) WITH ${pendingParams}`,
    );
    // The singleton takes one UPDATE per audit transaction forever against
    // one live row, so IT is the table that needs the fixed-threshold vacuum
    // backstop (HOT pruning in its nearly-empty page absorbs the rest).
    const budgetParams = '(autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000)';
    expect(folded).toContain(
      `updated_at TIMESTAMPTZ NOT NULL DEFAULT now() ) WITH ${budgetParams}`,
    );
    // The converge arm reaches tables created before the parameters existed,
    // gated behind a reloptions probe: a value-identical ALTER still takes
    // SHARE UPDATE EXCLUSIVE to COMMIT and writes pg_class, so steady-state
    // boots must skip it. The probe compares PARSED values via
    // pg_options_to_table, never stored text, so a '0' vs '0.0' rendering
    // difference cannot re-fire the ALTER on every boot.
    expect(folded).toContain(
      `ALTER TABLE "public".bank_ledger_growth_pending SET ${pendingParams}`,
    );
    expect(folded).toContain(`ALTER TABLE "public".bank_ledger_growth_budget SET ${budgetParams}`);
    expect(code).not.toContain('reloptions @>');
    expect(code).not.toContain('fillfactor');
    expect(folded.split('FROM pg_catalog.pg_options_to_table(c.reloptions) o')).toHaveLength(3);
    for (const table of ['bank_ledger_growth_pending', 'bank_ledger_growth_budget']) {
      const probe = folded.indexOf(`c.oid = '"public".${table}'::pg_catalog.regclass`);
      const gatedAlter = folded.indexOf(`ALTER TABLE "public".${table} SET`);
      expect(probe).toBeGreaterThanOrEqual(0);
      expect(probe).toBeLessThan(gatedAlter);
    }
    // The cast lives inside CASE (defined evaluation order), so an unrelated
    // non-numeric reloption can never reach it and abort boot.
    expect(folded.split('WHERE CASE o.option_name')).toHaveLength(3);
    expect(folded).toContain("WHEN 'autovacuum_vacuum_scale_factor'");
    expect(folded).toContain('o.option_value::pg_catalog.numeric = 0');
    expect(folded).toContain('o.option_value::pg_catalog.numeric = 100');
    expect(folded).toContain('o.option_value::pg_catalog.numeric = 1000');
    expect(folded).toContain('ELSE FALSE END');
  });

  it('converts only the trigger fixed identity and exact JSON evidence', () => {
    expect(BANK_LEDGER_GROWTH_LIMIT_SQLSTATE).toBe('P0001');
    expect(BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT).toBe('bank_ledger_growth_hard_limit');
    const pgError = {
      code: BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      detail: JSON.stringify({
        committed_rows: '9999999',
        attempted_rows: '2',
        hard_limit_rows: '10000000',
      }),
    };

    const converted = bankLedgerGrowthLimitFromError(pgError);
    expect(converted).toBeInstanceOf(BankLedgerGrowthLimitExceeded);
    expect(converted).toMatchObject({
      committedRows: 9_999_999,
      attemptedRows: 2,
      hardLimitRows: 10_000_000,
      cause: pgError,
    });
    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 9_999_999,
      hardLimitRows: 10_000_000,
      observedAtMs: expect.any(Number),
    });

    expect(bankLedgerGrowthLimitFromError({ ...pgError, code: '23505' })).toBeNull();
    expect(bankLedgerGrowthLimitFromError({ ...pgError, constraint: 'other' })).toBeNull();
    // The underflow refusal is an accounting invariant, not capacity: it must
    // never be converted into the player-facing growth error.
    expect(
      bankLedgerGrowthLimitFromError({
        code: BANK_LEDGER_GROWTH_UNDERFLOW_SQLSTATE,
        message: BANK_LEDGER_GROWTH_UNDERFLOW_MESSAGE,
        detail: JSON.stringify({
          committed_rows: '1',
          attempted_inserted_rows: '0',
          attempted_deleted_rows: '5',
        }),
      }),
    ).toBeNull();
    expect(() => bankLedgerGrowthLimitFromError({ ...pgError, detail: '{}' })).toThrow(
      /malformed trigger evidence/,
    );
    for (const malformedDetail of [
      { committed_rows: '-1', attempted_rows: '2', hard_limit_rows: '10000000' },
      { committed_rows: '9999999', attempted_rows: 'not-an-integer', hard_limit_rows: '10000000' },
      { committed_rows: '9999999', attempted_rows: '2', hard_limit_rows: '1.5' },
    ]) {
      expect(() =>
        bankLedgerGrowthLimitFromError({
          ...pgError,
          detail: JSON.stringify(malformedDetail),
        }),
      ).toThrow(/malformed trigger evidence/);
    }
  });

  it('ignores observations that do not match the configured durable limit', () => {
    expect(observeBankLedgerGrowthBudget(10_000_000, 10_000_000, 1234)).toBe(true);
    expect(observeBankLedgerGrowthBudget(99, 101, 9999)).toBe(false);
    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 10_000_000,
      hardLimitRows: 10_000_000,
      observedAtMs: 1234,
    });
  });

  it('lets the gauge fall, because the aggregate counter itself now falls', () => {
    // The retired guard refused any observation below the last one, which was
    // sound only while the counter was a lifetime insert tally. A cascading
    // owner delete now genuinely reduces it, so that guard would have pinned
    // the gauge at a high-water mark it could never leave and every capacity
    // decision after the first big reap would read stale.
    expect(observeBankLedgerGrowthBudget(10_000_000, 10_000_000, 5000)).toBe(true);
    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 10_000_000,
      observedAtMs: 5000,
    });
    expect(observeBankLedgerGrowthBudget(9_000_000, 10_000_000, 6000)).toBe(true);
    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 9_000_000,
      observedAtMs: 6000,
    });
    // Malformed or drifted values are still refused outright, so a fall can
    // only ever come from a validated durable reading.
    expect(observeBankLedgerGrowthBudget('not-a-count', 10_000_000, 7000)).toBe(false);
    expect(observeBankLedgerGrowthBudget(1, 9_999_999, 7000)).toBe(false);
    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 9_000_000,
      observedAtMs: 6000,
    });
  });

  it('orders observations by the ticket claimed before the read, never by value', () => {
    // A poll claims its ticket, then reads. Anything that observes the database
    // afterwards (a hard-limit refusal) claims a higher one and wins, however
    // the two VALUES compare, because a cascade makes the counter fall.
    const slowPoll = beginBankLedgerGrowthObservation();
    const refusal = beginBankLedgerGrowthObservation();
    expect(refusal).toBeGreaterThan(slowPoll);

    expect(observeBankLedgerGrowthBudget(4_000_000, 10_000_000, 20_000, refusal)).toBe(true);
    // The late answer is a healthy read, so it reports success, but it is stale
    // and moves neither measure.
    expect(observeBankLedgerGrowthBudget(9_000_000, 10_000_000, 10_000, slowPoll)).toBe(true);
    expect(observeBankLedgerGrowthBytes('999', slowPoll)).toBe(true);
    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 4_000_000,
      observedAtMs: 20_000,
    });
    expect(bankLedgerGrowthBudgetReadout().observedBytes).not.toBe(999);

    // A caller that omits the ticket observed at call time, so it claims the
    // newest one and lands, even when its value is lower.
    expect(observeBankLedgerGrowthBudget(1_000, 10_000_000, 30_000)).toBe(true);
    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 1_000,
      observedAtMs: 30_000,
    });
  });

  it('carries the aggregate byte reading beside the row counter', () => {
    expect(observeBankLedgerGrowthBytes('4096')).toBe(true);
    expect(bankLedgerGrowthBudgetReadout().observedBytes).toBe(4096);
    // Bytes fall legitimately (a vacuum, a cascade), so nothing here is
    // monotonic; only malformed values are refused, and they leave the last
    // good reading in place rather than blanking the measure.
    expect(observeBankLedgerGrowthBytes(2048)).toBe(true);
    expect(bankLedgerGrowthBudgetReadout().observedBytes).toBe(2048);
    for (const malformed of [null, undefined, '', 'not-a-count', -1, 1.5, Number.NaN]) {
      expect(observeBankLedgerGrowthBytes(malformed)).toBe(false);
    }
    expect(bankLedgerGrowthBudgetReadout().observedBytes).toBe(2048);
  });
});
