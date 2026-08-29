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
// WHY IT IS PARTIAL. `container` is a closed discriminator and this reader
// only ever passes the literal 'guild', so a full index would carry an entry
// for every PERSONAL bank row and every 'vault' row (the Materials Vault, Bank
// Storage Phase 2) as well: on a shipped game that is the large majority of a
// table nothing prunes, and the vault rows only enlarge the excluded majority,
// strengthening the case rather than weakening it. It buys nothing, because
// personal and vault reads are served by bank_ledger_character and no other
// statement in server/ or scripts/ filters on `container` at all. Those
// entries would be pure index size, pure extra WAL, and pure buffer-cache
// pressure on EVERY personal bank insert, forever. `WHERE container = 'guild'`
// is provably matched by the reader (the value is a literal in the SQL, never
// a parameter), and it leaves the index roughly the size of the guild subset
// the reader actually walks.
//
// THE NEXT INDEX TRIGGER, recorded the way the guild reader's deferral was. A
// future per-character vault HISTORY reader
// (`WHERE character_id = $1 AND container = 'vault' ORDER BY id DESC LIMIT n`)
// is NOT served by bank_ledger_character: that index's trailing column is
// created_at, not id, so the reader would still sort a character's whole
// history to find its newest n. It earns an index of its own when such a
// reader lands, and not before.
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

// ---------------------------------------------------------------------------
// The admin economy-oversight per-account reader
// (server/account_wealth_db.ts largeGoldMovementsForAccount):
// `WHERE account_id = $1 AND abs(copper_delta) >= 100000 ORDER BY id DESC
// LIMIT $2`. The fixed threshold is part of the product contract (10 gold),
// not caller input. Keeping it literal lets PostgreSQL prove that the query
// implies this partial-index predicate even under a generic prepared plan. A
// bind parameter cannot prove that implication at plan time and silently
// strands the partial index.
//
// The equality column plus `id DESC` turns "the newest large movements of one
// account" into a bounded backwards index scan. The partial predicate keeps
// ordinary small bank movements out of that ordered read index, avoiding
// their permanent second key, WAL, and cache cost. A full account index remains
// mandatory: account_id is an ON DELETE CASCADE foreign key, and PostgreSQL
// cannot use a partial index to find every child row when an account is deleted.
// Phase one keeps the broad predecessor in that role; phase two replaces it
// with compact `(account_id)`. The query and partial index interpolate this ONE
// predicate constant so their SQL text cannot drift apart.
//
// CONCURRENTLY, never boot DDL, same as the guild reader: bank_ledger is too
// large to lock for a transactional build. This partial index takes over the
// ordered-read role of bank_ledger_account_recent. Phase one (this release)
// keeps the predecessor migration in its original registry position, then
// appends the partial ordered index after every previously shipped entry. The
// predecessor continues supporting both the account FK and a peer whose prior
// binary still sends a parameterized threshold that cannot use the partial
// index under a generic plan. Phase two, after the fleet and rollback window
// converge, APPENDS the compact full migration below and attaches
// BANK_LEDGER_ACCOUNT_BROAD_RETIRE_SQL to that new migration. Appending keeps
// the registry's shipped order stable; it also means a failed repair of the
// earlier partial entry aborts the loop before compact-build or broad-drop.
// The runner then guarantees the compact replacement succeeds before the drop.
// Staging the compact build avoids four heap scans in this release.

export const BANK_LEDGER_LARGE_MOVEMENT_PREDICATE_SQL = 'abs(copper_delta) >= 100000';

// This shipped predecessor must remain in the append-only concurrent-index
// registry until a later migration has built its full `(account_id)`
// replacement. Existing databases already have it, while a fresh database
// depends on this entry for the account FK and rollback-compatible readers.
export const BANK_LEDGER_ACCOUNT_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_recent
  ON bank_ledger(account_id, id DESC);
`;

export const BANK_LEDGER_ACCOUNT_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('bank_ledger_account_recent')
   AND NOT i.indisvalid
`;

export const BANK_LEDGER_ACCOUNT_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_account_recent';

export const BANK_LEDGER_ACCOUNT_FK_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_fk
  ON bank_ledger(account_id);
`;

export const BANK_LEDGER_ACCOUNT_FK_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('bank_ledger_account_fk')
   AND NOT i.indisvalid
`;

export const BANK_LEDGER_ACCOUNT_FK_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_account_fk';

// Plan shape verified empirically (PG16, 1M seeded rows, plan_cache_mode =
// force_generic_plan, the reused-prepared-statement case): Limit over an Index
// Scan on this partial index, Index Cond (account_id = $1), 0.02ms. No seq scan.
export const BANK_LEDGER_ACCOUNT_LARGE_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_large_recent
  ON bank_ledger(account_id, id DESC)
  WHERE ${BANK_LEDGER_LARGE_MOVEMENT_PREDICATE_SQL};
`;

export const BANK_LEDGER_ACCOUNT_LARGE_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('bank_ledger_account_large_recent')
   AND NOT i.indisvalid
`;

export const BANK_LEDGER_ACCOUNT_LARGE_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_account_large_recent';

export const BANK_LEDGER_ACCOUNT_BROAD_RETIRE_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_account_recent';
