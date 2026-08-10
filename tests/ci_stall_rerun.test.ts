import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_STEP_RE,
  decide,
  SETUP_STEP_RE,
  TIMEOUT_ANNOTATION_FRAGMENT,
} from '../scripts/lib/ci_stall_rerun.mjs';

// The CI checkout-stall auto-rerun: pure decision core
// (scripts/lib/ci_stall_rerun.mjs), driver (scripts/ci_stall_rerun.mjs), and
// workflow (.github/workflows/ci-stall-rerun.yml). The predicate under test
// is a SAFETY predicate: a wrong "rerun" can resurrect a superseded run or
// blur a real failure's triage, so every case that is not positively the
// stall shape must decide no. The primary fixture is the real incident:
// run 31392590628 attempt 2 (2026-08-10), "PR gate (long sims A)" killed by
// its 20-minute bound inside "Check out repository", steps and annotation
// text verbatim from the GitHub API.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(
  new URL('../.github/workflows/ci-stall-rerun.yml', import.meta.url),
  'utf8',
);
// Comment-stripped view for count and adjacency pins, so a comment that
// happens to quote a token can never satisfy (or trip) a code assertion.
const workflowCode = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

// Verbatim from the incident job (id 93473897038): the runner's own
// housekeeping steps ("Post Check out repository", "Complete job") RAN and
// succeeded after the kill, so "everything after the dead step is skipped"
// must exempt exactly them and nothing else.
const LANE_A_STALL_STEPS = [
  { name: 'Set up job', conclusion: 'success' },
  { name: 'Check out repository', conclusion: 'cancelled' },
  { name: 'Set up pnpm', conclusion: 'skipped' },
  { name: 'Set up Node.js', conclusion: 'skipped' },
  { name: 'Install dependencies', conclusion: 'skipped' },
  { name: 'Cache vitest transform cache', conclusion: 'skipped' },
  { name: 'Run tests (PR tier, long-sims lane A)', conclusion: 'skipped' },
  { name: 'Post Check out repository', conclusion: 'success' },
  { name: 'Complete job', conclusion: 'success' },
];
const TIMEOUT_ANNOTATION = 'The job has exceeded the maximum execution time of 20m0s';
const CANCEL_ANNOTATION = 'The operation was canceled.';

interface FixtureJob {
  name: string;
  conclusion: string | null;
  steps: Array<{ name: string; conclusion: string | null }>;
  annotationMessages?: string[];
}

function greenJob(name: string): FixtureJob {
  return { name, conclusion: 'success', steps: [] };
}

function stalledLaneA(): FixtureJob {
  return {
    name: 'PR gate (long sims A)',
    conclusion: 'cancelled',
    steps: structuredClone(LANE_A_STALL_STEPS),
    annotationMessages: [TIMEOUT_ANNOTATION, CANCEL_ANNOTATION],
  };
}

function incidentRun(): { runAttempt: number; runConclusion: string | null; jobs: FixtureJob[] } {
  return {
    runAttempt: 1,
    runConclusion: 'cancelled',
    jobs: [
      greenJob('Detect code path changes'),
      greenJob('PR gate (English-only legal) (1)'),
      greenJob('PR gate (English-only legal) (2)'),
      greenJob('PR gate (long sims B)'),
      greenJob('PR checks (freshness, typecheck, builds)'),
      greenJob('Format + lint (Biome, changed files)'),
      greenJob('Browser regressions (Chromium)'),
      stalledLaneA(),
    ],
  };
}

