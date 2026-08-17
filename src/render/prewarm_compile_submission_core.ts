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
  lifecycle.markSyncEnd(record);
  pacing.markSyncEnd(unit.id, programCount() - programsBefore);
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
