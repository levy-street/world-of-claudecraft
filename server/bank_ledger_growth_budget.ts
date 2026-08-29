// Cross-process hard ceiling for the keep-forever bank_ledger table.
//
// A statement-level database trigger counts the rows PostgreSQL actually
// inserts into one transaction-local accumulator. A deferred constraint
// trigger applies that accumulator to the shared ceiling during COMMIT, after
// application queries have finished, so the singleton row never stays locked
// across a save transaction's storage or guild tail. This covers current
// writers, mixed-release processes, and raw SQL; rollback restores both the
// ledger and accumulator, while an idempotent receipt retry that inserts no
// ledger rows consumes nothing. The first migration locks ledger inserts while
// it seeds an exact COUNT(*), then publishes both triggers and the counter
// together when ensureSchema commits.

export const BANK_LEDGER_GROWTH_DEFAULT_HARD_LIMIT_ROWS = 10_000_000;
export const BANK_LEDGER_GROWTH_LIMIT_ENV = 'BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS';
export const BANK_LEDGER_GROWTH_LIMIT_SQLSTATE = 'P0001';
export const BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT = 'bank_ledger_growth_hard_limit';

export function bankLedgerGrowthHardLimitFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env[BANK_LEDGER_GROWTH_LIMIT_ENV];
  if (raw === undefined || raw === '') return BANK_LEDGER_GROWTH_DEFAULT_HARD_LIMIT_ROWS;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${BANK_LEDGER_GROWTH_LIMIT_ENV} must be a positive safe integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${BANK_LEDGER_GROWTH_LIMIT_ENV} must be a positive safe integer`);
  }
  return parsed;
}

export const BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS = bankLedgerGrowthHardLimitFromEnv();

/**
 * Applied once per boot under the schema advisory lock. The bootstrap lock is
 * taken only before the durable singleton is initialized, and excludes inserts
 * while COUNT(*) establishes the exact starting point. Later boots do not scan
 * or lock bank_ledger; a missing trigger or split hard-limit config fails boot.
 * An existing ledger already above the first configured ceiling is seeded at
 * its exact count and serves with all later ledger inserts refused, preserving
 * non-ledger access while operators raise or reconcile the limit.
 */
export function bankLedgerGrowthBudgetSchema(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('bank ledger growth budget schema must be a simple lowercase identifier');
  }
  const schema = `"${schemaName}"`;
  const ledgerRegclass = `${schema}.bank_ledger`;
  const pendingRegclass = `${schema}.bank_ledger_growth_pending`;
  const budgetRegclass = `${schema}.bank_ledger_growth_budget`;
  const accumulatorRegprocedure = `${schema}.accumulate_bank_ledger_growth_budget()`;
  const enforcerRegprocedure = `${schema}.enforce_bank_ledger_growth_budget()`;
  return `
-- The singleton takes one guarded UPDATE per ledger-writing transaction,
-- forever, against one live row: dead singleton versions accumulate at the
-- ledger write rate while the default scale-factor trigger, computed against
-- one live row, would wait on the fixed 50-tuple floor plus nothing. HOT
-- pruning inside the nearly-empty page absorbs most of that churn (fillfactor
-- is a no-op for a one-row table), so the fixed threshold below is the
-- backstop that keeps the page and the visibility map clean without vacuuming
-- every few seconds.
CREATE TABLE IF NOT EXISTS "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  committed_rows BIGINT NOT NULL CHECK (committed_rows >= 0),
  hard_limit_rows BIGINT NOT NULL CHECK (hard_limit_rows > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
) WITH (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000);

-- This table has no committed rows in healthy operation. Its one row per
-- ledger-writing transaction exists only until the deferred trigger consumes
-- it during COMMIT; rollback removes it together with the ledger insert.
-- That one-INSERT-one-DELETE-per-transaction churn against zero committed rows
-- is the textbook queue-table autovacuum shape: dead tuples accumulate at the
-- ledger write rate while a scale-factor trigger, computed against a table of
-- zero live rows, would barely ever fire. Vacuum on a small fixed dead-tuple
-- threshold instead. No fillfactor: every row here dies inside its own
-- transaction, so update headroom buys nothing (an install converged by an
-- earlier build may still carry fillfactor=70; harmless, and the probe below
-- deliberately ignores it).
CREATE TABLE IF NOT EXISTS "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending (
  transaction_id xid8 PRIMARY KEY,
  inserted_rows BIGINT NOT NULL CHECK (inserted_rows > 0)
) WITH (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 100);

