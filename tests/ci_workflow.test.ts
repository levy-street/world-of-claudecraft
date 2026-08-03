import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFullGateSteps } from '../scripts/lib/gate_steps.mjs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { packageManager?: string };
const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
// Shared step list (Phase 8): gate.mjs delegates here; pins below use both.
const gateSteps = buildFullGateSteps(8);
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const balancedSequencer = readFileSync(
  new URL('../scripts/ci_balanced_sequencer.mjs', import.meta.url),
  'utf8',
);
const shardPartition = readFileSync(
  new URL('../scripts/ci_shard_partition.mjs', import.meta.url),
  'utf8',
);

// Exact pnpm version pinned in package.json packageManager (e.g. pnpm@10.34.5).
const PNPM_VERSION = (() => {
  const field = packageJson.packageManager ?? '';
  const match = field.match(/^pnpm@(\d+\.\d+\.\d+)$/);
  if (!match) {
    throw new Error(`package.json packageManager must be pnpm@X.Y.Z, got ${JSON.stringify(field)}`);
  }
  return match[1];
})();

// Locked shard count for pr-gate and release-gate matrices (CI speed packet).
// Supersedes the prior toolchain N=4 on this surface. Both test jobs share this
// N. Prefer this single constant over scattering /N literals.
const SHARD_N = 8;
const SHARD_MATRIX = Array.from({ length: SHARD_N }, (_, i) => i + 1).join(', ');

// Shared serialized check-run lines for both pr-checks and release-checks (D8).
// One list so a step added on one arm only fails the other arm's pin.
const CHECK_RUN_STEPS = [
  'run: npm run i18n:gen',
  'run: node scripts/i18n_coverage_summary.mjs',
  'run: git diff --exit-code -- src/ui/i18n.resolved.generated',
  'run: npm run security:gate',
  'run: npm run check:types',
  'run: npm run build:env',
  'run: npm run build:server',
  'run: npm run build\n',
] as const;

// Exact job-level if line for both release jobs. toContain alone would allow a
// widened expression that still embeds this fragment and could run on ordinary PRs.
const RELEASE_IF_LINE =
  "    if: (github.event_name == 'pull_request' && github.base_ref == 'main' && startsWith(github.head_ref, 'release/')) || (github.event_name == 'push' && startsWith(github.ref, 'refs/heads/release/'))";

// PR-tier event routing (release-to-main exclusion + non-release push + dispatch).
// Path-filter arm is AND-composed separately so either arm can be pinned alone.
const PR_TIER_EVENT_FRAGMENT =
  "(github.event_name == 'pull_request' && (github.base_ref != 'main' || !startsWith(github.head_ref, 'release/'))) || (github.event_name == 'push' && !startsWith(github.ref, 'refs/heads/release/')) || github.event_name == 'workflow_dispatch'";

// Exact composed if for pr-gate and pr-checks after Phase 5 path filters (D10).
// Extra parens around the event fragment keep || from binding past the && code arm.
const PR_TIER_IF_LINE = `    if: (${PR_TIER_EVENT_FRAGMENT}) && needs.changes.outputs.code == 'true'`;

// Minimum code path globs the changes job must classify as code=true (D10).
const CODE_PATH_GLOBS = [
  'src/*',
  'server/*',
  'tests/*',
  'headless/*',
  'bot/*',
  'scripts/*',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.admin.json',
  'vite.config.ts',
  'vitest.browser.config.ts',
  'biome.json',
  '.github/workflows/*',
  'electron/*',
  'android/*',
  'ios/*',
  'public/*',
  // Security-adjacent / deploy surfaces: must not skip malware+builds (privacy review).
  'deploy/*',
  'mediawiki/*',
  'Dockerfile',
  'Dockerfile.*',
  'docker-compose.yml',
  'docker-compose.yaml',
] as const;

function jobSource(name: string): string {
  const match = workflow.match(new RegExp(`\\n  ${name}:[\\s\\S]*?(?=\\n  [a-z][a-z-]+:|$)`));
  if (!match) throw new Error(`missing CI job: ${name}`);
  return match[0];
}

