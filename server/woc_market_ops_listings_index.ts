// Concurrent-index SQL for the internal dashboard's Sold and Cancelled
// exchange-listing filters (PgWocMarketDb.opsListings).
//
// The read is equality on realm and resolution, bounded by created_at and
// ordered by created_at DESC, id DESC. Public listings only: directed rows
// belong to the P2P view. Closed listings have configurable retention, and a
// zero retention setting keeps them forever, so a result LIMIT alone cannot
// bound the scan or sort work.
//
// CONCURRENTLY, never boot DDL: this is a live table. A transactional index
// build during a rolling restart would block listing lifecycle writes for the
// duration of the retained-history scan.

export const WOC_MARKET_OPS_CLOSED_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS woc_market_ops_closed_created
  ON woc_market_listings(realm, resolution, created_at DESC, id DESC)
  WHERE directed_buyer_account IS NULL AND status = 'closed';
`;

// IF NOT EXISTS accepts an invalid carcass left by an interrupted concurrent
// build, so the boot migration repairs it before trying the create again.
export const WOC_MARKET_OPS_CLOSED_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('woc_market_ops_closed_created')
   AND NOT i.indisvalid
`;

export const WOC_MARKET_OPS_CLOSED_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS woc_market_ops_closed_created';
