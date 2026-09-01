// Lease-fence refusal counters for the OFFLINE character-blob writers (the
// Phase 18 security review's INFO on the persistence unit).
//
// Every offline writer in the tree now rides the lease-fenced
// saveOfflineCharacterState (server/db.ts, via server/offline_character_save_db.ts),
// and a fenced-out write is a deliberate no-op: the writer logs a line and
// moves on rather than clobbering a live session's state. That posture is
// right, but a log line is not something an operator can watch. A refusal
// means a durable effect (a rename's signer sweep, a reclaim's signer sweep,
// a boosted character's level column) silently did NOT land, with nothing in
// the tree to re-trigger it, so a rate of refusals is exactly the kind of
// thing a dashboard should show climbing.
//
// So each writer counts its own refusals beside the line it already writes.
// The counter is process-local and monotonic since boot (a total, never a
// gauge), matching how the metrics endpoint publishes its other counters.
// server/http/game_metrics.ts publishes them as woc_offline_fence_refusals_total,
// one series per family, reading offlineFenceRefusals() at scrape time and
// replaying the absolute totals (the same shape the bank-ledger and
// backend-cancel lifetime counters use). The TRUTH stays here: the exporter
// holds no state of its own, so a scrape can never disagree with the writers.
//
// WHAT IS COUNTED is the FENCE's refusal, the 0-row answer, and nothing else.
// A thrown save (a dead pool, a statement timeout) is a different failure with
// a different operator response (investigate the database, versus kick the
// session and retry), and it already surfaces as its own logged line; folding
// the two together would make the series unreadable in exactly the moment it
// matters. A new offline writer joins OFFLINE_FENCE_WRITERS below, never an
// ad-hoc label string at its call site.

/** The offline character-blob writers, one label per family. */
export type OfflineFenceWriter = 'rename_sweep' | 'reclaim_sweep' | 'pbe_roster';

/** The label vocabulary, in the order the readout lists it. */
export const OFFLINE_FENCE_WRITERS: readonly OfflineFenceWriter[] = [
  'rename_sweep',
  'reclaim_sweep',
  'pbe_roster',
];

const counts: Record<OfflineFenceWriter, number> = {
  rename_sweep: 0,
  reclaim_sweep: 0,
  pbe_roster: 0,
};

/** Record one lease-fence refusal (a 0-row fenced UPDATE) for `writer`. */
export function countOfflineFenceRefusal(writer: OfflineFenceWriter): void {
  counts[writer] += 1;
}

/** Refusals per writer family since boot. A copy, so a reader cannot move the
 *  live counters by editing what it was handed. */
export function offlineFenceRefusals(): Record<OfflineFenceWriter, number> {
  return { ...counts };
}

/** Test-only: clear every family so one suite's counts never reach the next. */
export function resetOfflineFenceRefusalsForTests(): void {
  for (const writer of OFFLINE_FENCE_WRITERS) counts[writer] = 0;
}
