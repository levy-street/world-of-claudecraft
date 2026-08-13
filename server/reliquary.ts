// Reliquary API surface: the global population-rarity aggregate (anonymous
// public read). Mirrors the deeds rarity rung in server/deeds.ts exactly: a
// static `routes` array, a configureReliquaryRuntime injection so the handler
// can reach the main.ts TTL cache without an import cycle
// (main -> registry -> reliquary -> main), and publicReadRateLimited
// in-handler. Registry-only: no legacy-ladder twin, by design.

import type { ReliquaryRarity } from '../src/world_api';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';

/**
 * The main.ts-owned runtime the rarity handler depends on but cannot import
 * without a cycle: the cache-fronted rarity read. The read shares the deeds
 * rarity cache entry, TTL, and single flight (see the deedsRarityCache block
 * in main.ts), so this endpoint never gives the characters walk a second
 * cadence.
 */
export interface ReliquaryRuntime {
  reliquaryRarity(): Promise<ReliquaryRarity>;
}

let runtime: ReliquaryRuntime | null = null;

/** Inject the main.ts runtime the handler needs. Called once at boot. */
export function configureReliquaryRuntime(rt: ReliquaryRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetReliquaryRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): ReliquaryRuntime {
  if (runtime === null) {
    throw new Error('reliquary runtime is not configured; call configureReliquaryRuntime');
  }
  return runtime;
}

/**
 * GET /api/reliquary/rarity: the global relic population-rarity aggregate,
 * `{ totalEligible, found: { [relicId]: count }, illuminated: { [pageId]:
 * count } }` with zero-count ids absent. Anonymous and cache-backed (the
 * relic catalog is public data-as-code the /wiki already publishes, and the
 * counts are population aggregates), so it takes the same per-IP public-read
 * budget the sheet and search use (in-handler, keeping the 429 body shape
 * those routes established).
 */
async function rarityHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  json(ctx.res, 200, await useRuntime().reliquaryRarity());
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/reliquary/rarity',
    surface: 'api',
    handler: rarityHandler,
  },
];