-- Converge tables created before the storage parameters existed, but only
-- when a setting is absent or different: even a value-identical ALTER TABLE
-- ... SET takes SHARE UPDATE EXCLUSIVE to COMMIT and writes pg_class, so
-- steady-state boots probe reloptions first and skip the churn. The probe
-- compares PARSED option values via pg_options_to_table, never the stored
-- text: PostgreSQL is free to render '0' as '0.0' (and an operator is free
-- to write either), and a text-match probe would re-fire the ALTER on every
-- boot of every realm on such a rendering, the exact churn it exists to
-- avoid. The numeric cast sits inside CASE, whose evaluation order IS
-- defined, so an unrelated non-numeric reloption an operator set by hand
-- (autovacuum_enabled=false, say) can never reach the cast and abort boot;
-- a bare AND leaves subexpression order to the planner. A genuinely drifted
-- or hand-edited VALUE converges once and is then skipped on every later
-- boot (idempotent).
DO $bank_ledger_growth_reloptions_converge$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c
     WHERE c.oid = '${pendingRegclass}'::pg_catalog.regclass
       AND (SELECT pg_catalog.count(*)
              FROM pg_catalog.pg_options_to_table(c.reloptions) o
             WHERE CASE o.option_name
                     WHEN 'autovacuum_vacuum_scale_factor'
                       THEN o.option_value::pg_catalog.numeric = 0
                     WHEN 'autovacuum_vacuum_threshold'
                       THEN o.option_value::pg_catalog.numeric = 100
                     ELSE FALSE
                   END) = 2
  ) THEN
    ALTER TABLE "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending
      SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c
     WHERE c.oid = '${budgetRegclass}'::pg_catalog.regclass
       AND (SELECT pg_catalog.count(*)
              FROM pg_catalog.pg_options_to_table(c.reloptions) o
             WHERE CASE o.option_name
                     WHEN 'autovacuum_vacuum_scale_factor'
                       THEN o.option_value::pg_catalog.numeric = 0
                     WHEN 'autovacuum_vacuum_threshold'
                       THEN o.option_value::pg_catalog.numeric = 1000
                     ELSE FALSE
                   END) = 2
  ) THEN
    ALTER TABLE "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget
      SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000);
  END IF;
END
$bank_ledger_growth_reloptions_converge$;

CREATE OR REPLACE FUNCTION "__woc_bank_ledger_growth_schema__".accumulate_bank_ledger_growth_budget()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, "__woc_bank_ledger_growth_schema__", pg_temp
AS $$
DECLARE
  inserted_rows BIGINT;
BEGIN
  SELECT count(*)::bigint INTO inserted_rows FROM inserted_bank_ledger_rows;
  IF inserted_rows = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending (transaction_id, inserted_rows)
  VALUES (pg_catalog.pg_current_xact_id(), inserted_rows)
  ON CONFLICT (transaction_id) DO UPDATE
    SET inserted_rows = "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending.inserted_rows
                      + EXCLUDED.inserted_rows;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION "__woc_bank_ledger_growth_schema__".enforce_bank_ledger_growth_budget()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, "__woc_bank_ledger_growth_schema__", pg_temp
AS $$
DECLARE
  attempted_rows BIGINT;
  before_rows BIGINT;
  stored_limit BIGINT;
