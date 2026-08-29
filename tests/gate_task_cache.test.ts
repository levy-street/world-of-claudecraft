import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildFullGateSteps,
  I18N_ARTIFACTS,
  MANIFEST_ARTIFACTS,
} from '../scripts/lib/gate_steps.mjs';
import {
  GATE_CACHE_TASK_INVENTORY,
  GATE_CACHEABLE_TASKS,
  GATE_NON_CACHEABLE_TASKS,
  isTurboGateStep,
  turboRunArgs,
} from '../scripts/lib/gate_task_cache.mjs';

const turboJson = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf8')) as {
  cacheDir?: string;
  tasks: Record<
    string,
    { cache?: boolean; inputs?: string[]; outputs?: string[]; dependsOn?: string[] }
  >;
};
const gateSrc = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  devDependencies?: Record<string, string>;
  scripts: Record<string, string>;
};

describe('turboRunArgs', () => {
  it('builds turbo run argv with stream UI', () => {
    expect(turboRunArgs(['i18n:gen'])).toEqual(['run', 'i18n:gen', '--ui=stream']);
    expect(turboRunArgs(['check:types', 'build:env', 'build:server'])).toEqual([
      'run',
      'check:types',
      'build:env',
      'build:server',
      '--ui=stream',
    ]);
  });

  it('rejects empty or invalid task lists', () => {
    expect(() => turboRunArgs([])).toThrow(/at least one/);
    expect(() => turboRunArgs([''])).toThrow(/invalid task/);
  });
});

describe('gate cache inventory vs turbo.json', () => {
  it('pins turbo as the chosen tool and lists every cacheable task', () => {
    expect(pkg.devDependencies?.turbo).toMatch(/^2\./);
    expect(GATE_CACHEABLE_TASKS).toEqual([
      'i18n:gen',
      'wiki:content',
      'sfx:check',
      'check:types',
      'build:env',
      'build:server',
      'build:bot',
      'build:bundle',
    ]);
    for (const task of GATE_CACHEABLE_TASKS) {
      expect(turboJson.tasks[task], `missing turbo task ${task}`).toBeDefined();
      expect(turboJson.tasks[task].cache).not.toBe(false);
      const inv = GATE_CACHE_TASK_INVENTORY[task as keyof typeof GATE_CACHE_TASK_INVENTORY];
      expect(inv, `inventory missing ${task}`).toBeDefined();
      expect(turboJson.tasks[task].inputs).toEqual(inv.inputs);
      expect(turboJson.tasks[task].outputs ?? []).toEqual(inv.outputs);
    }
  });

  it('never caches tests, malware, or changed-file biome', () => {
    for (const task of GATE_NON_CACHEABLE_TASKS) {
      expect(turboJson.tasks[task]?.cache).toBe(false);
    }
  });

  it('invalidates i18n when a catalog path is an input', () => {
    const inputs = turboJson.tasks['i18n:gen'].inputs ?? [];
    expect(inputs.some((p) => p.includes('i18n.catalog'))).toBe(true);
    expect(inputs.some((p) => p.includes('i18n.locales'))).toBe(true);
    // The sim/server matcher DICTs are i18n:gen inputs too: without these rows a
    // warm turbo cache restores a stale i18n.status.json over freshly added sim
    // rows (the exact bug the bank-storage phase 01 rider fixed; the sync pin
    // above only proves turbo.json and gate_task_cache.mjs agree WITH EACH OTHER,
    // so deleting the rows from both together would otherwise stay green).
    expect(inputs.some((p) => p.includes('sim_i18n'))).toBe(true);
    expect(inputs.some((p) => p.includes('server_i18n'))).toBe(true);
  });

  it('the i18n DICT input globs resolve to the real files on disk', () => {
    // The includes() pins above prove a ROW exists, not that it matches
    // anything: a typo'd glob resolving to zero files still contains the
    // substring while a warm turbo cache restores stale i18n output over a
    // changed DICT module (the exact bug these rows exist to prevent). So
    // resolve the patterns against the real directory and pin the result.
    const inputs = turboJson.tasks['i18n:gen'].inputs ?? [];
    const dictPatterns = inputs.filter(
      (p) => p.startsWith('src/ui/') && p.includes('_i18n') && p.endsWith('.ts'),
    );
    expect(dictPatterns.length).toBeGreaterThan(0);
    // Minimal matcher for the only wildcard these rows use: `*` within one
    // path segment, anchored over the whole repo-relative path.
    const toRe = (pattern: string) =>
      new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    const uiFiles = readdirSync(new URL('../src/ui', import.meta.url))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `src/ui/${f}`);
    const resolved = new Map(dictPatterns.map((p) => [p, uiFiles.filter((f) => toRe(p).test(f))]));
    for (const [pattern, files] of resolved) {
      expect(files.length, `i18n:gen input ${pattern} resolves to no file on disk`).toBeGreaterThan(
        0,
      );
    }
    // The current on-disk DICT-family files, pinned as literals: an addition
    // to a family (a new overlay or override module) EXTENDS this list.
    const matched = [...new Set([...resolved.values()].flat())].sort();
    expect(matched).toEqual([
      // entity_i18n.ts is transitively imported by the sim/server DICTs
      // (tEntity), so its edits change scan output and it must key the cache.
      'src/ui/entity_i18n.ts',
      'src/ui/server_i18n.newlocales.ts',
      'src/ui/server_i18n.ts',
      'src/ui/server_i18n_moderation.ts',
      'src/ui/sim_i18n.newlocales.ts',
      'src/ui/sim_i18n.ts',
      'src/ui/talent_i18n.newlocales.ts',
      'src/ui/talent_i18n.row_description_overrides.ts',
      'src/ui/talent_i18n.row_title_overrides.ts',
      'src/ui/talent_i18n.ts',
      'src/ui/world_entity_i18n.ts',
    ]);
    // Reverse arm: every on-disk file in these DICT families must be
    // matched by SOME input pattern, so a family file the globs miss cannot
    // change scan output while riding a warm cache.
    const familyStems = [
      'sim_i18n',
      'server_i18n',
      'talent_i18n',
      'world_entity_i18n',
      'entity_i18n',
    ];
    const familyFiles = uiFiles.filter((f) => {
      const base = f.slice('src/ui/'.length);
      return familyStems.some(
        (s) => base === `${s}.ts` || base.startsWith(`${s}.`) || base.startsWith(`${s}_`),
      );
    });
    expect(familyFiles.length).toBeGreaterThanOrEqual(11);
    for (const f of familyFiles) {
      expect(matched.includes(f), `${f} is not matched by any i18n:gen input pattern`).toBe(true);
    }
  });

  it('invalidates the server bundle when either Rift rollback migration source changes', () => {
    expect(turboJson.tasks['build:server'].inputs).toEqual(
      expect.arrayContaining([
        'scripts/migrate_rift_forge_rollback.ts',
        'scripts/rift_forge_rollback_migration.ts',
      ]),
    );
  });
});

