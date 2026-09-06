// The audit tables ONE durable growth budget accounts for, and the SQL text of
// the per-source enforcement objects built over them. Definitions and pure
// string builders only: this leaf opens no connection, reads no env, applies no
// DDL and holds no state.
//
// There is exactly ONE budget row, ONE env knob and ONE ceiling for every audit
// table listed here. A second budget, a per-source cap, or a per-source query
// on a write path is the shape this module exists to prevent.
//
// The durable objects keep their historical bank_ledger_growth_* names. They
// predate the material source journal (bank_ledger has shipped since bd51a6986c)
// and renaming a live table, function or trigger is a migration with no payoff:
// the NAMES are historical, the MEANING is aggregate, and every comment and
// message here says aggregate.
//
// Per source the budget owns two statement-level accumulators, one per
// transition direction, and one accumulator FUNCTION that both fire. A function
// per source (rather than one shared function) is deliberate: a statement
// trigger reads its transition rows by NAME, and two source tables have
// different row types, so one shared name would hand a cached plan the wrong
// tuple descriptor. Each branch here names one transition table of one type.

/** AFTER ... FOR EACH STATEMENT, by pg_trigger.tgtype (INSERT = 4, DELETE = 8). */
export const AUDIT_GROWTH_INSERT_TGTYPE = 4;
export const AUDIT_GROWTH_DELETE_TGTYPE = 8;
/** FOR EACH ROW (1) AFTER INSERT (4) OR UPDATE (16) on the pending accumulator. */
export const AUDIT_GROWTH_COMMIT_TGTYPE = 21;

export const AUDIT_GROWTH_BUDGET_TABLE = 'bank_ledger_growth_budget';
export const AUDIT_GROWTH_PENDING_TABLE = 'bank_ledger_growth_pending';
export const AUDIT_GROWTH_COMMIT_TRIGGER = 'bank_ledger_growth_budget_commit';
export const AUDIT_GROWTH_ENFORCER = 'enforce_bank_ledger_growth_budget';
/** The one named CHECK the pending accumulator carries once converged. */
export const AUDIT_GROWTH_PENDING_DELTA_CONSTRAINT = 'bank_ledger_growth_pending_delta';

/** One counted audit table plus the fixed identity of its enforcement objects. */
export interface AuditGrowthSource {
  /** plpgsql variable stem, and the key tests and messages read. */
  readonly key: string;
  readonly table: string;
  readonly accumulator: string;
  readonly insertTrigger: string;
  readonly deleteTrigger: string;
  readonly insertTransition: string;
  readonly deleteTransition: string;
}

/**
 * The COUNTED tables. Every row in either one is one audit row against the
 * shared ceiling.
 *
 * material_source_containers is deliberately absent: an anchor is only ever
 * created together with its first journal row and is reaped by the same cascade
 * that reaps its last one, so anchor cardinality is bounded by journal
 * cardinality and counting it would double-charge the same lifecycle. Its
 * BYTES still count (AUDIT_GROWTH_BYTE_TABLES below).
 *
 * The literal table names mirror material_source_journal_db.ts; the budget unit
 * test pins them against that module's exported constants so the two cannot
 * drift, without this leaf importing the sim-facing journal writer.
 */
export const AUDIT_GROWTH_SOURCES: readonly AuditGrowthSource[] = [
  {
    key: 'bank_ledger',
    table: 'bank_ledger',
    accumulator: 'accumulate_bank_ledger_growth_budget',
    insertTrigger: 'bank_ledger_growth_budget_insert',
    deleteTrigger: 'bank_ledger_growth_budget_delete',
    insertTransition: 'inserted_bank_ledger_rows',
    deleteTransition: 'deleted_bank_ledger_rows',
  },
  {
    key: 'material_source_journal',
    table: 'material_source_journal',
    accumulator: 'accumulate_material_source_journal_growth_budget',
    insertTrigger: 'material_source_journal_growth_budget_insert',
    deleteTrigger: 'material_source_journal_growth_budget_delete',
    insertTransition: 'inserted_material_source_journal_rows',
    deleteTransition: 'deleted_material_source_journal_rows',
  },
];

/**
 * What the aggregate BYTE measure sums. The counted tables plus the anchor
 * table: an anchor carries an immutable opening projection, so it is real
 * stored bytes even though it is not a counted row. Rows bound the ceiling;
 * bytes are what an operator sizes disk against, and the pair only reads
 * honestly if both are aggregate over the same audit surface.
 */
