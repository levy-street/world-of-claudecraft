// The housing persistence store's counters, as a scrape reads them: moved out
// of server/freehold_persist.ts (its monolith ceiling), which re-exports the
// type so every importer's contract point is unchanged. Counts, bytes and
// milliseconds only, never player identity.

import { type FreeholdJoinVerdict, freeholdJoinVerdictCounts } from './freehold_join_answer';
import type { FreeholdPersistEntry } from './freehold_persist_types';

/** Scrape-safe counters. COUNTS, BYTE TOTALS AND MILLISECOND TOTALS ONLY: no
 *  owner key, no account id, no plot id ever appears here, because these are
 *  read by an operator dashboard and a metrics endpoint that are not entitled
 *  to player identity. */
export interface FreeholdPersistStats {
  /** EVERY entry the store holds, including the reference-only placeholders a
   *  join creates before any read. On a dark realm that is one per online
   *  account and nothing else, so this measure alone must never be read as
   *  "records this realm is persisting": `loaded` is that number. */
  readonly entries: number;
  /** Entries that have finished a durable read, and so the only ones that can
   *  write. Zero on a dark realm however many entries exist. */
  readonly loaded: number;
  readonly dirty: number;
  readonly running: number;
  readonly pending: number;
  /** Entries held by ANY recovery hold, DATA or CAPACITY. A row this build could
   *  not interpret is one cause; a full local admission cap, a missing
   *  background permit and a thrown read are the others, and they mean opposite
   *  things to an operator. Read `loadFailuresByKind` to tell them apart. */
  readonly held: number;
  /** Entries quiesced by an answer no repeat of the same payload can fix. Only
   *  the first producer is the compare-and-swap fence: a stale CAS, a missing or
   *  conflicting row, the seal refusing a record this entry did not load, the
   *  unnamed-insert refusal, and the writable-implies-readable refusal (a run of
   *  thrown writes is `retrying` since R1, never this). Read it against `staleWrites` and
   *  `writeFailures` rather than alone, because only `staleWrites` means a
   *  second writer is touching these rows. Kept apart from `held` because the
   *  two are counted independently and must never be summed. */
  readonly quiesced: number;
  /** Entries on the THROWN-RUN RETRY CLOCK (R1, server/freehold_write_retry.ts):
   *  a run of thrown writes, kept rather than quiesced, each holding its owner's
   *  unwritten edits and retried once per error window until one commits. A
   *  sustained value is a database outage, not a data incident, and a restart
   *  during it ends those edits after one last attempt at the drain. */
  readonly retrying: number;
  /** The share of `retrying` with no session left: each holds up to TWO full
   *  records (its committed state and its leave capture) that a quiesce used to
   *  free, so this is the gauge the posture's memory bound is read from. */
  readonly retryingOffline: number;
  readonly loads: number;
  readonly loadFailures: number;
  /** The same total, split by the hold kind that caused it. */
  readonly loadFailuresByKind: Readonly<Record<string, number>>;
  readonly writes: number;
  readonly writeFailures: number;
  readonly staleWrites: number;
  /** Writes refused because this realm no longer holds the plot's global claim
   *  (07a): another realm took it over, so the owner is quiesced. Like
   *  `staleWrites` it means a second writer exists, but one the fence named. */
  readonly fencedWrites: number;
  readonly permitWaitMsTotal: number;
  readonly queueWaitMsTotal: number;
  readonly writeMsTotal: number;
  /** Serialization, cloning and the write refusal's own walk: the synchronous
   *  work between the permit and the statement, which `write_ms` deliberately
   *  does not bracket. */
  readonly codecMsTotal: number;
  readonly loadMsTotal: number;
  readonly oldestDirtyAgeMs: number;
  readonly writeBytesTotal: number;
  readonly maxWriteBytes: number;
  /** Writes that held a background permit with no document to send. No
   *  statement is issued: the arm returns before the row is ever touched. The
   *  terminal state of every lost-save path this store has had. */
  readonly writesWithoutRecord: number;
  /** Statements issued from the retry clock, so its rate against `retrying`
   *  shows the one-per-owner-per-window cadence. */
  readonly writeRetries: number;
  /** Oversize refusals taken on the ON-DISK pre-gate, where no text length was
   *  measured, as opposed to the measured byte bound. */
  readonly preGateRefusals: number;
  /** Owners whose write is waiting on the store's own admission cap rather than
   *  on the shared gate. The cap's whole claim is that the surplus waits in a
   *  bounded set this store owns, and an unobservable set is an unfalsifiable
   *  claim. */
  readonly deferredWrites: number;
  /** Retry-clock writes waiting on their sub-cap (R1), apart from
   *  `deferredWrites`, which stays the ordinary backlog: a slow outage keeps
   *  this non-zero by design, and must not read as healthy owners saturating
   *  the store's own cap. */
  readonly deferredRetries: number;
  readonly activeWrites: number;
  /** Documents captured at leave and not yet written: a second full record each
   *  on top of the entry's own, retained until the write lands. */
  readonly leaveCaptures: number;
  /** Ruling (b)'s re-asks: the handshake's second ask, after the character
   *  lease. `reaskReads` are those that waited on the durable path (a read, a
   *  shared single-flight read, or a permit wait) rather than replaying a loaded
   *  entry, which is housing wait inside the lease-held window; a cap refusal
   *  waits on nothing and is not counted, and a read is booked when it settles
   *  (for a re-ask refused on its budget, when the abandoned read lands, which
   *  the permit wait, the statement bound and the driver's query timeout
   *  guarantee). `reaskMsTotal` is the re-asks' summed wall time, bounded per
   *  handshake by what the first ask left of FREEHOLD_PERSIST_LOGIN_BUDGET_MS. */
  readonly reasks: number;
  readonly reaskReads: number;
  readonly reaskMsTotal: number;
  /** How each join's install was decided (server/freehold_join_answer.ts):
   *  `entry` is a join whose install changed nothing (the ask matched the
   *  loaded entry, a live record already stood beside a loaded entry, or both
   *  asks replayed one DATA hold), so it tracks login volume; `superseded` is
   *  the loaded entry installed in place of an ask that differed from it with
   *  no live record standing, the twelfth path's fix actually changing an
   *  install; `withheld` is a join nothing could vouch for, installed as no
   *  record (write-blocked when nothing live stands; beside a live record it
   *  shares that record). */
  readonly joinVerdicts: Readonly<Record<FreeholdJoinVerdict, number>>;
}

