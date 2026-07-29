import { describe, expect, it } from 'vitest';
import {
  CHANGED_LIST_BUDGET,
  decideTestMode,
  isRelayablePath,
  relayByteLength,
  SELECTION_PIPELINE_FILES,
} from '../scripts/lib/ci_test_select.mjs';

type Entry = { filename?: string; previous_filename?: string | null; status?: string };

const mod = (filename: string): Entry => ({ filename, status: 'modified' });

const PR = { eventName: 'pull_request', code: true as const };

describe('decideTestMode: when selection is allowed at all', () => {
  it('selects for an ordinary source-change PR and relays the paths', () => {
    const d = decideTestMode({
      ...PR,
      files: [mod('src/ui/unit_portrait.ts'), mod('tests/unit_portrait.test.ts'), mod('README.md')],
    });
    expect(d.mode).toBe('selective');
    expect(d.changedPaths).toEqual([
      'src/ui/unit_portrait.ts',
      'tests/unit_portrait.test.ts',
      'README.md',
    ]);
    expect(d.reason).toBe(
      'selective: 1 changed source file(s), 1 changed test file(s), 1 inert path(s)',
    );
  });

  it('never selects off a non-PR event', () => {
    // merge_group included: the merge queue is the last pre-merge bar, so a
    // queue run must never narrow the suite.
    for (const eventName of ['push', 'workflow_dispatch', 'schedule', 'merge_group', '']) {
      const d = decideTestMode({ eventName, code: true, files: [mod('src/ui/hud.ts')] });
      expect(d.mode).toBe('full');
      expect(d.changedPaths).toEqual([]);
    }
  });

  it('never selects without a provable file listing', () => {
    expect(decideTestMode({ ...PR, files: undefined }).mode).toBe('full');
    expect(decideTestMode({ ...PR, files: [] }).mode).toBe('full');
    expect(
      decideTestMode({ ...PR, code: undefined as unknown as boolean, files: [mod('a.ts')] }).mode,
    ).toBe('full');
  });
});