export const AUDIT_GROWTH_BYTE_TABLES: readonly string[] = [
  'bank_ledger',
  'material_source_containers',
  'material_source_journal',
];

/** One statement trigger the budget requires, and how to prove it unaltered. */
export interface AuditGrowthTrigger {
  readonly name: string;
  /** Unqualified relation the trigger sits on. */
  readonly table: string;
  /** plpgsql variable stem for the named/valid probe pair. */
  readonly variable: string;
  readonly tgtype: number;
  /** Unqualified function name, called with zero arguments. */
  readonly procedure: string;
  readonly newTable: string | null;
  readonly oldTable: string | null;
  readonly deferred: boolean;
  /** True once the budget is initialized at the CURRENT revision. Legacy
   *  (pre-aggregate) installs require only the two originals. */
  readonly requiredBeforeAggregate: boolean;
}

/**
 * Every trigger the aggregate budget enforces through, in creation order. The
 * deferred commit trigger comes first so the accumulators can never publish a
 * pending row that nothing consumes.
 */
export function auditGrowthTriggers(): readonly AuditGrowthTrigger[] {
  const triggers: AuditGrowthTrigger[] = [
    {
      name: AUDIT_GROWTH_COMMIT_TRIGGER,
      table: AUDIT_GROWTH_PENDING_TABLE,
      variable: 'commit',
      tgtype: AUDIT_GROWTH_COMMIT_TGTYPE,
      procedure: AUDIT_GROWTH_ENFORCER,
      newTable: null,
      oldTable: null,
      deferred: true,
      requiredBeforeAggregate: true,
    },
  ];
  for (const source of AUDIT_GROWTH_SOURCES) {
    triggers.push({
      name: source.insertTrigger,
      table: source.table,
      variable: `${source.key}_insert`,
      tgtype: AUDIT_GROWTH_INSERT_TGTYPE,
      procedure: source.accumulator,
      newTable: source.insertTransition,
      oldTable: null,
      deferred: false,
      // The ledger INSERT accumulator is the one original: an initialized
      // legacy budget already depends on it, so its absence stays a boot
      // refusal even before the aggregate migration runs.
      requiredBeforeAggregate: source.table === 'bank_ledger',
    });
    triggers.push({
      name: source.deleteTrigger,
      table: source.table,
      variable: `${source.key}_delete`,
      tgtype: AUDIT_GROWTH_DELETE_TGTYPE,
      procedure: source.accumulator,
      newTable: null,
      oldTable: source.deleteTransition,
      deferred: false,
      requiredBeforeAggregate: false,
    });
  }
  return triggers;
}

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * The two plpgsql booleans one trigger is judged by: NAMED (something with this
 * name exists, so a tampered definition is reported rather than silently
 * recreated) and VALID (it is byte for byte the trigger this build installs).
 */
export function auditGrowthTriggerProbeSql(schema: string, trigger: AuditGrowthTrigger): string {
  const relation = `${schema}.${trigger.table}`;
  const shared = `      FROM pg_catalog.pg_trigger
     WHERE tgrelid = '${relation}'::pg_catalog.regclass
       AND tgname = ${sqlLiteral(trigger.name)}
       AND NOT tgisinternal`;
  const constraintArm = trigger.deferred
    ? `       AND tgconstraint <> 0
       AND tgdeferrable
       AND tginitdeferred`
    : `       AND tgconstraint = 0`;
  const newTableArm =
    trigger.newTable === null
      ? '       AND tgnewtable IS NULL'
      : `       AND tgnewtable = ${sqlLiteral(trigger.newTable)}`;
  const oldTableArm =
    trigger.oldTable === null
      ? '       AND tgoldtable IS NULL'
      : `       AND tgoldtable = ${sqlLiteral(trigger.oldTable)}`;
  return `  SELECT EXISTS (
    SELECT 1
${shared}
  ) INTO named_${trigger.variable}_trigger;
  SELECT EXISTS (
    SELECT 1
${shared}
       AND tgenabled = 'O'
       AND tgtype = ${trigger.tgtype}
       AND tgfoid = '${schema}.${trigger.procedure}()'::pg_catalog.regprocedure
       AND tgnargs = 0
       AND pg_catalog.octet_length(tgargs) = 0
       AND tgattr::text = ''
       AND tgqual IS NULL
${constraintArm}
${newTableArm}
${oldTableArm}
  ) INTO valid_${trigger.variable}_trigger;`;
}

