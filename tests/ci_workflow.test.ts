import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isCodePath } from '../scripts/lib/ci_change_classify.mjs';
import { CI_LONG_SUITE_HALVES } from '../scripts/lib/ci_shard_plan.mjs';
import { decideTestMode } from '../scripts/lib/ci_test_select.mjs';
import {
  GENERATED_I18N_ARTIFACT_FILES,
  GENERATED_I18N_ARTIFACT_PREFIXES,
  isGeneratedI18nArtifactPath,
} from '../scripts/lib/gate_select_plan.mjs';
import { buildFullGateSteps, I18N_ARTIFACTS } from '../scripts/lib/gate_steps.mjs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const detectEntry = readFileSync(
  new URL('../scripts/detect_code_changes.mjs', import.meta.url),
  'utf8',
);
const ciShardEntry = readFileSync(new URL('../scripts/ci_shard_test.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { packageManager?: string };
const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
const preflightCode = readFileSync(
  new URL('../scripts/lib/gate_preflight.mjs', import.meta.url),
  'utf8',
);
// gate.mjs with its comments removed, BOTH kinds. A raw-substring pin on a step
// is not a pin at all: commenting the step out leaves the substring in the file,
// so the assertion stays green while the local gate quietly stops running it.
// Block comments are stripped first (a `/* ... */` wrapper defeats a line-comment
// strip just as well), then line comments, leaving anything after `://` alone so
// a URL inside a string cannot be truncated.
const gateCode = gate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
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

// Typecheck plus the three independent pure builds (env/server/bot), collapsed
// into one turbo call so CI shares the exact idiom gate.mjs already uses for
// intra-task cache/parallelism (scripts/lib/gate_task_cache.mjs turboRunArgs).
const TYPECHECK_BUILDS_TURBO_RUN =
  'run: npx turbo run check:types build:env build:server build:bot --ui=stream';

// Shared serialized check-run lines for both pr-checks and release-checks (D8).
// One list so a step added on one arm only fails the other arm's pin.
const CHECK_RUN_STEPS = [
  'run: npm run i18n:gen',
  'run: node scripts/i18n_coverage_summary.mjs',
  'run: git diff --exit-code -- src/ui/i18n.resolved.generated',
  'run: npm run security:gate',
  TYPECHECK_BUILDS_TURBO_RUN,
  'run: npm run wiki:content && npm run build:bundle\n',
] as const;

// Exact job-level if line for both release jobs. toContain alone would allow a
// widened expression that still embeds this fragment and could run on ordinary PRs.
const RELEASE_IF_LINE =
  "    if: (github.event_name == 'pull_request' && github.base_ref == 'main' && startsWith(github.head_ref, 'release/')) || (github.event_name == 'push' && startsWith(github.ref, 'refs/heads/release/'))";

// PR-tier event routing (release-to-main exclusion + non-release push + dispatch
// + merge queue). merge_group is unconditional: the queue bar is the full PR
// tier, including a queued release-to-main merge (the release exclusion lives on
// the pull_request arm and cannot match a merge_group event).
// Path-filter arm is AND-composed separately so either arm can be pinned alone.
const PR_TIER_EVENT_FRAGMENT =
  "(github.event_name == 'pull_request' && (github.base_ref != 'main' || !startsWith(github.head_ref, 'release/'))) || (github.event_name == 'push' && !startsWith(github.ref, 'refs/heads/release/')) || github.event_name == 'workflow_dispatch' || github.event_name == 'merge_group'";

// Exact composed if for pr-gate and pr-checks after Phase 5 path filters (D10).
// Extra parens around the event fragment keep || from binding past the && code arm.
// The code arm is != 'false' (not == 'true'): only an explicit docs-only verdict
// may skip the tier. A missing or empty output runs it, matching the
// classifier's fail-closed doctrine; under the merge queue a skipped required
// check reads satisfied, so failing toward SKIP would be the wrong direction.
// (Covers green-but-empty output only: a FAILED changes job skips dependents
// via needs regardless, which requiring "Detect code path changes" closes.)
const PR_TIER_IF_LINE = `    if: (${PR_TIER_EVENT_FRAGMENT}) && needs.changes.outputs.code != 'false'`;

// pr-gate alone splits those two arms across levels (the docs-only matrix
// collapse fix): the JOB if carries only the event routing, so every
// pull_request and merge_group run expands the shard matrix and reports all
// eight suffixed check runs, and EVERY step carries the release-to-main
// exclusion plus the code arm, so a leg the run does not apply to no-ops
// green under its required suffixed name. A job-level skip of a MATRIX job
// collapses to one check run WITHOUT the (N) suffix, which string-matches
// none of the required shard contexts and leaves them "expected" forever
// (observed live on the Phase 3 queue drills, PR #3038), which is why the
// job if must never regain either gate arm. The step gate keeps the
// != 'false' fail-closed polarity for the same reason PR_TIER_IF_LINE does.
const PR_GATE_JOB_IF_LINE =
  "    if: github.event_name == 'pull_request' || (github.event_name == 'push' && !startsWith(github.ref, 'refs/heads/release/')) || github.event_name == 'workflow_dispatch' || github.event_name == 'merge_group'";
const PR_GATE_STEP_GATE_LINE =
  "        if: (github.event_name != 'pull_request' || github.base_ref != 'main' || !startsWith(github.head_ref, 'release/')) && needs.changes.outputs.code != 'false'";

/** Escape a literal for embedding in a RegExp source. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The step gate as an anchored regex segment for the step-shape pins below:
// the EXACT literal, escaped and newline-terminated, so an anchored step pin
// on pr-gate admits precisely the gate and nothing else (an `if: false`
// neutering mutation still breaks the shape).
const PR_GATE_STEP_GATE_RE_SEGMENT = `${escapeRe(PR_GATE_STEP_GATE_LINE)}\n`;

// Minimum code path set the changes job must classify as code=true (D10).
// Each row pairs the original inline-YAML glob with a representative path;
// the pin is behavioral (through scripts/lib/ci_change_classify.mjs) because
// the rules no longer live in the workflow text at all.
const CODE_PATH_SAMPLES = [
  ['src/*', 'src/sim/sim.ts'],
  ['server/*', 'server/game.ts'],
  ['tests/*', 'tests/sim.test.ts'],
  ['headless/*', 'headless/env_server.ts'],
  ['bot/*', 'bot/src/index.ts'],
  ['scripts/*', 'scripts/gate.mjs'],
  ['package.json', 'package.json'],
  ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
  ['tsconfig.json', 'tsconfig.json'],
  ['tsconfig.admin.json', 'tsconfig.admin.json'],
  ['vite.config.ts', 'vite.config.ts'],
  ['vitest.browser.config.ts', 'vitest.browser.config.ts'],
  ['biome.json', 'biome.json'],
  ['.github/workflows/*', '.github/workflows/ci.yml'],
  ['electron/*', 'electron/main.ts'],
  ['android/*', 'android/app/build.gradle'],
  ['ios/*', 'ios/App/AppDelegate.swift'],
  ['public/*', 'public/models/prop.glb'],
  // Security-adjacent / deploy surfaces: must not skip malware+builds (privacy review).
  ['deploy/*', 'deploy/mediawiki/first-boot.sh'],
  ['mediawiki/*', 'mediawiki/Dockerfile'],
  ['Dockerfile', 'Dockerfile'],
  ['Dockerfile.*', 'Dockerfile.bot'],
  ['docker-compose.yml', 'docker-compose.yml'],
  ['docker-compose.yaml', 'docker-compose.yaml'],
  // Widened when the rules became a tested module: root build and
  // supply-chain inputs the old inline set skipped (the shipped entry
  // documents carry inline scripts and third-party tags; the configs steer
  // the install and every bundle).
  ['index.html', 'index.html'],
  ['play.html', 'play.html'],
  ['admin.html', 'admin.html'],
  ['guide.html', 'guide.html'],
  ['editor.html', 'editor.html'],
  ['wallet-handoff.html', 'wallet-handoff.html'],
  ['music_editor.html', 'music_editor.html'],
  ['svelte.config.js', 'svelte.config.js'],
  ['capacitor.config.ts', 'capacitor.config.ts'],
  ['tsconfig.bot.json', 'tsconfig.bot.json'],
  ['turbo.json', 'turbo.json'],
  ['.npmrc', '.npmrc'],
  ['.browserslistrc', '.browserslistrc'],
  ['.dockerignore', '.dockerignore'],
  ['data/*', 'data/battleground/thornhollow.map.json'],
  ['python/*', 'python/wow_env.py'],
] as const;

// Paths that must stay classifiable as docs-only, or every documentation PR
// silently pays the full 8-shard tier again.
const NON_CODE_SAMPLES = [
  'README.md',
  'CLAUDE.md',
  'docs/prd/some-spec.md',
  'docs/screenshots/before.png',
  '.github/PULL_REQUEST_TEMPLATE.md',
] as const;

function jobSource(name: string): string {
  // The lookahead is the job boundary. It accepts digits, underscores, and an
  // uppercase initial: a future job id like `pr-gate2` or `Release` would
  // otherwise not terminate the previous slice, letting one job's text bleed
  // into another and quietly satisfying a by-name pin from the wrong job.
  // It also stops at a top-level (two-space) comment line: those document the
  // NEXT job, and letting them bleed into the previous slice makes negative
  // pins (not.toContain) fail on a neighbour's comment text.
  const match = workflow.match(
    new RegExp(`\\n  ${name}:[\\s\\S]*?(?=\\n  [A-Za-z][A-Za-z0-9_-]*:|\\n  #|$)`),
  );
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
    // check jobs), collapsed with the env/server/bot builds into one turbo
    // call. Neither test job typechecks.
    expect(workflow.match(new RegExp(escapeRe(TYPECHECK_BUILDS_TURBO_RUN), 'g'))).toHaveLength(2);
    expect(jobSource('pr-checks')).toContain(TYPECHECK_BUILDS_TURBO_RUN);
    expect(jobSource('release-checks')).toContain(TYPECHECK_BUILDS_TURBO_RUN);
    expect(jobSource('pr-gate')).not.toContain('check:types');
    expect(jobSource('release-gate')).not.toContain('check:types');
    expect(workflow).not.toContain('run: npx tsc --noEmit');
    // Local gate runs typecheck through turbo (Phase 8); CI now shares that
    // exact idiom instead of four separate serial npm steps. The combined step
    // carries the Discord bot build too (R7: every consumer of the shared list
    // builds the bot beside the server).
    expect(gate).toContain('buildFullGateSteps');
    expect(gateSteps.some((s) => s.name === 'typecheck + env/server/bot builds')).toBe(true);
    const typesBuilds = gateSteps.find((s) => s.name === 'typecheck + env/server/bot builds');
    // The local gate resolves turbo's own binary directly (no npx dispatch);
    // cmd carries the "turbo" identity, args starts at "run" (gate_task_cache.mjs).
    expect(typesBuilds?.cmd).toMatch(/(?:^|[\\/])turbo(?:\.cmd)?$/);
    expect(typesBuilds?.args).toEqual(expect.arrayContaining(['run', 'check:types', 'build:bot']));
  });

  it('provisions FFmpeg from the static npm packages instead of apt', () => {
    // The gate preflight and the Studio playback/encode spawns resolve
    // ffmpeg/ffprobe via scripts/sfx/ffmpeg_paths.mjs (ffmpeg-static/
    // ffprobe-static with a PATH fallback); the conformance-measuring call sites
    // (sfx_conform.mjs, export_bundle.mjs) bind to the static packages directly.
    // Either way no CI job apt-installs system FFmpeg; reintroducing the install
    // step would put its cost back on every job it touches.
    // The preflight itself now lives in scripts/lib/gate_preflight.mjs so
    // gate.mjs and gate_select.mjs share one copy; the pin follows it there and
    // additionally holds gate.mjs to still invoking it, which is what actually
    // makes the resolution reachable.
    expect(workflow).not.toContain('apt-get');
    expect(preflightCode).toContain("from '../sfx/ffmpeg_paths.mjs'");
    expect(gateCode).toContain('runGatePreflights');
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
    // No restore-keys: the key is already exact-version-scoped, so a prefix
    // fallback could only ever restore a PRIOR Playwright version's binaries
    // alongside the new install. actions/cache never evicts an old entry, so
    // every future version bump would silently leave that stale version's
    // Chromium cached forever instead of a clean version-scoped miss.
    // Anchored to the YAML key shape (bare, double- or single-quoted) so a
    // step comment mentioning the phrase cannot satisfy the pin.
    expect(browserGate).not.toMatch(/\n\s+["']?restore-keys["']?:/);
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

  it('pins the inert generated-i18n classifier to exactly the freshness-diffed paths', () => {
    // The selective planner may treat a generated i18n artifact as inert ONLY
    // because this workflow reruns i18n:gen and `git diff --exit-code`s the
    // artifact paths on every code PR (pr-checks) and on the release push
    // (release-checks). This holds the two lists to each other: widening the
    // classifier without widening the freshness diff, or narrowing the diff
    // without narrowing the classifier, must fail HERE, not as a silent
    // selection escape in production.
    const classifierPaths = [
      ...GENERATED_I18N_ARTIFACT_PREFIXES.map((p) => p.replace(/\/$/, '')),
      ...GENERATED_I18N_ARTIFACT_FILES,
    ].sort();
    // The LOCAL gate's freshness list must agree too: gate_select treats the
    // classifier's paths as never-widening on the strength of the local i18n
    // freshness step covering them, and that step builds its argv from
    // I18N_ARTIFACTS. Without this coupling, narrowing I18N_ARTIFACTS would
    // silently orphan the local half of the safety argument (the step's own
    // test compares the argv to the same constant, which pins nothing).
    expect([...I18N_ARTIFACTS].sort()).toEqual(classifierPaths);
    for (const jobName of ['pr-checks', 'release-checks']) {
      const job = jobSource(jobName);
      // Anchored to the src/ prefix so a future unrelated `git diff
      // --exit-code` step added above this one cannot re-point the pin.
      const m = job.match(/run: git diff --exit-code -- (src\/[^\n]+)/);
      expect(m, `${jobName} must carry the freshness diff step`).not.toBeNull();
      const freshnessPaths = (m as RegExpMatchArray)[1].trim().split(/\s+/).sort();
      expect(classifierPaths).toEqual(freshnessPaths);
      // Regenerate BEFORE diff, inside the same job, so the diff proves the
      // committed artifacts against the PR's own sources. Trailing newline so
      // a renamed `i18n:gen:something` cannot satisfy the pin.
      expect(job.indexOf('run: npm run i18n:gen\n')).toBeGreaterThan(0);
      expect(job.indexOf('run: npm run i18n:gen\n')).toBeLessThan(
        job.indexOf('run: git diff --exit-code --'),
      );
    }
    // The freshness job is gated on the code output only, never the test mode:
    // artifact-carrying PRs are src/ paths, so code=true and the
    // regenerate-and-diff runs whatever the shards were told to run.
    const prChecks = jobSource('pr-checks');
    expect(prChecks).toContain("needs.changes.outputs.code != 'false'");
    expect(prChecks).not.toContain('test_mode');
    // The predicate agrees with the pinned path classes on both sides.
    expect(isGeneratedI18nArtifactPath('src/ui/i18n.resolved.generated/en.ts')).toBe(true);
    expect(isGeneratedI18nArtifactPath('src/admin/i18n.resolved.generated/loaders.ts')).toBe(true);
    expect(isGeneratedI18nArtifactPath('src/ui/i18n.catalog/translation_keys.generated.ts')).toBe(
      true,
    );
    expect(isGeneratedI18nArtifactPath('src/guide/content.generated.ts')).toBe(false);
  });

  it('runs the release tier against a release-to-main pull request merge result', () => {
    const prGate = jobSource('pr-gate');
    const prLongSimsA = jobSource('pr-long-sims-a');
    const prLongSimsB = jobSource('pr-long-sims-b');
    const prChecks = jobSource('pr-checks');
    const releaseGate = jobSource('release-gate');
    const releaseChecks = jobSource('release-checks');
    for (const job of [prLongSimsA, prLongSimsB, prChecks]) {
      // Exact composed if: event routing AND code path filter (D10). Dropping
      // either arm breaks release-to-main exclusion or docs-only skip. These
      // three are non-matrix jobs, so a job-level skip keeps the exact
      // required name and satisfies protection; only pr-gate needs the split
      // below.
      const ifLines = job.match(/^\s{4}if: .+$/gm) ?? [];
      expect(ifLines).toEqual([PR_TIER_IF_LINE]);
      expect(job).toContain(PR_TIER_EVENT_FRAGMENT);
      expect(job).toContain("needs.changes.outputs.code != 'false'");
      expect(job).not.toContain('I18N_RELEASE_TIER');
    }
    // pr-gate: the same two arms, split across levels (see
    // PR_GATE_JOB_IF_LINE). Exactly one job-level if, equal to the event-only
    // literal; the step gate on EVERY step, count pinned to the parsed step
    // list so a new step cannot land ungated and silently run (or leak work)
    // on a docs-only or release-to-main leg. Space classes are literal spaces,
    // not \s, so a blank line cannot be absorbed into an indent match; and the
    // step count matches EVERY list item start, named or not, because a
    // nameless `- uses:` step is legal YAML and a `- name: `-only sweep would
    // let it land ungated (fix-round mutation M7).
    {
      const jobIfLines = prGate.match(/^ {4}if: .+$/gm) ?? [];
      expect(jobIfLines).toEqual([PR_GATE_JOB_IF_LINE]);
      const stepIfLines = prGate.match(/^ {8}if: .+$/gm) ?? [];
      const stepStarts = prGate.match(/^ {6}- /gm) ?? [];
      // Vacuity floor near the real step count (checkout, pnpm, node,
      // install, cache, run): an empty parse must never pass the sweep.
      expect(stepStarts.length).toBeGreaterThanOrEqual(6);
      expect(stepIfLines).toEqual(stepStarts.map(() => PR_GATE_STEP_GATE_LINE));
      expect(prGate).not.toContain('I18N_RELEASE_TIER');
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
    // The tier flag lives in release-i18n ALONE (issue #2820): release-gate runs the
    // suite at PR tier so a red shard is always a real regression, and release-checks
    // never needed it. The job/list/scan three-way pin for release-i18n itself lives in
    // tests/release_i18n_tier_coverage.test.ts.
    expect(releaseGate).not.toMatch(/^\s{4}env:\n\s{6}I18N_RELEASE_TIER/m);
    expect(releaseChecks).not.toContain('I18N_RELEASE_TIER');
    expect(jobSource('release-i18n')).toContain("\n    env:\n      I18N_RELEASE_TIER: '1'");
  });

  it('splits the PR tier into parallel test and checks jobs that cover every step', () => {
    const prGate = jobSource('pr-gate');
    const prLongSimsA = jobSource('pr-long-sims-a');
    const prLongSimsB = jobSource('pr-long-sims-b');
    const prChecks = jobSource('pr-checks');
    // Parallel means no needs edge between the four. Each may need `changes`
    // for the path filter; none may wait on another (would re-serialize).
    expect(prGate).toMatch(/^\s{4}needs: changes\s*$/m);
    expect(prLongSimsA).toMatch(/^\s{4}needs: changes\s*$/m);
    expect(prLongSimsB).toMatch(/^\s{4}needs: changes\s*$/m);
    expect(prChecks).toMatch(/^\s{4}needs: changes\s*$/m);
    expect(prGate).not.toMatch(/needs:\s*\[?[^\n]*pr-checks/);
    expect(prChecks).not.toMatch(/needs:\s*\[?[^\n]*pr-gate/);
    expect(prLongSimsA).not.toMatch(/needs:\s*\[?[^\n]*pr-(gate|checks|long-sims)/);
    expect(prLongSimsB).not.toMatch(/needs:\s*\[?[^\n]*pr-(gate|checks|long-sims)/);
    expect(prGate).not.toMatch(/needs:\s*\[?[^\n]*pr-long-sims/);
    expect(prChecks).not.toMatch(/needs:\s*\[?[^\n]*pr-long-sims/);
    // Phase 2: pr-gate's test step runs through the selection-aware shard
    // runner; the runner itself spawns `npm test` (pretest preserved), which
    // tests/ci_shard_plan.test.ts pins behaviorally.
    expect(prGate).toContain('run: node scripts/ci_shard_test.mjs');
    expect(prGate).not.toContain('run: npm test');
    expect(prChecks).not.toContain('run: npm test');
    for (const step of CHECK_RUN_STEPS) {
      // Anchored to the start of a step line, so a YAML-commented-out step
      // (`#        run: npm run build`) cannot satisfy it: the substring
      // survives the comment, the anchored form does not.
      expect(prChecks).toMatch(new RegExp(`\\n {8}${escapeRe(step)}`));
      expect(prGate).not.toContain(step);
      expect(prLongSimsA).not.toContain(step);
      expect(prLongSimsB).not.toContain(step);
    }
    // The lane jobs are tests-only through the shard runner, like pr-gate: a
    // raw `npm test` or a check step substituted into one would run the whole
    // suite (or a check) on every PR under the lane's name.
    for (const laneJob of [prLongSimsA, prLongSimsB]) {
      expect(laneJob).not.toContain('run: npm test');
      expect(laneJob).not.toContain('Cache tsc incremental buildinfo');
    }
    // ...and a structural count, the same backstop release-gate has: an added
    // or removed pr-checks step must consciously update this test rather than
    // slipping in beside the by-name pins above.
    expect(prChecks.match(/\n {6}- name: /g)).toHaveLength(11);
    // pr-checks is unsharded, so NO step in it may carry a condition: an
    // `if: matrix.shard == 1` copy-pasted here is never true and would disable
    // that step outright.
    expect(prChecks).not.toMatch(/\n {8}if: /);
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
      // Same anchored form as the PR-tier loop: a YAML-commented-out step must
      // not satisfy the pin.
      expect(releaseChecks).toMatch(new RegExp(`\\n {8}${escapeRe(step)}`));
      expect(releaseGate).not.toContain(step);
    }
    // Named-step count: checkout, setup-pnpm, setup-node, pnpm install, plus
    // seven check steps (i18n gen/summary/freshness, malware, tsc cache, the
    // combined typecheck + env/server/bot builds turbo call, client build).
    // An accidental extra step on the checks job would otherwise stay green.
    expect(releaseChecks.match(/\n {6}- name: /g)).toHaveLength(11);
    expect(jobSource('pr-checks').match(/\n {6}- name: /g)).toHaveLength(11);
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

  it('classifies docs-only PRs via the API-driven changes job and keeps release unfiltered', () => {
    // D10 classifier: the changes job asks the GitHub API for the PR file list
    // through scripts/detect_code_changes.mjs; rules and the fail-closed
    // decision live in scripts/lib/ci_change_classify.mjs, whose behavior
    // (every error path resolving to code=true) is pinned by
    // tests/ci_change_classify.test.ts. Output code=true forces the full PR
    // tier; code=false skips pr-gate/pr-checks/browser-gate. lint stays
    // unfiltered. Release jobs never consult the output.
    const changes = jobSource('changes');
    expect(changes).toContain('id: filter');
    expect(changes).toContain('outputs:');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal GitHub Actions expression syntax.
    expect(changes).toContain('code: ${{ steps.filter.outputs.code }}');
    // Phase 2: the selection decision rides the same job's outputs, from the
    // same single classifier step, so the two decisions cannot come from
    // different listing snapshots.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal GitHub Actions expression syntax.
    expect(changes).toContain('test_mode: ${{ steps.filter.outputs.test_mode }}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal GitHub Actions expression syntax.
    expect(changes).toContain('test_mode_reason: ${{ steps.filter.outputs.test_mode_reason }}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal GitHub Actions expression syntax.
    expect(changes).toContain('changed_files: ${{ steps.filter.outputs.changed_files }}');
    // Anchored, not toContain: a YAML-commented-out step keeps the substring
    // but loses the indented shape, and this one line is the whole classifier.
    expect(changes).toMatch(/\n {8}run: node scripts\/detect_code_changes\.mjs\n/);
    // The script's appendFile is the ONLY writer of the code output: a shell
    // step echoing into GITHUB_OUTPUT could override the classifier verdict.
    expect(changes).not.toContain('GITHUB_OUTPUT');
    // Exactly one checkout, blob-less, shallow, and sparse: the ~10 minute
    // full-history checkout (which also wedged for 90+ minutes twice) must not
    // return, and nothing in this job may need the tree beyond scripts/.
    expect(changes.match(/uses: actions\/checkout/g)).toHaveLength(1);
    expect(changes).not.toMatch(/^\s+fetch-depth:/m);
    expect(changes).not.toContain('--unshallow');
    expect(changes).toContain('filter: blob:none');
    expect(changes).toMatch(/sparse-checkout: \|\n {12}scripts\n/);
    // No toolchain setup or dependency install on this serial critical path:
    // the classifier is stdlib-only and runs on the runner's preinstalled Node.
    expect(changes).not.toContain('pnpm install');
    expect(changes).not.toContain('actions/setup-node');
    // A wedged runner fails fast (single-digit timeout) and gets retried,
    // instead of stalling every downstream shard for 90+ minutes.
    expect(changes).toMatch(/\n {4}timeout-minutes: [1-9]\n/);
    // The API call authenticates with the workflow token via env (never
    // secrets.* and never string-interpolated into the run line).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal GitHub Actions expression syntax.
    expect(changes).toContain('GITHUB_TOKEN: ${{ github.token }}');
    // changes must always run (no job-level if). Gating it to pull_request only
    // would leave needs.changes dependents skipped on push to main/dev.
    expect(changes.match(/^\s{4}if: .+$/gm) ?? []).toEqual([]);
    // The entry stays wired to the tested lib and writes the step output; the
    // fail-closed reason strings themselves are pinned behaviorally in
    // tests/ci_change_classify.test.ts.
    expect(detectEntry).toContain("from './lib/ci_change_classify.mjs'");
    expect(detectEntry).toContain('detectCode');
    expect(detectEntry).toContain('GITHUB_OUTPUT');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal script output syntax.
    expect(detectEntry).toContain('code=${code}');
    // Phase 2 wiring: the entry derives the test mode from the SAME listing
    // (lib/ci_test_select.mjs) and writes all three selection outputs; the
    // exact output shape is pinned end to end by the subprocess tests in
    // tests/ci_change_classify.test.ts.
    expect(detectEntry).toContain("from './lib/ci_test_select.mjs'");
    expect(detectEntry).toContain('decideTestMode');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal script output syntax.
    expect(detectEntry).toContain('test_mode=${modeDecision.mode}');
    expect(detectEntry).toContain('changed_files=${JSON.stringify(');
    for (const [, sample] of CODE_PATH_SAMPLES) {
      expect(isCodePath(sample)).toBe(true);
    }
    for (const sample of NON_CODE_SAMPLES) {
      expect(isCodePath(sample)).toBe(false);
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
    expect(browserIf).toEqual(["    if: needs.changes.outputs.code != 'false'"]);

    // Aggregator only if branch protection cannot accept skipped checks. This
    // packet does not invent one without evidence (OPEN item 5: skipped release
    // jobs already show as skipping on ordinary PRs without blocking merge).
    expect(workflow).not.toMatch(/\n {2}ci-result:/);
    expect(workflow).not.toMatch(/\n {2}ci-success:/);

    // Red-path structural: a paths-ignore on either release job would silently
    // shrink release-tier enforcement on a docs-only release push.
    for (const name of [
      'release-gate',
      'release-i18n',
      'release-checks',
      'release-version-gate',
    ] as const) {
      const job = jobSource(name);
      expect(job).not.toContain('paths-ignore');
      expect(job).not.toContain('needs.changes');
      expect(job).not.toMatch(/^\s{4}needs:/m);
    }
  });

  it('routes merge queue runs through the full PR tier and keeps release lanes off them', () => {
    // The merge queue on main and release/** tests each candidate merge result
    // on a merge_group event. The trigger is load-bearing: required checks that
    // never report stall every queued PR until the queue's status-check timeout
    // rejects it. Anchored to a top-level on: key (comments, blank lines, and
    // other trigger lines allowed before it) so a commented-out trigger or one
    // nested under another event cannot satisfy the pin; key order is
    // deliberately not pinned.
    expect(workflow).toMatch(/\non:\n(?:(?:[ \t]+[^\n]*)?\n)*? {2}merge_group:\n/);

    // The queue always runs the FULL suite on the merge result: the changes job
    // has no job-level if (pinned elsewhere), and the selector refuses every
    // non-PR event. The file entry is what makes this decisive: with a real
    // modified source in hand, only the event guard can force full (the same
    // input under pull_request goes selective), so a future merge_group special
    // case in the selector fails here, next to the workflow trigger it would
    // undermine. The reason pin proves WHICH guard fired.
    const queueDecision = decideTestMode({
      eventName: 'merge_group',
      code: true,
      files: [{ filename: 'src/ui/hud.ts', status: 'modified' }],
    });
    expect(queueDecision.mode).toBe('full');
    expect(queueDecision.reason).toBe('selection applies to pull requests only: full suite');

    // Deliberate tripwire on the constant, not a workflow pin: the workflow
    // text itself is held to PR_TIER_IF_LINE by exact single-if-line equality
    // in 'runs the release tier against a release-to-main pull request merge
    // result' above. Editing the workflow AND the constant together to drop
    // the queue arm still goes red here, forcing a conscious edit of this
    // literal too.
    expect(PR_TIER_EVENT_FRAGMENT).toContain("github.event_name == 'merge_group'");

    // lint diffs a queue run against the target-branch tip the merge group was
    // built on (event.merge_group.base_sha, passed via env, never interpolated
    // into the run line). Without this arm the step falls through to the
    // default-branch fallback and diffs a release/** group against main,
    // dragging the whole release delta (intentionally-red whole-repo debt)
    // into biome and rejecting every queued release PR. Both env lines are
    // pinned INSIDE the Determine-base-ref step's env block (a raw substring
    // would stay green commented-out or moved to the wrong step), and the
    // whole shell arm is ONE regex, elif through fi, so no line of it can be
    // deleted, reordered, or parked as dead code elsewhere in the step; only
    // comment and blank lines are allowed at the two comment sites.
    const lint = jobSource('lint');
    const baseRefEnvBlock = String.raw`\n {6}- name: Determine base ref\n {8}id: base\n {8}env:\n(?:(?: {10}[A-Z_]+: [^\n]*| {10}#[^\n]*)?\n)*?`;
    expect(lint).toMatch(
      new RegExp(
        `${baseRefEnvBlock} {10}MERGE_GROUP_BASE_SHA: \\$\\{\\{ github\\.event\\.merge_group\\.base_sha \\}\\}\n`,
      ),
    );
    expect(lint).toMatch(
      new RegExp(
        `${baseRefEnvBlock} {10}MERGE_GROUP_BASE_REF: \\$\\{\\{ github\\.event\\.merge_group\\.base_ref \\}\\}\n`,
      ),
    );
    // The arm enters on the EVENT alone: a malformed base SHA must land in the
    // in-arm fallback, never fall through to the default-branch arm (the
    // pre-fix disaster path). The [ -n ] line is the loud guard for an empty
    // base ref (fetching "" quietly succeeds and would write a broken
    // ref=origin/ output).
    const comment12 = String.raw`(?:(?: {12}#[^\n]*)?\n)*?`;
    const comment14 = String.raw`(?:(?: {14}#[^\n]*)?\n)*?`;
    expect(lint).toMatch(
      new RegExp(
        String.raw`elif \[ "\$EVENT_NAME" = "merge_group" \]; then\n` +
          comment12 +
          String.raw` {12}if printf '%s' "\$MERGE_GROUP_BASE_SHA" \| grep -qE '\^\[0-9a-f\]\{40\}\$' \\\n` +
          String.raw` {14}&& git fetch --no-tags --depth=1 origin "\$MERGE_GROUP_BASE_SHA"; then\n` +
          String.raw` {14}echo "ref=\$MERGE_GROUP_BASE_SHA" >> "\$GITHUB_OUTPUT"\n` +
          String.raw` {12}else\n` +
          comment14 +
          String.raw` {14}base_branch="\$\{MERGE_GROUP_BASE_REF#refs/heads/\}"\n` +
          String.raw` {14}\[ -n "\$base_branch" \]\n` +
          String.raw` {14}git fetch --no-tags --depth=1 origin "\$base_branch"\n` +
          String.raw` {14}echo "ref=origin/\$base_branch" >> "\$GITHUB_OUTPUT"\n` +
          String.raw` {12}fi\n`,
      ),
    );

    // Release lanes stay off queue runs: their if arms match pull_request and
    // push only, and the RELEASE_IF_LINE equality pins hold the exact lines.
    // This negative keeps a future widen from quietly running a release lane
    // (release-i18n is legitimately red mid-cycle) on every queued PR.
    for (const name of [
      'release-gate',
      'release-i18n',
      'release-checks',
      'release-version-gate',
    ] as const) {
      expect(jobSource(name)).not.toContain('merge_group');
    }
  });

  it('pins the merge queue required-check names to ci.yml and docs/merge-queue.md', () => {
    // Branch protection string-matches check DISPLAY names, and the ruleset
    // lives outside git: renaming any of these jobs silently un-requires the
    // check, or worse leaves a required name that never reports, which blocks
    // every queued merge until the queue timeout. docs/merge-queue.md is the
    // written contract, so the workflow name line and the doc must both carry
    // each name exactly.
    const mergeQueueDoc = readFileSync(new URL('../docs/merge-queue.md', import.meta.url), 'utf8');
    const requiredCheckNames = [
      'Detect code path changes',
      'PR gate (English-only legal)',
      'PR gate (long sims A)',
      'PR gate (long sims B)',
      'PR checks (freshness, typecheck, builds)',
      'Format + lint (Biome, changed files)',
      'Browser regressions (Chromium)',
    ] as const;
    for (const name of requiredCheckNames) {
      // Anchored to the job-level name: line (4-space indent), so a
      // commented-out or step-level `- name:` cannot satisfy it.
      expect(workflow).toContain(`\n    name: ${name}\n`);
    }
    // The doc names each required check in the exact form protection sees it:
    // bare names for the unsharded jobs, and the matrix-suffixed range for the
    // sharded gate. The range must track SHARD_N, or a future shard-count
    // change silently leaves the extra shards un-required in a ruleset nobody
    // can diff in git. The doc is sliced at its "Never require these" heading:
    // each required name must sit in the REQUIRED half, and none may appear in
    // the never-require list, so quietly moving a check between the two lists
    // fails here rather than reading as a contract change nobody pinned.
    const neverIdx = mergeQueueDoc.indexOf('Never require these');
    expect(neverIdx).toBeGreaterThan(0);
    const requiredHalf = mergeQueueDoc.slice(0, neverIdx);
    const neverSectionEnd = mergeQueueDoc.indexOf('\n## ', neverIdx);
    expect(neverSectionEnd).toBeGreaterThan(neverIdx);
    const neverSection = mergeQueueDoc.slice(neverIdx, neverSectionEnd);
    const docRequiredNameForms = [
      '`Detect code path changes`',
      `\`PR gate (English-only legal) (1)\` through \`(${SHARD_N})\``,
      '`PR gate (long sims A)`',
      '`PR gate (long sims B)`',
      '`PR checks (freshness, typecheck, builds)`',
      '`Format + lint (Biome, changed files)`',
      '`Browser regressions (Chromium)`',
    ] as const;
    for (const form of docRequiredNameForms) {
      expect(requiredHalf).toContain(form);
    }
    for (const name of requiredCheckNames) {
      expect(neverSection).not.toContain(`\`${name}\``);
    }
  });

  it('bounds every ci.yml job against the runner-side checkout-stall class', () => {
    // Phase 6 of the CI/CD performance packet: on 2026-08-06 thirteen shard,
    // lane, and browser jobs across seven runs sat 9.6 to 24.4 minutes inside
    // actions/checkout before completing (runner-pool-side; healthy checkout
    // is under 3 minutes; the worst stalled job wall was 32.8 minutes), and
    // the stall, not any test, set those runs' tails. Each bound is sized
    // from that job's measured healthy worst case plus margin (the sizing
    // rationale sits on each ci.yml bound; the evidence table lives in the
    // packet's detect-wedge postmortem note), so a stalled job dies and gets
    // rerun on a fresh runner instead of holding a required check. Exact
    // values, not a floor: resizing a bound is a conscious, measured decision
    // (the full-core lane revert is the packet's precedent for what happens
    // to unmeasured resizes). Exactly one job-level line per job, so a
    // duplicate cannot shadow the pinned one; and job-level, never
    // step-level, because a step bound leaves the rest of the job free to
    // hang toward GitHub's 6 hour default.
    //
    // The checks and release lanes were the recorded follow-up from Phase 6's
    // postmortem note (bounding them was flagged, not forgotten): they now
    // carry a measured bound too, sized by analogy to their nearest sibling
    // in shape rather than lifted from the checkout-stall replay directly, so
    // every job in this file carries a conscious timeout-minutes value.
    const bounds = [
      ['pr-gate', 20],
      ['release-gate', 20],
      // The single-job lane's bound reached 60 after run 31290316610 measured
      // ~4400s aggregate suite time on a slow-quartile runner. The lane-diet
      // PR cut the aggregate several-fold and split the lane in two, so each
      // half projects under 10 minutes healthy on a standard runner; 20
      // matches the pr-gate shard bound (sizing evidence on the ci.yml
      // bounds and in the lane-diet PR body).
      ['pr-long-sims-a', 20],
      ['pr-long-sims-b', 20],
      ['browser-gate', 10],
      // 8 is a measured decision like the rest (healthy worst 4.42 min, all
      // observed stalls over 8), so it is pinned exactly here beside the
      // single-digit shape check the classifier test keeps.
      ['changes', 8],
      // lint is an unmatrixed single toolchain-setup-plus-checks job like
      // browser-gate, but lighter (no browser download): checkout, pnpm
      // install, a base-ref fetch, one biome pass. 15 keeps a margin over
      // browser-gate's 10 for the extra base-ref resolution step.
      ['lint', 15],
      // pr-checks and release-checks are the same shape as lint but heavier:
      // i18n generation, the malware gate, a typecheck, and four builds. 20
      // matches the shard matrices' bound.
      ['pr-checks', 20],
      ['release-checks', 20],
      // release-version-gate and release-i18n are both unsharded jobs whose
      // own work is fast (one small version-surface check; five test files,
      // "seconds long" by the release-i18n job comment): toolchain setup
      // dominates their wall time, so both share the smallest non-classifier
      // bound.
      ['release-version-gate', 10],
      ['release-i18n', 10],
    ] as const;
    // The positive check runs over the full index-based job span (this job
    // key to the next), never the comment-terminated jobSource slice, so a
    // stray top-level comment inside a job body cannot hide a duplicate
    // job-level bound or a step bound (the fix round's verifier proved the
    // jobSource form evadable both ways). Deliberate consequence: a span
    // INCLUDES the 2-space comment block that documents the NEXT job, so
    // only indentation-anchored patterns belong on spans; a bare
    // not.toContain would trip on a neighbour's comment.
    const jobSpan = (name: string) => {
      const start = workflow.indexOf(`\n  ${name}:`);
      expect(start).toBeGreaterThanOrEqual(0);
      const rest = workflow.slice(start + 1);
      const next = rest.search(/\n {2}[A-Za-z][A-Za-z0-9_-]*:[ \t]*(?:#[^\n]*)?\n/);
      return next === -1 ? rest : rest.slice(0, next);
    };
    for (const [name, minutes] of bounds) {
      const span = jobSpan(name);
      const jobLevel = span.match(/^ {4}timeout-minutes: \d+$/gm) ?? [];
      expect(jobLevel).toEqual([`    timeout-minutes: ${minutes}`]);
      expect(span).not.toMatch(/\n {8}timeout-minutes:/);
      // A step bound can also legally sit as the FIRST key of a step item.
      expect(span).not.toMatch(/\n {6}- timeout-minutes:/);
    }
    // Completeness: every ci.yml job must appear in the bounds table above.
    // A new job therefore cannot arrive silently unbounded and hang toward
    // GitHub's 6 hour default; adding one without a matching entry here fails
    // this equality. The key regex tolerates a trailing comment or space
    // after the colon, both valid YAML that would otherwise make an eleventh
    // job invisible. The nightly workflow's deliberately generous bounds
    // have their own presence pins in tests/nightly_workflow.test.ts and
    // stay untouched.
    const jobsSection = workflow.slice(workflow.indexOf('\njobs:'));
    const jobKeys = [
      ...jobsSection.matchAll(/\n {2}([A-Za-z][A-Za-z0-9_-]*):[ \t]*(?:#[^\n]*)?\n/g),
    ].map((m) => m[1]);
    expect([...jobKeys].sort()).toEqual([...bounds.map(([name]) => name)].sort());
    // The operator triage for a timeout kill is part of the contract: the
    // doc must keep the rejection signature, route it to a rerun, and tell
    // the operator to check for a failing test step first (a genuinely red
    // shard on a runner with a setup spike can die AS a timeout).
    const mergeQueueTriage = readFileSync(
      new URL('../docs/merge-queue.md', import.meta.url),
      'utf8',
    );
    expect(mergeQueueTriage).toContain('exceeded the maximum execution time');
    expect(mergeQueueTriage).toContain('checkout-stall bound');
    expect(mergeQueueTriage).toContain('failing or still running');
    // The routing is the entry's operational point: a timeout kill goes to
    // a rerun, never straight to a code investigation.
    expect(mergeQueueTriage).toContain('re-run the failed jobs and re-queue');
  });

  it(`shards the PR and release test steps ${SHARD_N} ways and keeps the checks single-shard`, () => {
    const prGate = jobSource('pr-gate');
    const prChecks = jobSource('pr-checks');
    const releaseGate = jobSource('release-gate');
    const releaseChecks = jobSource('release-checks');
    // Both test jobs fan the ONE suite across the same N-shard matrix.
    // release-gate keeps the raw `npm test -- --shard` run line (selection
    // never touches a release ref); pr-gate runs the same suite through the
    // selection-aware shard runner, which spawns `npm test` itself so pretest
    // still regenerates the i18n artifacts in every shard (the S3 guard, guide
    // freshness, and the git-subprocess suites need them regardless of which
    // shard they hash into). Never a bare vitest invocation in the workflow.
    // fail-fast stays off so shards pass or fail independently and a red run
    // always reports the whole suite.
    const halfCoreCap =
      '--maxWorkers="$(node -p \'Math.max(1, Math.floor(require("node:os").availableParallelism() / 2))\')"';
    const shardMatrixLine = `shard: [${SHARD_MATRIX}]`;
    const shardRunPrefix = `run: npm test -- --shard=\${{ matrix.shard }}/${SHARD_N}`;
    for (const job of [prGate, releaseGate]) {
      expect(job).toContain('strategy:');
      expect(job).toContain('fail-fast: false');
      expect(job).toContain(shardMatrixLine);
    }
    expect(releaseGate).toContain(shardRunPrefix);
    expect(releaseGate).toContain(halfCoreCap);
    const shardRunRe = new RegExp(
      String.raw`run: npm test -- --shard=\$\{\{ matrix\.shard \}\}\/${SHARD_N}`,
      'g',
    );
    expect(workflow.match(shardRunRe)).toHaveLength(1);
    // Phase 2 pin, anchored name-to-env-to-run adjacency: the selection inputs
    // ride an env block (a `run:`-line interpolation of PR-controlled filenames
    // would be a workflow-injection surface), the run line is the shard runner
    // with the matrix shard spec, and a YAML-commented-out step cannot satisfy
    // the shape. Release jobs must never pick this line up.
    expect(prGate).toMatch(
      new RegExp(
        String.raw`- name: Run tests \(PR tier, shard \$\{\{ matrix\.shard \}\} of ${SHARD_N}\)\n` +
          PR_GATE_STEP_GATE_RE_SEGMENT +
          String.raw` {8}env:\n` +
          String.raw` {10}TEST_MODE: \$\{\{ needs\.changes\.outputs\.test_mode \}\}\n` +
          String.raw` {10}TEST_MODE_REASON: \$\{\{ needs\.changes\.outputs\.test_mode_reason \}\}\n` +
          String.raw` {10}CHANGED_FILES: \$\{\{ needs\.changes\.outputs\.changed_files \}\}\n` +
          String.raw` {8}run: node scripts/ci_shard_test\.mjs --shard=\$\{\{ matrix\.shard \}\}/${SHARD_N}\n`,
      ),
    );
    // Exactly three entry invocations: the shard matrix and the two long-sims
    // lane halves.
    expect(workflow.match(/run: node scripts\/ci_shard_test\.mjs/g)).toHaveLength(3);
    // Each lane job mirrors the shard step's hardened relay (env block, never
    // run-line interpolation) and runs the entry in its lane-half mode:
    // unsharded, no matrix, two jobs that between them own the
    // CI_LONG_SUITES files every shard leg excludes. Same anchored
    // name-to-env-to-run shape as the shard pin.
    for (const [jobName, laneLabel, laneFlag] of [
      ['pr-long-sims-a', 'A', 'long-sims-a'],
      ['pr-long-sims-b', 'B', 'long-sims-b'],
    ] as const) {
      const laneJob = jobSource(jobName);
      expect(laneJob).toMatch(
        new RegExp(
          String.raw`- name: Run tests \(PR tier, long-sims lane ${laneLabel}\)\n` +
            String.raw` {8}env:\n` +
            String.raw` {10}TEST_MODE: \$\{\{ needs\.changes\.outputs\.test_mode \}\}\n` +
            String.raw` {10}TEST_MODE_REASON: \$\{\{ needs\.changes\.outputs\.test_mode_reason \}\}\n` +
            String.raw` {10}CHANGED_FILES: \$\{\{ needs\.changes\.outputs\.changed_files \}\}\n` +
            String.raw` {8}run: node scripts/ci_shard_test\.mjs --lane=${laneFlag}\n`,
        ),
      );
      expect(laneJob).not.toContain('strategy:');
      expect(laneJob).not.toContain('matrix:');
      expect(laneJob).not.toContain('--shard=');
      // Checkout, setup-pnpm, setup-node, pnpm install, the vitest transform
      // cache (the Phase 4 rider), and the lane run.
      expect(laneJob.match(/\n {6}- name: /g)).toHaveLength(6);
      // The lane jobs skip at JOB level, so NO step in them may carry a
      // condition: an appended step-level `if:` (never true, or `if: false`)
      // would disable that step outright while the run-line shape pin above
      // and the job-level if sweep both stay green (the same mutation class
      // the cache-step pin below closes with its blank-line terminator).
      expect(laneJob).not.toMatch(/\n {8}if: /);
    }
    // The half constants and the ci.yml run lines must cover each other: a
    // CI_LONG_SUITE_HALVES key with no lane job would leave that half's
    // files excluded from every shard but run by no lane (a silent coverage
    // hole the partition pin alone cannot see).
    expect(Object.keys(CI_LONG_SUITE_HALVES).sort()).toEqual(['a', 'b']);
    expect((workflow.match(/--lane=long-sims-([a-z])\b/g) ?? []).sort()).toEqual(
      Object.keys(CI_LONG_SUITE_HALVES)
        .sort()
        .map((half) => `--lane=long-sims-${half}`),
    );
    // The pre-split flag must not linger anywhere in the workflow (any token
    // shape, not just end-of-line): the entry rejects it, so a stale run
    // line would fail every PR loudly.
    expect(workflow).not.toMatch(/--lane=long-sims(?![-a-z])/);
    // The balance harnesses' full-sweep env flag is nightly-depth-only
    // (docs/qa-gate.md, "The balance-harness diet"): setting it on any ci.yml
    // job would silently put the five-seed cost back on the PR (or release)
    // critical path. tests/nightly_workflow.test.ts pins the one sanctioned
    // copy on the nightly tests job.
    expect(workflow).not.toContain('WOC_FULL_BALANCE_SWEEP');
    for (const job of [releaseGate, releaseChecks, jobSource('release-i18n')]) {
      expect(job).not.toContain('ci_shard_test.mjs');
      expect(job).not.toContain('TEST_MODE');
      // The lane split is PR-tier only: a release job must never exclude the
      // long sims (release pushes keep the whole suite in their 8 shards).
      expect(job).not.toContain('long-sims');
      expect(job).not.toContain('--exclude');
    }
    // The half-cores worker bound moved from pr-gate's run line into the shard
    // runner. Derive the expected expression FROM halfCoreCap (the release-gate
    // pin) so the two forms cannot drift apart: same formula, minus the shell
    // wrapper and with the runner's `os` import in place of require().
    const capExpression = halfCoreCap
      .replace(/^--maxWorkers="\$\(node -p '/, '')
      .replace(/'\)"$/, '')
      .replace('require("node:os")', 'os');
    expect(capExpression).toBe('Math.max(1, Math.floor(os.availableParallelism() / 2))');
    expect(ciShardEntry).toContain(capExpression);
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
    expect(gate).toContain('buildFullGateSteps(workers, { releaseTier, repoRoot })');
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
    // name-to-run adjacency proves no if: line sits between them. Since #2820 this
    // job runs at PR tier (the release tier is the separate release-i18n job), so the
    // step name matches pr-gate's; the adjacency requirement is unchanged.
    expect(releaseGate).toMatch(
      new RegExp(
        String.raw`- name: Run tests \(PR tier[^\n]*\n {8}run: npm test -- --shard=\$\{\{ matrix\.shard \}\}\/${SHARD_N}`,
      ),
    );
    // release-i18n is the tier job: unsharded, one test step, no if: between name and run.
    const releaseI18n = jobSource('release-i18n');
    expect(releaseI18n).toMatch(
      /- name: Run i18n release-tier suites[^\n]*\n {8}run: npm test -- tests\//,
    );
    expect(releaseI18n).not.toContain('--shard=');
    expect(releaseI18n.match(/\n {6}- name: /g)).toHaveLength(5);
    // Structural step counts: each test job is exactly checkout, setup-pnpm,
    // setup-node, pnpm install, the vitest transform cache, and the sharded
    // test run. An unconditioned addition would run N times per push; a
    // dropped step shrinks the job silently.
    expect(prGate.match(/\n {6}- name: /g)).toHaveLength(6);
    expect(releaseGate.match(/\n {6}- name: /g)).toHaveLength(6);
  });

  it('persists the vitest transform cache on the shard matrices and the long-sims lane', () => {
    // Phase 4 of the CI/CD performance packet: vitest's fsModuleCache store
    // (enabled in vite.config.ts) keys entries by content, so the
    // actions/cache key manages rotation and size; the tamper boundary is
    // GitHub's per-ref cache scoping (see the step comment in ci.yml).
    // Name-to-uses adjacency plus the path and key lines, TERMINATED BY THE
    // BLANK LINE THAT ENDS THE STEP: a YAML-commented-out copy cannot satisfy
    // it, and neither can a step neutered by an appended `if:` or any other
    // trailing key (the mutation that beat the pin's first draft). pr-gate's
    // copy is the one exception, and only for the EXACT step gate literal
    // (PR_GATE_STEP_GATE_LINE, required by its shape here): any other if,
    // including an `if: false` neuter, still breaks the pin, and release-gate
    // and the lane still admit no if at all.
    // One shared name line, body, and hashFiles tail for every copy of the
    // step, so the shard and lane regexes cannot drift apart: an edit to the
    // key's input list either moves all four ci.yml key lines or goes red
    // here.
    const cacheStepName = String.raw`- name: Cache vitest transform cache\n`;
    const cacheStepBody = String.raw`(?: {8}#[^\n]*\n)* {8}uses: actions\/cache@v(?:[4-9]|\d{2,})[^\n]*\n {8}with:\n {10}path: node_modules\/\.experimental-vitest-cache\n {10}key: vitest-fsmodule-\$\{\{ runner\.os \}\}-`;
    const cacheKeyTail = String.raw`-\$\{\{ hashFiles\('pnpm-lock\.yaml', 'vite\.config\.ts', '\.npmrc', 'package\.json'\) \}\}\n\n`;
    const shardKeySegment = String.raw`shard\$\{\{ matrix\.shard \}\}`;
    const prGateCacheStepRe = new RegExp(
      `${cacheStepName}${PR_GATE_STEP_GATE_RE_SEGMENT}${cacheStepBody}${shardKeySegment}${cacheKeyTail}`,
    );
    const releaseCacheStepRe = new RegExp(
      `${cacheStepName}${cacheStepBody}${shardKeySegment}${cacheKeyTail}`,
    );
    // The lane jobs (Phase 4 rider) carry the same step with per-half lane
    // key segments where the matrices carry shard${{ matrix.shard }}: the
    // lanes have no matrix, so the shard expression would render empty there,
    // and each half's store earns its own entry rather than borrowing a
    // shard's or the other half's.
    const laneCacheStepReA = new RegExp(
      `${cacheStepName}${cacheStepBody}lane-long-sims-a${cacheKeyTail}`,
    );
    const laneCacheStepReB = new RegExp(
      `${cacheStepName}${cacheStepBody}lane-long-sims-b${cacheKeyTail}`,
    );
    for (const [name, stepRe] of [
      ['pr-gate', prGateCacheStepRe],
      ['release-gate', releaseCacheStepRe],
      ['pr-long-sims-a', laneCacheStepReA],
      ['pr-long-sims-b', laneCacheStepReB],
    ] as const) {
      const job = jobSource(name);
      expect(job).toMatch(stepRe);
      // Restore strictly between the install and the test run: earlier and
      // pnpm install may prune or re-layout what was just restored, later and
      // the run never sees the store. Step-name literals, not bare phrases,
      // so a comment mentioning the name cannot shift the comparison; and
      // every anchor must EXIST first, because indexOf returns -1 for a
      // missing step and -1 compares less-than everything, making the
      // ordering vacuously green if a step were deleted.
      const install = job.indexOf('- name: Install dependencies');
      const cache = job.indexOf('- name: Cache vitest transform cache');
      const runTests = job.indexOf('- name: Run tests');
      expect(install).toBeGreaterThanOrEqual(0);
      expect(cache).toBeGreaterThanOrEqual(0);
      expect(runTests).toBeGreaterThanOrEqual(0);
      expect(install).toBeLessThan(cache);
      expect(cache).toBeLessThan(runTests);
      // No restore-keys: a cross-lockfile restore is discarded by vitest's own
      // integrity check and a cross-config restore misses every entry, so a
      // prefix fallback can only ever download dead weight. Anchored to the
      // YAML key shape (bare, double- or single-quoted) because the step's
      // own comment says the word.
      expect(job).not.toMatch(/\n\s+["']?restore-keys["']?:/);
    }
    // The store is enabled in the config this cache serves, at the DEFAULT
    // path the workflow hardcodes. Comment-stripped first (a `//` prefix
    // must fail the pin, not satisfy it), then anchored to the real config
    // line shape; and fsModuleCachePath must stay unset or the two would
    // silently point at different directories.
    const viteConfigCode = viteConfig.replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(viteConfigCode).toMatch(/\n\s+fsModuleCache: true,/);
    expect(viteConfigCode).not.toContain('fsModuleCachePath');
    // Exactly the two shard matrices plus the two long-sims lane halves
    // carry the step, counted workflow-wide so a copy added to ANY other job
    // fails (browser-gate has no matrix, so ${{ matrix.shard }} would render
    // empty there and every run would collide on one key; each lane carries
    // its own lane-long-sims-a/-b key segment for the same reason). The path
    // line is counted rather than the bare string because the pr-gate
    // rationale comment mentions the directory.
    expect(workflow.match(/- name: Cache vitest transform cache\n/g)).toHaveLength(4);
    expect(workflow.match(/ {10}path: node_modules\/\.experimental-vitest-cache\n/g)).toHaveLength(
      4,
    );
    for (const name of [
      'pr-checks',
      'release-checks',
      'release-i18n',
      'changes',
      'browser-gate',
      'lint',
      'release-version-gate',
    ] as const) {
      expect(jobSource(name)).not.toContain('path: node_modules/.experimental-vitest-cache');
    }
  });

  it('builds every bundle in the local gate too, including the Discord bot', () => {
    // The gate's step list now lives in the shared builder (gate_steps.mjs),
    // so the pin runs the BUILDER and asserts the executed shape: every bundle
    // CI builds must ride a local gate step, the bot included, and the cheap
    // bundles still run before the slow client build.
    const combined = gateSteps.find((s) => s.name === 'typecheck + env/server/bot builds');
    expect(combined?.args).toEqual(
      expect.arrayContaining(['run', 'build:env', 'build:server', 'build:bot']),
    );
    const combinedIdx = gateSteps.findIndex((s) => s.name === 'typecheck + env/server/bot builds');
    const clientIdx = gateSteps.findIndex((s) => s.name === 'client build');
    expect(combinedIdx).toBeGreaterThanOrEqual(0);
    expect(clientIdx).toBeGreaterThan(combinedIdx);
    expect(gateSteps[clientIdx]?.args).toEqual(expect.arrayContaining(['run', 'build:bundle']));
    // The profile fallback arm (types-only or builds-only runs) must carry the
    // bot build as its own step too, or --skip-types would silently drop it.
    const fallback = buildFullGateSteps(8, { skipTypes: true });
    expect(fallback.some((s) => s.name === 'bot build')).toBe(true);
    expect(fallback.find((s) => s.name === 'bot build')?.args).toEqual(
      expect.arrayContaining(['run', 'build:bot']),
    );
  });

  it('keeps the bot build a real, ungated failure in both CI check jobs', () => {
    // Name-to-run adjacency, because `toContain(TYPECHECK_BUILDS_TURBO_RUN)` is
    // also satisfied by an appended `|| true` (which can never fail) and by a
    // copy-pasted `if: matrix.shard == 1` slipped between the two lines, which
    // in these unsharded jobs is never true and would disable the build
    // outright. Either would put a broken bundle back on the host. turbo run
    // itself fails the step on any task's non-zero exit, so build:bot riding
    // inside the combined call still fails the whole step, not just its task.
    for (const name of ['pr-checks', 'release-checks'] as const) {
      expect(jobSource(name)).toMatch(
        new RegExp(
          `- name: Typecheck \\+ env/server/bot builds\\n {8}${escapeRe(TYPECHECK_BUILDS_TURBO_RUN)}\\n`,
        ),
      );
    }
    // A step that is allowed to fail is not a gate.
    expect(workflow).not.toContain('continue-on-error');
  });

  it('never runs untrusted pull-request code with write access', () => {
    // The jobs above run `npm ci`, the full suite, and four builds over the
    // head ref of any fork PR. That is only safe while the workflow stays on
    // `pull_request` with a read-only token: switching to
    // `pull_request_target`, or granting a job write scope so some check
    // "works on forks", would hand that untrusted code a privileged token and
    // nothing else in the repo would go red.
    expect(workflow).not.toContain('pull_request_target');
    // The WHOLE block, terminated by a blank line: matching only the first
    // entry would let `packages: write` be appended underneath it.
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    // Unanchored on purpose: the read-only grant is workflow-level, and a JOB
    // may re-declare `permissions:` at its own indent to widen it. Exactly two
    // blocks are sanctioned: the workflow-level read-only default and the
    // changes job's read-only widen (pull-requests: read, which the PR files
    // endpoint needs once workflow permissions are declared). Any third block
    // is an escalation; so is any write scope anywhere in the file.
    expect(workflow.match(/^\s*permissions:/gm)).toHaveLength(2);
    expect(jobSource('changes')).toMatch(
      /\n {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n/,
    );
    // \b, not $: a trailing comment after a write scope must not hide it, and
    // \b after "write" also matches the write-all shorthand.
    expect(workflow).not.toMatch(/^\s*[\w-]+:\s*write\b/m);
    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toContain("secrets['");
    expect(workflow).not.toContain('secrets["');
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