BEGIN
  -- Several ledger statements queue several deferred trigger events for the
  -- same transaction. Exactly one event wins this DELETE and applies the
  -- final accumulated count; every later event observes no row and is inert.
  DELETE FROM "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending
   WHERE transaction_id = NEW.transaction_id
  RETURNING inserted_rows INTO attempted_rows;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget
     SET committed_rows = committed_rows + attempted_rows,
         updated_at = now()
   WHERE singleton = TRUE
     AND hard_limit_rows = ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}
     AND committed_rows + attempted_rows <= hard_limit_rows
  RETURNING hard_limit_rows INTO stored_limit;
  IF FOUND THEN
    RETURN NULL;
  END IF;

  SELECT committed_rows, hard_limit_rows
    INTO before_rows, stored_limit
    FROM "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget
   WHERE singleton = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'bank ledger growth budget is not initialized';
  END IF;

  -- A RUNNING process whose baked limit stops matching the durable singleton
  -- (the singleton was updated under it, or it was deployed with a different
  -- env value) also fails the guarded UPDATE above, on the limit predicate
  -- rather than the capacity one. Reporting that as the capacity error would
  -- carry a self-contradicting DETAIL (committed + attempted visibly under the
  -- stored limit), so name the config drift instead, with both values.
  IF stored_limit <> ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS} THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = '${BANK_LEDGER_GROWTH_LIMIT_ENV} config drift: this process disagrees with the durable bank-ledger limit',
      DETAIL = pg_catalog.json_build_object(
        'stored_hard_limit_rows', stored_limit,
        'configured_hard_limit_rows', ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}
      )::text;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '${BANK_LEDGER_GROWTH_LIMIT_SQLSTATE}',
    MESSAGE = 'bank ledger growth limit exceeded',
    CONSTRAINT = '${BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT}',
    DETAIL = pg_catalog.json_build_object(
      'committed_rows', before_rows,
      'attempted_rows', attempted_rows,
      'hard_limit_rows', stored_limit
    )::text;
END
$$;

