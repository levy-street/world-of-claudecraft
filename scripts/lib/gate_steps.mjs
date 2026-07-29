// Shared full-gate step list for scripts/gate.mjs and the Phase 1 profile
// harness. Keeps generate-once (Phase 2), turbo artifact cache (Phase 8), and
// never-cache vitest semantics in one place so profile timings match the real
// merge bar.
import { gateVitestSkipPretestEnv } from './gate_artifact_skip.mjs';
import { turboRunArgs } from './gate_task_cache.mjs';

// The suites whose ASSERTIONS change under I18N_RELEASE_TIER=1 (they read the flag
// and tighten from "key is registered" to "every locale is filled"). They are the
// only tests the release tier needs to run differently, so they run twice: once at
// PR tier inside the ordinary full suite, and once here under the flag.
//
// Why this list exists at all. The tier used to be a job-level env var over the whole
// release test job, which cannot be forgotten but mixes two signals: a release branch
// is red for un-filled locales through most of a cycle, so a genuine regression hides
// inside expected noise (a dungeon-finder regression sat unnoticed in exactly that way,
// see issue #2820). Splitting the tier onto its own job separates "code is broken" from
// "the release fill has not run yet", at the cost of a list that could rot. The list is
// therefore pinned three ways by tests/release_i18n_tier_coverage.test.ts: this constant,
// the ci.yml job's command, and a scan of tests/ for files reading the flag must all name
// the same set, so a new tier-sensitive suite cannot quietly stop running under the tier.
export const I18N_RELEASE_TIER_SUITES = Object.freeze([
  'tests/deed_i18n.test.ts',
  'tests/i18n_status_registry.test.ts',
  'tests/i18n_t_behavior.test.ts',
  'tests/localization_coverage.test.ts',
  'tests/localization_fixes.test.ts',
]);

/**
 * Name of the step the vitest legs follow. gate_select.mjs splices its selective
 * legs directly after this one, so both sides read the same constant rather than
 * the selective gate matching a display string that a rename would silently move.
 */
export const PRE_VITEST_STEP_NAME = 'biome (changed files)';

export const I18N_ARTIFACTS = Object.freeze([
  'src/ui/i18n.resolved.generated',
  'src/admin/i18n.resolved.generated',
  'src/ui/i18n.catalog/translation_keys.generated.ts',
]);

/**
 * Full local gate steps (after dep-sync and ffmpeg preflights in gate.mjs).
 *
 * Cacheable pure artifacts go through `npx turbo run ...` (inputs/outputs in
 * turbo.json). Malware, biome, and tests always run via npm (no "passed"
 * cache). i18n:gen, wiki:content, and sfx:check are independent leaf tasks in
 * turbo.json (none dependsOn another), so they share one turbo multi-task step
 * for wall-clock overlap on a cold cache, same as typecheck + env + server
 * builds below; client build stays separate (depends on the gens finishing).
 *
 * @param {number} workers
 * @param {{
 *   releaseTier?: boolean,
 *   skipBrowser?: boolean,
 *   skipBuilds?: boolean,
 *   skipVitest?: boolean,
 *   skipTypes?: boolean,
 * }} [opts]
 * @returns {Array<{
 *   name: string,
 *   cmd: string,
 *   args: string[],
 *   hint?: string,
 *   env?: Record<string, string>,
 * }>}
 */
export function buildFullGateSteps(workers, opts = {}) {
  /** @type {Array<{ name: string, cmd: string, args: string[], hint?: string, env?: Record<string, string> }>} */
  const steps = [
    {
      name: 'i18n + wiki + sfx artifacts',
      cmd: 'npx',
      args: turboRunArgs(['i18n:gen', 'wiki:content', 'sfx:check']),
    },
    {
      name: 'i18n freshness',
      cmd: 'git',
      args: ['diff', '--exit-code', '--', ...I18N_ARTIFACTS],
      hint:
        'the regenerated i18n artifacts differ from the staged/committed copies: stage them ' +
        `(git add ${I18N_ARTIFACTS.join(' ')}) and re-run`,
    },
    {
      name: 'malware scan',
      cmd: 'npm',
      args: ['run', 'security:gate'],
    },
    {
      name: PRE_VITEST_STEP_NAME,
      cmd: 'npm',
      args: ['run', 'ci:changed'],
    },
  ];

  if (!opts.skipVitest) {
    steps.push({
      name: 'vitest (full suite)',
      cmd: 'npm',
      args: ['test', '--', `--maxWorkers=${workers}`],
      env: gateVitestSkipPretestEnv(),
    });
    // Release tier is a SEPARATE step over the tier-sensitive suites only, mirroring
    // the release-i18n job in ci.yml. The full suite above stays at PR tier, so a red
    // there always means a real regression, never an outstanding locale fill.
    if (opts.releaseTier) {
      steps.push({
        name: 'vitest (release-tier i18n)',
        cmd: 'npm',
        args: ['test', '--', ...I18N_RELEASE_TIER_SUITES, `--maxWorkers=${workers}`],
        env: { ...gateVitestSkipPretestEnv(), I18N_RELEASE_TIER: '1' },
        hint: 'release-tier i18n is red until every locale is filled: run the i18n-locale-fill workflow (docs/i18n-scaling/translation-workflow.md). It does NOT indicate a code regression.',
      });
    }
  }
  if (!opts.skipBrowser) {
    steps.push({
      name: 'browser regressions',
      cmd: 'npm',
      args: ['run', 'test:browser'],
    });
  }

  // Independent pure steps: one turbo multi-task run for wall-clock overlap.
  // When a profile flag drops only types or only builds, fall back to separate
  // tasks so --skip-* still measures what it claims.
  if (!opts.skipTypes && !opts.skipBuilds) {
    steps.push({
      name: 'typecheck + env/server/bot builds',
      cmd: 'npx',
      args: turboRunArgs(['check:types', 'build:env', 'build:server', 'build:bot']),
    });
    steps.push({
      name: 'client build',
      cmd: 'npx',
      args: turboRunArgs(['build:bundle']),
    });
  } else {
    if (!opts.skipTypes) {
      steps.push({
        name: 'typecheck',
        cmd: 'npx',
        args: turboRunArgs(['check:types']),
      });
    }
    if (!opts.skipBuilds) {
      steps.push(
        {
          name: 'env build',
          cmd: 'npx',
          args: turboRunArgs(['build:env']),
        },
        {
          name: 'server build',
          cmd: 'npx',
          args: turboRunArgs(['build:server']),
        },
        {
          name: 'bot build',
          cmd: 'npx',
          args: turboRunArgs(['build:bot']),
        },
        {
          name: 'client build',
          cmd: 'npx',
          args: turboRunArgs(['build:bundle']),
        },
      );
    }
  }

  return steps;
}
