// Concurrent-index SQL for the Exchange's realm-wide Sales History read
// (salesForRealm in woc_market_db.ts, the Sales History tab).
//
// WHY THIS INDEX EXISTS. The read is "every completed sale on the realm, most
// recent first": equality on realm, ordered by (created_at DESC, id DESC),
// LIMIT/OFFSET paged. The existing woc_market_sales_item index leads with
// item_id and the seller index with seller_name, so neither serves a
// realm-keyed most-recent-first walk; without this index every Sales History
// page open degrades to a sequential scan plus sort of the keep-forever sales
// provenance table.
//
// The id DESC tiebreak matches the query's ORDER BY verbatim so a paged walk
// is stable (two sales in the same millisecond keep one order across pages).
// Not partial: exclusions (excluded = true) are rare operator voids whose heap
// filter costs a few extra tuple visits, and a partial index would be a second
// structure on an insert-only table (the woc_market_sales_seller precedent).
// The filtered reads (quality/type/category/subcategory) are click-driven
// per-user lookups the read limiter bounds; they narrow the same realm walk
// with a heap filter and need no dedicated index. This is the first Exchange
// read whose WORST case is the whole ledger: a rare filter combination on a
// large realm walks toward the full realm history before a page fills, where
// the per-item and per-seller reads lead with their key and browse walks a
// PRUNED table. woc_market_sales is keep-forever, so if that ever bites the
// answer is the PRD's open retention question (rollups after a window), not a
// wider index; this note is that question's consumer.
//
// CONCURRENTLY, never boot DDL: woc_market_sales is keep-forever, so a
// transactional CREATE INDEX in the boot schema would hold a write-blocking
// ShareLock on the money path's insertSale for the whole scan on every
// rolling restart (the seller-index reasoning). Constants live in this
// dependency-free module because the registry evaluates its list at import.

export const WOC_MARKET_SALES_REALM_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS woc_market_sales_realm_created
  ON woc_market_sales(realm, created_at DESC, id DESC);
`;

// A CREATE INDEX CONCURRENTLY killed mid-build strands the index INVALID, and
// IF NOT EXISTS then treats that carcass as existing on every later boot, so
// the read would silently keep sequential-scanning forever. The boot
// coordinator drops the carcass before re-running the create (the seller
// index carcass note).
export const WOC_MARKET_SALES_REALM_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('woc_market_sales_realm_created')
   AND NOT i.indisvalid
`;

export const WOC_MARKET_SALES_REALM_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS woc_market_sales_realm_created';
