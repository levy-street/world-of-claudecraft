// Writer-capability guard for material-source composition: the capability a
// source-aware writer announces, and the DDL that refuses a write from a
// connection that has not announced it. Definitions only; this leaf applies no
// DDL, opens no connection, and reads no env or URL.
//
// Contracts:
//   * The capability is a custom GUC whose value is the writer VERSION,
//     announced as a connection STARTUP option so it describes the BINARY that
//     opened the connection. Never a shared PGOPTIONS env default: an old
//     binary on the same host would inherit that and defeat the guard.
//   * One trigger function plus one BEFORE ... FOR EACH STATEMENT trigger per
//     guarded table. The guard costs one GUC read per statement: no row payload
//     is read, no table is queried. It fires on a zero-row statement too.
//   * An unset or wrong capability RAISEs SQLSTATE 55000, aborting the whole
//     transaction, so a denied write takes every earlier statement with it.
//   * Every identifier is a static literal from the list below: no dynamic SQL,
//     no caller interpolation. The error text is an operator diagnostic, never
//     player-facing.
//
// Limits: TRUNCATE is out of scope, and a session setting
// `session_replication_role = replica` skips triggers entirely. This guards
// un-migrated code paths; it is not a security boundary and does not by itself
// make a rollback safe.
//
// The option composer appends the capability last and preserves the caller's
// string byte for byte, with one refusal: options ending in an unpaired
// backslash, which pg_split_opts would let escape the appended separator.
//
// Integration obligations, all the caller's: wire the startup option from CODE
// into the pool and both boot Clients; apply the DDL only after every guarded
// table exists, under a bounded migration lock_timeout (CREATE TRIGGER takes
// SHARE ROW EXCLUSIVE on its table); coordinate an all-realm shutdown and flush
// before activation; measure real lock behavior and per-write overhead.

/** The custom GUC a source-aware writer announces at connection startup. */
export const MATERIAL_SOURCE_WRITER_CAPABILITY = 'woc.material_source_writer';

/** The announced writer version, and the only value the guard accepts. */
export const MATERIAL_SOURCE_WRITER_VERSION = '1';

const CAPABILITY_SETTING = `${MATERIAL_SOURCE_WRITER_CAPABILITY}=${MATERIAL_SOURCE_WRITER_VERSION}`;

/** The literal startup option that announces the capability. */
export const MATERIAL_SOURCE_WRITER_STARTUP_OPTION = `-c ${CAPABILITY_SETTING}`;

/** object_not_in_prerequisite_state: stable, and distinguishable from a constraint. */
export const MATERIAL_SOURCE_WRITER_SQLSTATE = '55000';

/** The fixed leading text of every refusal (callers and tests match on this). */
export const MATERIAL_SOURCE_WRITER_ERROR_PREFIX = 'material source writer capability required';

/** The one trigger function every guarded table shares. */
export const MATERIAL_SOURCE_WRITER_GUARD_FUNCTION = 'woc_material_source_writer_guard';

export type MaterialSourceGuardEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface MaterialSourceGuardedTable {
  readonly table: string;
  readonly events: readonly MaterialSourceGuardEvent[];
}

const ALL_WRITES: readonly MaterialSourceGuardEvent[] = ['INSERT', 'UPDATE', 'DELETE'];

/**
 * Every table whose rows carry, or pair with, material composition.
 *
 * `characters` UPDATE is guarded as a WHOLE TABLE deliberately: a rename and a
 * state write are separate old writers, so narrowing the trigger to the state
 * column would let one of them through. `bank_ledger` is guarded even though it
 * has no paired save, because a direct old writer must not append
 * source-unaware rows after the cutover. `character_leases` is guarded on
 * INSERT and UPDATE only: lease CLEANUP has to keep working on an un-migrated
 * binary, or a dead process's lease would outlive it.
 */
export const MATERIAL_SOURCE_GUARDED_TABLES: readonly MaterialSourceGuardedTable[] = [
  { table: 'characters', events: ALL_WRITES },
  { table: 'guild_banks', events: ALL_WRITES },
  { table: 'world_state', events: ALL_WRITES },
  { table: 'mail_custody_parcels', events: ALL_WRITES },
  { table: 'mail_custody_watermark', events: ALL_WRITES },
  { table: 'woc_market_listings', events: ALL_WRITES },
  { table: 'woc_market_custody_claims', events: ALL_WRITES },
  { table: 'woc_market_settlements', events: ALL_WRITES },
  { table: 'woc_market_directed_offers', events: ALL_WRITES },
  { table: 'bank_ledger', events: ALL_WRITES },
  { table: 'material_source_containers', events: ALL_WRITES },
  { table: 'material_source_journal', events: ALL_WRITES },
  { table: 'character_leases', events: ['INSERT', 'UPDATE'] },
];

