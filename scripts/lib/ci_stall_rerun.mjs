// Decision core for the CI checkout-stall auto-rerun
// (.github/workflows/ci-stall-rerun.yml, driver scripts/ci_stall_rerun.mjs).
//
// The stall class this reacts to: a runner-side git fetch that trickles at
// zero throughput for tens of minutes inside a setup step (9.6 to 24.4
// minutes in the Phase 6 incident sample; three consecutive bound kills of
// "PR gate (long sims A)", then bounded at 20 minutes, on run 31392590628,
// 2026-08-10). The job
// bounds in ci.yml kill such a job, and docs/merge-queue.md routes the kill
// to "re-run the failed jobs and re-queue". This module is that triage rule
// as code, so attempt 1 of the rerun no longer needs a human.
//
// The crux is the SAFE PREDICATE: a rerun is only allowed when nothing else
// that ran had failed (the dead step itself is the one allowed failure) and
// nothing after the dead setup step ran (in particular no test step after
// it), so a rerun can never mask a real failure, and
// only on attempt 1, so the rerun's own completion can never rerun anything
// (a second stall of the same job is the doc's "real slowdown, investigate"
// case and stays with a human). A late setup step can legitimately die with
// earlier PASSED work steps behind it (ci.yml's tsc cache restore sits
// after the freshness checks); that reruns green work, never a red. Two
// stall shapes are recognized:
//
//   - bound kill: the job bound cancelled the job inside a SETUP step. Job
//     conclusion "cancelled" alone cannot be trusted: a superseded run
//     cancelled by ci.yml's cancel-in-progress concurrency group, or a
//     user cancel, is step-for-step identical, and resurrecting a
//     superseded run is pure waste. The discriminator is the runner's own
//     timeout annotation on the killed job ("The job has exceeded the
//     maximum execution time of 20m0s" in the incident), which only a
//     bound kill carries.
//   - fast abort: ci.yml's workflow-wide git low-speed abort ended the dead
//     transfer early, the in-step checkout retries also stalled, and the
//     CHECKOUT step FAILED with everything after it skipped. Deliberately
//     narrower than the bound-kill arm: only a checkout step qualifies,
//     because the low-speed abort can only kill a git HTTP transfer. A
//     failed "Install dependencies" stays with a human on purpose: a
//     lockfile desync fails identically in every job, and auto-rerunning
//     the whole matrix would delay the definitive red without masking it.
//
// Everything else fails closed: any failed step inside a cancelled job, any
// cancelled or failed TEST step, any job conclusion outside the recognized
// set, any step shape this module does not positively recognize, means no
// rerun and a human triages exactly as before. Pinned, with the real
// incident job as fixture, by tests/ci_stall_rerun.test.ts.

/**
 * Setup-step names as ci.yml spells them: checkout, toolchain setup,
 * dependency install, cache restore. "Set up job" (the runner's own first
 * step) matches "Set up " deliberately: a provisioning stall is the same
 * runner-side class. A test or work step never matches (the workflow pins
 * hold every ci.yml run step outside these prefixes).
 */
export const SETUP_STEP_RE = /^(Check out |Set up |Install |Cache )/;

/**
 * The runner's timeout annotation fragment, the discriminator between a
 * job-bound kill and a user or concurrency cancellation. Same fragment
 * docs/merge-queue.md pins as the rejection signature.
 */
export const TIMEOUT_ANNOTATION_FRAGMENT = 'exceeded the maximum execution time';

/**
 * The only step names the fast-abort arm accepts as the failed step: the
 * git low-speed abort can only kill a checkout's HTTP transfer, so a
 * failure anywhere else (install, cache, any work step) is not this class
 * and stays with a human.
 */
export const CHECKOUT_STEP_RE = /^Check out /;

// Runner housekeeping that legitimately RUNS after a kill: the "Post <setup
// step>" cleanup phases and the runner's own completion step. Deliberately
// anchored to the setup-step prefixes so a WORK step that happens to start
// with "Post " (ci.yml's "Post i18n coverage summary") is never swallowed:
// that one running after a dead setup step is an unrecognized shape and must
// veto.
const HOUSEKEEPING_RE =
  /^(Post (Check out |Set up |Install |Cache )|Complete job$|Stop containers$)/;

/** Job conclusions that need no stall check at all. */
const BENIGN_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

/**
 * @param {{ name: string }} step
 * @returns {boolean}
 */
function isHousekeeping(step) {
  return HOUSEKEEPING_RE.test(step.name);
}