DO $$
DECLARE
  named_insert_trigger BOOLEAN;
  valid_insert_trigger BOOLEAN;
  named_commit_trigger BOOLEAN;
  valid_commit_trigger BOOLEAN;
  budget_initialized BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget WHERE singleton = TRUE
  ) INTO budget_initialized;
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = '${ledgerRegclass}'::pg_catalog.regclass
       AND tgname = 'bank_ledger_growth_budget_insert'
       AND NOT tgisinternal
  ) INTO named_insert_trigger;
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = '${ledgerRegclass}'::pg_catalog.regclass
       AND tgname = 'bank_ledger_growth_budget_insert'
       AND NOT tgisinternal
       AND tgenabled = 'O'
       AND tgtype = 4
       AND tgfoid = '${accumulatorRegprocedure}'::pg_catalog.regprocedure
       AND tgnargs = 0
       AND pg_catalog.octet_length(tgargs) = 0
       AND tgattr::text = ''
       AND tgqual IS NULL
       AND tgnewtable = 'inserted_bank_ledger_rows'
       AND tgoldtable IS NULL
  ) INTO valid_insert_trigger;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = '${pendingRegclass}'::pg_catalog.regclass
       AND tgname = 'bank_ledger_growth_budget_commit'
       AND NOT tgisinternal
  ) INTO named_commit_trigger;
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = '${pendingRegclass}'::pg_catalog.regclass
       AND tgname = 'bank_ledger_growth_budget_commit'
       AND NOT tgisinternal
       AND tgenabled = 'O'
       AND tgtype = 21
       AND tgfoid = '${enforcerRegprocedure}'::pg_catalog.regprocedure
       AND tgnargs = 0
       AND pg_catalog.octet_length(tgargs) = 0
       AND tgattr::text = ''
       AND tgqual IS NULL
       AND tgconstraint <> 0
       AND tgdeferrable
       AND tginitdeferred
       AND tgnewtable IS NULL
       AND tgoldtable IS NULL
  ) INTO valid_commit_trigger;

  IF named_insert_trigger AND NOT valid_insert_trigger THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'bank_ledger_growth_budget_insert has an unsafe definition';
  END IF;
  IF named_commit_trigger AND NOT valid_commit_trigger THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'bank_ledger_growth_budget_commit has an unsafe definition';
  END IF;

  -- After initialization, an absent trigger is evidence of an unaudited write
  -- window. Recreating it without an exact reconciliation would permanently
  -- undercount rows inserted during that gap, so fail boot for an operator.
  IF budget_initialized AND (NOT valid_insert_trigger OR NOT valid_commit_trigger) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'initialized bank ledger growth budget is missing an enforcement trigger';
  END IF;
  IF budget_initialized AND EXISTS (
    SELECT 1 FROM "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'bank ledger growth budget has orphaned pending rows';
  END IF;

  IF NOT budget_initialized THEN
    -- bank_ledger PREDATES this budget (it has shipped since bd51a6986c,
    -- 2026-07-06), so the first production install seeds over weeks of real
    -- ledger history, never an empty table. Be precise about the blocked
    -- window: the boot transaction already holds ACCESS EXCLUSIVE on
    -- bank_ledger long before this fragment runs (the core SCHEMA's ADD
    -- COLUMN IF NOT EXISTS converges take it even as no-ops and hold it to
    -- COMMIT), so ledger reads AND writes from every other process stall
    -- for the WHOLE boot transaction on every boot, and this seed extends
    -- that one boot by exactly one count pass. The count is a parallel
    -- index-only scan over the PK (measured: ~43 MB of index per 2M rows,
    -- tens of milliseconds warm, low seconds cold at the 10M ceiling on
    -- modest hardware; DEPLOY.md, the growth-limit section, carries the
    -- numbers). A warm-up pre-count was tried and REVERTED: inside this
    -- transaction there is no unlocked place to put it, so it only doubled
    -- the pass (review round three, measured 1.85x). The seeding deploy
    -- still requires every realm stopped, the standard stop-then-cutover.
    -- CREATE TRIGGER holds this lock too, but spelling it before COUNT makes
    -- the mixed-release bootstrap boundary explicit and independent of DDL
    -- lock implementation details (inside THIS transaction it is a formality
    -- over the stronger lock already held). A RE-seed (the singleton deleted
    -- over a grown ledger) pays the same shape and stays a
    -- maintenance-window operation.
    LOCK TABLE "__woc_bank_ledger_growth_schema__".bank_ledger IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending;

    IF NOT valid_commit_trigger THEN
      EXECUTE 'CREATE CONSTRAINT TRIGGER bank_ledger_growth_budget_commit
        AFTER INSERT OR UPDATE ON "__woc_bank_ledger_growth_schema__".bank_ledger_growth_pending
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION "__woc_bank_ledger_growth_schema__".enforce_bank_ledger_growth_budget()';
    END IF;

    IF NOT valid_insert_trigger THEN
      -- REFERENCING NEW TABLE + count(*) is the only correct row-count source
      -- for a statement-level trigger. The proposed alternative, GET
      -- DIAGNOSTICS ROW_COUNT inside the trigger function, was evaluated and
      -- rejected: ROW_COUNT there reflects the function's OWN last statement,
      -- never the statement that fired the trigger, and a statement-level
      -- trigger has no other affected-row count. The transition tuplestore's
      -- cost is bounded by the 2,048-row outbox prefix cap on ledger batches.
      EXECUTE 'CREATE TRIGGER bank_ledger_growth_budget_insert
        AFTER INSERT ON "__woc_bank_ledger_growth_schema__".bank_ledger
        REFERENCING NEW TABLE AS inserted_bank_ledger_rows
        FOR EACH STATEMENT
        EXECUTE FUNCTION "__woc_bank_ledger_growth_schema__".accumulate_bank_ledger_growth_budget()';
    END IF;

    INSERT INTO "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget
      (singleton, committed_rows, hard_limit_rows)
    -- Deliberately allow committed_rows to start above the ceiling. The
    -- enforcement predicate then refuses every future insert without making
    -- unrelated gameplay unavailable during an emergency cap rollout.
    SELECT TRUE, COUNT(*)::bigint, ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}
      FROM "__woc_bank_ledger_growth_schema__".bank_ledger;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget
     WHERE singleton = TRUE
       AND hard_limit_rows <> ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = '${BANK_LEDGER_GROWTH_LIMIT_ENV} disagrees with the durable bank-ledger limit';
  END IF;
END
$$;

-- Readback for hand-applied installs. The BOOT readback is issued separately
-- by db.ts as its own single-statement SELECT: sending this whole schema as
-- one multi-statement query makes node-postgres return an ARRAY of results,
-- so a .rows[0] read of the combined result would never see this statement.
SELECT committed_rows, hard_limit_rows
  FROM "__woc_bank_ledger_growth_schema__".bank_ledger_growth_budget
 WHERE singleton = TRUE;
