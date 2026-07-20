// One-way in-process memo of which (day, realm) reward days have already been
// finalized, so finalizePreviousDay can short-circuit its ensureActiveDay plus
// finalizeDay work on the hot 3-second internal poll (the Discord winners poll
// and the external payout service both hit it). Finalization is monotonic: once
// daily_reward_days.finalized_at is stamped it never clears, so a bounded
// evict-oldest map is safe here. A miss (an evicted or never-recorded key) costs
// only one cheap primary-key read against daily_reward_days plus, at most, one
// redundant idempotent finalizeDay call, so concurrent callers that both miss
// for the SAME (day, realm) are intentionally NOT deduped in flight: the race
// just pays that one extra read and one idempotent finalize, cheaper than the
// machinery to dedupe it. This is unlike the seed gate, which protects a write
// transaction and therefore must dedupe and must not cache a failure.
//
// Pure and DB-free by design: this module holds no SQL and imports nothing from
// the db or realm layers, so a Vitest drives it directly and the caller supplies
// the realm. The bound is only a runaway backstop; in practice at most a handful
// of (day, realm) pairs are ever live.
//
// One-way also means ops surgery is invisible to a running process: nothing ever
// re-reads a recorded key, so hand-clearing finalized_at (or deleting the day
// row) to force a re-finalize takes effect only after a process restart.

const MAX_ENTRIES = 64;

// Insertion-ordered set of finalized (day, realm) keys. A Set keeps insertion
// order, so the first entry is always the oldest to evict. JSON.stringify of the
// pair is an injective, collision-free key that needs no field separator.
const finalized = new Set<string>();

function keyOf(day: string, realm: string): string {
  return JSON.stringify([day, realm]);
}

export function hasFinalized(day: string, realm: string): boolean {
  return finalized.has(keyOf(day, realm));
}

export function recordFinalized(day: string, realm: string): void {
  const key = keyOf(day, realm);
  if (finalized.has(key)) return;
  if (finalized.size >= MAX_ENTRIES) {
    const oldest = finalized.values().next().value;
    if (oldest !== undefined) finalized.delete(oldest);
  }
  finalized.add(key);
}

export function resetDailyFinalizeGuardForTests(): void {
  finalized.clear();
}

export function dailyFinalizeGuardSizeForTests(): number {
  return finalized.size;
}