/** A named-but-altered trigger is an operator emergency, never a silent recreate. */
export function auditGrowthTriggerRefusalSql(trigger: AuditGrowthTrigger): string {
  return `  IF named_${trigger.variable}_trigger AND NOT valid_${trigger.variable}_trigger THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = '${trigger.name} has an unsafe definition';
  END IF;`;
}

/** Publish one missing trigger, inside the caller's already-locked bootstrap. */
export function auditGrowthTriggerCreateSql(schema: string, trigger: AuditGrowthTrigger): string {
  const relation = `${schema}.${trigger.table}`;
  if (trigger.deferred) {
    return `    IF NOT valid_${trigger.variable}_trigger THEN
      EXECUTE 'CREATE CONSTRAINT TRIGGER ${trigger.name}
        AFTER INSERT OR UPDATE ON ${relation}
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION ${schema}.${trigger.procedure}()';
    END IF;`;
  }
  const event = trigger.newTable === null ? 'DELETE' : 'INSERT';
  const referencing =
    trigger.newTable === null
      ? `REFERENCING OLD TABLE AS ${trigger.oldTable}`
      : `REFERENCING NEW TABLE AS ${trigger.newTable}`;
  return `    IF NOT valid_${trigger.variable}_trigger THEN
      EXECUTE 'CREATE TRIGGER ${trigger.name}
        AFTER ${event} ON ${relation}
        ${referencing}
        FOR EACH STATEMENT
        EXECUTE FUNCTION ${schema}.${trigger.procedure}()';
    END IF;`;
}

/**
 * One accumulator function per source table. Both of that source's statement
 * triggers call it and TG_OP picks the branch, so the transition table each
 * branch names belongs to exactly one trigger of one row type.
 *
 * REFERENCING NEW/OLD TABLE plus count(*) is the only correct affected-row
 * count for a statement trigger: GET DIAGNOSTICS ROW_COUNT inside the function
 * reports the function's OWN last statement, never the statement that fired it.
 * A zero-row statement books nothing at all, so an idempotent retry that writes
 * no audit row consumes no budget.
 */
export function auditGrowthAccumulatorSql(schema: string, source: AuditGrowthSource): string {
  const pending = `${schema}.${AUDIT_GROWTH_PENDING_TABLE}`;
  return `CREATE OR REPLACE FUNCTION ${schema}.${source.accumulator}()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, ${schema}, pg_temp
AS $${source.key}_growth_accumulator$
DECLARE
  changed_rows BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT count(*)::bigint INTO changed_rows FROM ${source.insertTransition};
    IF changed_rows = 0 THEN
      RETURN NULL;
    END IF;
    INSERT INTO ${pending} (transaction_id, inserted_rows, deleted_rows)
    VALUES (pg_catalog.pg_current_xact_id(), changed_rows, 0)
    ON CONFLICT (transaction_id) DO UPDATE
      SET inserted_rows = ${pending}.inserted_rows + EXCLUDED.inserted_rows;
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT count(*)::bigint INTO changed_rows FROM ${source.deleteTransition};
    IF changed_rows = 0 THEN
      RETURN NULL;
    END IF;
    INSERT INTO ${pending} (transaction_id, inserted_rows, deleted_rows)
    VALUES (pg_catalog.pg_current_xact_id(), 0, changed_rows)
    ON CONFLICT (transaction_id) DO UPDATE
      SET deleted_rows = ${pending}.deleted_rows + EXCLUDED.deleted_rows;
    RETURN NULL;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'audit growth accumulator fired on an unsupported operation';
END
$${source.key}_growth_accumulator$;`;
}

/**
 * The aggregate BYTE expression: one scalar over the audit surface, resolved
 * through to_regclass so a database missing the source-journal DDL reports the
 * tables it does have instead of failing the read. It scans no heap, but
 * pg_total_relation_size opens each relation with AccessShareLock, so it can
 * wait behind an ACCESS EXCLUSIVE holder (a boot transaction); the caller's
 * statement timeout is what bounds that.
 */
export function auditGrowthBytesSql(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('audit growth byte schema must be a simple lowercase identifier');
  }
  const rows = AUDIT_GROWTH_BYTE_TABLES.map(
    (table) => `(pg_catalog.to_regclass('${schemaName}.${table}'))`,
  ).join(',\n                      ');
  return `(SELECT pg_catalog.sum(pg_catalog.pg_total_relation_size(audit_table.oid))::bigint
          FROM (VALUES ${rows}) AS audit_table(oid)
         WHERE audit_table.oid IS NOT NULL)`;
}
