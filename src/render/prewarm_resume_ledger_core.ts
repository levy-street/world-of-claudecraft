// What actually happened to the prewarm entries the entry deadline dropped.
//
// The manifest pass already reports a per-entry status (completed, partial,
// skipped, timed-out, failed) and that status reaches the perf report. What it
// cannot say is the half that happens AFTER the pass returns: a dropped entry
// hands its small units to the resume lane, which is fire-and-forget, and
// whether those units ever ran lives only in two console lines. So a report can
// show `vfx.weapon-skins` as `timed-out` and be unable to say whether the
// world-side weapon protection exists a minute into play or not at all, which
// is exactly the question the Armory investigation kept failing to answer.
//
// This ledger is the missing half. It is deliberately an OBSERVER: it changes
// no ordering, no priority, and no unit, and every entry point takes the facts
// rather than reading a clock or a queue.
//
// `started` counts units the lane HANDED to the GPU queue, not units that
// finished, because the lane's own hook fires at hand-off. A unit that is
// started and not failed settled or is still settling; the pair (started,
// failed) against `planned` is what says whether the lane drained.

export interface PrewarmResumeUnitRef {
  id: string;
}

export interface PrewarmResumeEntryRef {
  id: string;
  units: readonly PrewarmResumeUnitRef[];
}

/** `none` means nothing was dropped, which is a different fact from `done`. */
export type PrewarmResumeStatus = 'none' | 'scheduled' | 'done' | 'failed';

export interface PrewarmResumeEntryOutcome {
  id: string;
  /** Which lane the entry's units ran in: link/upload debt outranks cosmetic
   *  resume, and a starved cosmetic entry reads very differently from a starved
   *  debt one. */
  lane: 'debt' | 'cosmetic';
  planned: number;
  started: number;
  failed: number;
}

export interface PrewarmResumeStats {
  status: PrewarmResumeStatus;
  plannedEntries: number;
  plannedUnits: number;
  startedUnits: number;
  failedUnits: number;
  /** `<entryId>:<unitId>` for each failure, bounded. */
  failedUnitIds: string[];
  entries: PrewarmResumeEntryOutcome[];
}

export interface PrewarmResumeLedger {
  /** Records what the lane was asked to do, in the order it will do it. */
  schedule(entries: readonly PrewarmResumeEntryRef[], isDebt: (entryId: string) => boolean): void;
  noteStart(entryId: string): void;
  noteFailure(entryId: string, unitId: string): void;
  /** The lane settled (or threw). Called once. */
  finish(ok: boolean): void;
  stats(): PrewarmResumeStats;
}

// A whole dropped manifest is a few dozen units; this only stops a pathological
// run from carrying an unbounded id list into the beacon.
const DEFAULT_FAILED_ID_LIMIT = 24;

export function createPrewarmResumeLedger(opts?: {
  failedUnitIdLimit?: number;
}): PrewarmResumeLedger {
  const failedUnitIdLimit = Math.max(1, opts?.failedUnitIdLimit ?? DEFAULT_FAILED_ID_LIMIT);
  const entries: PrewarmResumeEntryOutcome[] = [];
  const byId = new Map<string, PrewarmResumeEntryOutcome>();
  const failedUnitIds: string[] = [];
  let status: PrewarmResumeStatus = 'none';

  const entryFor = (entryId: string): PrewarmResumeEntryOutcome | undefined => byId.get(entryId);

  return {
    schedule(list, isDebt): void {
      for (const entry of list) {
        if (byId.has(entry.id)) continue;
        const outcome: PrewarmResumeEntryOutcome = {
          id: entry.id,
          lane: isDebt(entry.id) ? 'debt' : 'cosmetic',
          planned: entry.units.length,
          started: 0,
          failed: 0,
        };
        entries.push(outcome);
        byId.set(entry.id, outcome);
      }
      // An empty schedule leaves `none`: "nothing was dropped" and "the lane ran
      // and did nothing" are different findings and must not collapse.
      if (entries.length > 0) status = 'scheduled';
    },
    noteStart(entryId): void {
      const entry = entryFor(entryId);
      if (!entry) return;
      entry.started++;
    },
    noteFailure(entryId, unitId): void {
      const entry = entryFor(entryId);
      if (!entry) return;
      entry.failed++;
      if (failedUnitIds.length < failedUnitIdLimit) failedUnitIds.push(`${entryId}:${unitId}`);
    },
    finish(ok): void {
      if (status === 'none') return;
      status = ok ? 'done' : 'failed';
    },
    stats(): PrewarmResumeStats {
      let plannedUnits = 0;
      let startedUnits = 0;
      let failedUnits = 0;
      for (const entry of entries) {
        plannedUnits += entry.planned;
        startedUnits += entry.started;
        failedUnits += entry.failed;
      }
      return {
        status,
        plannedEntries: entries.length,
        plannedUnits,
        startedUnits,
        failedUnits,
        failedUnitIds: [...failedUnitIds],
        entries: entries.map((entry) => ({ ...entry })),
      };
    },
  };
}
