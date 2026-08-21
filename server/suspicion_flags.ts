// Suspicion-flag emitters and the Flagged-view cache: the logic half over
// suspicion_flags_db.ts. Two emitters feed the store today:
//
//   1. Bot detector: each antibot tick hands the live suspicious-session list
//      to recordDetectorSuspicionFlags (a one-line hook in
//      server/game.ts runAntibotTick). Only CONFIRMED sessions persist (the
//      detector's own bar for filing an automated report); writes ride a
//      fire-and-forget FIFO (the bank_ledger.ts pattern) behind a per-account
//      re-record throttle so a confirmed session cannot hammer the table once
//      per tick.
//   2. Registration bursts: moderation_db.ts calls flagRegistrationBurst
//      beside its existing automated player_report, carrying the tripped
//      signals and the burst cohort as related accounts.
//
// The economy-watch detectors are the intended third emitter: mint flags with
// source 'economy_watch' through upsertSuspicionFlag and everything downstream
// (workflow, audit trail, admin UI) works unchanged.

import type { SuspiciousPlayer } from './bot_detector/contract';
import { type CachedRead, createCachedRead } from './cached_read';
import { severityForDetectorState, severityForRegistrationBurst } from './suspicion_flag_workflow';
import {
  SUSPICION_FLAG_DETAILS_MAX,
  type SuspicionFlagDataset,
  type SuspicionFlagUpsertInput,
  upsertSuspicionFlag,
} from './suspicion_flags_db';

// One flag per confirmed account per detector, not per evidence row: the kind
// is stable so re-confirmations dedupe onto one active flag.
export const DETECTOR_FLAG_KIND = 'session_automation';

// A confirmed session stays confirmed while it lasts, so re-record at most
// once per window per account; occurrences on the row still count each window.
export const DETECTOR_FLAG_RERECORD_MS = 5 * 60_000;

/** Compact evidence summary for the flag details column. */
export function detectorFlagDetails(player: SuspiciousPlayer): string {
  const evidence = player.evidence
    .map((e) => {
      const times = e.occurrences !== undefined && e.occurrences > 1 ? ` x${e.occurrences}` : '';
      return `${e.kind}${times}`;
    })
    .join(', ');
  const name = player.ref.name ? ` (${player.ref.name})` : '';
  return `Bot detector confirmed${name}: score ${Math.round(player.score)}; evidence: ${
    evidence || 'none'
  }`.slice(0, SUSPICION_FLAG_DETAILS_MAX);
}

/** The persistable inputs in one detector snapshot: CONFIRMED sessions only
 *  (pure; the throttle and the queue live in recordDetectorSuspicionFlags). */
export function detectorFlagInputs(
  players: readonly SuspiciousPlayer[],
): SuspicionFlagUpsertInput[] {
  const inputs: SuspicionFlagUpsertInput[] = [];
  for (const player of players) {
    if (player.state !== 'CONFIRMED') continue;
    if (!Number.isSafeInteger(player.ref.accountId) || player.ref.accountId <= 0) continue;
    inputs.push({
      accountId: player.ref.accountId,
      source: 'bot_detector',
      kind: DETECTOR_FLAG_KIND,
      severity: severityForDetectorState(player.state),
      details: detectorFlagDetails(player),
    });
  }
  return inputs;
}

// The fire-and-forget FIFO (the bank_ledger.ts recordBankOp shape): callers on
// the tick path never await; failures log and drop the one write.
let writeTail: Promise<void> = Promise.resolve();
const lastDetectorRecordAt = new Map<number, number>();

function enqueueFlagWrite(run: () => Promise<void>): void {
  writeTail = writeTail
    .then(run)
    .then(() => {
      bustSuspicionFlagCache();
    })
    .catch((err) => {
      console.error('suspicion flag write failed:', err);
    });
}

/** Drain pending flag writes (shutdown, tests). */
export function suspicionFlagsIdle(): Promise<void> {
  return writeTail.then(() => {});
}

/** Test-only: clear the per-account detector re-record throttle. */
export function resetDetectorFlagThrottleForTests(): void {
  lastDetectorRecordAt.clear();
}

/**
 * The antibot-tick hook: persist a flag for every CONFIRMED session, at most
 * once per DETECTOR_FLAG_RERECORD_MS per account. Fire-and-forget; never
 * blocks the tick.
 */
export function recordDetectorSuspicionFlags(
  players: readonly SuspiciousPlayer[],
  now: number = Date.now(),
): void {
  for (const input of detectorFlagInputs(players)) {
    const last = lastDetectorRecordAt.get(input.accountId);
    if (last !== undefined && now - last < DETECTOR_FLAG_RERECORD_MS) continue;
    lastDetectorRecordAt.set(input.accountId, now);
    enqueueFlagWrite(() => upsertSuspicionFlag(input));
  }
  // The throttle map is bounded by live confirmed sessions in practice; drop
  // entries old enough to be inert so a long-lived process never accumulates.
  if (lastDetectorRecordAt.size > 10_000) {
    for (const [accountId, at] of lastDetectorRecordAt) {
      if (now - at >= DETECTOR_FLAG_RERECORD_MS) lastDetectorRecordAt.delete(accountId);
    }
  }
}

/** The registration-burst emitter, called by moderation_db.ts beside its
 *  automated report. Fire-and-forget like the detector hook. */
export function flagRegistrationBurst(input: {
  accountId: number;
  signals: readonly string[];
  cohortAccountIds: readonly number[];
}): void {
  if (input.signals.length === 0) return;
  enqueueFlagWrite(() =>
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