/** The store's cumulative counters, mutated in place by
 *  server/freehold_persist.ts and published whole by freeholdPersistStatsOf. */
export function createFreeholdPersistCounters() {
  return {
    loads: 0,
    loadFailures: 0,
    loadFailuresByKind: {} as Record<string, number>,
    writes: 0,
    writeFailures: 0,
    staleWrites: 0,
    fencedWrites: 0,
    permitWaitMsTotal: 0,
    queueWaitMsTotal: 0,
    // The two durations the wait totals deliberately exclude: a durable write
    // that has become slow is pinning a gate permit AND a pool client, and
    // without these it is visible only indirectly, as OTHER work's waits rising.
    writeMsTotal: 0,
    // The CODEC, beside the statement rather than inside it. Every save
    // serializes the document twice (once for the refusal's byte measure and
    // once for the two content columns) and clones it twice before that, and
    // none of it reached a counter while `write_ms` bracketed only the
    // statement. Measured at 0.198 ms per save at the 420-row ceiling, of which
    // the refusal walk is 74 percent, and it is UNYIELDING synchronous time
    // between the permit and the statement, so it escapes the tick profiler's
    // save lap as well.
    codecMsTotal: 0,
    loadMsTotal: 0,
    // A TOTAL plus a high-water mark rather than a last-sample gauge: at a
    // thousand owners a scrape samples one arbitrary write, which says nothing
    // about the size distribution or about growth toward the byte ceiling.
    writeBytesTotal: 0,
    maxWriteBytes: 0,
    // The terminal state of every lost-save path: a write that held a permit
    // with no document to send, and issued no statement at all. It used to be
    // silent, which is why three separate versions of that bug had to be found
    // by reading rather than by watching.
    writesWithoutRecord: 0,
    // Which arm of the oversize refusal fired. The on-disk pre-gate and the
    // measured byte bound mean different things to an operator: one says the
    // row was too big to even look at, the other says it was measured and
    // refused.
    preGateRefusals: 0,
    // Ruling (b)'s second ask and the install it feeds (the stats doc above).
    reasks: 0,
    reaskReads: 0,
    reaskMsTotal: 0,
    joinVerdicts: freeholdJoinVerdictCounts(),
    // R1: statements issued from the thrown-run retry clock.
    writeRetries: 0,
  };
}

