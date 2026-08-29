// Whether the boot manifest's `world.initial-frame` pass runs or defers.
//
// That pass draws one frame under the loading cover so the live draw path
// starts with its programs linked. It pays for every program the draw touches
// that the driver has not finished: not per link, but as one blocking wait
// for whatever the driver still has queued (production 2026-08-19 10:43: one
// program absorbed 3.9 s of the 7.0 s pass on an RTX 3090; the Intel iGPU
// harness measured 13.9 s for 120 programs, a 38 s curtain). When the compile
// lane could not settle its units before this entry (units still linking, or
// handed to the resume lane), the pass is exactly that blind wait, and the
// branch has a cheaper answer already measured in production: reveal, hold
// each unlinked object on its stand-in through the reveal gates, and pay the
// debt on the resume lane (long50 4 per 5 min with that shape). So the pass
// runs only when the compile lane left NO link debt; otherwise the entry
// defers honestly (partial, with the debt in its detail) and draws nothing.
// No timer, no estimate: the decision reads the lane's own records.
//
// Host-agnostic: record shapes only, no Three, no DOM.

/** The compile lifecycle fields the decision reads (prewarm_compile_lifecycle.ts). */
export interface InitialFrameCompileRecord {
  submittedAtMs: number | null;
  settledAtMs: number | null;
  failedAtMs: number | null;
}

export interface LinkDebt {
  /** Units recorded by the submit lane but never submitted (handed to the
   *  resume lane by the deadline-aware submit loop). */
  deferredUnits: number;
  /** Units submitted whose driver link had not settled (nor failed). */
  unsettledUnits: number;
}

export function initialFrameLinkDebt(records: readonly InitialFrameCompileRecord[]): LinkDebt {
  let deferredUnits = 0;
  let unsettledUnits = 0;
  for (const record of records) {
    if (record.submittedAtMs === null) deferredUnits++;
    else if (record.settledAtMs === null && record.failedAtMs === null) unsettledUnits++;
  }
  return { deferredUnits, unsettledUnits };
}

/** True when the pass would block on the compile lane's remaining debt. */
export function initialFrameShouldDefer(debt: LinkDebt): boolean {
  return debt.deferredUnits > 0 || debt.unsettledUnits > 0;
}

/** The entry's one decision: the debt when the pass must defer, null when it
 *  may draw (no deferred unit, no unsettled unit). */
export function initialFrameDeferral(
  records: readonly InitialFrameCompileRecord[],
): LinkDebt | null {
  const debt = initialFrameLinkDebt(records);
  return initialFrameShouldDefer(debt) ? debt : null;
}

/** The entry's progress and detail arms for the manifest receipt: a deferred
 *  pass reports partial (planned 1, done 0, trimmed) with the debt it refused
 *  to wait for; a run pass reports complete. */
export function deferredPassArms(
  deferred: () => LinkDebt | null,
  reportCompletion = true,
): {
  progress: () => { done: number; planned: number; trimmed: boolean } | null;
  detail: () => string;
} {
  return {
    progress: () => {
      const debt = deferred();
      if (debt) return { done: 0, planned: 1, trimmed: true };
      return reportCompletion ? { done: 1, planned: 1, trimmed: false } : null;
    },
    detail: () => {
      const debt = deferred();
      return debt
        ? `deferred;link-debt:deferred=${debt.deferredUnits},unsettled=${debt.unsettledUnits}`
        : reportCompletion
          ? 'drawn'
          : 'eligible';
    },
  };
}
