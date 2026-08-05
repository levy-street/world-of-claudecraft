// Pure (IO-free) boot-time decision logic for seeding the Source Cave from the
// GitHub contributors leaderboard. Kept separate from server/main.ts's
// startServer() (which does the actual fetch + logging + configureSourceCaveRuntime
// injection) so the roster-cap classification and the boot-timeout race can be
// unit tested without a live GitHub call or a running server.

import type { SourceCaveRosterEntry } from '../src/sim/source_cave';
import type { DevLeaderboardEntry } from '../src/world_api';

// Defaults to a generous cap (a real roster is tiny); if it's ever exceeded we
// cap defensively and the caller logs loudly rather than silently changing
// cave scale (O1).
export const SOURCE_CAVE_ROSTER_MAX = 60;

// topContributors() pages the GitHub API up to CONTRIBUTORS_MAX_PAGES times,
// each individually capped at 8s but with no overall cap, so a consistently-slow
// (not erroring) GitHub could otherwise stall the whole boot for minutes before
// server.listen() runs. This bounds how long BOOT specifically waits.
export const SOURCE_CAVE_BOOT_TIMEOUT_MS = 20_000;

export type SourceCaveBootOutcome =
  | { kind: 'placeholder'; roster: undefined }
  | { kind: 'capped'; roster: SourceCaveRosterEntry[]; totalAvailable: number; max: number }
  | { kind: 'seeded'; roster: SourceCaveRosterEntry[] };

/**
 * Classifies a fetched contributor list into the roster configureSourceCaveRuntime
 * should receive: undefined (falls back to the placeholder roster) on empty,
 * capped-and-logged on overflow, or the full mapped roster otherwise.
 */
export function classifySourceCaveRoster(
  contributors: DevLeaderboardEntry[],
  max: number = SOURCE_CAVE_ROSTER_MAX,
): SourceCaveBootOutcome {
  if (contributors.length === 0) return { kind: 'placeholder', roster: undefined };
  const mapped: SourceCaveRosterEntry[] = contributors.map((c) => ({
    login: c.login,
    mergedPrs: c.mergedPrs,
    rank: c.rank,
  }));
  if (mapped.length > max) {
    return { kind: 'capped', roster: mapped.slice(0, max), totalAvailable: mapped.length, max };
  }
  return { kind: 'seeded', roster: mapped };
}

/**
 * Waits up to timeoutMs for work to settle; resolves { timedOut: true } instead
 * of hanging forever on a slow (not erroring) upstream. work is never cancelled:
 * its own eventual resolution still populates whatever cache backs it, for the
 * next caller who awaits it directly.
 */
export async function withBootTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  const timedOut = Symbol('boot-timeout');
  const raced = await Promise.race([
    work,
    new Promise<typeof timedOut>((resolve) => {
      setTimeout(() => resolve(timedOut), timeoutMs);
    }),
  ]);
  return raced === timedOut ? { timedOut: true } : { timedOut: false, value: raced as T };
}
