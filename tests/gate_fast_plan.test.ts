import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDayLoopVitestPlan,
  buildGuardVitestArgs,
  classifyChangedPaths,
  GATE_FAST_GUARD_TESTS,
  GATE_FAST_STEP_NAMES,
  isBroadConfigPath,
  isRelatedSourcePath,
  isTestPath,
  resolveFastChangedBase,
} from '../scripts/lib/gate_fast_plan.mjs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const gateFastSrc = readFileSync(new URL('../scripts/gate_fast.mjs', import.meta.url), 'utf8');
const qaGate = readFileSync(new URL('../docs/qa-gate.md', import.meta.url), 'utf8');

describe('gate_fast_plan: path classification', () => {
  it('detects tests, broad configs, and related sources', () => {
    expect(isTestPath('tests/gate_workers.test.ts')).toBe(true);
    expect(isTestPath('scripts/lib/gate_workers.mjs')).toBe(false);
    expect(isBroadConfigPath('package.json')).toBe(true);
    expect(isBroadConfigPath('vite.config.ts')).toBe(true);
    expect(isRelatedSourcePath('scripts/lib/gate_workers.mjs')).toBe(true);
    expect(isRelatedSourcePath('scripts/lib/gate_workers.d.mts')).toBe(false);
    expect(isRelatedSourcePath('package.json')).toBe(false);
    expect(isRelatedSourcePath('docs/qa-gate.md')).toBe(false);
  });

  it('classifies a mixed change set without feeding package.json into related', () => {
    const c = classifyChangedPaths([
      'package.json',
      'scripts/lib/gate_workers.mjs',
      'tests/gate_workers.test.ts',
      'docs/qa-gate.md',
      'scripts/gate_fast.mjs',
    ]);
    expect(c.broadConfigs).toEqual(['package.json']);
    expect(c.testFiles).toEqual(['tests/gate_workers.test.ts']);
    expect(c.relatedSources).toEqual(['scripts/gate_fast.mjs', 'scripts/lib/gate_workers.mjs']);
    expect(c.nonCode).toContain('docs/qa-gate.md');
  });
});

describe('gate_fast_plan: changed base', () => {
  it('uses explicit env base when set', () => {
    expect(resolveFastChangedBase({ envBase: 'origin/feature/x' })).toBe('origin/feature/x');
    expect(resolveFastChangedBase({ envBase: '  origin/release/v0.34.0  ' })).toBe(
      'origin/release/v0.34.0',
    );
  });

  it('defaults to null (day-loop uses related, not --changed)', () => {
    expect(resolveFastChangedBase({ envBase: null })).toBeNull();
    expect(resolveFastChangedBase({ envBase: '  ' })).toBeNull();
    expect(resolveFastChangedBase({})).toBeNull();
    expect(resolveFastChangedBase()).toBeNull();
  });
});

describe('gate_fast_plan: vitest plan', () => {
  it('builds guard args with the pinned architecture + localization pair', () => {
    expect(GATE_FAST_GUARD_TESTS).toEqual([
      'tests/architecture.test.ts',
      'tests/localization_fixes.test.ts',
    ]);
    expect(buildGuardVitestArgs({ workers: 4 })).toEqual([
      'run',
      '--maxWorkers=4',
      'tests/architecture.test.ts',
      'tests/localization_fixes.test.ts',
    ]);
  });

  it('prefers opt-in --changed when GATE_FAST_BASE is set', () => {
    expect(
      buildDayLoopVitestPlan({
        workers: 3,
        changedBase: 'origin/release/v0.34.0',
        relatedSources: ['scripts/lib/gate_workers.mjs'],
      }),
    ).toEqual({
      mode: 'changed',
      args: ['run', '--passWithNoTests', '--maxWorkers=3', '--changed', 'origin/release/v0.34.0'],
      reason: 'opt-in GATE_FAST_BASE=origin/release/v0.34.0',
    });
  });

  it('uses vitest related for source changes without expanding package.json', () => {
    expect(
      buildDayLoopVitestPlan({
        workers: 2,
        relatedSources: ['scripts/lib/gate_workers.mjs'],
        testFiles: ['tests/gate_workers.test.ts'],
      }),
    ).toEqual({
      mode: 'related',
      args: [
        'related',
        'scripts/lib/gate_workers.mjs',
        'tests/gate_workers.test.ts',
        '--run',
        '--passWithNoTests',
        '--maxWorkers=2',
      ],
    });
  });

  it('runs explicit test files when only tests changed', () => {
    expect(
      buildDayLoopVitestPlan({
        workers: 2,
        testFiles: ['tests/gate_fast_plan.test.ts'],
      }),
    ).toEqual({
      mode: 'run',
      args: ['run', '--passWithNoTests', '--maxWorkers=2', 'tests/gate_fast_plan.test.ts'],
    });
  });

  it('skips vitest when only docs/config changed', () => {
    const plan = buildDayLoopVitestPlan({ workers: 4, testFiles: [], relatedSources: [] });
    expect(plan.mode).toBe('skip');
    expect(plan.args).toBeNull();
    expect(plan.reason).toMatch(/no code or test/i);
  });

  it('floors invalid workers to at least 1', () => {
    const plan = buildDayLoopVitestPlan({
      workers: 0,
      testFiles: ['tests/x.test.ts'],
    });
    expect(plan.args?.find((a) => a.startsWith('--maxWorkers'))).toBe('--maxWorkers=1');
  });
});

describe('gate:fast wiring contracts', () => {
  it('exposes package script gate:fast and five documented step names', () => {
    expect(packageJson.scripts['gate:fast']).toBe('node scripts/gate_fast.mjs');
    expect(packageJson.scripts.gate).toBe('node scripts/gate.mjs');
    expect([...GATE_FAST_STEP_NAMES]).toEqual([
      'malware scan',
      'biome (changed files)',
      'guard tests (architecture + localization)',
      'typecheck (check:ts incremental)',
      'vitest (related / changed tests)',
    ]);
  });

  it('gate_fast.mjs uses Windows-safe shell spawn and free-mem worker policy', () => {
    expect(gateFastSrc).toMatch(/process\.platform === 'win32'/);
    expect(gateFastSrc).toMatch(/computeGateWorkers/);
    expect(gateFastSrc).toMatch(/GATE_WORKER_TIER/);
    expect(gateFastSrc).toMatch(/GATE_MAX_WORKERS/);
    expect(gateFastSrc).toMatch(/buildDayLoopVitestPlan|vitest related/);
    // Policy: must not claim to be the merge bar.
    expect(gateFastSrc).toMatch(/NOT the merge bar|not a merge contract/i);
    expect(gateFastSrc).toMatch(/npm run gate/);
  });

  it('docs keep full gate as the merge contract and name gate:fast as day-loop only', () => {
    expect(qaGate).toMatch(/npm run gate/);
    expect(qaGate).toMatch(/gate:fast/);
    expect(qaGate).toMatch(/merge|pre-merge|ready/i);
    // Full gate section must still exist as a first-class layer.
    expect(qaGate).toMatch(/Full local gate/);
  });
});