`.replaceAll('"__woc_bank_ledger_growth_schema__"', schema);
}

export const BANK_LEDGER_GROWTH_BUDGET_SCHEMA = bankLedgerGrowthBudgetSchema();

/**
 * The boot readback, exported beside the schema builder so the two cannot
 * drift: db.ts issues this as its OWN single-statement query before COMMIT
 * (the fragment's trailing SELECT is unreadable inside the multi-statement
 * result array), against the same schema the fragment was built for.
 */
export function bankLedgerGrowthBudgetReadbackSql(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('bank ledger growth budget schema must be a simple lowercase identifier');
  }
  return `SELECT committed_rows, hard_limit_rows FROM "${schemaName}".bank_ledger_growth_budget WHERE singleton = TRUE`;
}

export class BankLedgerGrowthLimitExceeded extends Error {
  constructor(
    readonly committedRows: number,
    readonly attemptedRows: number,
    readonly hardLimitRows: number,
    options?: ErrorOptions,
  ) {
    super(
      `bank ledger growth limit exceeded: ${committedRows} committed + ${attemptedRows} attempted > ${hardLimitRows}`,
      options,
    );
    this.name = 'BankLedgerGrowthLimitExceeded';
  }
}

export interface BankLedgerGrowthBudgetReadout {
  readonly committedRows: number | null;
  readonly hardLimitRows: number;
  readonly observedAtMs: number | null;
}

let observedCommittedRows: number | null = null;
let observedAtMs: number | null = null;

function safeDbInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Record a database-returned counter value for the scrape-time gauge. */
export function observeBankLedgerGrowthBudget(
  committedRows: unknown,
  hardLimitRows: unknown = BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS,
  nowMs: number = Date.now(),
): boolean {
  const committed = safeDbInteger(committedRows);
  const limit = safeDbInteger(hardLimitRows);
  if (
    committed === null ||
    limit !== BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS ||
    !Number.isFinite(nowMs) ||
    nowMs < 0
  ) {
    return false;
  }
  // The durable counter is monotonic. A refusal can report a newer value while
  // a periodic SELECT that took its snapshot just before that COMMIT is still
  // in flight; never let the late response move the exported gauge backward.
  if (observedCommittedRows !== null && committed < observedCommittedRows) return true;
  observedCommittedRows = committed;
  observedAtMs = nowMs;
  return true;
}

export function bankLedgerGrowthBudgetReadout(): BankLedgerGrowthBudgetReadout {
  return Object.freeze({
    committedRows: observedCommittedRows,
    hardLimitRows: BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS,
    observedAtMs,
  });
}

function growthEvidenceFromDetail(detail: unknown): {
  committedRows: number;
  attemptedRows: number;
  hardLimitRows: number;
} | null {
  if (typeof detail !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  const committedRows = safeDbInteger(row.committed_rows);
  const attemptedRows = safeDbInteger(row.attempted_rows);
  const hardLimitRows = safeDbInteger(row.hard_limit_rows);
  if (committedRows === null || attemptedRows === null || hardLimitRows === null) return null;
  return { committedRows, attemptedRows, hardLimitRows };
}

/** Convert only the trigger's fixed PostgreSQL identity into the domain error. */
export function bankLedgerGrowthLimitFromError(
  error: unknown,
): BankLedgerGrowthLimitExceeded | null {
  if (typeof error !== 'object' || error === null) return null;
  const pgError = error as Record<string, unknown>;
  if (
    pgError.code !== BANK_LEDGER_GROWTH_LIMIT_SQLSTATE ||
    pgError.constraint !== BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT
  ) {
    return null;
  }
  const evidence = growthEvidenceFromDetail(pgError.detail);
  if (!evidence) {
    throw new Error('bank ledger growth refusal returned malformed trigger evidence', {
      cause: error,
    });
  }
  observeBankLedgerGrowthBudget(evidence.committedRows, evidence.hardLimitRows);
  return new BankLedgerGrowthLimitExceeded(
    evidence.committedRows,
    evidence.attemptedRows,
    evidence.hardLimitRows,
    { cause: error },
  );
}
