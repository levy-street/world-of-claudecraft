import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chunkFileArgs,
  collectSuiteVisibility,
  compareSelection,
  filterExisting,
  isCollectedTestFile,
  listChangedPaths,
  listTestFiles,
  resolveSelectBase,
} from '../scripts/lib/gate_discovery.mjs';
import {
  buildAlwaysRunArgs,
  buildFullSuiteArgs,
  buildRelatedArgs,
  buildSelectPlan,
  classifySelectPaths,
} from '../scripts/lib/gate_select_plan.mjs';
import {
  buildAlwaysRunSet,
  buildHelperImportPattern,
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
    ['existsSync', 'expect(existsSync(p)).toBe(true);'],
    ['node:fs', `import fs from 'node:fs';`],
    ['node:child_process', `import { execFile } from 'node:child_process';`],
    ['execSync', 'execSync("git status");'],
    ['execFileSync', 'execFileSync(process.execPath, [script]);'],
    ['spawnSync', 'spawnSync("git", ["status"]);'],
    ['dynamic-import', 'const m = await import(specifier);'],
    // The awaited-adjacency regex missed these two dynamic forms.
    ['dynamic-import', 'const [m] = await Promise.all([import(spec)]);'],
    ['dynamic-import', 'return import(spec);'],
    // Third-party fs readers: a test asserting on shipped-asset CONTENT makes
    // no fs call of its own (tests/boar_asset.test.ts, tests/arena_render.test.ts,
    // tests/continent_map_view.test.ts were live escapes).
    ['gltf-transform', `import { NodeIO } from '@gltf-transform/core';`],
    ['sharp', `import sharp from 'sharp';`],
  ])('detects the %s escape hatch', (label, source) => {
    const v = classifyTestSource(source);
    expect(v.reasons).toContain(label);
    expect(requiresAlwaysRun(v.klass)).toBe(true);
  });

  it('does not mistake a static import or importActual for a dynamic import', () => {
    const v = classifyTestSource(
      `import { Sim } from '../src/sim/sim';\nconst real = await vi.importActual('../src/x');`,
    );
    expect(v.reasons).not.toContain('dynamic-import');
  });

  it('pins the pattern list so a silent deletion fails here', () => {
    expect(OUT_OF_GRAPH_PATTERNS.map(([label]) => label)).toEqual([
      'readFileSync',
      'readdirSync',
      'globSync',
      'readdir',
      'existsSync',
      'fs/promises',
      'node:fs',
      'node:child_process',
      'import.meta.glob',
      'execSync',
      'execFileSync',
      'spawnSync',
      'dynamic-import',
      'gltf-transform',
      'sharp',
      'generated-i18n',
    ]);
  });

  it('floors a suite that imports or path-references the generated i18n artifacts', () => {
    // Import specifier form (relative, extensionless) and fs-path string form
    // both fire. This is the BELT over the related-leg pass-through (the
    // artifacts are INSIDE the module graph and feed `related` directly): a
    // direct artifact-naming consumer keeps running even on diffs that carry
    // no artifact at all.
    for (const text of [
      `import { en } from '../src/ui/i18n.resolved.generated/en';`,
      `const p = 'src/admin/i18n.resolved.generated/de_DE.ts';`,
      `import { TRANSLATION_KEYS } from '../src/ui/i18n.catalog/translation_keys.generated';`,
    ]) {
      const v = classifyTestSource(text);
      expect(v.reasons).toContain('generated-i18n');
      expect(['blind', 'partial']).toContain(v.klass);
    }
    // A suite that merely uses the ordinary i18n API stays graph-visible.
    expect(classifyTestSource(`import { t } from '../src/ui/i18n';`).klass).toBe('graph');
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
    // Nested helper dirs: the shared fakes change behavior for every suite
    // that composes them, exactly like tests/helpers/.
    ['tests/server/helpers/fake_db.ts'],
  ])('falls back to the FULL suite for %s', (changed) => {
    const plan = buildSelectPlan({ changedPaths: [changed], alwaysRunFiles: ALWAYS });
    expect(plan.mode).toBe('full');
    expect(plan.relatedSources).toEqual([]);
  });

  it('keeps nested fixtures and helper-dir TEST files selective (deliberate cost calls)', () => {
    // The golden corpus under tests/server/fixtures/ is regenerated by routine
    // endpoint PRs, and every consuming suite reads it through fs, which puts
    // the consumer on the always-run floor: forcing full here would make the
    // most common selective-eligible PR shape always-full for no coverage.
    const fixture = buildSelectPlan({
      changedPaths: ['tests/server/fixtures/main/characterization.json'],
      alwaysRunFiles: ALWAYS,
    });
    expect(fixture.mode).toBe('selective');
    // A test file that merely lives beside the fakes runs ITSELF; promoting it
    // to the whole suite is waste with no safety story.
    const helperTest = buildSelectPlan({
      changedPaths: ['tests/server/helpers/golden.test.ts'],
      alwaysRunFiles: ALWAYS,
    });
    expect(helperTest.mode).toBe('selective');
    expect(helperTest.alwaysRunFiles).toContain('tests/server/helpers/golden.test.ts');
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
    // Exact-string pin: this arm's audit line lost its verbatim assertion when
    // the artifact-only case moved to the fed-to-related arm.
    expect(plan.reason).toBe('no code or test changes: always-run set only');
  });

  // Declaration files are type-only and check:types runs in full regardless, so
  // they must not drag the whole suite in; every new scripts/lib module ships one.
  it.each(['scripts/lib/gate_discovery.d.mts', 'src/types/foo.d.ts'])(
    'treats %s as type-only rather than an unrecognized full-suite trigger',
    (declFile) => {
      const plan = buildSelectPlan({ changedPaths: [declFile], alwaysRunFiles: ALWAYS });
      expect(plan.mode).toBe('selective');
    },
  );

  it('classifies paths into the five planner buckets', () => {
    const c = classifySelectPaths([
      'src/sim/sim.ts',
      'tests/threat.test.ts',
      'package.json',
      'docs/x.md',
      'src/ui/i18n.resolved.generated/en.ts',
    ]);
    expect(c.relatedSources).toEqual(['src/sim/sim.ts']);
    expect(c.testFiles).toEqual(['tests/threat.test.ts']);
    expect(c.broadConfigs).toEqual(['package.json']);
    expect(c.nonCode).toEqual(['docs/x.md']);
    expect(c.generatedI18n).toEqual(['src/ui/i18n.resolved.generated/en.ts']);
  });

  // Generated i18n artifacts: never widen while present (pr-checks and the
  // full local gate rerun i18n:gen and diff exactly these paths, so a
  // hand-edited or stale artifact is a red check regardless of selection),
  // unprovable when absent (regeneration recreates a deleted file UNTRACKED,
  // invisible to that diff). Coverage rides the graph FROM the artifacts:
  // they join the related leg, because their consumers hang off the artifact
  // side of the import graph (the catalog/overlay driving sources reach the
  // runtime only through type-erased edges and select almost nothing).
  it.each([
    ['src/ui/i18n.resolved.generated/de_DE.ts'],
    ['src/ui/i18n.resolved.generated/pending.ts'],
    ['src/admin/i18n.resolved.generated/loaders.ts'],
    ['src/ui/i18n.catalog/translation_keys.generated.ts'],
  ])('keeps a present artifact (%s) selective and feeds it to related', (artifact) => {
    const plan = buildSelectPlan({
      changedPaths: ['src/ui/i18n.catalog/tooltips.ts', artifact],
      alwaysRunFiles: ALWAYS,
      exists: () => true,
    });
    expect(plan.mode).toBe('selective');
    expect(plan.relatedSources).toEqual(['src/ui/i18n.catalog/tooltips.ts', artifact]);
    expect(plan.reason).toContain(
      '1 generated i18n artifact(s) fed to related (freshness-guarded)',
    );
  });

  it('feeds an artifact-only diff to related with the audit note in the reason', () => {
    // The counts stay honest (the artifact is not a "changed source file")
    // while the related leg still walks the graph from the artifact, which is
    // exactly what selects the consumers a full run would have caught.
    const plan = buildSelectPlan({
      changedPaths: ['src/ui/i18n.resolved.generated/en.ts'],
      alwaysRunFiles: ALWAYS,
      exists: () => true,
    });
    expect(plan.mode).toBe('selective');
    expect(plan.relatedSources).toEqual(['src/ui/i18n.resolved.generated/en.ts']);
    expect(plan.reason).toBe(
      '0 changed source file(s), 0 changed test file(s); 1 generated i18n artifact(s) fed to related (freshness-guarded)',
    );
  });

  it('truncates the missing-artifact reason list past three entries', () => {
    const missing = [
      'src/ui/i18n.resolved.generated/aa.ts',
      'src/ui/i18n.resolved.generated/bb.ts',
      'src/ui/i18n.resolved.generated/cc.ts',
      'src/ui/i18n.resolved.generated/dd.ts',
    ];
    const plan = buildSelectPlan({
      changedPaths: missing,
      alwaysRunFiles: ALWAYS,
      exists: () => false,
    });
    expect(plan.mode).toBe('full');
    expect(plan.reason).toContain('src/ui/i18n.resolved.generated/cc.ts');
    expect(plan.reason).toContain(', ...');
    expect(plan.reason).not.toContain('dd.ts');
  });

  it('keeps a SUBDIRECTORY path under an artifact dir an unclassified widen', () => {
    // The generator's orphan sweep does not recurse, so a nested file is not
    // freshness-provable and must not inherit the artifact standing.
    const plan = buildSelectPlan({
      changedPaths: ['src/ui/i18n.resolved.generated/sub/en.ts'],
      alwaysRunFiles: ALWAYS,
      exists: () => true,
    });
    expect(plan.mode).toBe('full');
    expect(plan.reason).toContain('broad/unclassified change');
  });

  it('wires the live existence probe at both planner entrypoints', () => {
    // The probe is the fail-closed default's escape hatch: without `exists:`
    // in the call, every artifact-carrying local gate widens to full and the
    // rule's local benefit silently dies. Source-text pin, same convention as
    // the gate step-list pins.
    for (const entry of ['scripts/gate_select.mjs', 'scripts/gate_shadow.mjs']) {
      const text = readFileSync(path.join(REPO_ROOT, entry), 'utf8');
      const call = text.slice(text.indexOf('buildSelectPlan({'));
      expect(call.slice(0, call.indexOf('})')), entry).toContain('exists:');
    }
  });

  it('falls back to the FULL suite when a changed artifact is missing from the tree', () => {
    const plan = buildSelectPlan({
      changedPaths: ['src/ui/i18n.resolved.generated/da_DK.ts'],
      alwaysRunFiles: ALWAYS,
      exists: (p) => p !== 'src/ui/i18n.resolved.generated/da_DK.ts',
    });
    expect(plan.mode).toBe('full');
    expect(plan.reason).toContain('generated i18n artifact(s) removed');
  });

  it('falls back to the FULL suite when the caller cannot verify artifact existence', () => {
    const plan = buildSelectPlan({
      changedPaths: ['src/ui/i18n.resolved.generated/da_DK.ts'],
      alwaysRunFiles: ALWAYS,
    });
    expect(plan.mode).toBe('full');
    expect(plan.reason).toContain('existence cannot be verified');
  });

  it('keeps every other generated tree a full-suite widen', () => {
    for (const p of [
      'src/game/sfx_manifest.generated.ts',
      'src/guide/content.generated.ts',
      'src/ui/map_bg_manifest.generated.ts',
    ]) {
      const plan = buildSelectPlan({
        changedPaths: [p],
        alwaysRunFiles: ALWAYS,
        exists: () => true,
      });
      expect(plan.mode).toBe('full');
      expect(plan.reason).toContain('broad/unclassified change');
    }
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

// A bare `spawn(` must NOT count: this sim has mob spawners, so matching it
// would sweep a large false-positive class into the always-run set.
describe('out-of-graph detection precision', () => {
  it('does not treat a sim mob spawn as reaching outside the graph', () => {
    const v = classifyTestSource(`import { Sim } from '../src/sim/sim';
const mob = spawn('forest_wolf', pos);`);
    expect(v.klass).toBe('graph');
  });

  it('flags a test whose fs access lives one hop away in a shared helper', () => {
    const pattern = buildHelperImportPattern(['tests/helpers/i18n_determinism']);
    const source = `import { Sim } from '../src/sim/sim';
import { resolvedTables } from './helpers/i18n_determinism';`;
    expect(classifyTestSource(source).klass).toBe('graph');
    const withHelper = classifyTestSource(source, { helperImportPattern: pattern });
    expect(withHelper.klass).toBe('partial');
    expect(withHelper.reasons).toContain('fs-helper-import');
  });

  it('flags the barrel import tests/CLAUDE.md recommends, not just the basename form', () => {
    // tests/server/helpers/index.ts re-exports golden.ts, so `from './helpers'`
    // reaches readFileSync one hop away without ever naming the helper.
    const pattern = buildHelperImportPattern(['tests/server/helpers/golden']);
    const viaBarrel = classifyTestSource(
      `import { Sim } from '../src/sim/sim';
import { goldenMaster } from './helpers';`,
      { helperImportPattern: pattern },
    );
    expect(viaBarrel.klass).toBe('partial');
    expect(viaBarrel.reasons).toContain('fs-helper-import');
  });

  it('matches an extension-suffixed import, the only legal form for a .mjs helper', () => {
    const pattern = buildHelperImportPattern(['tests/helpers/reader']);
    for (const spec of ['./helpers/reader.mjs', './helpers/reader.js', './helpers/reader']) {
      expect(pattern?.test(`import { read } from '${spec}';`), spec).toBe(true);
    }
    expect(pattern?.test(`import { read } from './helpers/reader_other';`)).toBe(false);
  });

  it('returns null for an empty helper list rather than a regex matching everything', () => {
    expect(buildHelperImportPattern([])).toBeNull();
  });
});

// Discovery must match what vitest actually collects. The first cut matched only
// `.test.ts` and skipped every `helpers` directory, hiding 20 collected files
// (8 of them blind) from the always-run set entirely.
describe('test discovery matches vitest collection', () => {
  it.each([
    ['tests/foo.test.ts', true],
    ['tests/foo.test.mjs', true],
    ['tests/foo.spec.ts', true],
    ['tests/foo.test.tsx', true],
    ['tests/helpers/ts_files_under.test.ts', true],
    ['tests/server/helpers/golden.test.ts', true],
    ['tests/browser/a11y.browser.test.ts', false],
    ['tests/foo.browser.test.ts', false],
    ['tests/helper.ts', false],
    ['node_modules/pkg/x.test.ts', false],
    ['tmp/leftover.test.ts', false],
  ])('%s -> collected=%s', (p, expected) => {
    expect(isCollectedTestFile(p)).toBe(expected);
  });

  it('walks nested directories and returns sorted repo-relative POSIX paths', () => {
    const tree: Record<string, Array<{ name: string; dir: boolean }>> = {
      '/r/tests': [
        { name: 'b.test.ts', dir: false },
        { name: 'helpers', dir: true },
        { name: 'node_modules', dir: true },
      ],
      '/r/tests/helpers': [{ name: 'a.test.mjs', dir: false }],
      '/r/tests/node_modules': [{ name: 'nope.test.ts', dir: false }],
    };
    const files = listTestFiles({
      root: '/r',
      dir: '/r/tests',
      readdirSync: (p: string) =>
        (tree[p] ?? []).map((e) => ({ name: e.name, isDirectory: () => e.dir })),
      join: (...parts: string[]) => parts.join('/'),
      relative: (from: string, to: string) => to.slice(from.length + 1),
      sep: '/',
    });
    expect(files).toEqual(['tests/b.test.ts', 'tests/helpers/a.test.mjs']);
  });
});

// A merge bar must diff the BRANCH. Diffing only the working tree meant a clean
// committed branch selected nothing and passed green.
describe('branch diff resolution', () => {
  const ok = { status: 0, stdout: '' };
  it('prefers an explicit GATE_SELECT_BASE that resolves', () => {
    const r = resolveSelectBase({ env: { GATE_SELECT_BASE: 'origin/release/v1' }, run: () => ok });
    expect(r.base).toBe('origin/release/v1');
  });

  it('refuses an explicit base that does not resolve', () => {
    const r = resolveSelectBase({
      env: { GATE_SELECT_BASE: 'typo' },
      run: () => ({ status: 1, stdout: '' }),
    });
    expect(r.base).toBeNull();
    expect(r.reason).toContain('typo');
  });

  it('uses the newest release branch as the integration base', () => {
    const r = resolveSelectBase({
      env: {},
      run: (_c, args) =>
        args[0] === 'for-each-ref'
          ? { status: 0, stdout: 'origin/release/v0.35.0\norigin/release/v0.34.0\n' }
          : { status: 0, stdout: '' },
    });
    expect(r.base).toBe('origin/release/v0.35.0');
  });

  // A feature branch tracks its OWN pushed copy, so @{upstream}...HEAD is empty
  // right after a push. Using it would silently re-introduce the empty-diff bug.
  it('never consults @{upstream}', () => {
    const seen: string[][] = [];
    resolveSelectBase({
      env: {},
      run: (_c, args) => {
        seen.push(args);
        return args[0] === 'for-each-ref'
          ? { status: 0, stdout: 'origin/release/v0.35.0\n' }
          : { status: 0, stdout: '' };
      },
    });
    expect(seen.flat().join(' ')).not.toContain('@{upstream}');
  });

  it('falls back to main when no release branch exists', () => {
    const r = resolveSelectBase({
      env: {},
      run: (_c, args) => {
        if (args[0] === 'for-each-ref') return { status: 0, stdout: '' };
        return args.includes('origin/main^{commit}')
          ? { status: 0, stdout: '' }
          : { status: 1, stdout: '' };
      },
    });
    expect(r.base).toBe('origin/main');
  });

  it('reports no base when nothing resolves, so the caller can refuse to narrow', () => {
    const r = resolveSelectBase({ env: {}, run: () => ({ status: 128, stdout: '' }) });
    expect(r.base).toBeNull();
  });

  // A swallowed git failure narrows the run silently, which is the one direction
  // this design must never fail in.
  it('throws rather than returning an empty changed set when git fails', () => {
    expect(() =>
      listChangedPaths({
        base: 'origin/main',
        run: () => ({ status: 128, stdout: '', stderr: 'bad revision' }),
      }),
    ).toThrow(/bad revision/);
  });

  it('unions branch, working-tree, and untracked changes', () => {
    const paths = listChangedPaths({
      base: 'origin/main',
      run: (_c, args) => {
        if (args.includes('origin/main...HEAD')) return { status: 0, stdout: 'src/a.ts\n' };
        if (args[0] === 'diff') return { status: 0, stdout: 'src/b.ts\n' };
        return { status: 0, stdout: 'src/c.ts\n' };
      },
    });
    expect(paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });
});

// cmd.exe caps a command line at 8191 chars and the gate spawns with shell:true
// on win32, so ~500 paths in one argv cannot launch there.
// A shadow run that only counts escapes prints PASS on any green branch no
// matter how bad selection is, and branches are usually green when gated. The
// coverage delta is the signal that exists on every run.
describe('shadow comparison distinguishes escapes from coverage delta', () => {
  it('reports the unselected surface even when nothing failed', () => {
    const r = compareSelection({
      selected: new Set(['tests/a.test.ts']),
      fullRan: new Set(['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts']),
      fullFailed: new Set(),
    });
    expect(r.escapes).toEqual([]);
    // The point: escapes is empty but selection skipped two files, and that is
    // the number a reviewer has to look at.
    expect(r.unselected).toEqual(['tests/b.test.ts', 'tests/c.test.ts']);
    expect(r.selectedCount).toBe(1);
    expect(r.fullCount).toBe(3);
  });

  it('flags a failure that selection would have skipped as an escape', () => {
    const r = compareSelection({
      selected: new Set(['tests/a.test.ts']),
      fullRan: new Set(['tests/a.test.ts', 'tests/b.test.ts']),
      fullFailed: new Set(['tests/b.test.ts']),
    });
    expect(r.escapes).toEqual(['tests/b.test.ts']);
  });

  it('does not count a failure selection DID run as an escape', () => {
    const r = compareSelection({
      selected: new Set(['tests/a.test.ts']),
      fullRan: new Set(['tests/a.test.ts']),
      fullFailed: new Set(['tests/a.test.ts']),
    });
    expect(r.escapes).toEqual([]);
    expect(r.unselected).toEqual([]);
  });
});

describe('deleted test files never reach the argv', () => {
  it('drops paths that no longer exist', () => {
    const kept = filterExisting({
      files: ['tests/alive.test.ts', 'tests/deleted.test.ts'],
      exists: (f) => f === 'tests/alive.test.ts',
    });
    expect(kept).toEqual(['tests/alive.test.ts']);
  });

  // The plan still ADDS a changed test file (it cannot know it was deleted);
  // filtering is what keeps the dead path out of the command line.
  it('is what saves a plan that added a deleted test file', () => {
    const plan = buildSelectPlan({
      changedPaths: ['tests/deleted.test.ts'],
      alwaysRunFiles: ['tests/architecture.test.ts'],
    });
    expect(plan.alwaysRunFiles).toContain('tests/deleted.test.ts');
    expect(
      filterExisting({ files: plan.alwaysRunFiles, exists: (f) => !f.includes('deleted') }),
    ).toEqual(['tests/architecture.test.ts']);
  });
});

describe('argv chunking for the always-run leg', () => {
  it('keeps every chunk under the limit and loses no file', () => {
    const files = Array.from({ length: 500 }, (_, i) => `tests/some_fairly_long_name_${i}.test.ts`);
    const chunks = chunkFileArgs({ files, limit: 6000 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(files);
    for (const c of chunks) {
      expect(c.join(' ').length).toBeLessThanOrEqual(6000);
    }
  });

  it('returns a single chunk when the list already fits', () => {
    expect(chunkFileArgs({ files: ['tests/a.test.ts'], limit: 6000 })).toEqual([
      ['tests/a.test.ts'],
    ]);
  });

  it('never drops a file longer than the limit', () => {
    const long = `tests/${'x'.repeat(50)}.test.ts`;
    expect(chunkFileArgs({ files: [long], limit: 10 }).flat()).toEqual([long]);
  });
});

// This is the guard that keeps the whole design honest as the suite grows: the
// always-run set is recomputed from source on every gate run, so it cannot go
// stale, but a regression that broke classification would silently shrink it.
describe('always-run set over the real suite', () => {
  const listTests = () =>
    listTestFiles({
      root: REPO_ROOT,
      dir: path.join(REPO_ROOT, 'tests'),
      readdirSync,
      join: path.join,
      relative: path.relative,
      sep: path.sep,
    });

  it('keeps the known out-of-graph guards in the always-run set', () => {
    const files = listTests();
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
    // Discovery-fix regressions: these are collected by vitest but were invisible
    // to the first walker (a `helpers/` directory and a `.mjs` extension).
    expect(alwaysRun).toContain('tests/helpers/scan_guard_self_audit.test.ts');
    expect(alwaysRun).toContain('tests/helpers/ts_files_under.test.ts');
    // Pattern-fix regressions: asset existence and a spawned build script.
    expect(alwaysRun).toContain('tests/held_weapon_models.test.ts');
    expect(alwaysRun).toContain('tests/i18n_resolved_equivalence.test.ts');
    // Third-party-reader regressions (Phase 2 adversarial audit): these assert
    // on shipped-asset CONTENT via NodeIO/sharp, make no fs call of their own,
    // and were graph-classified escapes on asset-only diffs.
    expect(alwaysRun).toContain('tests/boar_asset.test.ts');
    expect(alwaysRun).toContain('tests/arena_render.test.ts');
    expect(alwaysRun).toContain('tests/continent_map_view.test.ts');
    // Generated-i18n belt pattern: these witnesses are floored SOLELY by the
    // generated-i18n visibility entry (verified against the real reason sets:
    // every other pattern misses them), so deleting that entry turns exactly
    // these assertions red. The artifact consumers reachable only through the
    // src/ui/i18n.ts re-export seam are covered by the related-leg
    // pass-through instead, not by this floor.
    expect(alwaysRun).toContain('tests/i18n_lazy_loader.test.ts');
    expect(alwaysRun).toContain('tests/i18n_dialect_resolution.test.ts');
    expect(alwaysRun).toContain('tests/i18n_build_gapfill.test.ts');
    expect(alwaysRun).toContain('tests/collective_reversal.test.ts');
    // Sanity floor: classification collapsing to "everything is graph-visible"
    // is the exact regression that would make selection unsafe.
    expect(alwaysRun.length).toBeGreaterThan(300);
  });
});

// The classification pipeline as ONE unit, driven end to end over a real
// (fixture) tree: the fs-helper scan, the barrel/basename import pattern, the
// walker, and the fold have individual pins above, but the extraction that
// composes them (collectSuiteVisibility, now shared by gate_select, the shadow
// validator, and the CI shard runner) needs its own producer-driven proof: with
// the helper hop disabled, the fs-delegating test silently degrades to graph
// and only the composed run can see it.
describe('collectSuiteVisibility over a fixture tree', () => {
  it('floors a test whose only fs reach is one helper hop away, and not its pure sibling', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wocc-suite-vis-'));
    try {
      mkdirSync(path.join(root, 'tests', 'helpers'), { recursive: true });
      writeFileSync(
        path.join(root, 'tests', 'helpers', 'fixture_reader.ts'),
        `import { readFileSync } from 'node:fs';\nexport const read = (p: string) => readFileSync(p, 'utf8');\n`,
      );
      writeFileSync(
        path.join(root, 'tests', 'delegating.test.ts'),
        `import { read } from './helpers/fixture_reader';\nit('x', () => read('public/a.json'));\n`,
      );
      writeFileSync(
        path.join(root, 'tests', 'pure.test.ts'),
        `import { thing } from '../src/thing';\nit('y', () => thing());\n`,
      );
      const r = collectSuiteVisibility({
        root,
        readdirSync,
        readFileSync,
        join: path.join,
        relative: path.relative,
        sep: path.sep,
      });
      expect(r.testFiles).toEqual(['tests/delegating.test.ts', 'tests/pure.test.ts']);
      expect(r.alwaysRun).toEqual(['tests/delegating.test.ts']);
      expect(r.reasons['tests/delegating.test.ts']).toContain('fs-helper-import');
      expect(r.counts).toEqual({ blind: 1, partial: 0, graph: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Discovery walks tests/ only, while vitest's default include is repo-wide.
// Zero collected test files exist outside tests/ today, so the two agree; the
// day someone adds src/foo.test.ts (or a second `browser` directory, which the
// walker's SKIP_DIRS drops anywhere but vitest excludes only tests/browser/),
// the floor would silently stop covering it. These guards turn that divergence
// into a loud failure instead.
describe('discovery scope matches vitest collection over the real tree', () => {
  // Deliberately NOT reusing SKIP_DIRS wholesale: its bare `browser` entry is
  // the walker's own approximation (vitest excludes only tests/browser/), and
  // this guard exists to catch what that approximation would miss.
  const SCOPE_SKIP = new Set([
    'node_modules',
    'dist',
    '.git',
    '.claude',
    '.codex',
    '.agents',
    '.worktrees',
    '.venv',
    'tmp',
  ]);

  it('finds no collected test file outside tests/', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SCOPE_SKIP.has(entry.name)) continue;
          if (rel === 'tests') continue;
          walk(full);
          continue;
        }
        if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) && !rel.includes('.browser.test.')) {
          offenders.push(rel);
        }
      }
    };
    walk(REPO_ROOT);
    // If this ever fails, either move the test under tests/ or extend the
    // discovery walk (and this guard) to the new location in the same change.
    expect(offenders).toEqual([]);
  });

  it('finds no directory named browser under tests/ except the opt-in tests/browser', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.name === 'browser' && rel !== 'tests/browser') offenders.push(rel);
        if (entry.name === 'browser') continue;
        walk(full);
      }
    };
    walk(path.join(REPO_ROOT, 'tests'));
    expect(offenders).toEqual([]);
  });
});
