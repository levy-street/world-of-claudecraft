// Public read of the limited-relic mint ledger: GET /api/limited-mints. A hot
// vanity endpoint (external sites, the burn-tracker-style pages), so it is
// anonymous, in-handler rate-limited, and served from a short in-process cache
// rather than hitting Postgres per request.
//
// Module-first split (server/CLAUDE.md): the SQL lives in limited_supply_db.ts;
// this module carries only the pure response builder, the cache, and a thin Ctx
// handler. The ledger reader is INJECTED at boot via configureLimitedRuntime so
// `export const routes` stays a static array the registry can spread without a
// cycle back to the pool.

import { ITEMS } from '../src/sim/data';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import type { LimitedMintsSnapshot } from './limited_supply_db';
import { publicReadRateLimited } from './ratelimit';

interface LimitedRuntime {
  // Reads the raw cross-realm ledger snapshot (counts + confirmed mints).
  readMints(): Promise<LimitedMintsSnapshot>;
  // Monotonic wall clock (ms), injected so the cache is testable without the
  // global clock (matches the leaderboard runtime injection).
  now(): number;
}

let runtime: LimitedRuntime | null = null;

export function configureLimitedRuntime(rt: LimitedRuntime): void {
  runtime = rt;
}

function useRuntime(): LimitedRuntime {
  if (!runtime) {
    throw new Error('limited runtime is not configured; call configureLimitedRuntime');
  }
  return runtime;
}

// One item's public row: the cap, how many are confirmed minted, how many can
// still ever appear (supply minus minted minus in-flight leases), and the roll of
// every confirmed serial with its holder.
interface LimitedItemView {
  itemId: string;
  name: string;
  quality: string;
  supply: number;
  minted: number;
  remaining: number;
  mints: { serial: number; characterName: string | null; realm: string; mintedAt: string }[];
}

// Pure snapshot -> response builder. Enriches each supply row with the item's
// English name + quality from the content catalog (this is a public data API, not
// the localized game client), buckets the confirmed mints by item, and sorts each
// item's mints by serial. Items with no supply row are skipped.
export function buildLimitedMintsResponse(snapshot: LimitedMintsSnapshot): {
  items: LimitedItemView[];
} {
  const mintsByItem = new Map<string, LimitedItemView['mints']>();
  for (const m of snapshot.mints) {
    const list = mintsByItem.get(m.itemId) ?? [];
    list.push({
      serial: m.serial,
      characterName: m.characterName,
      realm: m.realm,
      mintedAt: m.mintedAt,
    });
    mintsByItem.set(m.itemId, list);
  }
  const items: LimitedItemView[] = [];
  for (const row of snapshot.supplies) {
    const def = ITEMS[row.itemId];
    const mints = (mintsByItem.get(row.itemId) ?? []).sort((a, b) => a.serial - b.serial);
    items.push({
      itemId: row.itemId,
      name: def?.name ?? row.itemId,
      quality: def?.quality ?? 'epic',
      supply: row.supply,
      minted: row.minted,
      remaining: Math.max(0, row.supply - row.minted - row.leased),
      mints,
    });
  }
  items.sort((a, b) => a.itemId.localeCompare(b.itemId));
  return { items };
}

// Short in-process cache: the ledger changes only on a mint (minutes to hours
// apart), so a 30 s TTL keeps the hot vanity endpoint off Postgres without ever
// showing a stale-by-more-than-a-glance number.
const CACHE_TTL_MS = 30_000;
let cache: { at: number; body: { items: LimitedItemView[] } } | null = null;

async function readCached(rt: LimitedRuntime): Promise<{ items: LimitedItemView[] }> {
  const nowMs = rt.now();
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.body;
  const body = buildLimitedMintsResponse(await rt.readMints());
  cache = { at: nowMs, body };
  return body;
}

// Test seam: drop the memoized snapshot so a suite sees a fresh read.
export function resetLimitedMintsCache(): void {
  cache = null;
}

async function limitedMintsHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate_limited' });
    return;
  }
  const body = await readCached(useRuntime());
  json(ctx.res, 200, body);
}

export const routes: RouteDef[] = [
  { method: 'GET', path: '/api/limited-mints', surface: 'api', handler: limitedMintsHandler },
];