/** The trigger name for a guarded table; static, and inside PG's 63-byte limit. */
export function materialSourceGuardTriggerName(table: string): string {
  return `woc_msw_guard_${table}`;
}

// current_setting(..., true) returns NULL when the GUC was never set, so the
// null-safe comparison covers "unset" and "wrong version" with one test.
const GUARD_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION ${MATERIAL_SOURCE_WRITER_GUARD_FUNCTION}()
  RETURNS trigger
  LANGUAGE plpgsql
AS $woc_msw$
BEGIN
  IF current_setting('${MATERIAL_SOURCE_WRITER_CAPABILITY}', true)
       IS DISTINCT FROM '${MATERIAL_SOURCE_WRITER_VERSION}' THEN
    RAISE EXCEPTION '${MATERIAL_SOURCE_WRITER_ERROR_PREFIX}: % on %', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '${MATERIAL_SOURCE_WRITER_SQLSTATE}';
  END IF;
  -- Statement level: this return value is ignored and skips nothing. Refusal
  -- is the RAISE above, which aborts the transaction.
  RETURN NULL;
END;
$woc_msw$;`;

function guardTriggerSql(row: MaterialSourceGuardedTable): string {
  return `CREATE OR REPLACE TRIGGER ${materialSourceGuardTriggerName(row.table)}
  BEFORE ${row.events.join(' OR ')} ON ${row.table}
  FOR EACH STATEMENT
  EXECUTE FUNCTION ${MATERIAL_SOURCE_WRITER_GUARD_FUNCTION}();`;
}

/**
 * The whole guard as one idempotent DDL script: CREATE OR REPLACE throughout,
 * so re-applying it is a no-op rather than an error. Unqualified names resolve
 * through the applying connection's search_path.
 */
export const MATERIAL_SOURCE_WRITER_GUARD_SQL = [
  GUARD_FUNCTION_SQL,
  ...MATERIAL_SOURCE_GUARDED_TABLES.map(guardTriggerSql),
].join('\n\n');

// pg_split_opts consumes an unpaired terminal backslash, so appending a
// separator to a string that ends in an ODD run of backslashes would make that
// backslash escape the separator and absorb the appended `-c` into the previous
// value: the capability would silently not be announced. That single input is
// refused; an even run (each pair a literal backslash) is safe and accepted.
function endsInUnpairedBackslash(text: string): boolean {
  let run = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) run++;
  return run % 2 === 1;
}

// Static, and deliberately free of the options string: a connection options
// value can carry operator configuration, so it is never echoed into a log.
const UNPAIRED_BACKSLASH_REFUSAL =
  'material source writer: connection options end in an unpaired backslash, which would ' +
  'escape the appended separator and suppress the capability; fix the caller options';

/**
 * Appends the capability to a connection's startup options.
 *
 * The caller's string is carried through BYTE FOR BYTE: it is never tokenized
 * or normalized, because PostgreSQL option values can carry backslash-escaped
 * whitespace that any re-joining would rewrite. The capability is appended LAST
 * so this code-owned value wins over an earlier setting of the same GUC.
 *
 * The one boundary, and the reason this is not a universal append: an options
 * string ending in an unpaired backslash cannot have anything appended to it
 * safely, so it is REFUSED at composition time rather than producing a
 * connection that quietly lacks the capability. Everything else is accepted,
 * including even-numbered terminal backslashes and trailing plain whitespace.
 *
 * Nothing here is reconciled or deduplicated (the string is built once at
 * connection creation), and no URL, credential, or env is read.
 *
 * @throws if `options` ends in an odd-length run of backslashes.
 */
export function withMaterialSourceWriterOption(options?: string | null): string {
  const base = options ?? '';
  if (base.length === 0) return MATERIAL_SOURCE_WRITER_STARTUP_OPTION;
  if (endsInUnpairedBackslash(base)) throw new Error(UNPAIRED_BACKSLASH_REFUSAL);
  return `${base} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`;
}
