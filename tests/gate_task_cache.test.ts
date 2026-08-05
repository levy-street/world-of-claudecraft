import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFullGateSteps, I18N_ARTIFACTS } from '../scripts/lib/gate_steps.mjs';
import {
  GATE_CACHE_TASK_INVENTORY,
  GATE_CACHEABLE_TASKS,
  GATE_NON_CACHEABLE_TASKS,
  isTurboGateStep,
  turboRunArgs,
} from '../scripts/lib/gate_task_cache.mjs';

const turboJson = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf8')) as {
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
  it('builds npx-ready turbo run argv with stream UI', () => {
    expect(turboRunArgs(['i18n:gen'])).toEqual(['turbo', 'run', 'i18n:gen', '--ui=stream']);
    expect(turboRunArgs(['check:types', 'build:env', 'build:server'])).toEqual([
      'turbo',
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
  });
});

describe('buildFullGateSteps orchestration', () => {
  it('uses turbo for pure artifacts and npm for tests/malware/biome', () => {
    const steps = buildFullGateSteps(8);
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    expect(isTurboGateStep(byName['i18n artifacts'].cmd, byName['i18n artifacts'].args)).toBe(true);
    expect(byName['i18n artifacts'].args).toContain('i18n:gen');
    expect(byName['i18n freshness'].cmd).toBe('git');
    expect(byName['i18n freshness'].args).toEqual(
      expect.arrayContaining(['diff', '--exit-code', ...I18N_ARTIFACTS]),
    );
    expect(isTurboGateStep(byName['wiki content'].cmd, byName['wiki content'].args)).toBe(true);
    expect(byName['malware scan'].cmd).toBe('npm');
    expect(byName['malware scan'].args).toEqual(['run', 'security:gate']);
    expect(byName['biome (changed files)'].cmd).toBe('npm');
    expect(byName['sfx check'].cmd).toBe('npx');
    expect(byName['vitest (full suite)'].cmd).toBe('npm');
    expect(byName['vitest (full suite)'].args).toEqual(['test', '--', '--maxWorkers=8']);
    expect(byName['vitest (full suite)'].env).toEqual({ WOC_SKIP_PRETEST: '1' });
    expect(byName['browser regressions'].cmd).toBe('npm');

    const typesBuilds = byName['typecheck + env/server/bot builds'];
    expect(typesBuilds.cmd).toBe('npx');
    expect(typesBuilds.args).toEqual(
      expect.arrayContaining([
        'turbo',
        'run',
        'check:types',
        'build:env',
        'build:server',
        'build:bot',
      ]),
    );
    expect(isTurboGateStep(byName['client build'].cmd, byName['client build'].args)).toBe(true);
    expect(byName['client build'].args).toContain('build:bundle');
  });

  it('preserves generate-once ordering: i18n before freshness before wiki before vitest', () => {
    const names = buildFullGateSteps(4).map((s) => s.name);
    const i18n = names.indexOf('i18n artifacts');
    const freshness = names.indexOf('i18n freshness');
    const wiki = names.indexOf('wiki content');
    const vitest = names.indexOf('vitest (full suite)');
    const client = names.indexOf('client build');
    expect(i18n).toBeGreaterThan(-1);
    expect(freshness).toBeGreaterThan(i18n);
    expect(wiki).toBeGreaterThan(freshness);
    expect(vitest).toBeGreaterThan(wiki);
    expect(client).toBeGreaterThan(vitest);
  });

  it('honors profile skip flags without dropping the other arm of types/builds', () => {
    const typesOnly = buildFullGateSteps(2, {
      skipBrowser: true,
      skipBuilds: true,
      skipVitest: true,
    });
    expect(typesOnly.map((s) => s.name)).toEqual([
      'i18n artifacts',
      'i18n freshness',
      'wiki content',
      'malware scan',
      'biome (changed files)',
      'sfx check',
      'typecheck',
    ]);

    const buildsOnly = buildFullGateSteps(2, {
      skipBrowser: true,
      skipTypes: true,
      skipVitest: true,
    });
    expect(buildsOnly.map((s) => s.name)).toEqual([
      'i18n artifacts',
      'i18n freshness',
      'wiki content',
      'malware scan',
      'biome (changed files)',
      'sfx check',
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
