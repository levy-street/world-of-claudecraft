// Admin market metrics: live World Market listing aggregates over the six
// Masterwrought-era supply buckets (cores, essence, patterns, produce, seeds,
// compost). The source is the sim's shared listing book (Sim.marketListings,
// injected from main.ts), never the market:<realm> world_state blob: the live
// in-process book is the truth and this process reports its OWN realm only.
// Pure derivation + a pure builder here so a Vitest drives both directly; the
// thin GET handler lives in server/admin.ts.

import { FARM_CROPS, FARM_SUPPLY_ITEM_IDS } from '../src/sim/content/farm_crops';
import { ITEMS } from '../src/sim/data';
import type { MarketListing } from '../src/sim/market';
import {
  MAKERS_EMBER_ITEM_ID,
  SUNDERED_ESSENCE_ITEM_ID,
  WYRMFALL_CORE_ITEM_ID,
} from '../src/sim/professions/masterwrought_materials';
import { type CachedRead, createCachedRead, deepFreezeSnapshot } from './cached_read';

// Fixed bucket order: the response always carries all six in this order so the
// dashboard renders a stable layout with zeros.
export const MARKET_METRICS_BUCKETS = [
  'cores',
  'essence',
  'patterns',
  'produce',
  'seeds',
  'compost',
] as const;
export type MarketMetricsBucketId = (typeof MARKET_METRICS_BUCKETS)[number];

// Every bucket is DERIVED from an exported content table or exported id
// constant, never a hand list, so a future pattern table or crop row
// self-registers here. The sets are disjoint by construction (pinned by
// tests/server/admin_market_metrics.test.ts).
//
// The essence bucket is a structural-zero tripwire, kept on purpose: both
// materials are soulbound and the market refuses soulbound at both list verbs
// and sweeps any listing whose item BECAME soulbound back to its seller
// (src/sim/market.ts reclaimSoulboundListings), so essence can never
// legitimately carry a listing. Any nonzero value here means the escrow
// invariant broke, which is exactly what an operator should see. Do not fold
// makers_ember into cores: cores is the tradable-supply signal, essence is
// the tripwire pair.
export const MARKET_METRICS_BUCKET_SETS: Readonly<
  Record<MarketMetricsBucketId, ReadonlySet<string>>
> = {
  cores: new Set([WYRMFALL_CORE_ITEM_ID]),
  essence: new Set([SUNDERED_ESSENCE_ITEM_ID, MAKERS_EMBER_ITEM_ID]),
  patterns: new Set(
    Object.values(ITEMS)
      .filter((def) => def.kind === 'recipe')
      .map((def) => def.id),
  ),
  // FARM_WITHERED_HUSK_ITEM_ID is deliberately excluded: a failure by-product,
  // neither seed nor produce.
  produce: new Set(
    Object.values(FARM_CROPS).flatMap((crop) => [crop.produceItemId, crop.fineProduceItemId]),
  ),
  seeds: new Set(Object.values(FARM_CROPS).map((crop) => crop.seedItemId)),
  compost: new Set(FARM_SUPPLY_ITEM_IDS),
};

/** The bucket this item id belongs to, or null for an untracked id. */
export function classifyMarketMetricsItem(itemId: string): MarketMetricsBucketId | null {
  for (const bucket of MARKET_METRICS_BUCKETS) {
    if (MARKET_METRICS_BUCKET_SETS[bucket].has(itemId)) return bucket;
  }
  return null;
}

export interface AdminMarketMetricsItemRow {
  itemId: string;
  // Resolved server-side from ITEMS: the admin SPA may not import src/sim, so
  // names travel as data (the AntibotConfig convention).
  name: string;
  listingCount: number;
  totalQuantity: number;
  lowestPerUnit: number;
  medianPerUnit: number;
}

export interface AdminMarketMetricsBucket {
  bucket: MarketMetricsBucketId;
  listingCount: number;
  totalQuantity: number;
  trackedItemCount: number;
  listedItemCount: number;
  items: AdminMarketMetricsItemRow[];
}

export interface AdminMarketMetrics {
  realm: string;
  buckets: AdminMarketMetricsBucket[];
}

// Whole-copper median over the per-listing per-unit prices, rounding up on an
// even split: the same never-understate stance as the per-unit ceil rule.
function medianCopper(sortedPerUnit: readonly number[]): number {
  const mid = Math.floor(sortedPerUnit.length / 2);
  if (sortedPerUnit.length % 2 === 1) return sortedPerUnit[mid];
  return Math.ceil((sortedPerUnit[mid - 1] + sortedPerUnit[mid]) / 2);
}