describe('CI workflow parity', () => {
  it('installs with pnpm frozen-lockfile and pins the packageManager version', () => {
    // Full migration: no npm ci install path, cache and install are pnpm-only,
    // and every pnpm/action-setup version matches package.json packageManager so
    // CI cannot silently lag the local pin.
    expect(workflow).not.toContain('run: npm ci');
    expect(workflow).not.toContain('cache: npm');
    expect(workflow).toContain('cache: pnpm');
    expect(workflow).toContain('run: pnpm install --frozen-lockfile');
    expect(workflow).toContain('uses: pnpm/action-setup@v4');
    expect(workflow).toContain(`version: ${PNPM_VERSION}`);
    const setupPins = workflow.match(
      /uses: pnpm\/action-setup@v4\n {8}with:\n {10}version: [^\n]+/g,
    );
    expect(setupPins?.length).toBeGreaterThanOrEqual(4);
    for (const pin of setupPins ?? []) {
      expect(pin).toContain(`version: ${PNPM_VERSION}`);
    }
    // Lockfile path filter + tsc cache keys must hash pnpm-lock.yaml only.
    expect(workflow).toContain('pnpm-lock.yaml');
    expect(workflow).not.toContain('package-lock.json');
  });

  it('cancels a superseded PR run without letting PR traffic cancel release pushes', () => {
    // Anchored above the first job so a future job named "concurrency" cannot
    // be mistaken for this block. D4: group includes event_name so pull_request
    // and push never share a cancel group; cancel-in-progress stays true.
    const concurrency = workflow.slice(0, workflow.indexOf('\njobs:'));
    expect(concurrency).toMatch(
      /\nconcurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n {2}cancel-in-progress: true\n/,
    );
  });

  it('runs the canonical game and admin typecheck in CI and the local gate', () => {
    // One occurrence in pr-checks and one in release-checks (the parallel
    // check jobs). Neither test job typechecks.
    expect(workflow.match(/run: npm run check:types/g)).toHaveLength(2);
    expect(jobSource('pr-checks')).toContain('run: npm run check:types');
    expect(jobSource('release-checks')).toContain('run: npm run check:types');
    expect(jobSource('pr-gate')).not.toContain('run: npm run check:types');
    expect(jobSource('release-gate')).not.toContain('run: npm run check:types');
    expect(workflow).not.toContain('run: npx tsc --noEmit');
    // Local gate runs typecheck through turbo (Phase 8); CI still uses npm run check:types.
    expect(gate).toContain('buildFullGateSteps');
    expect(gateSteps.some((s) => s.name === 'typecheck + env/server builds')).toBe(true);
    expect(gateSteps.find((s) => s.name === 'typecheck + env/server builds')?.args).toEqual(
      expect.arrayContaining(['turbo', 'run', 'check:types']),
    );
  });

  it('provisions FFmpeg from the static npm packages instead of apt', () => {
    // The gate preflight and the Studio playback/encode spawns resolve
    // ffmpeg/ffprobe via scripts/sfx/ffmpeg_paths.mjs (ffmpeg-static/
    // ffprobe-static with a PATH fallback); the conformance-measuring call sites
    // (sfx_conform.mjs, export_bundle.mjs) bind to the static packages directly.
    // Either way no CI job apt-installs system FFmpeg; reintroducing the install
    // step would put its cost back on every job it touches.
    expect(workflow).not.toContain('apt-get');
    expect(gate).toContain("from './sfx/ffmpeg_paths.mjs'");
  });

  it('runs the opt-in Chromium browser regressions in their own CI job', () => {
    const browserGate = jobSource('browser-gate');
    expect(browserGate).toContain('run: npx playwright install --with-deps chromium');
    expect(browserGate).toContain('run: npm run test:browser');
    const browser = gateSteps.find((s) => s.name === 'browser regressions');
    expect(browser?.cmd).toBe('npm');
    expect(browser?.args).toEqual(['run', 'test:browser']);
  });

  it('keeps lint shallow, cancels superseded PR runs, and caches Playwright Chromium', () => {
    // D12: full-history checkout was pure waste for biome --changed --since.
    // The base commit is fetched with --depth=1 in the determine-base step.
    const lint = jobSource('lint');
    // Fail if the lint checkout reintroduces a full-history with: block.
    expect(lint).not.toMatch(
      /Check out repository[\s\S]*?uses: actions\/checkout@[^\n]+\n\s+with:\n\s+fetch-depth:\s*0/,
    );
    expect(lint).not.toMatch(/^\s+fetch-depth:\s*(?:0|"0")\s*$/m);
    expect(lint).toContain('git fetch --no-tags --depth=1 origin');
    expect(lint).toContain('npx @biomejs/biome ci --changed --since=');
    // Push arm must still resolve a base without reintroducing full history:
    // pre-push tip, HEAD~1, or the default branch tip.
    expect(lint).toContain('BEFORE_SHA');
    expect(lint).toContain('HEAD~1');
    expect(lint).toContain('DEFAULT_BRANCH');

    // D4: workflow-level concurrency cancels in-progress runs; group key
    // includes event name and PR number/ref so release work stays isolated.
    // Adjacency pin so a comment or job-level block cannot satisfy the shape.
    expect(workflow).toMatch(
      /\nconcurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n {2}cancel-in-progress: true\n/,
    );

    // Browser-gate reuses Chromium via actions/cache keyed on Playwright version.
    // Name-to-uses adjacency + cache-before-install order so comments alone fail.
    const browserGate = jobSource('browser-gate');
    expect(browserGate).toMatch(
      /- name: Cache Playwright Chromium browsers\n(?: {8}#[^\n]*\n)* {8}uses: actions\/cache@[^\n]+\n {8}with:\n {10}path: ~\/\.cache\/ms-playwright\n/,
    );
    expect(browserGate).toContain("require('playwright/package.json').version");
    expect(browserGate.indexOf('Cache Playwright Chromium browsers')).toBeLessThan(
      browserGate.indexOf('run: npx playwright install --with-deps chromium'),
    );
    expect(browserGate).toContain('run: npx playwright install --with-deps chromium');
  });

  it('posts the i18n coverage summary and diffs the committed artifacts in both check jobs', () => {
    // The job-summary step is the out-of-band audit trail that replaced the
    // committed src/ui/i18n.status.summary.json; deleting it would silently
    // drop the trail, and re-adding the summary to a freshness diff or to
    // gate.mjs would resurrect the aggregate merge conflicts the degit removed.
    // Coverage + freshness live in the parallel check jobs, not the test jobs.
    const prChecks = jobSource('pr-checks');
    const releaseChecks = jobSource('release-checks');
    for (const job of [prChecks, releaseChecks]) {
      expect(job).toContain('run: node scripts/i18n_coverage_summary.mjs');
      expect(job).toContain(
        'run: git diff --exit-code -- src/ui/i18n.resolved.generated src/admin/i18n.resolved.generated src/ui/i18n.catalog/translation_keys.generated.ts',
      );
      expect(job).not.toContain('src/ui/i18n.status.summary.json');
    }
    expect(jobSource('pr-gate')).not.toContain('run: node scripts/i18n_coverage_summary.mjs');
    expect(jobSource('release-gate')).not.toContain('run: node scripts/i18n_coverage_summary.mjs');
    expect(gate).not.toContain('src/ui/i18n.status.summary.json');
  });

  it('runs the release tier against a release-to-main pull request merge result', () => {
    const prGate = jobSource('pr-gate');
    const prChecks = jobSource('pr-checks');
    const releaseGate = jobSource('release-gate');
    const releaseChecks = jobSource('release-checks');
    for (const job of [prGate, prChecks]) {
      // Exact composed if: event routing AND code path filter (D10). Dropping
      // either arm breaks release-to-main exclusion or docs-only skip.
      const ifLines = job.match(/^\s{4}if: .+$/gm) ?? [];
      expect(ifLines).toEqual([PR_TIER_IF_LINE]);
      expect(job).toContain(PR_TIER_EVENT_FRAGMENT);
      expect(job).toContain("needs.changes.outputs.code == 'true'");
      expect(job).not.toContain('I18N_RELEASE_TIER');
    }
    // Both release jobs share the exact same job-level if line so they skip or
    // run together. Exact-line match (not bare toContain of the fragment) so a
    // widened condition that still embeds the fragment cannot sneak ordinary
    // feature PRs onto release-checks. Anchored to the JOB level env block on
    // the TEST job only: moving the flag onto a single step would silently run
    // the other shards at PR tier; putting it on release-checks is unnecessary.
    for (const job of [releaseGate, releaseChecks]) {
      expect(job).toContain(RELEASE_IF_LINE);
      // Exactly one job-level if: line, equal to the literal (no widen).
      const ifLines = job.match(/^\s{4}if: .+$/gm) ?? [];
      expect(ifLines).toEqual([RELEASE_IF_LINE]);
      // Red-path: path filters must never land on release jobs (D10).
      expect(job).not.toContain('needs: changes');
      expect(job).not.toContain('needs.changes');
      expect(job).not.toContain('paths-ignore');
      expect(job).not.toContain('paths:');
    }
    expect(releaseGate).toContain("\n    env:\n      I18N_RELEASE_TIER: '1'");
    expect(releaseChecks).not.toContain('I18N_RELEASE_TIER');
  });

  it('splits the PR tier into parallel test and checks jobs that cover every step', () => {
    const prGate = jobSource('pr-gate');
    const prChecks = jobSource('pr-checks');
    // Parallel means no needs edge between the pair. Both may need `changes`
    // for the path filter; neither may wait on the other (would re-serialize).
    expect(prGate).toMatch(/^\s{4}needs: changes\s*$/m);
    expect(prChecks).toMatch(/^\s{4}needs: changes\s*$/m);
    expect(prGate).not.toMatch(/needs:\s*\[?[^\n]*pr-checks/);
    expect(prChecks).not.toMatch(/needs:\s*\[?[^\n]*pr-gate/);
    expect(prGate).toContain('run: npm test');
    expect(prChecks).not.toContain('run: npm test');
    for (const step of CHECK_RUN_STEPS) {
      expect(prChecks).toContain(step);
      expect(prGate).not.toContain(step);
    }
  });

  it('splits the release tier into parallel test and checks jobs that cover every step', () => {
    const releaseGate = jobSource('release-gate');
    const releaseChecks = jobSource('release-checks');
    // Mirror of the PR parallel pair (D8). No needs edge either way; checks
    // job carries every serialized step that used to sit behind
    // matrix.shard == 1 on release-gate; test job stays tests-only.
    expect(releaseGate).not.toContain('needs:');
    expect(releaseChecks).not.toContain('needs:');
    expect(releaseGate).toContain('run: npm test');
    expect(releaseChecks).not.toContain('run: npm test');
    expect(releaseChecks).not.toContain('strategy:');
    expect(releaseChecks).not.toContain('matrix:');
    // Red-path pin: reintroducing single-shard gating on the test job fails.
    expect(releaseGate).not.toContain('matrix.shard == 1');
    expect(workflow).not.toContain('matrix.shard == 1');
    for (const step of CHECK_RUN_STEPS) {
      expect(releaseChecks).toContain(step);
      expect(releaseGate).not.toContain(step);
    }
    // Named-step count: checkout, setup-pnpm, setup-node, pnpm install, plus nine
    // check steps (i18n gen/summary/freshness, malware, tsc cache, typecheck,
    // three builds). An accidental extra step on the checks job would otherwise
    // stay green.
    expect(releaseChecks.match(/\n {6}- name: /g)).toHaveLength(13);
    expect(jobSource('pr-checks').match(/\n {6}- name: /g)).toHaveLength(13);
    // tsc incremental cache (#2758) must land on both check jobs, never on a
    // matrixed test job (would N-way cache thrash or reintroduce shard-1 gates).
    for (const job of [releaseChecks, jobSource('pr-checks')]) {
      expect(job).toContain('Cache tsc incremental buildinfo');
      expect(job).toContain('path: node_modules/.cache/tsc');
      expect(job).not.toContain('if: matrix.shard == 1');
    }
    expect(jobSource('pr-gate')).not.toContain('Cache tsc incremental buildinfo');
    expect(releaseGate).not.toContain('Cache tsc incremental buildinfo');
  });

  it('classifies docs-only PRs via a native changes job and keeps release unfiltered', () => {
    // D10: native git-diff classifier (no dorny/paths-filter). Output code=true
    // forces the full PR tier; code=false skips pr-gate/pr-checks/browser-gate.
    // lint stays unfiltered. Release jobs never consult the output.
    const changes = jobSource('changes');
    expect(changes).toContain('id: filter');
    expect(changes).toContain('outputs:');
    expect(changes).toContain('code: ${{ steps.filter.outputs.code }}');
    expect(changes).toContain('fetch-depth: 0');
    expect(changes).toContain('EVENT_NAME');
    expect(changes).toContain('BASE_SHA');
    expect(changes).toContain('HEAD_SHA');
    // changes must always run (no job-level if). Gating it to pull_request only
    // would leave needs.changes dependents skipped on push to main/dev.
    expect(changes.match(/^\s{4}if: .+$/gm) ?? []).toEqual([]);
    // Non-PR events and empty/missing diffs fail closed toward code=true.
    expect(changes).toContain('non-PR event: full PR tier (code=true)');
    expect(changes).toContain('missing PR base/head SHAs: full PR tier (code=true)');
    expect(changes).toContain('empty file list: full PR tier (code=true)');
    expect(changes).toContain('echo "code=$code" >> "$GITHUB_OUTPUT"');
    expect(changes).toContain('code=false');
    expect(changes).toContain('code=true');
    for (const glob of CODE_PATH_GLOBS) {
      expect(changes).toContain(glob);
    }
    // No third-party path-filter action (D10: justify dorny in progress.md if added).
    expect(workflow).not.toContain('dorny/paths-filter');
    expect(workflow).not.toContain('paths-filter@');
    // Workflow-level path filters would skip the whole workflow (including
    // release-to-main). Job-level paths-ignore is invalid YAML but still banned.
    // Allow the changes job's case arms and comments only: ban on: block keys.
    expect(workflow).not.toMatch(/\non:\n(?:[ \t]+[^\n]+\n)*?[ \t]+paths(-ignore)?:/);

    const lint = jobSource('lint');
    expect(lint).not.toContain('needs: changes');
    expect(lint).not.toContain('needs.changes');
    // lint has no job-level if: (always runs, including docs-only).
    expect(lint.match(/^\s{4}if: .+$/gm) ?? []).toEqual([]);

    const browserGate = jobSource('browser-gate');
    expect(browserGate).toMatch(/^\s{4}needs: changes\s*$/m);
    const browserIf = browserGate.match(/^\s{4}if: .+$/gm) ?? [];
    expect(browserIf).toEqual(["    if: needs.changes.outputs.code == 'true'"]);

    // Aggregator only if branch protection cannot accept skipped checks. This
    // packet does not invent one without evidence (OPEN item 5: skipped release
    // jobs already show as skipping on ordinary PRs without blocking merge).
    expect(workflow).not.toMatch(/\n {2}ci-result:/);
    expect(workflow).not.toMatch(/\n {2}ci-success:/);

    // Red-path structural: a paths-ignore on either release job would silently
    // shrink release-tier enforcement on a docs-only release push.
    for (const name of ['release-gate', 'release-checks', 'release-version-gate'] as const) {
      const job = jobSource(name);
      expect(job).not.toContain('paths-ignore');
      expect(job).not.toContain('needs.changes');
      expect(job).not.toMatch(/^\s{4}needs:/m);
    }
  });

  it(`shards the PR and release test steps ${SHARD_N} ways and keeps the checks single-shard`, () => {
    const prGate = jobSource('pr-gate');
    const prChecks = jobSource('pr-checks');
    const releaseGate = jobSource('release-gate');
    const releaseChecks = jobSource('release-checks');
    // Both test jobs fan the ONE suite across the same N-shard matrix. The run
    // line stays `npm test` (whose pretest regenerates the i18n artifacts in
    // every shard: the S3 guard, guide freshness, and the git-subprocess suites
    // need them regardless of which shard they hash into), never a bare vitest
    // invocation. fail-fast stays off so shards pass or fail independently and
    // a red run always reports the whole suite.
    const halfCoreCap =
      '--maxWorkers="$(node -p \'Math.max(1, Math.floor(require("node:os").availableParallelism() / 2))\')"';
    const shardMatrixLine = `shard: [${SHARD_MATRIX}]`;
    const shardRunPrefix = `run: npm test -- --shard=\${{ matrix.shard }}/${SHARD_N}`;
    for (const job of [prGate, releaseGate]) {
      expect(job).toContain('strategy:');
      expect(job).toContain('fail-fast: false');
      expect(job).toContain(shardMatrixLine);
      expect(job).toContain(shardRunPrefix);
      expect(job).toContain(halfCoreCap);
    }
    const shardRunRe = new RegExp(
      String.raw`run: npm test -- --shard=\$\{\{ matrix\.shard \}\}\/${SHARD_N}`,
      'g',
    );
    expect(workflow.match(shardRunRe)).toHaveLength(2);
    // Legacy N=4 run lines must not remain once SHARD_N has moved on.
    // String(SHARD_N) comparison avoids tsc folding a constant always-true arm.
    if (String(SHARD_N) !== '4') {
      expect(workflow).not.toMatch(/run: npm test -- --shard=\$\{\{ matrix\.shard \}\}\/4\b/);
      // Exact matrix of length 4 only (trailing newline after closing bracket).
      expect(workflow).not.toContain('shard: [1, 2, 3, 4]\n');
    }
    // Every matrix entry 1..N is present (missing a slot is a silent shrink).
    for (let i = 1; i <= SHARD_N; i++) {
      expect(prGate).toMatch(new RegExp(`shard: \\[[^\\]]*\\b${i}\\b`));
      expect(releaseGate).toMatch(new RegExp(`shard: \\[[^\\]]*\\b${i}\\b`));
    }
    expect(workflow).not.toContain('npx vitest');
    // The local gate is the one place the whole suite still runs as a single
    // unsharded pass (bounded workers); a --shard flag there would silently
    // turn the pre-merge gate into a partial run, deleting the step would
    // silently drop tests from the gate entirely, and dropping the worker
    // bound would reintroduce the documented core-contention flake mode.
    expect(gate).not.toContain('--shard');
    const vitest = gateSteps.find((s) => s.name === 'vitest (full suite)');
    expect(vitest?.cmd).toBe('npm');
    expect(vitest?.args).toEqual(['test', '--', '--maxWorkers=8']);
    expect(vitest?.env).toEqual({ WOC_SKIP_PRETEST: '1' });
    // gate.mjs still binds workers into the shared step builder.
    expect(gate).toContain('buildFullGateSteps(workers)');
    expect(gate).toContain('computeGateWorkers');
    // Both check jobs stay single unsharded jobs: serialized checks run once.
    for (const job of [prChecks, releaseChecks]) {
      expect(job).not.toContain('strategy:');
      expect(job).not.toContain('matrix:');
    }
    // Both test jobs are tests-only: nothing is gated to a single shard.
    // Phase 4 moved serialized checks to release-checks; matrix.shard == 1
    // must not return on either test job (would re-serialize or shrink).
    expect(prGate).not.toContain('matrix.shard == 1');
    expect(releaseGate).not.toContain('matrix.shard == 1');
    // The release TEST step itself must stay un-gated (run on every shard):
    // name-to-run adjacency proves no if: line sits between them.
    expect(releaseGate).toMatch(
      new RegExp(
        String.raw`- name: Run tests \(release tier[^\n]*\n {8}run: npm test -- --shard=\$\{\{ matrix\.shard \}\}\/${SHARD_N}`,
      ),
    );
    // Structural step counts: each test job is exactly checkout, setup-pnpm,
    // setup-node, pnpm install, and the sharded test run. An unconditioned
    // addition would run N times per push; a dropped step shrinks the job silently.
    expect(prGate.match(/\n {6}- name: /g)).toHaveLength(5);
    expect(releaseGate.match(/\n {6}- name: /g)).toHaveLength(5);
  });

  it('keeps D11 path-matrix tooling available but unwired after two MISS approaches', () => {
    // Both LPT and stripe greened with completeness but D11 MISS (ratios 1.59 /
    // 1.64). Sequencer stays in-tree for a future measured-weight attempt; CI
    // must not re-wire it without a green D11 probe. Default --shard is back.
    expect(viteConfig).not.toContain('sequencer: BalancedSequencer');
    expect(viteConfig).not.toContain("from './scripts/ci_balanced_sequencer.mjs'");
    expect(balancedSequencer).toContain('extends BaseSequencer');
    expect(balancedSequencer).toContain('partitionForCi');
    expect(shardPartition).toContain('export function partitionByStripe');
    expect(shardPartition).toContain('export function partitionByLpt');
    expect(shardPartition).toContain('export function weightForTestFile');
    expect(shardPartition).not.toContain("from 'vitest");
    expect(workflow).toContain('ci_balanced_sequencer.mjs');
    // Integrity guard kept even with default packs.
    expect(viteConfig).toContain('passWithNoTests: false');
  });
});
