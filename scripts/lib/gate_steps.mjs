// Shared full-gate step list for scripts/gate.mjs and the Phase 1 profile
// harness. Keeps generate-once (Phase 2), turbo artifact cache (Phase 8), and
// never-cache vitest semantics in one place so profile timings match the real
// merge bar.
import { gateVitestSkipPretestEnv } from './gate_artifact_skip.mjs';
import { turboRunArgs } from './gate_task_cache.mjs';

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
 * cache). Typecheck + env + server builds share one turbo multi-task step so
 * independent work overlaps; client build stays separate (depends on gens).
 *
 * @param {number} workers
 * @param {{
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
      name: 'i18n artifacts',
      cmd: 'npx',
      args: turboRunArgs(['i18n:gen']),
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
      name: 'wiki content',
      cmd: 'npx',
      args: turboRunArgs(['wiki:content']),
    },
    {
      name: 'malware scan',
      cmd: 'npm',
      args: ['run', 'security:gate'],
    },
    {
      name: 'biome (changed files)',
      cmd: 'npm',
      args: ['run', 'ci:changed'],
    },
    {
      name: 'sfx check',
      cmd: 'npx',
      args: turboRunArgs(['sfx:check']),
    },
  ];

  if (!opts.skipVitest) {
    steps.push({
      name: 'vitest (full suite)',
      cmd: 'npm',
      args: ['test', '--', `--maxWorkers=${workers}`],
      env: gateVitestSkipPretestEnv(),
    });
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
