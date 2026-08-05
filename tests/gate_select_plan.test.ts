import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAlwaysRunArgs,
  buildFullSuiteArgs,
  buildRelatedArgs,
  buildSelectPlan,
  classifySelectPaths,
} from '../scripts/lib/gate_select_plan.mjs';
import {
  buildAlwaysRunSet,
  classifyTestSource,
  OUT_OF_GRAPH_PATTERNS,
  requiresAlwaysRun,
} from '../scripts/lib/test_visibility.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('test visibility classification', () => {
  it('classifies a pure-import test as graph-visible', () => {
    const v = classifyTestSource(`import { Sim } from '../src/sim/sim';\nit('x', () => {});`);
    expect(v.klass).toBe('graph');
    expect(v.reasons).toEqual([]);
    expect(requiresAlwaysRun(v.klass)).toBe(false);
  });

  it('classifies a disk-scanning test with no source import as blind', () => {
    const v = classifyTestSource(`import { readdirSync } from 'node:fs';
const files = readdirSync('src/sim');`);
    expect(v.klass).toBe('blind');
    expect(v.reasons).toContain('readdirSync');
    expect(v.srcImports).toBe(false);
    expect(requiresAlwaysRun(v.klass)).toBe(true);
  });

  it('classifies a test that both imports source and scans disk as partial', () => {
    const v = classifyTestSource(`import { Sim } from '../src/sim/sim';
const raw = readFileSync('docs/x.md', 'utf8');`);
    expect(v.klass).toBe('partial');
    expect(v.srcImports).toBe(true);
    expect(requiresAlwaysRun(v.klass)).toBe(true);
  });

  // Each out-of-graph pattern gets its own negative case: a single regex that
  // silently stops matching would drop real tests out of the always-run set, and
  // the failure would be invisible (the gate still prints PASS).
  it.each([
    ['readFileSync', 'const a = readFileSync("x");'],
    ['readdirSync', 'const a = readdirSync("x");'],
    ['globSync', 'const a = globSync("x");'],
    ['readdir', 'await readdir("x");'],
    ['fs/promises', `import { readFile } from 'node:fs/promises';`],
    ['import.meta.glob', 'const m = import.meta.glob("./*.ts");'],
    ['execSync', 'execSync("git status");'],
    ['spawnSync', 'spawnSync("git", ["status"]);'],
    ['dynamic-import', 'const m = await import(specifier);'],
  ])('detects the %s escape hatch', (label, source) => {
    const v = classifyTestSource(source);
    expect(v.reasons).toContain(label);
    expect(requiresAlwaysRun(v.klass)).toBe(true);
  });

  it('pins the pattern list so a silent deletion fails here', () => {
    expect(OUT_OF_GRAPH_PATTERNS.map(([label]) => label)).toEqual([
      'readFileSync',
      'readdirSync',
      'globSync',
      'readdir',
      'fs/promises',
      'import.meta.glob',
      'execSync',
      'spawnSync',
      'dynamic-import',
    ]);
  });

  it('folds classifications into a sorted always-run set with reasons', () => {
    const { alwaysRun, reasons, counts } = buildAlwaysRunSet([
      { file: 'tests/z.test.ts', visibility: classifyTestSource('readFileSync("a")') },
      { file: 'tests/a.test.ts', visibility: classifyTestSource('execSync("b")') },
      { file: 'tests/pure.test.ts', visibility: classifyTestSource(`import '../src/x';`) },
    ]);
    expect(alwaysRun).toEqual(['tests/a.test.ts', 'tests/z.test.ts']);
    expect(reasons['tests/a.test.ts']).toContain('execSync');
    expect(counts).toEqual({ blind: 2, partial: 0, graph: 1 });
  });
});

