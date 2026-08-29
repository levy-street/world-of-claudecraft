import { describe, expect, it } from 'vitest';
import {
  BANK_LEDGER_GROWTH_BUDGET_SCHEMA,
  BANK_LEDGER_GROWTH_DEFAULT_HARD_LIMIT_ROWS,
  BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS,
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_ENV,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  BankLedgerGrowthLimitExceeded,
  bankLedgerGrowthBudgetReadbackSql,
  bankLedgerGrowthBudgetReadout,
  bankLedgerGrowthBudgetSchema,
  bankLedgerGrowthHardLimitFromEnv,
  bankLedgerGrowthLimitFromError,
  observeBankLedgerGrowthBudget,
} from '../../server/bank_ledger_growth_budget';

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

  it('installs an exact accumulator and deferred commit ceiling under the bootstrap lock', () => {
    const folded = BANK_LEDGER_GROWTH_BUDGET_SCHEMA.replace(/\s+/g, ' ');
    // bank_ledger predates this budget in production, so the first install
    // seeds over real history with ONE exact count. A warm-up pre-count was
    // tried and reverted (review round three): the boot transaction already
    // holds ACCESS EXCLUSIVE on the ledger from the core schema's ADD COLUMN
    // converges, so there is no unlocked place inside it and a second pass
    // only lengthened the blocked window (measured 1.85x).
    const code = BANK_LEDGER_GROWTH_BUDGET_SCHEMA.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    expect(code).not.toContain('PERFORM');
    const lock = folded.indexOf('LOCK TABLE "public".bank_ledger IN SHARE ROW EXCLUSIVE MODE');
    const createCommitTrigger = folded.indexOf(
      'CREATE CONSTRAINT TRIGGER bank_ledger_growth_budget_commit',
    );
    const createInsertTrigger = folded.indexOf('CREATE TRIGGER bank_ledger_growth_budget_insert');
    const exactSeed = folded.indexOf('SELECT TRUE, COUNT(*)::bigint');

    expect(folded).toContain('CREATE TABLE IF NOT EXISTS "public".bank_ledger_growth_budget');
    expect(folded).toContain('CREATE TABLE IF NOT EXISTS "public".bank_ledger_growth_pending');
    expect(folded).toContain(
      'CREATE OR REPLACE FUNCTION "public".accumulate_bank_ledger_growth_budget()',
    );
    expect(folded).toContain(
      'CREATE OR REPLACE FUNCTION "public".enforce_bank_ledger_growth_budget()',
    );
    expect(folded.split('SET search_path = pg_catalog, "public", pg_temp')).toHaveLength(3);
    expect(folded).toContain('REFERENCING NEW TABLE AS inserted_bank_ledger_rows');
    expect(folded).toContain('FOR EACH STATEMENT');
    expect(folded).toContain('SELECT count(*)::bigint INTO inserted_rows');
    expect(folded).toContain('VALUES (pg_catalog.pg_current_xact_id(), inserted_rows)');
    expect(folded).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(folded).toContain('DELETE FROM "public".bank_ledger_growth_pending');
    expect(folded).toContain('committed_rows + attempted_rows <= hard_limit_rows');
    expect(folded).toContain('tgrelid = \'"public".bank_ledger\'::pg_catalog.regclass');
    expect(folded).toContain("AND tgenabled = 'O' AND tgtype = 4");
    expect(folded).toContain(
      "AND tgnargs = 0 AND pg_catalog.octet_length(tgargs) = 0 AND tgattr::text = '' AND tgqual IS NULL",
    );
    expect(folded).toContain("AND tgnewtable = 'inserted_bank_ledger_rows'");
    expect(folded).toContain(
      'tgrelid = \'"public".bank_ledger_growth_pending\'::pg_catalog.regclass',
    );
    expect(folded).toContain("AND tgenabled = 'O' AND tgtype = 21");
    expect(folded.split('AND tgqual IS NULL')).toHaveLength(3);
    expect(folded).toContain('AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred');
    expect(folded).toContain(
      'IF budget_initialized AND (NOT valid_insert_trigger OR NOT valid_commit_trigger)',
    );
    expect(folded).toContain(
      "MESSAGE = 'initialized bank ledger growth budget is missing an enforcement trigger'",
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(createCommitTrigger);
    expect(createCommitTrigger).toBeLessThan(createInsertTrigger);
    expect(createInsertTrigger).toBeLessThan(exactSeed);
    expect(folded).toContain("ERRCODE = 'P0001'");
    expect(folded).toContain("CONSTRAINT = 'bank_ledger_growth_hard_limit'");
    expect(folded).not.toMatch(/nextval|currval|last_value/i);

    expect(bankLedgerGrowthBudgetSchema('isolated_test')).toContain(
      '"isolated_test".bank_ledger_growth_budget',
    );
    // The boot readback's LITERAL, pinned here so the exported-builder
    // equality pins in schema_wiring and the save-effects boot test are
    // anchored to real SQL rather than comparing the builder to itself.
    expect(bankLedgerGrowthBudgetReadbackSql()).toBe(
      'SELECT committed_rows, hard_limit_rows FROM "public".bank_ledger_growth_budget WHERE singleton = TRUE',
    );
    expect(() => bankLedgerGrowthBudgetReadbackSql('bad; DROP')).toThrow(
      /simple lowercase identifier/,
    );
    expect(() => bankLedgerGrowthBudgetSchema('public; DROP TABLE bank_ledger')).toThrow(
      /simple lowercase identifier/,
    );
  });

  it('names enforcement-time config drift distinctly from the capacity refusal', () => {
    const folded = BANK_LEDGER_GROWTH_BUDGET_SCHEMA.replace(/\s+/g, ' ');

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

    // The drift arm decides BEFORE the capacity raise: a drifted process must
    // never reach the generic refusal.
    const driftArm = folded.indexOf('config drift: this process disagrees');
    const capacityRaise = folded.indexOf("MESSAGE = 'bank ledger growth limit exceeded'");
    expect(driftArm).toBeGreaterThanOrEqual(0);
    expect(capacityRaise).toBeGreaterThan(driftArm);
  });

  it('tunes both budget tables for their dead-tuple churn', () => {
    const folded = BANK_LEDGER_GROWTH_BUDGET_SCHEMA.replace(/\s+/g, ' ');

    // One INSERT plus one DELETE per ledger transaction against zero committed
    // rows is the queue-table autovacuum shape: a scale-factor trigger against
    // zero live rows barely ever fires, so the pending table pins a fixed
    // dead-tuple threshold. No fillfactor: its rows die inside their own
    // transaction, so update headroom buys nothing.
    const pendingParams = '(autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 100)';
    expect(folded).toContain(
      `CREATE TABLE IF NOT EXISTS "public".bank_ledger_growth_pending ` +
        `( transaction_id xid8 PRIMARY KEY, inserted_rows BIGINT NOT NULL ` +
        `CHECK (inserted_rows > 0) ) WITH ${pendingParams}`,
    );
    // The singleton takes one UPDATE per ledger transaction forever against
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
    // Strip SQL comments before the absence pins: the prose deliberately
    // EXPLAINS why fillfactor is gone, and a comment mention must not satisfy
    // or defeat a code-level assertion.
    const code = BANK_LEDGER_GROWTH_BUDGET_SCHEMA.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
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
    expect(bankLedgerGrowthBudgetReadout()).toEqual({
      committedRows: 9_999_999,
      hardLimitRows: 10_000_000,
      observedAtMs: expect.any(Number),
    });

    expect(bankLedgerGrowthLimitFromError({ ...pgError, code: '23505' })).toBeNull();
    expect(bankLedgerGrowthLimitFromError({ ...pgError, constraint: 'other' })).toBeNull();
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
    expect(bankLedgerGrowthBudgetReadout()).toEqual({
      committedRows: 10_000_000,
      hardLimitRows: 10_000_000,
      observedAtMs: 1234,
    });
  });

  it('never lets an older in-flight observation move the durable gauge backward', () => {
    expect(observeBankLedgerGrowthBudget(10_000_000, 10_000_000, 2000)).toBe(true);
    expect(observeBankLedgerGrowthBudget(9_999_999, 10_000_000, 3000)).toBe(true);
    expect(bankLedgerGrowthBudgetReadout()).toEqual({
      committedRows: 10_000_000,
      hardLimitRows: 10_000_000,
      observedAtMs: 2000,
    });
  });
});
