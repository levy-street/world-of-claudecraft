// Boot-log forwarding for schema-fragment RAISE NOTICE reports, shared by the
// two dedicated boot clients (ensureSchema's transaction client and the
// post-listen concurrent-index / VALIDATE client in db.ts). node-postgres
// discards notices no listener consumes, so without a forwarder the one real
// report (the storage-purchase refused-row sweep naming what it removed)
// vanishes; unfiltered, the ~400 idempotent-DDL skip notices every
// steady-state boot emits bury it.

/** The fields node-postgres surfaces on a NoticeMessage that the filter reads. */
export interface SchemaNotice {
  code?: string;
  routine?: string;
  message?: string;
}

// The already-exists-skipping family from IF NOT EXISTS DDL: 42P07
// (duplicate_table, also indexes and sequences), 42701 (duplicate_column),
// 42P06 (duplicate_schema), and 42710 (duplicate_object, the same skip
// grammar for the object classes the first three do not cover).
const SKIP_NOTICE_CODES = new Set(['42P07', '42701', '42P06', '42710']);

// The does-not-exist-skipping family from idempotent retire DROPs (a
// superseded index, trigger, or constraint already gone). These arrive as
// SQLSTATE 00000, the SAME code a plpgsql RAISE NOTICE report carries, so
// code alone cannot separate noise from report; the server-side reporting
// routine can (measured on PG 16: drop skips report does_not_exist_skipping
// or DropErrorMsgNonExistent, ALTER TABLE ... DROP CONSTRAINT IF EXISTS
// reports ATExecDropConstraint, RAISE reports exec_stmt_raise), and routine
// names are C identifiers, immune to lc_messages localization.
const SKIP_NOTICE_ROUTINES = new Set([
  'does_not_exist_skipping',
  'DropErrorMsgNonExistent',
  'ATExecDropConstraint',
]);

/**
 * True for the idempotent-DDL skip notices a steady-state boot emits by the
 * hundreds. A DROP-list on purpose: anything unrecognized stays loud.
 */
export function isIdempotentSchemaSkipNotice(notice: SchemaNotice): boolean {
  if (notice.code !== undefined && SKIP_NOTICE_CODES.has(notice.code)) return true;
  return notice.routine !== undefined && SKIP_NOTICE_ROUTINES.has(notice.routine);
}

/**
 * Attach the filtered boot-log forwarder to a dedicated boot client. The
 * typeof guard tolerates minimal test fakes, the pool.on idiom in db.ts.
 * Dev-channel English: log lines, never player text. Unknown notices are
 * logged VERBATIM, so a schema fragment must never RAISE NOTICE row data.
 */
export function attachSchemaNoticeForwarder(client: {
  on?: (event: 'notice', listener: (notice: SchemaNotice) => void) => unknown;
}): void {
  if (typeof client.on !== 'function') return;
  client.on('notice', (notice) => {
    if (isIdempotentSchemaSkipNotice(notice)) return;
    console.warn(`[schema] ${notice.message}`);
  });
}
