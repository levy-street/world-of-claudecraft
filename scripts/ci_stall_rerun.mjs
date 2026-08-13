// Driver for the CI checkout-stall auto-rerun
// (.github/workflows/ci-stall-rerun.yml). Thin by design: every judgment
// lives in the pure core (lib/ci_stall_rerun.mjs) so the predicate is unit
// tested against the real incident fixtures; this file only relays GitHub
// API state in and the one rerun call out, and prints the whole decision so
// a suspicious rerun (or non-rerun) can be audited from the job log alone.
//
// Fail-closed doctrine: any malformed input, any API read that cannot be
// parsed, exits non-zero WITHOUT rerunning. The only state this script ever
// mutates is the single rerun-failed-jobs POST, and only when the core said
// so. The live run is re-read here rather than trusting the workflow_run
// payload: a manual rerun or a duplicate event delivery may have raced this
// job, and a run that is no longer a completed attempt 1 must do nothing.
import { spawnSync } from 'node:child_process';
import { decide } from './lib/ci_stall_rerun.mjs';

const runId = process.env.RUN_ID ?? '';
const repo = process.env.GITHUB_REPOSITORY ?? '';
if (!/^\d+$/.test(runId) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('[ci-stall-rerun] RUN_ID or GITHUB_REPOSITORY missing or malformed');
  process.exit(1);
}

/**
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * @param {string[]} args
 * @returns {any}
 */
function ghJson(args) {
  const result = gh(args);
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} exited ${result.status}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

const run = ghJson(['api', `repos/${repo}/actions/runs/${runId}`]);
console.log(
  `[ci-stall-rerun] run ${runId} status=${run.status} conclusion=${run.conclusion} attempt=${run.run_attempt}`,
);
if (run.status !== 'completed') {
  console.log(
    '[ci-stall-rerun] run is no longer completed (a rerun already started); nothing to do',
  );
  process.exit(0);
}

const jobsPayload = ghJson(['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`]);
const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
if (jobsPayload.total_count !== jobs.length) {
  // More jobs than one page holds would silently judge a partial run; the
  // whole CI matrix is far under 100 jobs, so this is a wiring bug, not a
  // paging feature to add quietly.
  console.error(
    `[ci-stall-rerun] jobs page holds ${jobs.length} of ${jobsPayload.total_count}; refusing a partial decision`,
  );
  process.exit(1);
}

const mapped = jobs.map((job) => {
  const entry = {
    name: job.name,
    conclusion: job.conclusion,
    steps: (Array.isArray(job.steps) ? job.steps : []).map((step) => ({
      name: step.name,
      conclusion: step.conclusion,
    })),
  };
  if (job.conclusion === 'cancelled') {
    // The bound-kill discriminator: only a job the bound killed carries the
    // runner's timeout annotation. Fetched only for cancelled jobs; the
    // failure arm never consults annotations. Deliberately unpaged (default
    // 30 rows): a timeout annotation dropped past page one could only make
    // the core MISS a rerun, never grant a wrong one, so the read fails in
    // the safe direction.
    const annotations = ghJson(['api', `repos/${repo}/check-runs/${job.id}/annotations`]);
    entry.annotationMessages = (Array.isArray(annotations) ? annotations : [])
      .map((a) => a.message)
      .filter((m) => typeof m === 'string');
  }
  return entry;
});

for (const job of mapped) {
  console.log(`[ci-stall-rerun]   job "${job.name}" conclusion=${job.conclusion}`);
}

const decision = decide({
  runAttempt: run.run_attempt,
  runConclusion: run.conclusion,
  jobs: mapped,
});
console.log(`[ci-stall-rerun] decision rerun=${decision.rerun}: ${decision.reason}`);
if (!decision.rerun) process.exit(0);

const rerun = gh(['api', '-X', 'POST', `repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`]);
if (rerun.status !== 0) {
  console.error(`[ci-stall-rerun] rerun-failed-jobs failed: ${rerun.stderr.trim()}`);
  process.exit(1);
}
console.log(
  `[ci-stall-rerun] rerun requested for ${decision.stalledJobs.join(', ')} (attempt 2 is the last automatic one; a repeat stall stays with a human)`,
);