describe('selective gate planning', () => {
  const ALWAYS = ['tests/architecture.test.ts', 'tests/ci_workflow.test.ts'];

  it('routes a source change to related and keeps the always-run set', () => {
    const plan = buildSelectPlan({
      changedPaths: ['src/render/nameplates.ts'],
      alwaysRunFiles: ALWAYS,
    });
    expect(plan.mode).toBe('selective');
    expect(plan.relatedSources).toEqual(['src/render/nameplates.ts']);
    expect(plan.alwaysRunFiles).toEqual(ALWAYS);
  });

  // The safety fallback is the load-bearing branch: a config change we cannot
  // reason about must widen to the full suite, never narrow.
  it.each([
    ['package.json'],
    ['pnpm-lock.yaml'],
    ['vite.config.ts'],
    ['tsconfig.json'],
    ['some/unrecognized/thing.bin'],
  ])('falls back to the FULL suite for %s', (changed) => {
    const plan = buildSelectPlan({ changedPaths: [changed], alwaysRunFiles: ALWAYS });
    expect(plan.mode).toBe('full');
    expect(plan.relatedSources).toEqual([]);
  });

  it('adds a changed test file to the always-run set even if nothing imports it', () => {
    const plan = buildSelectPlan({
      changedPaths: ['tests/brand_new.test.ts'],
      alwaysRunFiles: ALWAYS,
    });
    expect(plan.mode).toBe('selective');
    expect(plan.alwaysRunFiles).toContain('tests/brand_new.test.ts');
  });

  it('runs only the always-run set for a docs-only change', () => {
    const plan = buildSelectPlan({
      changedPaths: ['docs/qa-gate.md', 'README.md'],
      alwaysRunFiles: ALWAYS,
    });
    expect(plan.mode).toBe('selective');
    expect(plan.relatedSources).toEqual([]);
    expect(plan.alwaysRunFiles).toEqual(ALWAYS);
  });

  it('classifies paths into the four planner buckets', () => {
    const c = classifySelectPaths([
      'src/sim/sim.ts',
      'tests/threat.test.ts',
      'package.json',
      'docs/x.md',
    ]);
    expect(c.relatedSources).toEqual(['src/sim/sim.ts']);
    expect(c.testFiles).toEqual(['tests/threat.test.ts']);
    expect(c.broadConfigs).toEqual(['package.json']);
    expect(c.nonCode).toEqual(['docs/x.md']);
  });
});

describe('selective gate argv', () => {
  it('builds the always-run leg with an explicit file list', () => {
    expect(buildAlwaysRunArgs({ files: ['tests/a.test.ts'], workers: 7 })).toEqual([
      'run',
      'tests/a.test.ts',
      '--maxWorkers=7',
    ]);
  });

  it('builds the related leg as a subcommand, not a flag', () => {
    expect(buildRelatedArgs({ sources: ['src/x.ts'], workers: 4 })).toEqual([
      'related',
      'src/x.ts',
      '--run',
      '--passWithNoTests',
      '--maxWorkers=4',
    ]);
  });

  it('returns null for the related leg when nothing changed', () => {
    expect(buildRelatedArgs({ sources: [], workers: 4 })).toBeNull();
  });

  it('builds the full-suite fallback with no file filter', () => {
    expect(buildFullSuiteArgs({ workers: 7 })).toEqual(['run', '--maxWorkers=7']);
  });
});

// This is the guard that keeps the whole design honest as the suite grows: the
// always-run set is recomputed from source on every gate run, so it cannot go
// stale, but a regression that broke classification would silently shrink it.
describe('always-run set over the real suite', () => {
  function listTests(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          ['node_modules', 'browser', '__snapshots__', 'fixtures', 'helpers'].includes(entry.name)
        )
          continue;
        listTests(full, out);
        continue;
      }
      if (/\.test\.[cm]?ts$/.test(entry.name)) {
        out.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
      }
    }
    return out;
  }

  it('keeps the known out-of-graph guards in the always-run set', () => {
    const files = listTests(path.join(REPO_ROOT, 'tests'));
    const { alwaysRun } = buildAlwaysRunSet(
      files.map((file) => ({
        file,
        visibility: classifyTestSource(readFileSync(path.join(REPO_ROOT, file), 'utf8')),
      })),
    );
    // These four assert over content they never import. If any drops out of the
    // set, `vitest related` would stop selecting it and the gate would go quiet.
    expect(alwaysRun).toContain('tests/architecture.test.ts');
    expect(alwaysRun).toContain('tests/localization_fixes.test.ts');
    expect(alwaysRun).toContain('tests/ci_workflow.test.ts');
    expect(alwaysRun).toContain('tests/guide.test.ts');
    // Sanity floor: classification collapsing to "everything is graph-visible"
    // is the exact regression that would make selection unsafe.
    expect(alwaysRun.length).toBeGreaterThan(300);
  });
});
