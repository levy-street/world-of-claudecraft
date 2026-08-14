import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  gateVitestSkipPretestEnv,
  shouldRunEntryPretest,
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

describe('shouldRunEntryPretest (the CI shard entry decision)', () => {
  // The three arms of scripts/ci_shard_test.mjs's entry-level pretest,
  // unit-driven so the always-executed CI branch has executing coverage:
  // zero legs (a selective lane that owns nothing) must not regenerate,
  // an inherited skip flag must not regenerate twice, and the normal shape
  // must regenerate exactly once before any leg.
  it('runs for a populated plan with no skip flag', () => {
    expect(shouldRunEntryPretest({ legCount: 1, env: {} })).toBe(true);
  });
  it('skips for a zero-leg plan (nothing below reads the artifacts)', () => {
    expect(shouldRunEntryPretest({ legCount: 0, env: {} })).toBe(false);
  });
  it('skips when the flag is already set, exact-string contract', () => {
    expect(shouldRunEntryPretest({ legCount: 3, env: { WOC_SKIP_PRETEST: '1' } })).toBe(false);
    expect(shouldRunEntryPretest({ legCount: 3, env: { WOC_SKIP_PRETEST: 'true' } })).toBe(true);
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