describe('git worktree cache sharing (Turborepo >= 2.8)', () => {
  it('stays on a turbo version that auto-shares the local cache across linked worktrees', () => {
    // Since Turborepo 2.8, a run inside a `git worktree add` checkout auto-detects
    // the linkage and redirects local-cache reads/writes to the MAIN checkout's
    // .turbo/cache, no config needed (https://turborepo.dev/blog/2-8). This repo's
    // own default task workflow mandates a fresh worktree per task, so this is what
    // makes the very first gate run in a brand-new worktree warm-cache for every
    // pure artifact step (i18n:gen, wiki:content, sfx:check, check:types, the env/
    // server/bot/client builds) whenever the inputs are unchanged from what the main
    // checkout already built, instead of paying the cold-cache cost every time.
    // Verified empirically (docs/local-gate-perf/experiment-log.md): running the
    // gate's turbo steps from a linked worktree wrote new cache entries into the
    // MAIN repo root's .turbo/cache, not the worktree's own .turbo/. Pin the
    // MINOR floor (not just "^2.") so a downgrade under 2.8 fails loudly instead
    // of silently losing this for every new worktree.
    const version = pkg.devDependencies?.turbo ?? '';
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    expect(match, `unparsable turbo version ${version}`).toBeTruthy();
    const [, major, minor] = match as RegExpMatchArray;
    const atLeast28 = Number(major) > 2 || (Number(major) === 2 && Number(minor) >= 8);
    expect(atLeast28, `turbo ${version} predates 2.8's worktree cache sharing`).toBe(true);
  });

  it('never pins an explicit cacheDir, which disables the auto-worktree-sharing default', () => {
    // Turborepo's auto-detection only applies when no cacheDir override is set; an
    // explicit (even relative) cacheDir pins every worktree to its OWN path and
    // silently reintroduces a cold cache in every fresh worktree this repo's
    // workflow creates.
    expect(turboJson.cacheDir).toBeUndefined();
  });
});