describe('ci stall rerun decision core', () => {
  it('reruns the real incident shape: bound-killed setup step, no test step ran', () => {
    const decision = decide(incidentRun());
    expect(decision.rerun).toBe(true);
    expect(decision.stalledJobs).toEqual(['PR gate (long sims A)']);
    expect(TIMEOUT_ANNOTATION).toContain(TIMEOUT_ANNOTATION_FRAGMENT);
  });

  it('never reruns past attempt 1, whatever the shape', () => {
    const run = incidentRun();
    run.runAttempt = 2;
    const decision = decide(run);
    expect(decision.rerun).toBe(false);
    expect(decision.reason).toContain('attempt 2');
  });

  it('ignores runs whose conclusion is not a kill shape', () => {
    for (const conclusion of ['success', 'skipped', 'neutral', null]) {
      const run = incidentRun();
      run.runConclusion = conclusion;
      expect(decide(run).rerun).toBe(false);
    }
  });

  it('refuses a cancelled job with no timeout annotation (user or concurrency cancel)', () => {
    // A superseded run cancelled by cancel-in-progress mid-checkout is
    // step-for-step identical to the stall; only the runner's bound-kill
    // annotation separates them, so its absence must veto.
    const run = incidentRun();
    const lane = run.jobs[run.jobs.length - 1];
    lane.annotationMessages = [CANCEL_ANNOTATION];
    expect(decide(run).rerun).toBe(false);
    lane.annotationMessages = [];
    expect(decide(run).rerun).toBe(false);
  });

  it('fails the cancelled arm closed when annotations were never fetched', () => {
    const run = incidentRun();
    const lane = run.jobs[run.jobs.length - 1];
    lane.annotationMessages = undefined;
    expect(decide(run).rerun).toBe(false);
  });

  it('refuses a bound kill that caught the TEST step running (real slowdown, not a stall)', () => {
    // docs/merge-queue.md: a test step still running near the bound is a
    // real slowdown; rerunning it automatically would hide that signal.
    const run = incidentRun();
    const lane = run.jobs[run.jobs.length - 1];
    lane.steps = [
      { name: 'Set up job', conclusion: 'success' },
      { name: 'Check out repository', conclusion: 'success' },
      { name: 'Set up pnpm', conclusion: 'success' },
      { name: 'Set up Node.js', conclusion: 'success' },
      { name: 'Install dependencies', conclusion: 'success' },
      { name: 'Cache vitest transform cache', conclusion: 'success' },
      { name: 'Run tests (PR tier, long-sims lane A)', conclusion: 'cancelled' },
      { name: 'Post Check out repository', conclusion: 'success' },
      { name: 'Complete job', conclusion: 'success' },
    ];
    expect(decide(run).rerun).toBe(false);
  });

  it('refuses a cancelled job carrying any failed step', () => {
    const run = incidentRun();
    const lane = run.jobs[run.jobs.length - 1];
    lane.steps[6] = { name: 'Run tests (PR tier, long-sims lane A)', conclusion: 'failure' };
    expect(decide(run).rerun).toBe(false);
  });

  it('refuses a run that also holds a genuinely red job', () => {
    // rerun-failed-jobs would rerun the red shard too; one real failure
    // means the whole run belongs to a human.
    const run = incidentRun();
    run.jobs[1] = {
      name: 'PR gate (English-only legal) (1)',
      conclusion: 'failure',
      steps: [
        { name: 'Check out repository', conclusion: 'success' },
        { name: 'Run tests (PR tier, shard 1 of 8)', conclusion: 'failure' },
      ],
    };
    expect(decide(run).rerun).toBe(false);
  });

  it('refuses a work step that ran after the dead setup step, even one named Post', () => {
    // "Post i18n coverage summary" is a WORK step whose name starts with
    // "Post "; the housekeeping exemption must not swallow it.
    const run = incidentRun();
    const lane = run.jobs[run.jobs.length - 1];
    lane.steps = [
      { name: 'Set up job', conclusion: 'success' },
      { name: 'Check out repository', conclusion: 'cancelled' },
      { name: 'Post i18n coverage summary', conclusion: 'success' },
      { name: 'Complete job', conclusion: 'success' },
    ];
    expect(decide(run).rerun).toBe(false);
  });

  it('refuses unrecognized job conclusions: timed_out, action_required, still running', () => {
    for (const conclusion of ['timed_out', 'action_required', null]) {
      const run = incidentRun();
      run.jobs[3] = { name: 'PR gate (long sims B)', conclusion, steps: [] };
      expect(decide(run).rerun).toBe(false);
    }
  });

  it('does nothing when no job matches a stall shape', () => {
    const run = incidentRun();
    run.jobs = run.jobs.slice(0, -1);
    const decision = decide(run);
    expect(decision.rerun).toBe(false);
    expect(decision.reason).toContain('no job matches');
  });

  it('reruns the fast-abort shape: checkout failed, everything after it skipped', () => {
    // The second arm: ci.yml's git low-speed abort exhausted the in-step
    // checkout retries and FAILED the checkout early (the only step name
    // the arm accepts). No annotation needed: nothing after the dead
    // checkout ran, so a rerun can mask nothing.
    const run = incidentRun();
    run.runConclusion = 'failure';
    run.jobs[run.jobs.length - 1] = {
      name: 'PR gate (long sims A)',
      conclusion: 'failure',
      steps: [
        { name: 'Set up job', conclusion: 'success' },
        { name: 'Check out repository', conclusion: 'failure' },
        { name: 'Set up pnpm', conclusion: 'skipped' },
        { name: 'Set up Node.js', conclusion: 'skipped' },
        { name: 'Install dependencies', conclusion: 'skipped' },
        { name: 'Cache vitest transform cache', conclusion: 'skipped' },
        { name: 'Run tests (PR tier, long-sims lane A)', conclusion: 'skipped' },
        { name: 'Post Check out repository', conclusion: 'success' },
        { name: 'Complete job', conclusion: 'success' },
      ],
    };
    const decision = decide(run);
    expect(decision.rerun).toBe(true);
    expect(decision.stalledJobs).toEqual(['PR gate (long sims A)']);
  });

  it('refuses a failed job whose failed step is anything but a checkout', () => {
    // The fast-abort arm is narrower than the bound-kill arm on purpose:
    // only a checkout can die of the git low-speed abort. A failed install
    // (a lockfile desync fails identically in every job) or cache step
    // stays with a human instead of auto-rerunning the whole matrix.
    for (const stepName of [
      'Run tests (PR tier, long-sims lane A)',
      'Biome check (changed files only)',
      'Malicious-code gate',
      'Install dependencies',
      'Set up Node.js',
      'Cache vitest transform cache',
    ]) {
      const run = incidentRun();
      run.runConclusion = 'failure';
      run.jobs[run.jobs.length - 1] = {
        name: 'PR gate (long sims A)',
        conclusion: 'failure',
        steps: [
          { name: 'Check out repository', conclusion: 'success' },
          { name: stepName, conclusion: 'failure' },
          { name: 'Complete job', conclusion: 'success' },
        ],
      };
      expect(decide(run).rerun).toBe(false);
    }
  });

  it('refuses a failed job carrying more than one failed step', () => {
    const run = incidentRun();
    run.runConclusion = 'failure';
    run.jobs[run.jobs.length - 1] = {
      name: 'PR gate (long sims A)',
      conclusion: 'failure',
      steps: [
        { name: 'Check out repository', conclusion: 'failure' },
        { name: 'Set up pnpm', conclusion: 'skipped' },
        { name: 'Run tests (PR tier, long-sims lane A)', conclusion: 'skipped' },
        { name: 'Post Check out repository', conclusion: 'failure' },
      ],
    };
    expect(decide(run).rerun).toBe(false);
  });

  it('reruns once for several stalled jobs in one run, both arms mixed', () => {
    // Attempt 1 of the incident also stalled shard (4) for 16 minutes; had
    // both died, one rerun-failed-jobs call covers them together.
    const run = incidentRun();
    run.jobs[2] = {
      name: 'PR gate (English-only legal) (2)',
      conclusion: 'failure',
      steps: [
        { name: 'Set up job', conclusion: 'success' },
        { name: 'Check out repository', conclusion: 'failure' },
        { name: 'Run tests (PR tier, shard 2 of 8)', conclusion: 'skipped' },
        { name: 'Complete job', conclusion: 'success' },
      ],
    };
    const decision = decide(run);
    expect(decision.rerun).toBe(true);
    expect(decision.stalledJobs).toEqual([
      'PR gate (English-only legal) (2)',
      'PR gate (long sims A)',
    ]);
  });
});