/**
 * The one dead step of a stall-shaped job, or null when the job does not
 * match: the first non-housekeeping step carrying `deadConclusion` has a
 * name matching `nameRe`, and every non-housekeeping step after it was
 * skipped (nothing after the dead step ran).
 *
 * @param {Array<{ name: string, conclusion: string | null }>} steps
 * @param {'cancelled' | 'failure'} deadConclusion
 * @param {RegExp} nameRe
 * @returns {{ name: string } | null}
 */
function findDeadStep(steps, deadConclusion, nameRe) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const work = steps.filter((step) => !isHousekeeping(step));
  const deadIndex = work.findIndex((step) => step.conclusion === deadConclusion);
  if (deadIndex === -1) return null;
  const dead = work[deadIndex];
  if (!nameRe.test(dead.name)) return null;
  for (const step of work.slice(deadIndex + 1)) {
    if (step.conclusion !== 'skipped') return null;
  }
  return dead;
}

/**
 * Bound-kill stall shape: the runner's timeout annotation is present, no
 * step failed anywhere (housekeeping included), and the one cancelled work
 * step is a setup step with everything after it skipped.
 *
 * @param {import('./ci_stall_rerun.d.mts').CiStallJob} job
 * @returns {boolean}
 */
function isBoundKillStall(job) {
  const messages = Array.isArray(job.annotationMessages) ? job.annotationMessages : [];
  if (!messages.some((m) => typeof m === 'string' && m.includes(TIMEOUT_ANNOTATION_FRAGMENT))) {
    return false;
  }
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (steps.some((step) => step.conclusion === 'failure')) return false;
  const cancelledCount = steps.filter(
    (step) => !isHousekeeping(step) && step.conclusion === 'cancelled',
  ).length;
  if (cancelledCount !== 1) return false;
  return findDeadStep(steps, 'cancelled', SETUP_STEP_RE) !== null;
}

/**
 * Fast-abort stall shape: exactly one failed step in the whole job, it is a
 * CHECKOUT step (the only step the git low-speed abort can kill), nothing
 * was cancelled, and everything after it was skipped. A rerun of a dead
 * checkout can never mask a test result because nothing after it ran.
 *
 * @param {import('./ci_stall_rerun.d.mts').CiStallJob} job
 * @returns {boolean}
 */
function isFastAbortStall(job) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (steps.some((step) => step.conclusion === 'cancelled')) return false;
  const failedCount = steps.filter((step) => step.conclusion === 'failure').length;
  if (failedCount !== 1) return false;
  return findDeadStep(steps, 'failure', CHECKOUT_STEP_RE) !== null;
}

/**
 * The whole-run rerun decision. `rerun` is true exactly when: this is
 * attempt 1, the run concluded cancelled or failure, every job is either
 * benign (success, skipped, neutral) or a recognized stall shape, and at
 * least one stall shape is present. Any other job conclusion (a genuine
 * failure, timed_out, action_required, a still-running null) vetoes the
 * whole run: rerun-failed-jobs would rerun every non-successful job, so one
 * unrecognized job means the run belongs to a human.
 *
 * @param {import('./ci_stall_rerun.d.mts').CiStallRun} run
 * @returns {import('./ci_stall_rerun.d.mts').CiStallDecision}
 */
export function decide(run) {
  const { runAttempt, runConclusion, jobs } = run;
  if (runAttempt !== 1) {
    return {
      rerun: false,
      reason: `attempt ${runAttempt}: the auto-rerun only ever covers attempt 1; a repeat stall is the merge-queue doc's real-slowdown case`,
      stalledJobs: [],
    };
  }
  if (runConclusion !== 'cancelled' && runConclusion !== 'failure') {
    return {
      rerun: false,
      reason: `run conclusion "${runConclusion}" is not a kill shape (cancelled or failure)`,
      stalledJobs: [],
    };
  }
  const stalledJobs = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (BENIGN_CONCLUSIONS.has(job.conclusion ?? '')) continue;
    if (job.conclusion === 'cancelled' && isBoundKillStall(job)) {
      stalledJobs.push(job.name);
      continue;
    }
    if (job.conclusion === 'failure' && isFastAbortStall(job)) {
      stalledJobs.push(job.name);
      continue;
    }
    return {
      rerun: false,
      reason: `job "${job.name}" (conclusion ${JSON.stringify(job.conclusion)}) does not match a stall shape; leaving the whole run to a human`,
      stalledJobs: [],
    };
  }
  if (stalledJobs.length === 0) {
    return {
      rerun: false,
      reason: 'no job matches a stall shape',
      stalledJobs: [],
    };
  }
  return {
    rerun: true,
    reason: `every non-benign job is a recognized checkout-stall shape (${stalledJobs.join(', ')}); nothing else that ran had failed and nothing after the dead step ran, rerunning failed jobs once`,
    stalledJobs,
  };
}