export type FreeholdPersistCounters = ReturnType<typeof createFreeholdPersistCounters>;

/** What the store folds from its entries and its own gauges on each scrape. */
export type FreeholdPersistOccupancy = Omit<FreeholdPersistStats, keyof FreeholdPersistCounters>;

/** The entry half of a scrape's occupancy, counted in ONE walk of the store's
 *  map (moved whole out of the store's stats(), which keeps only its own
 *  private sizes). The store hands in its OWN dirty and held predicates, so the
 *  census can never disagree with what the store acts on, and its clock, read
 *  only when some entry is dirty, as before. */
export function censusFreeholdEntries(
  entries: Iterable<FreeholdPersistEntry>,
  isDirty: (entry: FreeholdPersistEntry) => boolean,
  isHeld: (entry: FreeholdPersistEntry) => boolean,
  nowMs: () => number,
): Pick<
  FreeholdPersistOccupancy,
  | 'loaded'
  | 'dirty'
  | 'running'
  | 'pending'
  | 'held'
  | 'quiesced'
  | 'retrying'
  | 'retryingOffline'
  | 'oldestDirtyAgeMs'
> {
  let dirty = 0;
  let running = 0;
  let pending = 0;
  let held = 0;
  let quiesced = 0;
  let retrying = 0;
  let retryingOffline = 0;
  let loaded = 0;
  let oldestDirtyAtMs = 0;
  for (const entry of entries) {
    if (isDirty(entry)) dirty++;
    if (entry.running) running++;
    if (entry.pending) pending++;
    if (entry.hold !== null) held++;
    if (entry.quiesced) quiesced++;
    // On the clock and still writing (a later quiesce ends the posture); the
    // offline share holds up to TWO records each (its state and its capture).
    if (entry.retryAtMs > 0 && !isHeld(entry)) {
      retrying++;
      if (entry.refs === 0) retryingOffline++;
    }
    if (entry.loaded) loaded++;
    if (entry.dirtySinceMs > 0 && (oldestDirtyAtMs === 0 || entry.dirtySinceMs < oldestDirtyAtMs)) {
      oldestDirtyAtMs = entry.dirtySinceMs;
    }
  }
  const oldestDirtyAgeMs = oldestDirtyAtMs === 0 ? 0 : Math.max(0, nowMs() - oldestDirtyAtMs);
  return {
    loaded,
    dirty,
    running,
    pending,
    held,
    quiesced,
    retrying,
    retryingOffline,
    oldestDirtyAgeMs,
  };
}

/** One scrape: the occupancy plus a COPY of every counter, the two record
 *  measures cloned so a caller can never reach the store's live ones. */
export function freeholdPersistStatsOf(
  occupancy: FreeholdPersistOccupancy,
  counters: FreeholdPersistCounters,
): FreeholdPersistStats {
  return {
    ...occupancy,
    ...counters,
    loadFailuresByKind: { ...counters.loadFailuresByKind },
    joinVerdicts: { ...counters.joinVerdicts },
  };
}
