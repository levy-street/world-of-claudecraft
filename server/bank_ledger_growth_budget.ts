// Cross-process hard ceiling for the keep-forever AUDIT tables: bank_ledger
// plus the material source journal, accounted TOGETHER against one durable
// singleton, one env knob and one ceiling.
//
// Statement-level database triggers count the rows PostgreSQL actually inserts
// into, and deletes from, each audited table, into one transaction-local
// accumulator. A deferred constraint trigger applies that accumulator's NET
// delta to the shared ceiling during COMMIT, after application queries have
// finished, so the singleton row never stays locked across a save
// transaction's storage, guild or source-journal tail. This covers current
// writers, mixed-release processes, and raw SQL; rollback restores the audit
// rows and the accumulator together, while an idempotent receipt retry that
// writes no audit rows consumes nothing.
//
// WHAT THE COUNTER MEANS (aggregate, and net): committed_rows is the number of
// audit rows the budget currently accounts for across ALL counted tables, not a
// per-table figure and not a lifetime insert tally. A cascading owner delete
// that removes audit rows gives that capacity back, which is what makes the
// ceiling a bound on stored audit rows rather than on history ever written.
// material_source_containers is not counted: an anchor is minted with its first
// journal row and reaped with its last, so its cardinality is already bounded
// by the journal rows that are counted (server/audit_growth_sources.ts).
//
// The durable objects keep their historical bank_ledger_growth_* names because
// renaming live tables, functions and triggers is a migration with no payoff.
//
// MIGRATION: an install that predates the aggregate budget carries
// budget_revision 1 (a bank_ledger-only lifetime insert count). It converges
// ONCE, inside the boot transaction's canonical schema advisory lock: both
// source tables are locked, the missing triggers are published, and
// committed_rows is replaced by an EXACT recount across both tables. Later
// boots read the revision marker, scan nothing and take no source-table lock.

import {
  AUDIT_GROWTH_BUDGET_TABLE,
  AUDIT_GROWTH_PENDING_DELTA_CONSTRAINT,
  AUDIT_GROWTH_PENDING_TABLE,
  AUDIT_GROWTH_SOURCES,
  auditGrowthAccumulatorSql,
  auditGrowthTriggerCreateSql,
  auditGrowthTriggerProbeSql,
  auditGrowthTriggerRefusalSql,
  auditGrowthTriggers,
} from './audit_growth_sources';

export const BANK_LEDGER_GROWTH_DEFAULT_HARD_LIMIT_ROWS = 10_000_000;
export const BANK_LEDGER_GROWTH_LIMIT_ENV = 'BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS';
export const BANK_LEDGER_GROWTH_LIMIT_SQLSTATE = 'P0001';
export const BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT = 'bank_ledger_growth_hard_limit';

/**
 * The durable shape marker on the singleton. 1 is the original bank_ledger-only
 * lifetime insert count; 2 is the aggregate net row count over every table in
 * AUDIT_GROWTH_SOURCES. It is the ONE thing a later boot reads to decide that
 * it owes no migration, so it is bumped only by a change that needs a recount.
 */
export const BANK_LEDGER_GROWTH_BUDGET_REVISION = 2;

/** object_not_in_prerequisite_state: an accounting invariant, never capacity. */
export const BANK_LEDGER_GROWTH_UNDERFLOW_SQLSTATE = '55000';
export const BANK_LEDGER_GROWTH_UNDERFLOW_MESSAGE = 'audit growth budget underflow';

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
 * Applied once per boot under the schema advisory lock. Source-table locks are
 * taken only on the two boots that owe work (the first install, and the ONE
 * aggregate migration of an existing install), and they exclude writers while
 * an exact COUNT establishes the starting point. Every later boot probes
 * catalogs only: no COUNT, no ALTER, no source-table lock. A missing or
 * tampered trigger, a split hard-limit config, or a singleton left at another
 * revision fails boot.
 *
 * An audit surface already above the configured ceiling is seeded or recounted
 * at its exact size and serves with all later net-growth transactions refused,
 * preserving non-ledger access while operators raise or reconcile the limit.
 * Transactions that only REMOVE audit rows keep working there, so the state is
 * recoverable rather than wedged.
 */
