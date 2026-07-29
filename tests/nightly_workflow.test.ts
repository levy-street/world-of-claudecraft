import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NIGHTLY_LANES_PER_REF } from '../scripts/lib/nightly_plan.mjs';

const workflow = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { packageManager?: string };
const targetsEntry = readFileSync(
  new URL('../scripts/nightly_targets.mjs', import.meta.url),
  'utf8',
);
const reportEntry = readFileSync(new URL('../scripts/nightly_report.mjs', import.meta.url), 'utf8');

const PNPM_VERSION = (() => {
  const field = packageJson.packageManager ?? '';
  const match = field.match(/^pnpm@(\d+\.\d+\.\d+)$/);
  if (!match) {
    throw new Error(`package.json packageManager must be pnpm@X.Y.Z, got ${JSON.stringify(field)}`);
  }
  return match[1];
})();

// Same job-boundary slicing as tests/ci_workflow.test.ts: the lookahead stops
// at the next two-space job key OR a top-level comment line (which documents
// the next job), so one job's text or a neighbour's comment cannot satisfy a
// pin meant for another.
function jobSourceIn(text: string, name: string, file: string): string {
  const match = text.match(
    new RegExp(`\\n  ${name}:[\\s\\S]*?(?=\\n  [A-Za-z][A-Za-z0-9_-]*:|\\n  #|$)`),
  );
  if (!match) throw new Error(`missing ${file} job: ${name}`);
  return match[0];
}
const jobSource = (name: string) => jobSourceIn(workflow, name, 'nightly.yml');