describe('setup-step pattern against the real ci.yml step names', () => {
  it('matches exactly the setup steps and never a work or test step', () => {
    const stepNames = [...ciWorkflow.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]);
    // Vacuity floor: the extraction must see the real work steps before the
    // partition below means anything.
    expect(stepNames).toContain('Run tests (PR tier, long-sims lane A)');
    expect(stepNames).toContain('Biome check (changed files only)');
    expect(stepNames).toContain('Post i18n coverage summary');
    const setupMatched = [...new Set(stepNames.filter((name) => SETUP_STEP_RE.test(name)))].sort();
    // A new ci.yml step whose name drifts into the setup prefixes becomes
    // auto-rerunnable on failure; this equality forces that to be a
    // conscious decision here, not an accident of naming.
    expect(setupMatched).toEqual([
      'Cache Playwright Chromium browsers',
      'Cache tsc incremental buildinfo',
      'Cache vitest transform cache',
      'Check out classifier script',
      'Check out repository',
      'Install Chromium',
      'Install dependencies',
      'Set up Node.js',
      'Set up pnpm',
    ]);
    // The fast-abort arm's narrower pattern: exactly the checkout steps,
    // nothing else, so a failed install or cache step can never ride it.
    const checkoutMatched = [
      ...new Set(stepNames.filter((name) => CHECKOUT_STEP_RE.test(name))),
    ].sort();
    expect(checkoutMatched).toEqual(['Check out classifier script', 'Check out repository']);
  });
});