export function bankLedgerGrowthBudgetSchema(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('bank ledger growth budget schema must be a simple lowercase identifier');
  }
  const schema = `"${schemaName}"`;
  const pendingRegclass = `${schema}.${AUDIT_GROWTH_PENDING_TABLE}`;
  const budgetRegclass = `${schema}.${AUDIT_GROWTH_BUDGET_TABLE}`;
  const triggers = auditGrowthTriggers();

  const triggerDeclarations = triggers
    .map(
      (trigger) =>
        `  named_${trigger.variable}_trigger BOOLEAN;\n  valid_${trigger.variable}_trigger BOOLEAN;`,
    )
    .join('\n');
  const triggerProbes = triggers
    .map((trigger) => auditGrowthTriggerProbeSql(schema, trigger))
    .join('\n');
  const triggerRefusals = triggers.map(auditGrowthTriggerRefusalSql).join('\n');
  const triggerCreates = triggers
    .map((trigger) => auditGrowthTriggerCreateSql(schema, trigger))
    .join('\n');
  const allTriggersValid = triggers
    .map((trigger) => `valid_${trigger.variable}_trigger`)
    .join(' AND ');
  const legacyTriggersValid = triggers
    .filter((trigger) => trigger.requiredBeforeAggregate)
    .map((trigger) => `valid_${trigger.variable}_trigger`)
    .join(' AND ');

  const sourceExistenceGuards = AUDIT_GROWTH_SOURCES.map(
    (source) => `  IF pg_catalog.to_regclass('${schema}.${source.table}') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'audit growth budget requires ${source.table} to exist first';
  END IF;`,
  ).join('\n');
  const sourceLocks = AUDIT_GROWTH_SOURCES.map(
    (source) => `    LOCK TABLE ${schema}.${source.table} IN SHARE ROW EXCLUSIVE MODE;`,
  ).join('\n');
  const exactAggregateCount = AUDIT_GROWTH_SOURCES.map(
    (source) => `(SELECT count(*)::bigint FROM ${schema}.${source.table})`,
  ).join('\n         + ');
  const accumulatorFunctions = AUDIT_GROWTH_SOURCES.map((source) =>
    auditGrowthAccumulatorSql(schema, source),
  ).join('\n\n');

  return `
-- The singleton takes one guarded UPDATE per audit-writing transaction,
-- forever, against one live row: dead singleton versions accumulate at the
-- audit write rate while the default scale-factor trigger, computed against
-- one live row, would wait on the fixed 50-tuple floor plus nothing. HOT
-- pruning inside the nearly-empty page absorbs most of that churn (fillfactor
-- is a no-op for a one-row table), so the fixed threshold below is the
-- backstop that keeps the page and the visibility map clean without vacuuming
-- every few seconds.
--
-- budget_revision defaults to 1, the pre-aggregate shape, so an ADD COLUMN
-- against a legacy install marks it as owing the migration. A FRESH install
-- never takes that path: its seeding INSERT writes the current revision
-- explicitly, having counted every source table.
CREATE TABLE IF NOT EXISTS ${budgetRegclass} (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  committed_rows BIGINT NOT NULL CHECK (committed_rows >= 0),
  hard_limit_rows BIGINT NOT NULL CHECK (hard_limit_rows > 0),
  budget_revision INT NOT NULL DEFAULT 1 CHECK (budget_revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
) WITH (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000);

-- This table has no committed rows in healthy operation. Its one row per
-- audit-writing transaction exists only until the deferred trigger consumes
-- it during COMMIT; rollback removes it together with the audit rows.
-- That one-INSERT-one-DELETE-per-transaction churn against zero committed rows
-- is the textbook queue-table autovacuum shape: dead tuples accumulate at the
-- audit write rate while a scale-factor trigger, computed against a table of
-- zero live rows, would barely ever fire. Vacuum on a small fixed dead-tuple
-- threshold instead. No fillfactor: every row here dies inside its own
-- transaction, so update headroom buys nothing (an install converged by an
-- earlier build may still carry fillfactor=70; harmless, and the probe below
-- deliberately ignores it).
--
-- The two counters are kept apart rather than folded into one signed column:
-- each accumulator adds to its own direction, the enforcer nets them once, and
-- the column names stay true for an operator reading a live pending row.
CREATE TABLE IF NOT EXISTS ${pendingRegclass} (
  transaction_id xid8 PRIMARY KEY,
  inserted_rows BIGINT NOT NULL DEFAULT 0,
  deleted_rows BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT ${AUDIT_GROWTH_PENDING_DELTA_CONSTRAINT}
    CHECK (inserted_rows >= 0 AND deleted_rows >= 0 AND inserted_rows + deleted_rows > 0)
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
    ALTER TABLE ${pendingRegclass}
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
    ALTER TABLE ${budgetRegclass}
      SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000);
  END IF;
END
$bank_ledger_growth_reloptions_converge$;

-- Shape converge for an install that predates the aggregate budget, gated on
-- catalog probes so a steady-state boot issues no ALTER at all. All three are
-- additive and cheap: ADD COLUMN with a constant default is a metadata-only
-- write since PostgreSQL 11, and the pending table holds no committed rows to
-- scan for the replacement CHECK. The legacy inserted_rows > 0 CHECK is looked
-- up by DEFINITION, never by its system-generated name, and only ever on the
-- budget's own accumulator table.
DO $bank_ledger_growth_shape_converge$
DECLARE
  legacy_check RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute
     WHERE attrelid = '${budgetRegclass}'::pg_catalog.regclass
       AND attname = 'budget_revision'
       AND NOT attisdropped
  ) THEN
    ALTER TABLE ${budgetRegclass}
      ADD COLUMN budget_revision INT NOT NULL DEFAULT 1 CHECK (budget_revision > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute
     WHERE attrelid = '${pendingRegclass}'::pg_catalog.regclass
       AND attname = 'deleted_rows'
       AND NOT attisdropped
  ) THEN
    ALTER TABLE ${pendingRegclass}
      ADD COLUMN deleted_rows BIGINT NOT NULL DEFAULT 0;
  END IF;

  FOR legacy_check IN
    SELECT c.conname
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = '${pendingRegclass}'::pg_catalog.regclass
       AND c.contype = 'c'
       AND c.conname <> '${AUDIT_GROWTH_PENDING_DELTA_CONSTRAINT}'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%inserted_rows > 0%'
  LOOP
    EXECUTE 'ALTER TABLE ${pendingRegclass} DROP CONSTRAINT '
      || pg_catalog.quote_ident(legacy_check.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = '${pendingRegclass}'::pg_catalog.regclass
       AND conname = '${AUDIT_GROWTH_PENDING_DELTA_CONSTRAINT}'
  ) THEN
    ALTER TABLE ${pendingRegclass}
      ADD CONSTRAINT ${AUDIT_GROWTH_PENDING_DELTA_CONSTRAINT}
      CHECK (inserted_rows >= 0 AND deleted_rows >= 0 AND inserted_rows + deleted_rows > 0);
  END IF;
END
$bank_ledger_growth_shape_converge$;

${accumulatorFunctions}

CREATE OR REPLACE FUNCTION ${schema}.enforce_bank_ledger_growth_budget()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, ${schema}, pg_temp
AS $enforce_audit_growth_budget$
DECLARE
  attempted_inserted_rows BIGINT;
  attempted_deleted_rows BIGINT;
  attempted_rows BIGINT;
  before_rows BIGINT;
  stored_limit BIGINT;
BEGIN
  -- Several audit statements queue several deferred trigger events for the
  -- same transaction. Exactly one event wins this DELETE and applies the
  -- final accumulated counters; every later event observes no row and is inert.
  DELETE FROM ${pendingRegclass}
   WHERE transaction_id = NEW.transaction_id
  RETURNING inserted_rows, deleted_rows
       INTO attempted_inserted_rows, attempted_deleted_rows;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  attempted_rows := attempted_inserted_rows - attempted_deleted_rows;

  -- One guarded UPDATE decides everything: the capacity arm applies only to a
  -- transaction that GROWS the audit surface, so a transaction that removes
  -- rows keeps working against an already-over-limit budget and gives its
  -- capacity back. The non-negative arm refuses to underflow rather than
  -- clamping a miscount silently to zero. A net-zero transaction still takes
  -- the update, deliberately: that is how every audit-writing transaction
  -- keeps re-proving this process agrees with the durable limit.
  UPDATE ${budgetRegclass}
     SET committed_rows = committed_rows + attempted_rows,
         updated_at = now()
   WHERE singleton = TRUE
     AND hard_limit_rows = ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}
     AND committed_rows + attempted_rows >= 0
     AND (attempted_rows <= 0 OR committed_rows + attempted_rows <= hard_limit_rows)
  RETURNING hard_limit_rows INTO stored_limit;
  IF FOUND THEN
    RETURN NULL;
  END IF;

  SELECT committed_rows, hard_limit_rows
    INTO before_rows, stored_limit
    FROM ${budgetRegclass}
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

  -- More audit rows removed than the budget ever accounted for. That is a
  -- broken accumulator, not a full disk: refuse loudly with both directions of
  -- the attempt rather than let the counter wrap into the CHECK or quietly
  -- floor at zero and lose the discrepancy.
  IF before_rows + attempted_rows < 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '${BANK_LEDGER_GROWTH_UNDERFLOW_SQLSTATE}',
      MESSAGE = '${BANK_LEDGER_GROWTH_UNDERFLOW_MESSAGE}',
      DETAIL = pg_catalog.json_build_object(
        'committed_rows', before_rows,
        'attempted_inserted_rows', attempted_inserted_rows,
        'attempted_deleted_rows', attempted_deleted_rows
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
$enforce_audit_growth_budget$;

DO $bank_ledger_growth_bootstrap$
DECLARE
${triggerDeclarations}
  budget_initialized BOOLEAN;
  stored_revision INT;
BEGIN
  -- The counted tables must already exist: this fragment is the LAST boot
  -- fragment precisely so every audited table is in place before it runs.
  -- Naming the missing one beats a bare regclass cast failure.
${sourceExistenceGuards}

  SELECT EXISTS (
    SELECT 1 FROM ${budgetRegclass} WHERE singleton = TRUE
  ) INTO budget_initialized;
  SELECT budget_revision INTO stored_revision
    FROM ${budgetRegclass}
   WHERE singleton = TRUE;

${triggerProbes}

${triggerRefusals}

  -- After initialization, an absent trigger is evidence of an unaudited write
  -- window. Recreating it without an exact reconciliation would leave the
  -- counter wrong for rows written during that gap, so fail boot for an
  -- operator. A budget still at the legacy revision is judged against the
  -- legacy trigger set only: the aggregate triggers are legitimately absent
  -- there until the migration below publishes them.
  IF budget_initialized
     AND stored_revision >= ${BANK_LEDGER_GROWTH_BUDGET_REVISION}
     AND NOT (${allTriggersValid}) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'initialized bank ledger growth budget is missing an enforcement trigger';
  END IF;
  IF budget_initialized
     AND stored_revision < ${BANK_LEDGER_GROWTH_BUDGET_REVISION}
     AND NOT (${legacyTriggersValid}) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'initialized bank ledger growth budget is missing an enforcement trigger';
  END IF;
  IF budget_initialized AND EXISTS (
    SELECT 1 FROM ${pendingRegclass}
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
    -- that one boot by exactly one count pass per counted table. The ledger
    -- count is a parallel index-only scan over the PK (measured: ~43 MB of
    -- index per 2M rows, tens of milliseconds warm, low seconds cold at the
    -- 10M ceiling on modest hardware; DEPLOY.md, the growth-limit section,
    -- carries the numbers); the source journal is empty at its own first
    -- boot. A warm-up pre-count was tried and REVERTED: inside this
    -- transaction there is no unlocked place to put it, so it only doubled
    -- the pass (review round three, measured 1.85x). The seeding deploy
    -- still requires every realm stopped, the standard stop-then-cutover.
    -- CREATE TRIGGER holds these locks too, but spelling them before COUNT
    -- makes the mixed-release bootstrap boundary explicit and independent of
    -- DDL lock implementation details (inside THIS transaction the ledger
    -- lock is a formality over the stronger lock already held). A RE-seed
    -- (the singleton deleted over a grown audit surface) pays the same shape
    -- and stays a maintenance-window operation.
${sourceLocks}
    DELETE FROM ${pendingRegclass};

${triggerCreates}

    INSERT INTO ${budgetRegclass}
      (singleton, committed_rows, hard_limit_rows, budget_revision)
    -- Deliberately allow committed_rows to start above the ceiling. The
    -- enforcement predicate then refuses every future net-growth transaction
    -- without making unrelated gameplay unavailable, and deletions still
    -- reduce it, during an emergency cap rollout.
    SELECT TRUE,
           ${exactAggregateCount},
           ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS},
           ${BANK_LEDGER_GROWTH_BUDGET_REVISION};
  ELSIF stored_revision < ${BANK_LEDGER_GROWTH_BUDGET_REVISION} THEN
    -- The ONE aggregate migration, inside the boot transaction that already
    -- holds the canonical schema advisory lock, so concurrent realms are
    -- parked at the advisory acquire holding nothing. Lock every counted
    -- table BEFORE publishing the new triggers and counting, so no writer can
    -- slip a row between the snapshot this count reads and the moment its own
    -- statement starts being accumulated. The pre-aggregate counter was a
    -- lifetime insert tally that cascaded deletes never credited back, so it
    -- is REPLACED by the exact live count rather than adjusted.
${sourceLocks}

${triggerCreates}

    UPDATE ${budgetRegclass}
       SET committed_rows = ${exactAggregateCount},
           budget_revision = ${BANK_LEDGER_GROWTH_BUDGET_REVISION},
           updated_at = now()
     WHERE singleton = TRUE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ${budgetRegclass}
     WHERE singleton = TRUE
       AND hard_limit_rows <> ${BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS}
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = '${BANK_LEDGER_GROWTH_LIMIT_ENV} disagrees with the durable bank-ledger limit';
  END IF;

  -- Post-condition, and the downgrade fence: after this fragment the singleton
  -- is at exactly this build's revision. A HIGHER revision means an older
  -- binary is booting against a database a newer one already migrated, whose
  -- counter it would maintain under the wrong rules.
  IF EXISTS (
    SELECT 1
      FROM ${budgetRegclass}
     WHERE singleton = TRUE
       AND budget_revision <> ${BANK_LEDGER_GROWTH_BUDGET_REVISION}
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'bank ledger growth budget revision disagrees with this process';
  END IF;
END
$bank_ledger_growth_bootstrap$;

-- Readback for hand-applied installs. The BOOT readback is issued separately
-- by db.ts as its own single-statement SELECT: sending this whole schema as
-- one multi-statement query makes node-postgres return an ARRAY of results,
-- so a .rows[0] read of the combined result would never see this statement.
SELECT committed_rows, hard_limit_rows
  FROM ${budgetRegclass}
 WHERE singleton = TRUE;
`;
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
  return `SELECT committed_rows, hard_limit_rows FROM "${schemaName}".${AUDIT_GROWTH_BUDGET_TABLE} WHERE singleton = TRUE`;
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
  /** Audit rows the durable budget accounts for, aggregated over every counted
   *  table and net of removals. Null until the first accepted observation. */
  readonly committedRows: number | null;
  readonly hardLimitRows: number;
  /** Total stored bytes across the audit surface (counted tables plus the
   *  source anchor table), or null when no byte observation has landed. */
  readonly observedBytes: number | null;
  readonly observedAtMs: number | null;
}