// Anchored step-line form (\n + exact indent), the repo's comment-proof pin:
// a YAML-commented-out step keeps the substring but loses the anchored shape.
const stepLine = (line: string) =>
  new RegExp(`\\n {8}${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/** Every run: line of a job, in order, trimmed. */
function runLines(job: string): string[] {
  return (job.match(/\n {8}run: [^\n]+/g) ?? []).map((line) => line.trim());
}

// The five jobs, in file order. The inventory is pinned so a new lane cannot
// arrive without joining every per-job assertion below (timeout, checkout
// hygiene), and so the lanes-per-ref constant stays wired to reality.
const JOB_NAMES = ['targets', 'tests', 'checks', 'browser', 'report'] as const;
const LANE_JOBS = ['tests', 'checks', 'browser'] as const;

describe('nightly gate workflow', () => {
  it('runs on a schedule and manual dispatch only, never on PR or push traffic', () => {
    const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
    expect(triggers).toMatch(
      /\n {2}schedule:\n {4}# [^\n]+\n[^\n]*\n {4}- cron: '47 4 \* \* \*'\n/,
    );
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).toMatch(/\n {6}ref:\n/);
    // The whole point of a separate file: zero added PR latency, and no cron
    // fan-out into ci.yml's PR-shaped jobs (same reasoning as audit.yml).
    expect(triggers).not.toContain('pull_request');
    expect(triggers).not.toMatch(/\n {2}push:/);
  });

  it('keeps the job inventory pinned, each job bounded, and every checkout credential-free', () => {
    const jobsSection = workflow.slice(workflow.indexOf('\njobs:'));
    const jobKeys = (jobsSection.match(/^ {2}[a-z][\w-]*:$/gm) ?? []).map((key) =>
      key.trim().replace(/:$/, ''),
    );
    expect(jobKeys).toEqual([...JOB_NAMES]);
    for (const name of JOB_NAMES) {
      const job = jobSource(name);
      // A wedged runner must fail the job, not eat the night.
      expect(job).toMatch(/\n {4}timeout-minutes: \d+\n/);
      // No checkout leaves a token in .git/config: the write-scoped report job
      // must not persist one, and the lanes are where arbitrary-ref code runs.
      expect(job).toContain('persist-credentials: false');
    }
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(JOB_NAMES.length);
    // Nothing cancels a nightly pass; dispatch and schedule stay in separate
    // concurrency groups.
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('resolves refs through the tested script and fans every lane over them', () => {
    const targets = jobSource('targets');
    expect(targets).toMatch(stepLine('run: node scripts/nightly_targets.mjs'));
    expect(targets).toContain('refs: ${{ steps.resolve.outputs.refs }}');
    expect(targets).toContain('NIGHTLY_REF: ${{ inputs.ref }}');
    // The real default branch rides in from the event, so a renamed default
    // branch cannot strand the nightly on a hardcoded 'main'.
    expect(targets).toContain(
      'NIGHTLY_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}',
    );
    expect(targets).toContain('filter: blob:none');
    for (const name of LANE_JOBS) {
      const job = jobSource(name);
      expect(job).toMatch(/^\s{4}needs: targets$/m);
      expect(job).toContain('ref: ${{ fromJSON(needs.targets.outputs.refs) }}');
      expect(job).toContain('fail-fast: false');
      expect(job).toContain('ref: ${{ matrix.ref }}');
      expect(job).toMatch(stepLine('run: pnpm install --frozen-lockfile'));
      expect(job).toContain(`version: ${PNPM_VERSION}`);
    }
    // The proven-green guard counts this many lanes per ref; the workflow and
    // the planning lib must agree or every night reads as unproven.
    expect(LANE_JOBS).toHaveLength(NIGHTLY_LANES_PER_REF);
    // The entry scripts stay wired to the unit-tested planning lib: the
    // targets entry emits the JSON-escaped refs output the matrix consumes,
    // and the report entry calls the planner and the drill identity switch.
    expect(targetsEntry).toContain("from './lib/nightly_plan.mjs'");
    expect(targetsEntry).toContain('refs=${JSON.stringify(targets)}');
    expect(targetsEntry).toContain('refNamesFromMatchingRefs(');
    expect(reportEntry).toContain("from './lib/nightly_plan.mjs'");
    expect(reportEntry).toMatch(/planNightlyReport\(\{/);
    expect(reportEntry).toContain('summarizeRunJobs(');
    expect(reportEntry).toContain('trackingIssueIdentity(');
    expect(reportEntry).toContain('parseTargetsEnv(');
    expect(reportEntry).toContain('labelEnsureFailed(');
  });

  it('runs the full unsharded suite per ref, with the bounded worker cap', () => {
    const tests = jobSource('tests');
    expect(tests).toMatch(stepLine('run: npm test -- --maxWorkers='));
    expect(tests).toContain(
      'run: npm test -- --maxWorkers="$(node -p \'Math.max(1, Math.floor(require("node:os").availableParallelism() / 2))\')"',
    );
    // Unsharded by design: a --shard flag here would quietly turn the nightly
    // proof into a partial run.
    expect(tests).not.toContain('--shard');
    // The expected-red release-i18n locale tier stays out of the whole file
    // (issue #2820), not just out of the tests job.
    expect(workflow).not.toContain('I18N_RELEASE_TIER');
    // Uncached by design, and pinned because docs/qa-gate.md says so out
    // loud: the nightly is the one full replay that never restores the
    // vitest transform cache the PR-tier test jobs persist (Phase 4, plus
    // the long-sims lane since Phase 6), so a cache-layer bug can never
    // hide from it.
    expect(workflow).not.toContain('.experimental-vitest-cache');
    // Retry-free by design too (Phase 6): the nightly must never run the
    // PR tier's selection-aware entry or its known-flake retry runner; a
    // nightly teardown-rpc red stays red, per docs/qa-gate.md.
    expect(workflow).not.toContain('ci_shard_test');
    expect(workflow).not.toContain('ci_leg_runner');
  });

  it('mirrors the serialized release checks from ci.yml and the browser lane', () => {
    // Derived from ci.yml rather than a hand-copied list, so a check step
    // added to the release lane cannot leave the nightly silently thinner.
    // The tsc incremental cache is a uses: step, not a run: step, so the two
    // run-line sequences must match exactly, in order.
    const releaseChecks = jobSourceIn(ciWorkflow, 'release-checks', 'ci.yml');
    const checks = jobSource('checks');
    // runLines reads single-line run: steps only, so a block scalar would be
    // compared by its first line alone; refuse loudly instead of comparing a
    // truncated view.
    expect(checks).not.toContain('run: |');
    expect(releaseChecks).not.toContain('run: |');
    expect(runLines(checks)).toEqual(runLines(releaseChecks));
    expect(checks).not.toContain('run: npm test');
    const browser = jobSource('browser');
    expect(browser).toMatch(stepLine('run: npx playwright install --with-deps chromium'));
    expect(browser).toMatch(stepLine('run: npm run test:browser'));
    expect(browser).toContain('path: ~/.cache/ms-playwright');
  });

  it('always reports, and only the report job may write issues', () => {
    const report = jobSource('report');
    expect(report).toMatch(/^\s{4}needs: \[targets, tests, checks, browser\]$/m);
    // Anchored to the full line (both legal spellings): `always() && false`
    // would silently disable the workflow's only alerting deliverable.
    expect(report).toMatch(/^ {4}if: (\$\{\{ always\(\) \}\}|always\(\))$/m);
    expect(report).toMatch(stepLine('run: node scripts/nightly_report.mjs'));
    expect(report).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(report).toContain('NIGHTLY_TARGETS: ${{ needs.targets.outputs.refs }}');
    // The drill switch: a dispatch ref makes the report use the drill issue
    // identity instead of the production one.
    expect(report).toContain('NIGHTLY_REF: ${{ inputs.ref }}');
    // The report job must judge the workflow's own ref, never a resolved one:
    // it is the one job holding a write scope, so its checkout carries no
    // ref: input at all (not merely not matrix.ref).
    expect(report).not.toContain('matrix.ref');
    expect(report).not.toMatch(/^ {10}ref:/m);
    // Workflow-level permissions stay read-only; the report job's block is the
    // only widen and issues: write is the only write scope in the file.
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    expect(workflow.match(/^\s*permissions:/gm)).toHaveLength(2);
    expect(report).toMatch(/\n {4}permissions:\n {6}contents: read\n {6}issues: write\n/);
    expect(workflow.match(/^\s*[\w-]+: write\s*$/gm)).toEqual(['      issues: write']);
    expect(workflow).not.toContain('write-all');
    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toContain('pull_request_target');
  });
});
