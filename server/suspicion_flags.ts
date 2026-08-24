// Suspicion-flag emitters and the Flagged-view cache: the logic half over
// suspicion_flags_db.ts. Two emitters feed the store today:
//
//   1. Bot detector: the detector PUSHES at its own decision points through
//      the BotDetectorHost it is handed at boot (attachDetectorFlagHost, one
//      line in server/game.ts). It records a case when it decides one, and
//      refreshes the case's details when the evidence behind it grows; nothing
//      here polls or samples detector state, so occurrences counts decisions
//      and last_seen_at is a real observation time. Storage policy, including
//      the write cadence, stays on this side of the seam: the detector build
//      is bundled independently, so refreshes are paced and coalesced per
//      account here rather than trusted to the detector's own pacing. Writes
//      ride a fire-and-forget FIFO (the bank_ledger.ts pattern).
//   2. Registration bursts: moderation_db.ts calls flagRegistrationBurst
//      beside its existing automated player_report, carrying the tripped
//      signals and the burst cohort as related accounts.
//
// The economy-watch detectors are the intended third emitter: mint flags with
// source 'economy_watch' through upsertSuspicionFlag and everything downstream
// (workflow, audit trail, admin UI) works unchanged.

import type {
  BotDetector,
  BotDetectorHost,
  SuspicionFlagObservation,
} from './bot_detector/contract';
import { type CachedRead, createCachedRead } from './cached_read';
import { DETECTOR_FLAG_SEVERITY, severityForRegistrationBurst } from './suspicion_flag_workflow';
import {
  refreshSuspicionFlagDetails as refreshFlagDetailsSql,
  SUSPICION_FLAG_DETAILS_MAX,
  type SuspicionFlagDataset,
  upsertSuspicionFlag,
} from './suspicion_flags_db';

// One flag per account per detector, not per evidence row: the kind is stable
// so repeat decisions bump one active flag instead of stacking rows.
export const DETECTOR_FLAG_KIND = 'session_automation';

// The per-account floor between two details refreshes. Sits under the
// detector's own pacing (it refreshes at most every 30 s per case), so a
// well-behaved detector never hits it; a runaway one is capped at one indexed
// UPDATE per account per window, and its latest summary still lands on the
// next accepted refresh (every summary is the whole evidence list, not a
// delta). A queued refresh for the same account is replaced, latest wins, so
// a slow database never stacks duplicate rewrites.
export const DETECTOR_FLAG_REFRESH_FLOOR_MS = 10_000;

// The same guard on decisions. Legitimate records for one account are at
// least a sync interval apart (the initial decision, then escalations on the
// detector's 30 s pacing), so this floor only ever bites a runaway build; a
// decision it drops within the window is one occurrence bump folded into the
// previous one, never a lost case (the active flag already exists and the
// next accepted write carries the full summary).
export const DETECTOR_FLAG_RECORD_FLOOR_MS = 5_000;

// The fire-and-forget FIFO (the bank_ledger.ts recordBankOp shape): callers on
// the tick path never await; failures log and drop the one write. Each write
// also resolves its own outcome for a caller that wants it (the detector host
// hands it back to the detector so a lost write can be retried). The Flagged
// view cache busts only for writes that change the flag SET (a record, a
// burst); a details refresh does bump last_seen_at and with it the queue
// order, but 15 s of stale ordering is exactly what the TTL is defined to
// tolerate, and busting per refresh would defeat the cache with a handful of
// live confirmed sessions.
let writeTail: Promise<void> = Promise.resolve();

function enqueueFlagWrite(run: () => Promise<void>, bust: boolean): Promise<boolean> {
  const landed = writeTail.then(run).then(
    () => {
      if (bust) bustSuspicionFlagCache();
      return true;
    },
    (err) => {
      console.error('suspicion flag write failed:', err);
      return false;
    },
  );
  writeTail = landed.then(() => {});
  return landed;
}

/** Drain pending flag writes (shutdown, tests). */
export function suspicionFlagsIdle(): Promise<void> {
  return writeTail.then(() => {});
}

