// Concurrent-index SQL for the Exchange's seller click-through read
// (salesForSeller in woc_market_db.ts, the Browse seller-history pane).
//
// WHY THIS INDEX EXISTS. The read is "a seller's most recent completed
// trades": equality on (realm, seller_name), ordered by created_at DESC,
// LIMIT-capped. The existing woc_market_sales_item index leads with item_id
// and cannot serve a seller-keyed probe, so without this index every seller
// pane open degrades to a sequential scan plus sort of the keep-forever
// sales provenance table.
//
// Not partial: exclusions (excluded = true) are rare operator voids, so the
// heap filter costs at most a handful of extra tuple visits per read, and a
// partial index would be a second structure to maintain on an insert-only
// provenance table (the woc_market_sales_item precedent).
//
// CONCURRENTLY, never boot DDL: woc_market_sales is keep-forever (no
// retention story by design), so it only grows, and a transactional CREATE
// INDEX in the boot schema would hold a write-blocking ShareLock on the
// money path's insertSale for the whole scan on every rolling restart.
// Constants live in this dependency-free module (the client_perf_indexes.ts
// precedent) because the registry (server/concurrent_indexes.ts) evaluates
// its list at import time and server/db.ts already imports the registry.

export const WOC_MARKET_SALES_SELLER_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS woc_market_sales_seller
  ON woc_market_sales(realm, seller_name, created_at DESC);
`;

// A CREATE INDEX CONCURRENTLY killed mid-build strands the index INVALID, and
// IF NOT EXISTS then treats that carcass as existing on every later boot (the
// player_metrics_db.ts carcass note), so the read would silently keep
// sequential-scanning forever. The boot coordinator drops the carcass before
// re-running the create.
export const WOC_MARKET_SALES_SELLER_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('woc_market_sales_seller')
   AND NOT i.indisvalid
`;

export const WOC_MARKET_SALES_SELLER_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS woc_market_sales_seller';
