import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  gateVitestSkipPretestEnv,
  shouldSkipPretest,
  WOC_SKIP_PRETEST,
} from '../scripts/lib/gate_artifact_skip.mjs';

const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
const pretest = readFileSync(new URL('../scripts/pretest.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('shouldSkipPretest', () => {
  it('skips only when the env marker is exactly "1"', () => {
    expect(shouldSkipPretest({})).toBe(false);
    expect(shouldSkipPretest({ [WOC_SKIP_PRETEST]: undefined })).toBe(false);
    expect(shouldSkipPretest({ [WOC_SKIP_PRETEST]: '' })).toBe(false);
    expect(shouldSkipPretest({ [WOC_SKIP_PRETEST]: '0' })).toBe(false);
    expect(shouldSkipPretest({ [WOC_SKIP_PRETEST]: 'true' })).toBe(false);
    expect(shouldSkipPretest({ [WOC_SKIP_PRETEST]: '1' })).toBe(true);
  });

  it('exports the gate vitest overlay as WOC_SKIP_PRETEST=1', () => {
    expect(gateVitestSkipPretestEnv()).toEqual({ [WOC_SKIP_PRETEST]: '1' });
  });
});

describe('gate generate-once orchestration pins', () => {
  it('delegates the step list so generate-once + turbo cache stay centralized', () => {
    // Step names and turbo/npm wiring are pinned in tests/gate_task_cache.test.ts
    // via buildFullGateSteps. gate.mjs must import that shared list (Phase 8).
    expect(gate).toContain('buildFullGateSteps');
    expect(gate).toContain("from './lib/gate_steps.mjs'");
    // Full `npm run build` must not appear as an inline gate step (would re-gen gens).
    expect(gate).not.toMatch(/\['client build',\s*'npm',\s*\['run',\s*'build'\]/);
  });

  it('keeps standalone pretest and full build regeneration paths', () => {
    expect(pkg.scripts.pretest).toBe('node scripts/pretest.mjs');
    expect(pkg.scripts.build).toContain('i18n:gen');
    expect(pkg.scripts.build).toContain('wiki:content');
    expect(pkg.scripts.build).toContain('build:bundle');
    expect(pkg.scripts['build:bundle']).toContain('vite build');
    expect(pkg.scripts['build:bundle']).not.toContain('i18n:gen');
    expect(pkg.scripts['build:bundle']).not.toContain('wiki:content');

    // pretest only skips when the pure helper says so; otherwise spawns gens.
    expect(pretest).toContain('shouldSkipPretest');
    expect(pretest).toContain("['run', 'i18n:gen']");
    expect(pretest).toContain("['run', 'wiki:content']");
  });
});
