// Concurrent-index SQL for bank_ledger's guild-container reader (the in-game
// guild bank activity log, server/guild_bank_log.ts).
//
// WHY THIS INDEX EXISTS NOW AND NOT BEFORE. bank_ledger has always had a
// (character_id, created_at DESC) index and a created_at index, and the
// deferral recorded in docs/guild-bank/state.md named the exact trigger for a
// (container, container_id) index: "until a per-guild reader exists". The
// activity log IS that reader, and it is a live player-facing read, so the
// index lands with it. Without it the query degrades to a sequential scan of a
// KEEP-FOREVER table (bank_ledger is the anti-dupe audit trail and nothing
// prunes it) plus a sort, on a path any officer can trigger by opening a window.
//
// WHY `id DESC` IS A COLUMN AND NOT DECORATION. The reader is "the most recent
// N rows of one guild", i.e. an equality column plus a descending scan:
// `WHERE container = 'guild' AND container_id = $1 ORDER BY id DESC LIMIT 50`.
// Indexing only the equality would still make Postgres sort a guild's ENTIRE
// history to find its newest 50, which is the cost that actually grows with an
// old guild's activity. Carrying `id DESC` turns the whole read into a bounded
// backwards index scan whose cost is the LIMIT, not the guild's row count.
// This mirrors bank_ledger_character, which pairs its equality column with
// created_at DESC for the same reason. `id` rather than `created_at` because
// the primary key is the tiebreak-free monotonic order the reader actually
// pages by (two rows can share a created_at; a BIGSERIAL id cannot collide).
//
// WHY IT IS PARTIAL. `container` is a two-value discriminator and this reader
// only ever passes the literal 'guild', so a full index would carry an entry
// for every PERSONAL bank row as well: on a shipped game that is the large
// majority of a table nothing prunes, and it buys nothing, because personal
// reads are served by bank_ledger_character and no other statement in server/
// or scripts/ filters on `container` at all. Those entries would be pure index
// size, pure extra WAL, and pure buffer-cache pressure on EVERY personal bank
// insert, forever. `WHERE container = 'guild'` is provably matched by the
// reader (the value is a literal in the SQL, never a parameter), and it leaves
// the index roughly the size of the guild subset the reader actually walks.
//
// WHY `op` STAYS OUT of it, even though the reader filters on it. The op
// predicate is `= ANY($2::text[])`, and a ScalarArrayOpExpr on a MIDDLE column
// forfeits the index's ordering guarantee for the trailing column: Postgres
// would have to sort every matching row of that guild instead of walking 50.
// As a trailing Filter on rows already arriving in id order it costs only the
// suppressed rows, which are the two rare diagnostic ops.
//
// CONCURRENTLY, never boot DDL: bank_ledger is one of the largest live tables
// in production and a transactional CREATE INDEX would hold its lock for the
// whole scan, stalling every bank op on every realm behind it. Constants live
// in this dependency-free module because the registry
// (server/concurrent_indexes.ts) evaluates its list at import time and
// server/db.ts already imports the registry (the client_perf_indexes.ts
// precedent).

export const BANK_LEDGER_CONTAINER_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_container_recent
  ON bank_ledger(container_id, id DESC)
  WHERE container = 'guild';
`;

// A CREATE INDEX CONCURRENTLY killed mid-build strands the index INVALID, and
// IF NOT EXISTS then treats that carcass as existing on every later boot (the
// player_metrics_db.ts carcass note), so the reader would silently keep
// sequential-scanning forever. The boot coordinator drops the carcass before
// re-running the create.
export const BANK_LEDGER_CONTAINER_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('bank_ledger_container_recent')
   AND NOT i.indisvalid
`;

export const BANK_LEDGER_CONTAINER_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_container_recent';
