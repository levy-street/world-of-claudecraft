// Demand-driven TTL memo over the four admin_db reads the Activity tab bundles
// together (registrationsByDay, sessionsByDay, classDistribution,
// levelDistribution): four uncached full-table scans re-run cold on every
// request, unlike the sibling overviewCounts aggregate on the same dashboard
// (admin_overview_cache.ts). This memo bounds the bundle to one refresh per
// TTL window, shared by BOTH /admin/api/activity dispatch arms.
//
// The four reads are moderation-invariant (registration/session/class/level
// counts never change from a ban, suspend, mute, or report action), so this
// cache carries no bust wire: the same TTL-only shape as overviewCounts.
//
// The single-flight, stale-serve, and bust semantics come from the cached_read
// primitive (server/cached_read.ts, pinned by tests/server/cached_read.test.ts);
// this module only wires it to the activity bundle at a fixed TTL.
//
// Exports registrationsByDay/sessionsByDay/classDistribution/levelDistribution
// under the SAME names and signatures admin_db.ts exports, so admin.ts can swap
// its import source for these four names with no other code change on either
// dispatch arm. All four share ONE underlying query (one Promise.all), so four
// callers reading the bundle at once (the existing Promise.all in both dispatch
// arms) collapse into a single cached refresh via createCachedRead's
// single-flight join, not four.

import {
  type BucketCount,
  type DayPoint,
  classDistribution as dbClassDistribution,
  levelDistribution as dbLevelDistribution,
  registrationsByDay as dbRegistrationsByDay,
  sessionsByDay as dbSessionsByDay,
  type SessionDayPoint,
} from './admin_db';
import { type CachedRead, createCachedRead } from './cached_read';

/** The fixed lookback window every activity chart covers. */
export const ACTIVITY_WINDOW_DAYS = 30;

/** How long one activity bundle is served before the next re-query. */
export const ADMIN_ACTIVITY_TTL_MS = 60_000;

export interface AdminActivityBundle {
  registrations: DayPoint[];
  sessions: SessionDayPoint[];
  classes: BucketCount[];
  levels: BucketCount[];
}

// The refresh + clock the singleton is built with. Production never touches
// these (the real admin_db reads and Date.now); tests inject fakes below.
let queryFn: () => Promise<AdminActivityBundle> = async () => {
  const [registrations, sessions, classes, levels] = await Promise.all([
    dbRegistrationsByDay(ACTIVITY_WINDOW_DAYS),
    dbSessionsByDay(ACTIVITY_WINDOW_DAYS),
    dbClassDistribution(),
    dbLevelDistribution(),
  ]);
  return { registrations, sessions, classes, levels };
};
let nowFn: (() => number) | undefined;

// The module-level singleton, built LAZILY on first read so a test seam
// installed before first use takes effect.
let cache: CachedRead<AdminActivityBundle> | null = null;

/** The cached activity bundle: at most one four-query refresh per TTL window. */
function readAdminActivity(): Promise<AdminActivityBundle> {
  // One bundle object is served by reference to every reader in a TTL window;
  // freeze it so no consumer can poison the shared arrays.
  cache ??= createCachedRead(async () => Object.freeze(await queryFn()), {
    ttlMs: ADMIN_ACTIVITY_TTL_MS,
    now: nowFn,
  });
  return cache.read();
}

// Every real caller passes ACTIVITY_WINDOW_DAYS (the only two call sites in the
// repo both import it from here); a mismatched days argument would otherwise
// silently serve the wrong window from the shared cache, so it throws instead.
function assertWindow(days: number): void {
  if (days !== ACTIVITY_WINDOW_DAYS) {
    throw new Error(
      `admin_activity_cache only serves the ${ACTIVITY_WINDOW_DAYS}-day window, got ${days}`,
    );
  }
}

export async function registrationsByDay(days: number): Promise<DayPoint[]> {
  assertWindow(days);
  return (await readAdminActivity()).registrations;
}

export async function sessionsByDay(days: number): Promise<SessionDayPoint[]> {
  assertWindow(days);
  return (await readAdminActivity()).sessions;
}

export async function classDistribution(): Promise<BucketCount[]> {
  return (await readAdminActivity()).classes;
}

export async function levelDistribution(): Promise<BucketCount[]> {
  return (await readAdminActivity()).levels;
}

/**
 * Inject a fake query and/or clock into the singleton (test-only). Drops the
 * current cache instance so the next read is cold under the injected fakes.
 */
export function setAdminActivityCacheForTests(opts: {
  query?: () => Promise<AdminActivityBundle>;
  now?: () => number;
}): void {
  if (opts.query) queryFn = opts.query;
  if (opts.now) nowFn = opts.now;
  cache = null;
}

/**
 * Restore the real admin_db reads + Date.now and drop the cache instance so
 * the next read is cold (test-only).
 */
export function resetAdminActivityCacheForTests(): void {
  queryFn = async () => {
    const [registrations, sessions, classes, levels] = await Promise.all([
      dbRegistrationsByDay(ACTIVITY_WINDOW_DAYS),
      dbSessionsByDay(ACTIVITY_WINDOW_DAYS),
      dbClassDistribution(),
      dbLevelDistribution(),
    ]);
    return { registrations, sessions, classes, levels };
  };
  nowFn = undefined;
  cache = null;
}
