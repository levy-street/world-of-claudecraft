import type { DailyRewardTaskSeed } from './daily_rewards_db';

// Day-scoped memo that runs the daily-reward ensureDay plus seedTasks write pair
// at most once per (day, realm, config) key, collapsing the storm of identical
// seed writes that status(), spin(), recordOnlineMinute(), the five gameplay
// event recorders, and finalizePreviousDay would otherwise each issue (one per
// online player per minute, plus one per gameplay event, plus one per 3-second
// internal poll). The key includes only the config fields the writes actually
// persist (prizePoolUsd, wocUsdPrice, and a signature of the tasks array), so a
// genuine config change forces exactly one reseed and nothing else does. It
// holds MANY keys at once: the finalize path seeds yesterday while status seeds
// today, so a single-slot cache would thrash and gate nothing.
//
// This gate protects a WRITE, not a read, so its failure semantics are load
// bearing:
//   - a key is marked seeded ONLY after its write resolves;
//   - concurrent callers for the same key share ONE in-flight write, so a burst
//     of simultaneous recordOnlineMinute calls across many online players does
//     not all pass a "not yet seeded" check and all re-issue the write;
//   - a rejected write is evicted, never cached.
// A runOnce that cached its in-flight promise unconditionally would strand the
// day: seedTasks is a BEGIN/UPDATE/INSERT/COMMIT transaction that rolls back and
// rethrows on any error (and ensureDay can throw too), so a single transient
// failure at the first status() of a new day would leave daily_reward_tasks
// unwritten and every task award returning 0 until process restart, far worse
// than the redundant writes this gate removes.
//
// Pure and DB-free: the caller passes the seed thunk; this module holds no SQL.
// The bound is a runaway backstop (in practice only the current and previous day
// times a realm are ever live); eviction just costs one extra idempotent write.
//
// Once a key is marked, out-of-band deletion or mutation of the seeded rows is
// not re-healed until a restart or a genuine config change mints a new key
// (before this gate, every event re-issued the writes and incidentally
// self-healed hand-edited tables).

const MAX_ENTRIES = 256;

// Insertion-ordered set of keys whose seed write has RESOLVED. A Set keeps
// insertion order, so the first entry is always the oldest to evict.
const seeded = new Set<string>();
// In-flight seed writes, keyed identically, so concurrent callers for one key
// share a single write instead of each re-issuing it.
const inflight = new Map<string, Promise<void>>();

interface SeedConfig {
  prizePoolUsd: number;
  wocUsdPrice: number | null;
  tasks: DailyRewardTaskSeed[];
}

// A stable, order-sensitive signature of exactly the fields seedTasks persists,
// with the same default fills seedTasks applies (basePoints ?? points,
// active ?? true, config ?? {}), so two configs that would write identical task
// rows share a key and two that would write different rows do not.
function tasksSignature(tasks: DailyRewardTaskSeed[]): unknown[] {
  return tasks.map((t) => [
    t.id,
    t.type,
    t.title,
    t.description,
    t.points,
    t.basePoints ?? t.points,
    t.sortOrder,
    t.active ?? true,
    t.config ?? {},
  ]);
}

export function buildSeedKey(day: string, realm: string, config: SeedConfig): string {
  // JSON.stringify of the tuple is an injective, collision-free key that needs
  // no field separator. Erring toward a fresh key (for example if a config
  // object's property order ever varied) only costs one extra idempotent write,
  // the safe direction; a spurious SKIP would be the unsafe one.
  return JSON.stringify([
    day,
    realm,
    config.prizePoolUsd,
    config.wocUsdPrice,
    tasksSignature(config.tasks),
  ]);
}

function markSeeded(key: string): void {
  if (seeded.has(key)) return;
  if (seeded.size >= MAX_ENTRIES) {
    const oldest = seeded.values().next().value;
    if (oldest !== undefined) seeded.delete(oldest);
  }
  seeded.add(key);
}

// Run `seed` once per key. A resolved earlier run short-circuits; a concurrent
// run joins the same in-flight write; a rejected run is evicted so the next
// caller retries.
export function runSeedOnce(key: string, seed: () => Promise<void>): Promise<void> {
  if (seeded.has(key)) return Promise.resolve();
  const existing = inflight.get(key);
  if (existing) return existing;
  // .then(seed) also converts a synchronous throw in seed into a rejection.
  const write = Promise.resolve()
    .then(seed)
    .then(() => {
      markSeeded(key);
    });
  // Evict the in-flight entry once it settles, but only AFTER a success has
  // marked the key: a concurrent caller either joins this write or sees it
  // already seeded, never re-issues it, while a rejection is evicted unmarked so
  // the next caller re-issues it.
  const tracked = write.finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, tracked);
  return tracked;
}

export function resetDailyRewardSeedGateForTests(): void {
  seeded.clear();
  inflight.clear();
}

export function dailyRewardSeedGateSizeForTests(): number {
  return seeded.size;
}
