import type { AdminGuildSort, AdminGuildSortDirection } from './admin_guilds_sort';

// This is deliberately a third cache shape beside cached_read.ts and deeds_board_warm.ts.
// Search, sort, and page create bounded key cardinality, while member-count sorting can
// aggregate every matched guild. Identical requests always share a flight; distinct cold
// reads are admitted per COST CLASS, because only the aggregating branch is what the
// admission control exists for. A single cap over both classes turned three staff (or one
// operator with three tabs) opening the plain name-sorted directory into a 503, which the
// stated rationale never justified.
export const ADMIN_GUILD_LIST_MAX_CONCURRENT_AGGREGATE_READS = 2;
export const ADMIN_GUILD_LIST_MAX_CONCURRENT_PAGE_READS = 8;
export const ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES = 64;
export const ADMIN_GUILD_LIST_CACHE_TTL_MS = 2_000;

// The member_count branch groups over every matched guild before it can page; the
// name / created_at branches page against an index first and aggregate only the page.
export type AdminGuildListReadClass = 'aggregate' | 'page';

export interface AdminGuildListRequest {
  search: string;
  page: number;
  limit: number;
  sort: AdminGuildSort;
  dir: AdminGuildSortDirection;
}

export class AdminGuildListBusyError extends Error {
  constructor() {
    super('admin guild list is busy');
    this.name = 'AdminGuildListBusyError';
  }
}

const inFlight = new Map<string, { flight: Promise<unknown>; cost: AdminGuildListReadClass }>();
const cache = new Map<string, { value: unknown; expiresAt: number }>();
let cacheEpoch = 0;

export function normalizeAdminGuildSearch(search: string): string {
  return search.trim().slice(0, 64);
}

export function adminGuildListReadClass(request: AdminGuildListRequest): AdminGuildListReadClass {
  return request.sort === 'member_count' ? 'aggregate' : 'page';
}

function concurrencyLimit(cost: AdminGuildListReadClass): number {
  return cost === 'aggregate'
    ? ADMIN_GUILD_LIST_MAX_CONCURRENT_AGGREGATE_READS
    : ADMIN_GUILD_LIST_MAX_CONCURRENT_PAGE_READS;
}

function inFlightCount(cost: AdminGuildListReadClass): number {
  let count = 0;
  for (const entry of inFlight.values()) if (entry.cost === cost) count += 1;
  return count;
}

function requestKey(request: AdminGuildListRequest): string {
  return JSON.stringify([
    normalizeAdminGuildSearch(request.search).toLocaleLowerCase('en-US'),
    request.page,
    request.limit,
    request.sort,
    request.dir,
  ]);
}

export async function readAdminGuildList<T>(
  request: AdminGuildListRequest,
  load: () => Promise<T>,
): Promise<T> {
  const key = requestKey(request);
  const cached = cache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.value as T;
    }
    cache.delete(key);
  }

  const epoch = cacheEpoch;
  const flightKey = `${epoch}:${key}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing.flight as Promise<T>;
  const cost = adminGuildListReadClass(request);
  if (inFlightCount(cost) >= concurrencyLimit(cost)) {
    throw new AdminGuildListBusyError();
  }

  const pending = Promise.resolve()
    .then(load)
    .then((value) => {
      if (cacheEpoch === epoch) {
        cache.delete(key);
        cache.set(key, { value, expiresAt: Date.now() + ADMIN_GUILD_LIST_CACHE_TTL_MS });
        while (cache.size > ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      }
      return value;
    });
  const entry = { flight: pending as Promise<unknown>, cost };
  inFlight.set(flightKey, entry);
  try {
    return await pending;
  } finally {
    if (inFlight.get(flightKey) === entry) inFlight.delete(flightKey);
  }
}

export function bustAdminGuildListReads(): void {
  cacheEpoch += 1;
  cache.clear();
}

export function adminGuildListCacheSizeForTests(): number {
  return cache.size;
}

export function resetAdminGuildListReadsForTests(): void {
  cacheEpoch += 1;
  inFlight.clear();
  cache.clear();
}