function validObservation(observation: SuspicionFlagObservation): boolean {
  return (
    Number.isSafeInteger(observation.accountId) &&
    observation.accountId > 0 &&
    // A malformed detector build must not burn the account's floor slot on a
    // write that can only throw inside the queue.
    typeof observation.details === 'string'
  );
}

/** One write-per-account floor with a bounded memory of who wrote when.
 *  Exported for its own unit tests: the pruning has no behavioral effect (a
 *  stale entry no longer blocks anyone), only a memory bound, so only size()
 *  can pin it. */
export interface AccountWriteFloor {
  /** True when accountId may write at `at`; false inside the floor window. */
  accept(accountId: number, at: number): boolean;
  /** Release the slot accept() took: the write it guarded did not land, so a
   *  retry must be admitted however fast it arrives. */
  forget(accountId: number): void;
  size(): number;
}

export function createAccountWriteFloor(floorMs: number): AccountWriteFloor {
  const lastAt = new Map<number, number>();
  return {
    forget(accountId) {
      lastAt.delete(accountId);
    },
    accept(accountId, at) {
      const last = lastAt.get(accountId);
      if (last !== undefined && at - last < floorMs) return false;
      lastAt.set(accountId, at);
      // Bounded by live confirmed sessions in practice; drop entries old
      // enough to be inert so a long-lived process never accumulates.
      if (lastAt.size > 10_000) {
        for (const [id, ts] of lastAt) {
          if (at - ts >= floorMs) lastAt.delete(id);
        }
      }
      return true;
    },
    size: () => lastAt.size,
  };
}

interface PendingWrite {
  details: string;
  landed: Promise<boolean>;
}

/**
 * The host the detector pushes through. Storage policy stays here: source,
 * kind, severity, dedupe (the active partial index), the details cap, and the
 * write cadence for BOTH calls (the floors above, plus per-account coalescing
 * while a write is queued). The detector supplies the decision and its own
 * evidence summary, nothing else.
 */
export function createDetectorFlagHost(now: () => number = () => Date.now()): BotDetectorHost {
  const recordFloor = createAccountWriteFloor(DETECTOR_FLAG_RECORD_FLOOR_MS);
  const refreshFloor = createAccountWriteFloor(DETECTOR_FLAG_REFRESH_FLOOR_MS);
  const pendingRecord = new Map<number, PendingWrite>();
  const pendingRefresh = new Map<number, PendingWrite>();
  return {
    recordSuspicionFlag(observation) {
      if (!validObservation(observation)) return Promise.resolve(false);
      const accountId = observation.accountId;
      const queued = pendingRecord.get(accountId);
      if (queued) {
        queued.details = observation.details;
        return queued.landed;
      }
      if (!recordFloor.accept(accountId, now())) return Promise.resolve(true);
      const pending: PendingWrite = {
        details: observation.details,
        landed: Promise.resolve(true),
      };
      pendingRecord.set(accountId, pending);
      // A lost write releases the floor slot before the caller sees false: a
      // record is the write that mints the case, so a retry inside the window
      // must write, not be acknowledged against a row that does not exist.
      pending.landed = enqueueFlagWrite(async () => {
        pendingRecord.delete(accountId);
        await upsertSuspicionFlag({
          accountId,
          source: 'bot_detector',
          kind: DETECTOR_FLAG_KIND,
          severity: DETECTOR_FLAG_SEVERITY,
          details: pending.details.slice(0, SUSPICION_FLAG_DETAILS_MAX),
        });
      }, true).then((landed) => {
        if (!landed) recordFloor.forget(accountId);
        return landed;
      });
      return pending.landed;
    },
    refreshSuspicionFlagDetails(observation) {
      if (!validObservation(observation)) return Promise.resolve(false);
      const accountId = observation.accountId;
      const queued = pendingRefresh.get(accountId);
      if (queued) {
        queued.details = observation.details;
        return queued.landed;
      }
      if (!refreshFloor.accept(accountId, now())) return Promise.resolve(true);
      const pending: PendingWrite = {
        details: observation.details,
        landed: Promise.resolve(true),
      };
      pendingRefresh.set(accountId, pending);
      // Deleted BEFORE the awaited write, not after: a refresh arriving while
      // this one is mid-flight must queue its newer summary, not fold into a
      // write whose details are already on the wire. And a lost write releases
      // the floor slot (the record path's rule, kept symmetric) so a retry is
      // admitted however fast it arrives.
      pending.landed = enqueueFlagWrite(async () => {
        pendingRefresh.delete(accountId);
        await refreshFlagDetailsSql({
          accountId,
          source: 'bot_detector',
          kind: DETECTOR_FLAG_KIND,
          details: pending.details.slice(0, SUSPICION_FLAG_DETAILS_MAX),
        });
      }, false).then((landed) => {
        if (!landed) refreshFloor.forget(accountId);
        return landed;
      });
      return pending.landed;
    },
  };
}

