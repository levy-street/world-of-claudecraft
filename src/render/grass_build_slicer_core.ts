// Budgeted resumable build slicing for the streamed grass ring (foliage.ts).
//
// The grass chunk builder used to run a whole chunk in one main-thread call
// and only consulted its frame budget AFTER the build finished, so the budget
// bounded how MANY builds ran per frame, never the worst single frame (one
// build was measured at 18.6ms against a 2.2ms budget). This core owns the
// fix: a chunk build is expressed as a sequence of sub-units (grid rows plus
// a finalize step) behind SlicedBuildJob, and runSlicedBuild checks the
// deadline BEFORE every sub-unit, pausing the job so the remainder resumes on
// a later frame. A call whose deadline has already passed performs zero
// sub-units: the check always precedes the cost.
//
// The bound this buys is the budget plus the ONE sub-unit that crossed the
// deadline, and sub-units are not uniformly small: the grass ring's finalize
// step (stable-rank reorder over all instances, bounding spheres, trim,
// freeze) runs unsliced, so the honest worst frame is the budget plus
// finalize, not the budget plus one grid row.
//
// Slicing moves only WHEN the work happens, never WHAT it produces: a job's
// sub-unit sequence must be a pure function of its own cursor state (no clock
// reads inside step()), so the finished output is byte-identical however the
// frames divide the work. runSlicedBuild guarantees its half of that contract
// by executing steps strictly in order, one at a time, with no skipping:
// pinned by tests/grass_build_slicer_core.test.ts (order invariance) and
// tests/grass_build_slicing.test.ts (vertex-data equality on the real ring).
//
// The clock is injected (never performance.now here): this core stays
// deterministic and Node-testable per the RENDER_PURE_CORES contract.

export interface SlicedBuildJob {
  /** Runs the next sub-unit of work. Returns true while more sub-units remain. */
  step(): boolean;
}

export type SlicedBuildOutcome = 'completed' | 'paused';

/**
 * Runs sub-units of `job` in order until it completes or `now()` reaches
 * `deadlineMs`. The deadline check happens BEFORE each sub-unit, so once the
 * elapsed time exceeds the budget no further work starts, and a call that
 * arrives with its deadline already passed performs zero sub-units. A paused
 * job resumes exactly where it left off on the next call.
 */
export function runSlicedBuild(
  job: SlicedBuildJob,
  deadlineMs: number,
  now: () => number,
): SlicedBuildOutcome {
  while (now() < deadlineMs) {
    if (!job.step()) return 'completed';
  }
  return 'paused';
}
