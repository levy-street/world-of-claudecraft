import type { PrewarmPacing } from './link_rate_budget';
import type { PrewarmCompileLifecycle } from './prewarm_compile_lifecycle';

export interface PrewarmCompileUnitLike {
  id: string;
  run: () => void | Promise<void>;
}

export interface PrewarmCompileSubmissionDependencies {
  lifecycle: PrewarmCompileLifecycle;
  pacing: PrewarmPacing;
  programCount: () => number;
  onError: (error: unknown) => void;
}

export interface SubmittedPrewarmCompileUnit {
  id: string;
  done: Promise<void>;
}

/** What the submit LOOP needs from the renderer, and nothing else. */
export interface PrewarmCompileSubmissionLoopHost {
  /** True once the loop must stop launching work (deadline or pacing stop). */
  outOfTime: () => boolean;
  /** Wait for a pacing slot; false means the loop must defer the rest. */
  awaitSlot: (outOfTime: () => boolean) => Promise<boolean>;
  /** Record a unit the loop is handing to the resume lane, before it defers. */
  recordDeferred: (unit: PrewarmCompileUnitLike) => void;
  /** Submit one unit and RECORD it, in the same step. The recording must not
   *  be deferred to the loop's return value: see runPrewarmCompileSubmission.
   *  Any return value is ignored, so a caller may push and return the length. */
  submit: (unit: PrewarmCompileUnitLike) => unknown;
  /** Yield between unit submissions. */
  yieldSlice: () => Promise<void>;
}

export interface PrewarmCompileSubmissionResult {
  /** Non-empty when the loop stopped early; these units are NEVER dropped. */
  deferred: PrewarmCompileUnitLike[];
}

/**
 * Submit `pending` in order, stopping at the deadline instead of running to
 * completion.
 *
 * DEADLINE-AWARE, CHECKED BETWEEN UNITS: one uninterrupted submit loop
 * measured 22 s of synchronous prologue work in production, sailing past the
 * 15 s hard deadline and dropping every entry behind it, the deadline-exempt
 * debt payers included (hitch-hunt S1/S2). The caller's deadline is the GPU
 * submit guard, or `min(gpuSubmitDeadline, compileAwaitDeadline)` on the
 * compile entry's tail call, so the loop can never eat the await reserve that
 * keeps world.initial-frame's programs linked before it draws.
 *
 * Units the loop does not reach are RETURNED, never dropped: their roots were
 * marked seen at BUILD time, so these exact unit objects are the only remaining
 * route to their compiles (hitch-hunt P1). The caller drains them from the
 * compile entry and hands whatever is left to the resume lane.
 *
 * The yield between submissions matters: each unit carries up to 32 synchronous
 * compileAsync prologue walks, and links progress off-thread anyway.
 *
 * `host.submit` records each unit as it goes, rather than the loop returning a
 * batch the caller records afterwards. That ordering is load bearing: if
 * `awaitSlot` or `yieldSlice` ever rejects, a batch returned only on the happy
 * path would lose the units already submitted in that call from the set
 * `programs.compile` awaits, and world.initial-frame would draw believing
 * programs were ready that nobody waited on.
 */
export async function runPrewarmCompileSubmission(
  pending: readonly PrewarmCompileUnitLike[],
  host: PrewarmCompileSubmissionLoopHost,
): Promise<PrewarmCompileSubmissionResult> {
  for (let i = 0; i < pending.length; i++) {
    if (!(await host.awaitSlot(host.outOfTime))) {
      const deferred = pending.slice(i);
      for (const unit of deferred) host.recordDeferred(unit);
      return { deferred };
    }
    host.submit(pending[i]);
    await host.yieldSlice();
  }
  return { deferred: [] };
}

/** Keep lifecycle and pacing transitions identical for every compile unit. */
export function submitPrewarmCompileUnit(
  unit: PrewarmCompileUnitLike,
  lane: string,
  dependencies: PrewarmCompileSubmissionDependencies,
): SubmittedPrewarmCompileUnit {
  const { lifecycle, pacing, programCount, onError } = dependencies;
  const record = lifecycle.recordFor(unit, lane);
  lifecycle.markSubmitted(record);
  pacing.markSubmitted(unit.id);
  const programsBefore = programCount();
  let runResult: void | Promise<void>;
  try {
    runResult = unit.run();
  } catch (error) {
    runResult = Promise.reject(error);
  }
  const programsAfter = programCount();
  const programDelta = programsAfter - programsBefore;
  const chargedLinks = Number.isFinite(programDelta) ? Math.max(0, programDelta) : 0;
  lifecycle.markSyncEnd(record, { programsBefore, programsAfter, chargedLinks });
  pacing.markSyncEnd(unit.id, chargedLinks);
  return {
    id: unit.id,
    done: Promise.resolve(runResult).then(
      () => {
        lifecycle.markSettled(record);
        pacing.markSettled(unit.id);
      },
      (error: unknown) => {
        lifecycle.markFailed(record);
        pacing.markFailed(unit.id);
        onError(error);
      },
    ),
  };
}