describe('ci-stall-rerun.yml shape', () => {
  it('triggers only on completed CI runs', () => {
    expect(workflowCode).toMatch(
      /\non:\n {2}workflow_run:\n {4}workflows: \[CI\]\n {4}types: \[completed\]\n/,
    );
  });

  it('declares exactly the three justified scopes and the one write among them', () => {
    expect(workflowCode).toMatch(
      /\npermissions:\n {2}actions: write\n {2}checks: read\n {2}contents: read\n/,
    );
    expect(workflowCode.match(/^\s*permissions:/gm)).toHaveLength(1);
    expect(workflowCode.match(/: write/g)).toHaveLength(1);
    expect(workflowCode).not.toContain('secrets.');
    // The departure from the repo's contents: read baseline must stay
    // justified in the header, next to the file it protects.
    expect(workflow).toContain('every other workflow in this repository declares');
    expect(workflow).toContain('must never check out or run');
    expect(workflow).toContain('PR-authored code');
  });

  it('gates the runner spin on attempt 1 of a killed non-queue run', () => {
    expect(workflowCode).toContain('github.event.workflow_run.run_attempt == 1');
    expect(workflowCode).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(workflowCode).toContain("github.event.workflow_run.conclusion == 'failure'");
    // A rejected merge group is already dissolved (ref deleted, PR ejected);
    // rerunning it cannot re-queue anything, so queue runs stay manual.
    expect(workflowCode).toContain("github.event.workflow_run.event != 'merge_group'");
    // The substring pins above cannot catch a broken fold (every fragment
    // present but the expression malformed), so re-fold the block scalar
    // and pin the whole expression. The merge_group arm is enforced by
    // this if ALONE (the core never sees the event), so the exact folded
    // expression is load-bearing, not cosmetic.
    const ifBlock = workflowCode.match(/\n {4}if: >-\n((?: {6}\S[^\n]*\n)+)/);
    expect(ifBlock).not.toBeNull();
    const folded = (ifBlock?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
    expect(folded).toBe(
      'github.event.workflow_run.run_attempt == 1 && ' +
        "github.event.workflow_run.event != 'merge_group' && " +
        "(github.event.workflow_run.conclusion == 'cancelled' || " +
        "github.event.workflow_run.conclusion == 'failure')",
    );
  });

  it('serializes duplicate deliveries per triggering run', () => {
    expect(workflowCode).toMatch(
      /\nconcurrency:\n {2}group: ci-stall-rerun-\$\{\{ github\.event\.workflow_run\.id \}\}\n {2}cancel-in-progress: false\n/,
    );
  });

  it('carries the same dead-transfer floor ci.yml uses for its own checkout', () => {
    expect(workflowCode).toMatch(
      /\nenv:\n {2}GIT_HTTP_LOW_SPEED_LIMIT: '1000'\n {2}GIT_HTTP_LOW_SPEED_TIME: '120'\n/,
    );
  });

  it('checks out the decision scripts at the default branch, blobless, credentials dropped', () => {
    // workflow_run executes with write-capable permissions: the checkout
    // must never reference the triggering run's head. Blobless + sparse is
    // the nightly.yml script-checkout shape: the reactor needs the scripts
    // subtree, not the repository's media payload, and it runs on every
    // killed CI run under a 5 minute bound.
    expect(workflowCode).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflowCode).toContain('filter: blob:none');
    expect(workflowCode).toContain('sparse-checkout: scripts');
    expect(workflowCode).toContain('persist-credentials: false');
    expect(workflowCode).not.toContain('workflow_run.head');
  });

  it('relays the run id over env into the pinned driver line and stays bounded', () => {
    expect(workflowCode).toMatch(
      /- name: Decide and rerun once\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {10}RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}\n {8}run: node scripts\/ci_stall_rerun\.mjs\n/,
    );
    expect(workflowCode.match(/^ {8}run: /gm)).toHaveLength(1);
    expect(workflowCode).toMatch(/^ {4}timeout-minutes: 5$/m);
  });

  it('is named in the merge-queue triage note', () => {
    const doc = readFileSync(new URL('../docs/merge-queue.md', import.meta.url), 'utf8');
    expect(doc).toContain('ci-stall-rerun.yml');
    expect(doc).toContain('scripts/lib/ci_stall_rerun.mjs');
  });
});