/**
 * Boot wiring: hand the detector its host if this detector build accepts one.
 * Returns whether it did, and says so on the console either way, so an
 * operator reading the boot log knows where automated cases land (Flagged, or
 * the Reports inbox the detector falls back to without a host).
 */
export function attachDetectorFlagHost(
  detector: BotDetector,
  log: (line: string) => void = (line) => console.log(line),
): boolean {
  if (typeof detector.attachHost !== 'function') {
    log('[bot-detector] suspicion-flag host: not accepted by this detector build');
    return false;
  }
  detector.attachHost(createDetectorFlagHost());
  log('[bot-detector] suspicion-flag host: attached');
  return true;
}

/** The registration-burst emitter, called by moderation_db.ts beside its
 *  automated report. Fire-and-forget like the detector hook. */
export function flagRegistrationBurst(input: {
  accountId: number;
  signals: readonly string[];
  cohortAccountIds: readonly number[];
}): void {
  if (input.signals.length === 0) return;
  enqueueFlagWrite(
    () =>
      upsertSuspicionFlag({
        accountId: input.accountId,
        source: 'registration_burst',
        kind: 'registration_burst',
        severity: severityForRegistrationBurst(input.signals.length),
        details: `Automated registration pattern: ${input.signals.join('; ')}`.slice(
          0,
          SUSPICION_FLAG_DETAILS_MAX,
        ),
        relatedAccountIds: input.cohortAccountIds,
      }),
    true,
  );
}

// ---------------------------------------------------------------------------
// The Flagged-view cache: single-key, single-flight, short TTL, bust-wired to
// every flag write (emitter upserts above, workflow transitions and notes via
// bustSuspicionFlagCache from the admin handlers).
// ---------------------------------------------------------------------------

export const SUSPICION_FLAG_LIST_TTL_MS = 15_000;

let datasetSource: (() => Promise<SuspicionFlagDataset>) | null = null;
let datasetCache: CachedRead<SuspicionFlagDataset> | null = null;

/** Inject the dataset SQL read (boot wiring, or a test fake). */
export function configureSuspicionFlagDataset(source: () => Promise<SuspicionFlagDataset>): void {
  datasetSource = source;
  datasetCache = null;
}

/** Clear the injected source and cache (test-only). */
export function resetSuspicionFlagDatasetForTests(): void {
  datasetSource = null;
  datasetCache = null;
}

/** The cached Flagged-view dataset both admin dispatch arms read. */
export function readSuspicionFlagDataset(): Promise<SuspicionFlagDataset> {
  if (datasetSource === null) {
    throw new Error(
      'suspicion flag dataset source is not configured; call configureSuspicionFlagDataset',
    );
  }
  const source = datasetSource;
  datasetCache ??= createCachedRead(() => source(), { ttlMs: SUSPICION_FLAG_LIST_TTL_MS });
  return datasetCache.read();
}

/** Bust the Flagged-view cache; wired to every flag write so an admin's
 *  transition or a fresh detection is visible on the next read. */
export function bustSuspicionFlagCache(): void {
  datasetCache?.bust();
}