/**
 * Fold the live listing book into the six-bucket readout. Pure: fresh plain
 * aggregates only, no reference into the input rows. House-stock rows count as
 * real supply (the lowestListingPricePerUnit stance); unclassified item ids
 * are ignored. Per-listing per-unit price is Math.ceil(price / count), parity
 * with src/sim/market.ts lowestListingPricePerUnit.
 */
export function buildAdminMarketMetrics(
  listings: readonly MarketListing[],
  realm: string,
): AdminMarketMetrics {
  const perBucket = new Map<
    MarketMetricsBucketId,
    Map<string, { listingCount: number; totalQuantity: number; perUnit: number[] }>
  >();
  for (const bucket of MARKET_METRICS_BUCKETS) perBucket.set(bucket, new Map());
  for (const listing of listings) {
    const bucket = classifyMarketMetricsItem(listing.itemId);
    if (bucket === null) continue;
    const byItem = perBucket.get(bucket);
    if (!byItem) continue;
    let acc = byItem.get(listing.itemId);
    if (!acc) {
      acc = { listingCount: 0, totalQuantity: 0, perUnit: [] };
      byItem.set(listing.itemId, acc);
    }
    acc.listingCount += 1;
    acc.totalQuantity += listing.count;
    acc.perUnit.push(Math.ceil(listing.price / listing.count));
  }
  const buckets = MARKET_METRICS_BUCKETS.map((bucket): AdminMarketMetricsBucket => {
    const byItem = perBucket.get(bucket) ?? new Map();
    // Sorted by item id so the readout is stable across book insertion order.
    const items = [...byItem.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([itemId, acc]): AdminMarketMetricsItemRow => {
        // Loop-based min, copy-then-sort median: a spread argument list caps
        // at the engine's argument limit, and a pathologically deep one-item
        // book must degrade to slow, never throw.
        let lowestPerUnit = acc.perUnit[0];
        for (const perUnit of acc.perUnit) {
          if (perUnit < lowestPerUnit) lowestPerUnit = perUnit;
        }
        return {
          itemId,
          name: ITEMS[itemId]?.name ?? itemId,
          listingCount: acc.listingCount,
          totalQuantity: acc.totalQuantity,
          lowestPerUnit,
          medianPerUnit: medianCopper(acc.perUnit.slice().sort((a: number, b: number) => a - b)),
        };
      });
    return {
      bucket,
      listingCount: items.reduce((sum, row) => sum + row.listingCount, 0),
      totalQuantity: items.reduce((sum, row) => sum + row.totalQuantity, 0),
      trackedItemCount: MARKET_METRICS_BUCKET_SETS[bucket].size,
      listedItemCount: items.length,
      items,
    };
  });
  return { realm, buckets };
}

// The economy-oversight sibling's TTL (TOP_WEALTH_HOLDERS_TTL_MS): this read
// tracks a live in-process book, not a minute sweep, so the shorter value.
export const ADMIN_MARKET_METRICS_TTL_MS = 15_000;

// ---------------------------------------------------------------------------
// The cached read the GET /admin/api/market/metrics handler serves (the
// configureTopWealthHolders shape in server/account_wealth.ts). Deliberately
// TTL-only, never bust-wired: no moderation action changes the listing book,
// and worst-case staleness is 15s of cosmetic dashboard lag.
// ---------------------------------------------------------------------------

let metricsSource: (() => AdminMarketMetrics) | null = null;
let metricsCache: CachedRead<AdminMarketMetrics> | null = null;

/** Inject the live-book metrics build (boot wiring, or a test fake). */
export function configureAdminMarketMetrics(source: () => AdminMarketMetrics): void {
  metricsSource = source;
  metricsCache = null;
}

/** Clear the injected source and cache (test-only). */
export function resetAdminMarketMetricsForTests(): void {
  metricsSource = null;
  metricsCache = null;
}

/** The cached market metrics readout the admin route serves. */
export function readAdminMarketMetrics(): Promise<AdminMarketMetrics> {
  if (metricsSource === null) {
    throw new Error(
      'admin market metrics source is not configured; call configureAdminMarketMetrics',
    );
  }
  const source = metricsSource;
  // One snapshot object is served by reference to every reader in a TTL
  // window (and its serialized envelope is memoized on that identity by the
  // route, server/ok_response_memo.ts); freeze it WHOLE, buckets and rows
  // included, so no consumer can poison the shared readout or desync the
  // memoized bytes from the object (a shallow freeze left the rows open).
  metricsCache ??= createCachedRead(async () => deepFreezeSnapshot(source()), {
    ttlMs: ADMIN_MARKET_METRICS_TTL_MS,
  });
  return metricsCache.read();
}