describe('buildFullGateSteps orchestration', () => {
  it('uses turbo for pure artifacts and npm for tests/malware/biome', () => {
    const steps = buildFullGateSteps(8);
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    const artifacts = byName['i18n + wiki + sfx artifacts'];
    expect(isTurboGateStep(artifacts.cmd, artifacts.args)).toBe(true);
    expect(artifacts.cmd).toMatch(/(?:^|[\\/])turbo(?:\.cmd)?$/);
    expect(artifacts.args).toEqual(
      expect.arrayContaining(['run', 'i18n:gen', 'wiki:content', 'sfx:check']),
    );
    expect(byName['i18n freshness'].cmd).toBe('git');
    expect(byName['i18n freshness'].args).toEqual(
      expect.arrayContaining(['diff', '--exit-code', ...I18N_ARTIFACTS]),
    );
    // The manifest arm mirrors the i18n one, pinned to the SAME constant the
    // three-way weld checks (tests/ci_workflow.test.ts): trackedness closes
    // the deleted-then-regenerated untracked-file escape, while a diff argv
    // that drifts from MANIFEST_ARTIFACTS would prove fewer files than the
    // classifier declassifies.
    expect(byName['sfx manifest regen'].cmd).toBe('node');
    expect(byName['sfx manifest regen'].args).toEqual(['scripts/build_sfx_manifest.mjs']);
    expect(byName['media manifest regen'].cmd).toBe('node');
    expect(byName['media manifest regen'].args).toEqual([
      'scripts/build_media_manifest.mjs',
      'generate',
    ]);
    expect(byName['manifest trackedness'].cmd).toBe('git');
    expect(byName['manifest trackedness'].args).toEqual([
      'ls-files',
      '--error-unmatch',
      '--',
      ...MANIFEST_ARTIFACTS,
    ]);
    expect(byName['manifest freshness'].cmd).toBe('git');
    expect(byName['manifest freshness'].args).toEqual([
      'diff',
      '--exit-code',
      '--',
      ...MANIFEST_ARTIFACTS,
    ]);
    expect(byName['malware scan'].cmd).toBe('npm');
    expect(byName['malware scan'].args).toEqual(['run', 'security:gate']);
    expect(byName['biome (changed files)'].cmd).toBe('npm');
    expect(byName['biome (changed files)'].args).toEqual(['run', 'ci:changed']);
    expect(byName['vitest (full suite)'].cmd).toBe('npm');
    expect(byName['vitest (full suite)'].args).toEqual(['test', '--', '--maxWorkers=8']);
    expect(byName['vitest (full suite)'].env).toEqual({ WOC_SKIP_PRETEST: '1' });
    expect(byName['browser regressions'].cmd).toBe('npm');

    const typesBuilds = byName['typecheck + env/server/bot builds'];
    expect(typesBuilds.cmd).toMatch(/(?:^|[\\/])turbo(?:\.cmd)?$/);
    expect(typesBuilds.args).toEqual(
      expect.arrayContaining(['run', 'check:types', 'build:env', 'build:server', 'build:bot']),
    );
    expect(isTurboGateStep(byName['client build'].cmd, byName['client build'].args)).toBe(true);
    expect(byName['client build'].args).toContain('build:bundle');
  });

  it('preserves generate-once ordering: artifacts before freshness before biome before vitest', () => {
    const names = buildFullGateSteps(4).map((s) => s.name);
    const artifacts = names.indexOf('i18n + wiki + sfx artifacts');
    const freshness = names.indexOf('i18n freshness');
    const sfxRegen = names.indexOf('sfx manifest regen');
    const mediaRegen = names.indexOf('media manifest regen');
    const manifestTrackedness = names.indexOf('manifest trackedness');
    const manifestFreshness = names.indexOf('manifest freshness');
    const biome = names.indexOf('biome (changed files)');
    const vitest = names.indexOf('vitest (full suite)');
    const client = names.indexOf('client build');
    expect(artifacts).toBeGreaterThan(-1);
    expect(freshness).toBeGreaterThan(artifacts);
    // Both regens (and the turbo wiki:content in the artifacts step) must
    // precede the manifest diff, or it proves nothing about this tree.
    expect(sfxRegen).toBeGreaterThan(freshness);
    expect(mediaRegen).toBeGreaterThan(sfxRegen);
    expect(manifestTrackedness).toBeGreaterThan(mediaRegen);
    expect(manifestFreshness).toBeGreaterThan(manifestTrackedness);
    expect(biome).toBeGreaterThan(manifestFreshness);
    expect(vitest).toBeGreaterThan(biome);
    expect(client).toBeGreaterThan(vitest);
  });

  it('honors profile skip flags without dropping the other arm of types/builds', () => {
    const typesOnly = buildFullGateSteps(2, {
      skipBrowser: true,
      skipBuilds: true,
      skipVitest: true,
    });
    expect(typesOnly.map((s) => s.name)).toEqual([
      'i18n + wiki + sfx artifacts',
      'i18n freshness',
      'sfx manifest regen',
      'media manifest regen',
      'manifest trackedness',
      'manifest freshness',
      'malware scan',
      'biome (changed files)',
      'typecheck',
    ]);

    const buildsOnly = buildFullGateSteps(2, {
      skipBrowser: true,
      skipTypes: true,
      skipVitest: true,
    });
    expect(buildsOnly.map((s) => s.name)).toEqual([
      'i18n + wiki + sfx artifacts',
      'i18n freshness',
      'sfx manifest regen',
      'media manifest regen',
      'manifest trackedness',
      'manifest freshness',
      'malware scan',
      'biome (changed files)',
      'env build',
      'server build',
      'bot build',
      'client build',
    ]);
  });
});

describe('gate.mjs wiring pins', () => {
  it('delegates the step list to buildFullGateSteps and keeps standalone regen paths', () => {
    expect(gateSrc).toContain('buildFullGateSteps');
    expect(gateSrc).not.toContain("['run', 'i18n:gen']");
    expect(pkg.scripts.pretest).toBe('node scripts/pretest.mjs');
    expect(pkg.scripts.build).toContain('i18n:gen');
    expect(pkg.scripts.build).toContain('wiki:content');
    expect(pkg.scripts['build:bundle']).not.toContain('i18n:gen');
  });
});