// The packet's fall-back acceptance list (docs/qa-gate.md, "Selective PR-tier CI"):
// lockfile, package.json, workflow files, vite/vitest/tsconfig, generated-file
// regeneration, and the selection pipeline itself all run the full suite. One
// carve-out: the freshness-guarded i18n artifacts classify inert (their own
// describe below); every OTHER generated tree still widens.
describe('decideTestMode: fail-closed triggers', () => {
  it.each([
    ['pnpm-lock.yaml'],
    ['package.json'],
    ['vite.config.ts'],
    ['vitest.browser.config.ts'],
    ['tsconfig.json'],
    ['turbo.json'],
    ['biome.json'],
    ['.npmrc'],
    ['tests/helpers/bare_client.ts'],
    ['tests/server/helpers/fake_db.ts'],
    ['tests/global_setup.ts'],
    ['.browserslistrc'],
    ['some/unrecognized/thing.bin'],
  ])('%s runs the full suite via the shared planner buckets', (p) => {
    const d = decideTestMode({ ...PR, files: [mod('src/ui/hud.ts'), mod(p)] });
    expect(d.mode).toBe('full');
    expect(d.changedPaths).toEqual([]);
  });

  it('treats any .github/ path as a workflow-side change', () => {
    for (const p of ['.github/workflows/ci.yml', '.github/workflows/nightly.yml', '.github/foo']) {
      const d = decideTestMode({ ...PR, files: [mod(p)] });
      expect(d.mode).toBe('full');
      expect(d.reason).toContain('workflow-side change');
    }
  });

  it('treats every selection pipeline file (and its .d.mts twin) as unprovable', () => {
    for (const p of SELECTION_PIPELINE_FILES) {
      expect(decideTestMode({ ...PR, files: [mod(p)] }).reason).toContain(
        'selection pipeline change',
      );
    }
    const d = decideTestMode({ ...PR, files: [mod('scripts/lib/ci_shard_plan.d.mts')] });
    expect(d.mode).toBe('full');
    expect(d.reason).toContain('selection pipeline change');
  });

  it('treats a rename AWAY from the pipeline or .github as unprovable too', () => {
    // The new name is outside every trigger; only previous_filename carries
    // the signal that the workflow-side file set changed.
    const d = decideTestMode({
      ...PR,
      files: [
        {
          filename: 'docs/ci-notes.md',
          previous_filename: '.github/workflows/ci.yml',
          status: 'renamed',
        },
      ],
    });
    expect(d.mode).toBe('full');
    expect(d.reason).toContain('selection pipeline rename');
  });

  it('refuses a renamed entry whose source path is missing', () => {
    // The removed-path rule depends on previous_filename; its absence is
    // unprovable, same doctrine as an unknown status.
    for (const prev of [undefined, null, '']) {
      const d = decideTestMode({
        ...PR,
        files: [{ filename: 'src/sim/rng2.ts', previous_filename: prev, status: 'renamed' }],
      });
      expect(d.mode).toBe('full');
      expect(d.reason).toContain('rename without a source path');
    }
  });

  it('refuses to narrow on a removed or renamed source/test path', () => {
    // `vitest related <deleted path>` matches nothing, so the importer of a
    // deleted module would be silently unselected; the .mjs suites are outside
    // tsc, so no other PR-tier layer is guaranteed to catch it.
    expect(
      decideTestMode({ ...PR, files: [{ filename: 'src/sim/rng.ts', status: 'removed' }] }).reason,
    ).toContain('removed or renamed code path');
    expect(
      decideTestMode({ ...PR, files: [{ filename: 'tests/threat.test.ts', status: 'removed' }] })
        .reason,
    ).toContain('removed or renamed code path');
    expect(
      decideTestMode({
        ...PR,
        files: [
          { filename: 'src/sim/rng2.ts', previous_filename: 'src/sim/rng.ts', status: 'renamed' },
        ],
      }).reason,
    ).toContain('removed or renamed code path');
    // A removed docs file deletes nothing any test imports.
    expect(
      decideTestMode({
        ...PR,
        files: [mod('src/ui/hud.ts'), { filename: 'docs/old-note.md', status: 'removed' }],
      }).mode,
    ).toBe('selective');
  });

  it('fails closed on entries it cannot read safely', () => {
    expect(decideTestMode({ ...PR, files: [{ status: 'modified' }] }).mode).toBe('full');
    expect(decideTestMode({ ...PR, files: [{ filename: '', status: 'modified' }] }).mode).toBe(
      'full',
    );
    expect(
      decideTestMode({ ...PR, files: [{ filename: '--config=evil', status: 'modified' }] }).mode,
    ).toBe('full');
    expect(
      decideTestMode({ ...PR, files: [{ filename: 'a\nb.ts', status: 'modified' }] }).mode,
    ).toBe('full');
    expect(decideTestMode({ ...PR, files: [{ filename: 'src/a.ts' }] }).reason).toContain(
      'unknown file status',
    );
    expect(
      decideTestMode({ ...PR, files: [{ filename: 'src/a.ts', status: 'mystery' }] }).reason,
    ).toContain('unknown file status');
  });

  it('falls back when the relayed list would exceed the env budget', () => {
    const files = Array.from({ length: 1200 }, (_, i) =>
      mod(`src/ui/very/long/module/path/component_number_${i}_with_a_long_name.ts`),
    );
    expect(JSON.stringify(files.map((f) => f.filename)).length).toBeGreaterThan(
      CHANGED_LIST_BUDGET,
    );
    const d = decideTestMode({ ...PR, files });
    expect(d.mode).toBe('full');
    expect(d.reason).toContain('relay budget');
    expect(d.changedPaths).toEqual([]);
  });

  it('measures the relay budget in bytes, not UTF-16 code units', () => {
    // MAX_ARG_STRLEN is a byte limit; a CJK-heavy listing can fit the
    // code-unit count while exceeding it in UTF-8. One three-byte character
    // per unit makes the difference decisive.
    const cjkSeg = '世界'.repeat(16);
    const files = Array.from({ length: 700 }, (_, i) => mod(`src/ui/${cjkSeg}_${i}.ts`));
    const json = JSON.stringify(files.map((f) => f.filename));
    expect(json.length).toBeLessThan(CHANGED_LIST_BUDGET);
    expect(relayByteLength(json)).toBeGreaterThan(CHANGED_LIST_BUDGET);
    const d = decideTestMode({ ...PR, files });
    expect(d.mode).toBe('full');
    expect(d.reason).toContain('relay budget');
  });
});

// The 2026-08-05 incident replay (docs/qa-gate.md, "Selective PR-tier CI"): a
// content change that shifts world-gen draws must stay selectable, because
// selection hands the content file to `vitest related`, whose import graph
// reaches the seed-pinned suites through src/sim/content/data.ts; the guard
// tests ride the always-run floor regardless (tests/ci_shard_plan.test.ts).
describe('decideTestMode: incident replay stays covered', () => {
  it('keeps a content-only PR selective WITH the content file relayed as a source', () => {
    const d = decideTestMode({ ...PR, files: [mod('src/sim/content/amberfall.ts')] });
    expect(d.mode).toBe('selective');
    expect(d.changedPaths).toEqual(['src/sim/content/amberfall.ts']);
  });

  it('keeps a sim-core PR selective with the core file relayed (the graph then widens)', () => {
    const d = decideTestMode({ ...PR, files: [mod('src/sim/rng.ts')] });
    expect(d.mode).toBe('selective');
    expect(d.changedPaths).toEqual(['src/sim/rng.ts']);
  });
});