let observedCommittedRows: number | null = null;
let observedTotalBytes: number | null = null;
let observedAtMs: number | null = null;
let issuedGeneration = 0;
let acceptedGeneration = 0;

/**
 * Claim an ordering ticket BEFORE reading the database. The counter now falls
 * as well as rises, so observations cannot be ordered by value; they are
 * ordered by when their read STARTED. A refusal observes the database while a
 * slow poll is still in flight, claims a higher ticket, and wins.
 */
export function beginBankLedgerGrowthObservation(): number {
  issuedGeneration += 1;
  return issuedGeneration;
}

function safeDbInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Record a database-returned counter value for the scrape-time gauge. Callers
 * that read the database asynchronously pass the ticket they claimed BEFORE the
 * read; an omitted ticket is claimed here, which is right for a caller (a
 * refusal, the boot readback) whose value was observed at call time. A stale
 * ticket is dropped, not failed: the read itself was healthy.
 */
export function observeBankLedgerGrowthBudget(
  committedRows: unknown,
  hardLimitRows: unknown = BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS,
  nowMs: number = Date.now(),
  generation: number = beginBankLedgerGrowthObservation(),
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
  if (generation < acceptedGeneration) return true;
  acceptedGeneration = generation;
  observedCommittedRows = committed;
  observedAtMs = nowMs;
  return true;
}

/**
 * The aggregate stored-byte reading that rides the same minute refresh, ordered
 * by the same ticket. Bytes legitimately fall (a vacuum, a cascade); a
 * malformed or stale reading leaves the last one in place.
 */
export function observeBankLedgerGrowthBytes(
  totalBytes: unknown,
  generation: number = beginBankLedgerGrowthObservation(),
): boolean {
  const bytes = safeDbInteger(totalBytes);
  if (bytes === null) return false;
  if (generation < acceptedGeneration) return true;
  observedTotalBytes = bytes;
  return true;
}

export function bankLedgerGrowthBudgetReadout(): BankLedgerGrowthBudgetReadout {
  return Object.freeze({
    committedRows: observedCommittedRows,
    hardLimitRows: BANK_LEDGER_GROWTH_HARD_LIMIT_ROWS,
    observedBytes: observedTotalBytes,
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
