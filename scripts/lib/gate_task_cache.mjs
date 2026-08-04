// Phase 8 local-gate-perf: Turborepo task-cache helpers for pure gate artifacts.
//
// Tool choice: turbo (not wireit). Rationale lives in docs/local-gate-perf/
// experiment-log.md and state.md. Summary: single-package task graph with
// precise inputs/outputs, local disk cache, and one-shot multi-task parallel
// for independent pure steps (check:types // build:env // build:server).
// Wireit would also skip unchanged scripts but is heavier to express across
// many package.json scripts without rewriting each entry to "wireit".
//
// Non-negotiable:
// - Never cache "tests passed". package.json "test" / "test:browser" are
//   cache:false in turbo.json; gate.mjs also runs them via npm (not turbo).
// - Malware and changed-file biome always run (git / always-run semantics).
// - i18n freshness (git diff) always runs after i18n:gen so a cache restore
//   cannot hide drift from committed artifacts.
// - Standalone `npm test` / `npm run build` still regenerate via pretest/build
//   (Phase 2 generate-once only applies inside gate.mjs).

/** Tasks the full gate runs through turbo for local disk cache. */
export const GATE_CACHEABLE_TASKS = Object.freeze([
  'i18n:gen',
  'wiki:content',
  'sfx:check',
  'check:types',
  'build:env',
  'build:server',
  'build:bot',
  'build:bundle',
]);

/** Tasks that must never report a cache hit as "green forever". */
export const GATE_NON_CACHEABLE_TASKS = Object.freeze([
  'test',
  'test:browser',
  'security:gate',
  'ci:changed',
]);

/**
 * Human inventory for docs and pins: precise inputs/outputs per cacheable task.
 * Keep in sync with turbo.json (tests pin both).
 */
export const GATE_CACHE_TASK_INVENTORY = Object.freeze({
  'i18n:gen': {
    inputs: [
      'src/ui/i18n.catalog/**',
      'src/ui/i18n.locales/**',
      'src/ui/i18n.ts',
      'src/admin/i18n.en.ts',
      'src/admin/i18n.locales/**',
      'src/admin/i18n.ts',
      'scripts/i18n_*.mjs',
      'package.json',
    ],
    outputs: [
      'src/ui/i18n.resolved.generated/**',
      'src/admin/i18n.resolved.generated/**',
      'src/ui/i18n.catalog/translation_keys.generated.ts',
      'src/ui/i18n.status.json',
      'src/ui/i18n.status.summary.json',
    ],
  },
  'wiki:content': {
    inputs: [
      'src/sim/**',
      'src/render/characters/manifest.ts',
      'src/ui/deed_image_ids.ts',
      'scripts/wiki/**',
      'package.json',
    ],
    outputs: ['src/guide/content.generated.ts'],
  },
  'sfx:check': {
    inputs: ['public/audio/sfx/**', 'scripts/sfx_conform.mjs', 'scripts/sfx/**', 'package.json'],
    outputs: [],
  },
  'check:types': {
    inputs: [
      'src/**',
      'server/**',
      'headless/**',
      'bot/**',
      'tests/**',
      'private/**',
      'tsconfig.json',
      'tsconfig.admin.json',
      'tsconfig.bot.json',
      'package.json',
    ],
    outputs: ['node_modules/.cache/tsc/**'],
  },
  'build:env': {
    inputs: ['headless/**', 'src/sim/**', 'package.json'],
    outputs: ['dist-env/**'],
  },
  'build:server': {
    inputs: [
      'server/**',
      'src/**',
      'scripts/build_server.mjs',
      'scripts/migrate_old_cragmaw_pelt.ts',
      'private/**',
      'package.json',
    ],
    outputs: ['dist-server/**'],
  },
  'build:bot': {
    // tsconfig.json is an input because esbuild auto-discovers it when bundling
    // bot/main.ts (no explicit tsconfig option in build_bot.mjs), so a root
    // compiler-settings edit must bust the cached dist-bot artifact.
    inputs: ['bot/**', 'src/**', 'scripts/build_bot.mjs', 'tsconfig.json', 'package.json'],
    outputs: ['dist-bot/**'],
  },
  'build:bundle': {
    inputs: [
      'src/**',
      'public/**',
      'index.html',
      'admin.html',
      'play.html',
      'guide.html',
      'editor.html',
      'vite.config.ts',
      'tsconfig.json',
      'scripts/build_sitemap.mjs',
      'scripts/build_sfx_manifest.mjs',
      'scripts/build_media_manifest.mjs',
      'scripts/check_backdrop_survival.mjs',
      'package.json',
    ],
    outputs: ['dist/**'],
  },
});

/** Stream UI keeps cache hit/miss lines visible on Windows and POSIX. */
export const GATE_TURBO_UI_ARGS = Object.freeze(['--ui=stream']);

/**
 * Args for `npx turbo run <tasks...>`.
 * @param {ReadonlyArray<string>} tasks package.json script names
 * @returns {string[]}
 */
export function turboRunArgs(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('turboRunArgs requires at least one task name');
  }
  for (const t of tasks) {
    if (typeof t !== 'string' || !t.trim()) {
      throw new Error(`turboRunArgs: invalid task ${JSON.stringify(t)}`);
    }
  }
  return ['turbo', 'run', ...tasks, ...GATE_TURBO_UI_ARGS];
}

/**
 * True when a gate step is invoked through turbo (cacheable pure artifacts).
 * @param {string} cmd
 * @param {ReadonlyArray<string>} args
 */
export function isTurboGateStep(cmd, args) {
  return cmd === 'npx' && Array.isArray(args) && args[0] === 'turbo' && args[1] === 'run';
}