// Generated i18n artifacts (docs/qa-gate.md, "Selective PR-tier CI"): they
// never WIDEN the run because pr-checks reruns i18n:gen and diffs EXACTLY
// these paths on every code PR in every mode (tests/ci_workflow.test.ts pins
// the coupling), and they are never DROPPED from selection either: the shard
// plan feeds them to `vitest related` as graph nodes, because their consumer
// suites hang off the artifact side of the import graph (the catalog/overlay
// driving sources are type-erased build inputs). Deletions stay unprovable:
// the freshness diff cannot flag a deleted-then-regenerated file, so
// `removed`/`renamed` widens.
describe('decideTestMode: generated i18n artifacts', () => {
  it.each([
    ['src/ui/i18n.resolved.generated/de_DE.ts'],
    ['src/ui/i18n.resolved.generated/loaders.ts'],
    ['src/admin/i18n.resolved.generated/fr_FR.ts'],
    ['src/ui/i18n.catalog/translation_keys.generated.ts'],
  ])('%s is inert: a regeneration-carrying PR stays selective', (p) => {
    const d = decideTestMode({
      ...PR,
      files: [mod('src/ui/i18n.catalog/tooltips.ts'), mod(p)],
    });
    expect(d.mode).toBe('selective');
    expect(d.changedPaths).toEqual(['src/ui/i18n.catalog/tooltips.ts', p]);
    expect(d.reason).toBe(
      'selective: 1 changed source file(s), 0 changed test file(s), ' +
        '0 inert path(s), 1 generated i18n artifact(s) fed to related (freshness-guarded)',
    );
  });

  it('keeps an artifact-only diff selective with the audit note in the reason', () => {
    const d = decideTestMode({
      ...PR,
      files: [
        mod('src/ui/i18n.resolved.generated/en.ts'),
        mod('src/admin/i18n.resolved.generated/en.ts'),
      ],
    });
    expect(d.mode).toBe('selective');
    expect(d.reason).toContain('2 generated i18n artifact(s) fed to related (freshness-guarded)');
  });

  it('widens on a removed or renamed-away artifact (the freshness diff cannot see it)', () => {
    expect(
      decideTestMode({
        ...PR,
        files: [{ filename: 'src/ui/i18n.resolved.generated/da_DK.ts', status: 'removed' }],
      }).reason,
    ).toContain('removed or renamed generated i18n artifact');
    expect(
      decideTestMode({
        ...PR,
        files: [
          {
            filename: 'src/ui/i18n.resolved.generated/da_DK_old.ts',
            previous_filename: 'src/ui/i18n.resolved.generated/da_DK.ts',
            status: 'renamed',
          },
        ],
      }).reason,
    ).toContain('removed or renamed generated i18n artifact');
  });

  it('keeps every OTHER generated tree an unclassified widen', () => {
    for (const p of [
      'src/game/sfx_manifest.generated.ts',
      'src/guide/content.generated.ts',
      'src/ui/map_bg_manifest.generated.ts',
      'src/editor/asset_catalog.generated.ts',
      'src/sim/thornhollow_field.generated.ts',
    ]) {
      const d = decideTestMode({ ...PR, files: [mod('src/ui/hud.ts'), mod(p)] });
      expect(d.mode).toBe('full');
      expect(d.reason).toContain('broad or unclassified change');
    }
  });

  it('refuses lookalike paths outside the pinned artifact classes', () => {
    // Prefix matching is anchored at the repo root, requires the directory
    // separator, and stops at ONE level (the freshness sweep cannot see
    // deeper); the file arm is an exact-path match, never a basename match
    // (a same-named file elsewhere is not freshness-proven).
    for (const p of [
      'nested/src/ui/i18n.resolved.generated/en.ts',
      'src/ui/i18n.resolved.generated.bak.ts',
      'src/guide/i18n.resolved.generated/en.ts',
      'src/ui/i18n.resolved.generated/sub/en.ts',
      'src/admin/i18n.catalog/translation_keys.generated.ts',
      'nested/src/ui/i18n.catalog/translation_keys.generated.ts',
    ]) {
      const d = decideTestMode({ ...PR, files: [mod(p)] });
      expect(d.mode).toBe('full');
    }
  });
});

describe('isRelayablePath', () => {
  it.each([
    ['src/sim/sim.ts', true],
    ['docs/a.md', true],
    ['src/with space.ts', true],
    ['src/..dots/a.ts', true],
    ['-rf', false],
    ['--config=evil', false],
    ['a\nb', false],
    ['a\tb', false],
    ['', false],
    // Repo-relative only: the predicate is the named relay-safety bar and must
    // not depend on the producer being the API listing.
    ['/etc/passwd', false],
    ['../outside.ts', false],
    ['..', false],
    ['src/../../outside.ts', false],
    ['src/x/..', false],
  ])('%j -> %s', (p, expected) => {
    expect(isRelayablePath(p)).toBe(expected);
  });
});