describe('driver wiring', () => {
  // The driver is fail-closed glue; prove the wiring end to end against a
  // stub gh: it reads the live run, maps jobs and annotations, consults the
  // core, and POSTs rerun-failed-jobs exactly once, or not at all. The
  // stub's failure switches (STUB_FAIL_*) let each fail-closed branch be
  // exercised for real instead of taken on faith.
  interface DriverRun {
    status: number | null;
    stdout: string;
    stderr: string;
    log: string;
  }

  function runDriver(
    runJson: object,
    options: { jobsJson?: object; env?: Record<string, string | undefined> } = {},
  ): DriverRun {
    const stubDir = mkdtempSync(path.join(os.tmpdir(), 'woc-ci-stall-'));
    try {
      const logPath = path.join(stubDir, 'gh.log');
      writeFileSync(logPath, '');
      writeFileSync(path.join(stubDir, 'run.json'), JSON.stringify(runJson));
      const jobsJson = options.jobsJson ?? {
        total_count: 2,
        jobs: [
          { id: 1, name: 'PR gate (long sims B)', conclusion: 'success', steps: [] },
          {
            id: 93473897038,
            name: 'PR gate (long sims A)',
            conclusion: 'cancelled',
            steps: LANE_A_STALL_STEPS,
          },
        ],
      };
      writeFileSync(path.join(stubDir, 'jobs.json'), JSON.stringify(jobsJson));
      writeFileSync(
        path.join(stubDir, 'annotations.json'),
        JSON.stringify([{ message: TIMEOUT_ANNOTATION }, { message: CANCEL_ANNOTATION }]),
      );
      const stub = [
        '#!/bin/bash',
        'printf \'%s\\n\' "$*" >> "$STUB_LOG"',
        'case "$*" in',
        '  *rerun-failed-jobs*)',
        '    if [ -n "$STUB_FAIL_RERUN" ]; then echo "HTTP 403" >&2; exit 1; fi',
        '    exit 0 ;;',
        '  *check-runs*)',
        '    if [ -n "$STUB_FAIL_ANNOTATIONS" ]; then echo "HTTP 500" >&2; exit 1; fi',
        '    cat "$STUB_DIR/annotations.json" ;;',
        '  *"jobs?per_page=100"*) cat "$STUB_DIR/jobs.json" ;;',
        '  *actions/runs/*) cat "$STUB_DIR/run.json" ;;',
        '  *) echo "unexpected gh call: $*" >&2; exit 64 ;;',
        'esac',
        '',
      ].join('\n');
      const stubPath = path.join(stubDir, 'gh');
      writeFileSync(stubPath, stub);
      chmodSync(stubPath, 0o755);
      const result = spawnSync('node', [path.join(root, 'scripts/ci_stall_rerun.mjs')], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH ?? ''}`,
          RUN_ID: '31392590628',
          GITHUB_REPOSITORY: 'levy-street/world-of-claudecraft',
          STUB_DIR: stubDir,
          STUB_LOG: logPath,
          STUB_FAIL_RERUN: undefined,
          STUB_FAIL_ANNOTATIONS: undefined,
          ...options.env,
        },
      });
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        log: readFileSync(logPath, 'utf8'),
      };
    } finally {
      // The log is read before this runs; the temp tree never outlives the test.
      rmSync(stubDir, { recursive: true, force: true });
    }
  }

  it('reruns the incident run exactly once through the real endpoint', () => {
    const { status, stdout, log } = runDriver({
      status: 'completed',
      conclusion: 'cancelled',
      run_attempt: 1,
    });
    expect(status).toBe(0);
    expect(stdout).toContain('decision rerun=true');
    const rerunCalls = log.split('\n').filter((line) => line.includes('rerun-failed-jobs'));
    expect(rerunCalls).toEqual([
      'api -X POST repos/levy-street/world-of-claudecraft/actions/runs/31392590628/rerun-failed-jobs',
    ]);
  });

  it('does not touch the rerun endpoint on a later attempt', () => {
    const { status, stdout, log } = runDriver({
      status: 'completed',
      conclusion: 'cancelled',
      run_attempt: 2,
    });
    expect(status).toBe(0);
    expect(stdout).toContain('decision rerun=false');
    expect(log).not.toContain('rerun-failed-jobs');
  });

  it('does nothing when the run is no longer completed (manual rerun raced us)', () => {
    const { status, stdout, log } = runDriver({
      status: 'in_progress',
      conclusion: null,
      run_attempt: 1,
    });
    expect(status).toBe(0);
    expect(stdout).toContain('nothing to do');
    expect(log).not.toContain('rerun-failed-jobs');
  });

  it('refuses a malformed RUN_ID before touching the API at all', () => {
    const good = { status: 'completed', conclusion: 'cancelled', run_attempt: 1 };
    for (const runId of ['31392590628/../evil', 'abc', '']) {
      const { status, log } = runDriver(good, { env: { RUN_ID: runId } });
      expect(status).toBe(1);
      expect(log).toBe('');
    }
    const { status, log } = runDriver(good, { env: { GITHUB_REPOSITORY: 'no-slash' } });
    expect(status).toBe(1);
    expect(log).toBe('');
  });

  it('refuses a partial jobs page instead of judging a partial run', () => {
    const { status, stderr, log } = runDriver(
      { status: 'completed', conclusion: 'cancelled', run_attempt: 1 },
      {
        jobsJson: {
          total_count: 3,
          jobs: [{ id: 1, name: 'PR gate (long sims B)', conclusion: 'success', steps: [] }],
        },
      },
    );
    expect(status).toBe(1);
    expect(stderr).toContain('refusing a partial decision');
    expect(log).not.toContain('rerun-failed-jobs');
  });

  it('exits red when the annotations read fails, without rerunning', () => {
    const { status, log } = runDriver(
      { status: 'completed', conclusion: 'cancelled', run_attempt: 1 },
      { env: { STUB_FAIL_ANNOTATIONS: '1' } },
    );
    expect(status).toBe(1);
    expect(log).not.toContain('rerun-failed-jobs');
  });

  it('exits red when the rerun POST fails, after exactly one attempt', () => {
    const { status, stderr, log } = runDriver(
      { status: 'completed', conclusion: 'cancelled', run_attempt: 1 },
      { env: { STUB_FAIL_RERUN: '1' } },
    );
    expect(status).toBe(1);
    expect(stderr).toContain('rerun-failed-jobs failed');
    const rerunCalls = log.split('\n').filter((line) => line.includes('rerun-failed-jobs'));
    expect(rerunCalls).toHaveLength(1);
  });
});
