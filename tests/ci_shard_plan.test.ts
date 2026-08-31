import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildFloor,
  buildLanePlan,
  buildShardPlan,
  CI_GUARD_PREFIXES,
  CI_GUARD_SUITES,
  CI_LONG_SUITE_HALVES,
  CI_LONG_SUITES,
  collectedLaneFiles,
  FLOOR_SANITY_MIN,
  parseShardArg,
  resolveWorkerCount,
} from '../scripts/lib/ci_shard_plan.mjs';
import { collectSuiteVisibility } from '../scripts/lib/gate_discovery.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');

// A realistic fixture: enough always-run files to clear the sanity floor, plus
// every guard suite and a parity pin so the guard union resolves.
const GUARDS = [...CI_GUARD_SUITES, 'tests/parity/golden_warrior.test.ts'];
const FILLER = Array.from({ length: FLOOR_SANITY_MIN + 20 }, (_, i) => `tests/blind_${i}.test.ts`);
const ALWAYS = [...FILLER, 'tests/architecture.test.ts', 'tests/localization_fixes.test.ts'];
const COLLECTED = [
  ...new Set([...FILLER, ...GUARDS, 'tests/pure_a.test.ts', 'tests/pure_b.test.ts']),
];

const BASE = {
  mode: 'selective',
  changedPaths: ['src/ui/unit_portrait.ts'],
  alwaysRun: ALWAYS,
  testFiles: COLLECTED,
  shard: { index: 3, total: 8 },
  workers: 2,
  exists: () => true,
};

describe('parseShardArg', () => {
  it.each([
    [['--shard=1/8'], { index: 1, total: 8 }],
    [['--shard=8/8'], { index: 8, total: 8 }],
    [['--plan-only', '--shard=2/4'], { index: 2, total: 4 }],
    [['--shard=9/8'], null],
    [['--shard=0/8'], null],
    [['--shard=1'], null],
    [['--shard=a/b'], null],
    [[], null],
  ])('%j -> %j', (argv, expected) => {
    expect(parseShardArg(argv as string[])).toEqual(expected);
  });
});

describe('resolveWorkerCount', () => {
  // The half-cores default is the MEASURED ruling (run 31107474546; the
  // entry's comment); WOC_TEST_WORKERS is its sanctioned trial knob. Every
  // rejected shape falls back to the ruling value with source 'invalid' so
  // the entry reports it, and a bad value can never mean fewer tests, only
  // the calibrated worker bound.
  it.each([
    [4, undefined, { workers: 2, source: 'default' }],
    [4, '', { workers: 2, source: 'default' }],
    [4, '3', { workers: 3, source: 'env' }],
    [4, '1', { workers: 1, source: 'env' }],
    [4, '4', { workers: 4, source: 'env' }],
    [4, '5', { workers: 2, source: 'invalid' }],
    [4, '0', { workers: 2, source: 'invalid' }],
    [4, '-2', { workers: 2, source: 'invalid' }],
    [4, '2.5', { workers: 2, source: 'invalid' }],
    [4, '03', { workers: 2, source: 'invalid' }],
    [4, ' 3', { workers: 2, source: 'invalid' }],
    [4, 'banana', { workers: 2, source: 'invalid' }],
    [1, undefined, { workers: 1, source: 'default' }],
    [1, '1', { workers: 1, source: 'env' }],
    [1, '2', { workers: 1, source: 'invalid' }],
  ])('cores=%j env=%j -> %j', (cores, envValue, expected) => {
    expect(resolveWorkerCount({ cores, envValue: envValue as string | undefined })).toEqual(
      expected,
    );
  });
});

describe('the floor union', () => {
  it('carries the computed set, every guard suite, the parity pins, and changed tests', () => {
    const { floor, missingGuards } = buildFloor({
      alwaysRun: ALWAYS,
      testFiles: COLLECTED,
      changedTestFiles: ['tests/pure_a.test.ts'],
    });
    expect(missingGuards).toEqual([]);
    for (const g of GUARDS) expect(floor).toContain(g);
    for (const f of ALWAYS) expect(floor).toContain(f);
    expect(floor).toContain('tests/pure_a.test.ts');
    expect(floor).not.toContain('tests/pure_b.test.ts');
  });

  it('reports a guard suite or parity prefix the collected tree no longer has', () => {
    const { missingGuards } = buildFloor({
      alwaysRun: ALWAYS,
      testFiles: COLLECTED.filter(
        (f) => f !== 'tests/world_api_parity.test.ts' && !f.startsWith('tests/parity/'),
      ),
      changedTestFiles: [],
    });
    expect(missingGuards).toContain('tests/world_api_parity.test.ts');
    expect(missingGuards).toContain('tests/parity/');
  });

  // The guard list is the spec's invariant floor: architecture, localization
  // guards, and the parity pins. Deleting an entry here must be a conscious
  // decision, not a refactor side effect.
  it('pins the invariant guard suites and prefixes', () => {
    expect([...CI_GUARD_SUITES]).toEqual([
      'tests/architecture.test.ts',
      'tests/ci_pg_presence.test.ts',
      'tests/localization_fixes.test.ts',
      'tests/localization_coverage.test.ts',
      'tests/suite_duration_budget.test.ts',
      'tests/world_api_parity.test.ts',
    ]);
    expect([...CI_GUARD_PREFIXES]).toEqual(['tests/parity/']);
    // Literal, not self-relative: every other use of this constant in the file
    // is derived from it, so without this line lowering it to 2 (making the
    // classification-collapse fallback vacuous) would stay green.
    expect(FLOOR_SANITY_MIN).toBe(300);
  });

  it('resolves every guard against the REAL collected suite', () => {
    const { testFiles, alwaysRun } = collectSuiteVisibility({
      root: REPO_ROOT,
      readdirSync,
      readFileSync,
      join: path.join,
      relative: path.relative,
      sep: path.sep,
    });
    const { floor, missingGuards } = buildFloor({
      alwaysRun,
      testFiles,
      changedTestFiles: [],
    });
    expect(missingGuards).toEqual([]);
    // The parity pins are graph-visible today, so the union (not the
    // classifier) is what puts them on every selective shard.
    expect(floor).toContain('tests/world_api_parity.test.ts');
    expect(floor.filter((f) => f.startsWith('tests/parity/')).length).toBeGreaterThanOrEqual(10);
    expect(floor.length).toBeGreaterThan(FLOOR_SANITY_MIN);
  }, 60_000);
});

describe('buildShardPlan: full mode replays the old step minus the lane', () => {
  // The base fixture collects NO lane file, so these legs carry no --exclude
  // and match the pre-lane step exactly; the lane-aware shapes are pinned in
  // the long-sims lane describe below.
  it.each([
    ['full', 'mode=full from the changes job'],
    ['', 'unrecognized mode'],
    ['SELECTIVE', 'unrecognized mode'],
    ['garbage', 'unrecognized mode'],
  ])('mode=%j runs the one full leg', (mode, reasonPart) => {
    const plan = buildShardPlan({ ...BASE, mode });
    expect(plan.mode).toBe('full');
    expect(plan.reason).toContain(reasonPart);
    expect(plan.legs).toEqual([
      {
        name: 'npm test (full suite, shard 3/8)',
        cmd: 'npm',
        args: ['test', '--', '--shard=3/8', '--maxWorkers=2'],
      },
    ]);
  });
});

describe('buildShardPlan: selective mode', () => {
  it('builds ONE merged vitest related leg carrying the sources and the floor as seeds', () => {
    const plan = buildShardPlan({ ...BASE });
    expect(plan.mode).toBe('selective');
    expect(plan.legs).toHaveLength(1);
    const [merged] = plan.legs;
    expect(merged.cmd).toBe('npx');
    // Argv order: the vitest related invocation, the changed sources, then
    // every floor file as a SELF-SELECTING seed (vitest seeds its affected
    // set with the given paths themselves; the subprocess describe below
    // pins that property by execution), then the flags. The floor files ride
    // this leg because `npx vitest` has no npm lifecycle: pretest moved to
    // the entry (scripts/ci_shard_test.mjs), once per job.
    expect(merged.args.slice(0, 3)).toEqual(['--no-install', 'vitest', 'related']);
    expect(merged.args[3]).toBe('src/ui/unit_portrait.ts');
    expect(merged.args).toContain('tests/architecture.test.ts');
    expect(merged.args).toContain('tests/world_api_parity.test.ts');
    expect(merged.args).toContain('tests/parity/golden_warrior.test.ts');
    expect(merged.args.slice(-4)).toEqual([
      '--run',
      '--passWithNoTests=false',
      '--shard=3/8',
      '--maxWorkers=2',
    ]);
    // EXPLICIT =false, never the bare flag and never omitted: the related
    // subcommand defaults passWithNoTests to TRUE internally, so only an
    // explicit false makes an empty collection exit 1. That is the loud
    // direction a floor-seeding collapse must take in real CI (measured both
    // ways in the gate-integrity round).
    expect(merged.args).not.toContain('--passWithNoTests');
    // Every floor member is a positional: sources (1) + floor + the 3 fixed
    // leading/4 trailing tokens accounts for the whole argv. (The genuine
    // completeness proof is the partition test below, which recomputes
    // buildFloor independently; this count only pins the argv shape.)
    const positionals = merged.args.slice(3, -4);
    expect(positionals.length).toBe(1 + (plan.floorCount ?? 0));
  });

  it('keeps the merged leg when the diff has no live sources (floor seeds only)', () => {
    const docsOnly = buildShardPlan({ ...BASE, changedPaths: ['docs/a.md', 'README.md'] });
    expect(docsOnly.mode).toBe('selective');
    expect(docsOnly.legs).toHaveLength(1);
    expect(docsOnly.legs[0].args.filter((a) => a.startsWith('src/'))).toEqual([]);
    expect(docsOnly.legs[0].args).toContain('tests/architecture.test.ts');
    const deleted = buildShardPlan({ ...BASE, exists: (p) => !p.startsWith('src/') });
    expect(deleted.legs).toHaveLength(1);
    expect(deleted.legs[0].args.filter((a) => a.startsWith('src/'))).toEqual([]);
  });

  it('adds a changed test file to the merged seeds and drops a deleted one from the argv', () => {
    const plan = buildShardPlan({
      ...BASE,
      changedPaths: ['tests/pure_b.test.ts', 'tests/deleted.test.ts'],
      exists: (p) => p !== 'tests/deleted.test.ts',
    });
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].args).toContain('tests/pure_b.test.ts');
    expect(plan.legs[0].args).not.toContain('tests/deleted.test.ts');
  });

  it('reports what it runs and what it skips, for the job log', () => {
    const plan = buildShardPlan({ ...BASE });
    // Derived from the fixture, not the implementation's own formula: FILLER
    // (FLOOR_SANITY_MIN + 20) + architecture + localization_fixes always-run,
    // plus ci_pg_presence, localization_coverage, suite_duration_budget,
    // world_api_parity, and the parity file via the guard union =
    // FLOOR_SANITY_MIN + 27; COLLECTED holds two more pure tests, exactly
    // the outside-floor remainder.
    expect(plan.floorCount).toBe(FLOOR_SANITY_MIN + 27);
    expect(plan.relatedCount).toBe(1);
    expect(plan.outsideFloorCount).toBe(2);
  });
});

describe('buildShardPlan: fail-closed fallbacks', () => {
  it.each([
    ['missing changed list', { changedPaths: undefined as unknown as string[] }],
    ['unsafe relayed path', { changedPaths: ['--config=evil'] }],
    [
      'unsafe path that is not the first element',
      { changedPaths: ['src/ui/hud.ts', '--config=evil'] },
    ],
    ['control character in path', { changedPaths: ['a\nb.ts'] }],
    ['classification collapse', { alwaysRun: ['tests/architecture.test.ts'] }],
    ['broad path re-classified shard-side', { changedPaths: ['package.json'] }],
    [
      'guard suite missing from the tree',
      { testFiles: COLLECTED.filter((f) => f !== 'tests/world_api_parity.test.ts') },
    ],
    [
      // The one artifact shape the freshness diff cannot flag: deleted in the
      // PR, recreated untracked by the shard's own regeneration.
      'generated i18n artifact missing from the tree',
      {
        changedPaths: ['src/ui/i18n.resolved.generated/da_DK.ts'],
        exists: (p: string) => p !== 'src/ui/i18n.resolved.generated/da_DK.ts',
      },
      'generated i18n artifact(s) missing from the tree',
    ],
    [
      // Same doctrine, second freshness-guarded family. The reason substring
      // proves THIS family's guard fired: with the family emptied the path
      // would fall back through broadConfigs instead and this row would pass
      // for the wrong reason (audit finding).
      'generated manifest artifact missing from the tree',
      {
        changedPaths: ['src/game/sfx_manifest.generated.ts'],
        exists: (p: string) => p !== 'src/game/sfx_manifest.generated.ts',
      },
      'generated manifest artifact(s) missing from the tree',
    ],
  ])('%s falls back to the full leg', (_label, overrides, reasonContains?: string) => {
    const plan = buildShardPlan({ ...BASE, ...overrides });
    expect(plan.mode).toBe('full');
    if (reasonContains) expect(plan.reason).toContain(reasonContains);
    expect(plan.legs).toEqual([
      {
        name: 'npm test (full suite, shard 3/8)',
        cmd: 'npm',
        args: ['test', '--', '--shard=3/8', '--maxWorkers=2'],
      },
    ]);
  });

  it('keeps a PRESENT generated i18n artifact selective and IN the related leg', () => {
    // The artifact is a graph node: its consumers (including suites that pin
    // resolved-table content through the src/ui/i18n.ts re-export seam) are
    // reachable only from the artifact side, so dropping it from the argv is
    // the silent-unselect failure mode this pin exists to catch.
    const plan = buildShardPlan({
      ...BASE,
      changedPaths: ['src/ui/unit_portrait.ts', 'src/ui/i18n.resolved.generated/da_DK.ts'],
    });
    expect(plan.mode).toBe('selective');
    const related = plan.legs.find((l) => l.args.includes('related'));
    expect(related).toBeDefined();
    expect(related?.args).toContain('src/ui/unit_portrait.ts');
    expect(related?.args).toContain('src/ui/i18n.resolved.generated/da_DK.ts');
    expect(plan.relatedCount).toBe(2);
  });

  it('keeps a PRESENT generated manifest artifact selective and IN the related leg', () => {
    // Second freshness-guarded family, same graph-node rationale: manifest
    // consumer suites hang off the artifact side of the import graph.
    const plan = buildShardPlan({
      ...BASE,
      changedPaths: ['src/render/assets/manifest.generated.ts'],
    });
    expect(plan.mode).toBe('selective');
    const related = plan.legs.find((l) => l.args.includes('related'));
    expect(related).toBeDefined();
    expect(related?.args).toContain('src/render/assets/manifest.generated.ts');
    expect(plan.relatedCount).toBe(1);
  });

  it('truncates the missing-artifact fallback reason past three entries', () => {
    const missing = [
      'src/ui/i18n.resolved.generated/aa.ts',
      'src/ui/i18n.resolved.generated/bb.ts',
      'src/ui/i18n.resolved.generated/cc.ts',
      'src/ui/i18n.resolved.generated/dd.ts',
    ];
    const plan = buildShardPlan({ ...BASE, changedPaths: missing, exists: () => false });
    expect(plan.mode).toBe('full');
    expect(plan.reason).toContain('generated i18n artifact(s) missing');
    expect(plan.reason).toContain('src/ui/i18n.resolved.generated/cc.ts, ...');
    expect(plan.reason).not.toContain('dd.ts');
  });
});

describe('the long-sims lane (Phase 4)', () => {
  // A fixture that COLLECTS two lane files, one of them floor-classified
  // (mirroring the real tree, where tests/nythraxis_matrix.test.ts is
  // floor-classified and the owned-class balance files are graph-visible).
  const LANE_BLIND = 'tests/nythraxis_matrix.test.ts';
  const LANE_GRAPH = 'tests/owned_class_balance_role_bands.test.ts';
  const LANE_BASE = {
    ...BASE,
    alwaysRun: [...ALWAYS, LANE_BLIND],
    testFiles: [...COLLECTED, LANE_BLIND, LANE_GRAPH],
    half: 'a' as const,
  };

  it('pins the lane membership list and the a/b halves as literals', () => {
    // Literal list: a rename or removal must be a conscious decision here AND
    // in the measured record (docs/qa-gate.md, "The long-sims lane"), never a
    // refactor side effect.
    expect([...CI_LONG_SUITES]).toEqual([
      'tests/chronomancy_balance_targets.test.ts',
      'tests/druid_balance_probe.test.ts',
      'tests/eastbrook_gameplay_integration.test.ts',
      'tests/hunter_dps_balance.test.ts',
      'tests/nythraxis_matrix.test.ts',
      'tests/owned_class_balance_dps_metrics.test.ts',
      'tests/owned_class_balance_dps_probes.test.ts',
      'tests/owned_class_balance_druid_bands.test.ts',
      'tests/owned_class_balance_groveheart.test.ts',
      'tests/owned_class_balance_healer_contract.test.ts',
      'tests/owned_class_balance_healer_probes.test.ts',
      'tests/owned_class_balance_role_bands.test.ts',
      'tests/owned_class_raid_armor_avoidance.test.ts',
      'tests/owned_class_raid_sustain_bands.test.ts',
    ]);
    // The two lane jobs' halves, also literal (the a/b balance is a measured
    // decision, re-balanced 2026-08-13 with the run 31732244215 per-file
    // duration ledger recorded in the lane-split PRs).
    expect([...CI_LONG_SUITE_HALVES.a]).toEqual([
      'tests/nythraxis_matrix.test.ts',
      'tests/owned_class_balance_dps_metrics.test.ts',
      'tests/owned_class_balance_dps_probes.test.ts',
      'tests/owned_class_balance_druid_bands.test.ts',
      'tests/owned_class_balance_healer_probes.test.ts',
      'tests/owned_class_balance_role_bands.test.ts',
      'tests/owned_class_raid_armor_avoidance.test.ts',
    ]);
    expect([...CI_LONG_SUITE_HALVES.b]).toEqual([
      'tests/chronomancy_balance_targets.test.ts',
      'tests/druid_balance_probe.test.ts',
      'tests/eastbrook_gameplay_integration.test.ts',
      'tests/hunter_dps_balance.test.ts',
      'tests/owned_class_balance_groveheart.test.ts',
      'tests/owned_class_balance_healer_contract.test.ts',
      'tests/owned_class_raid_sustain_bands.test.ts',
    ]);
    // Exact partition of the union the shard legs exclude. Half b is DERIVED
    // (union minus half a), so "in neither half" and "in both halves" are
    // structurally impossible now; what this still catches is a half-a entry
    // that is not a union member (which would double-run a file the shards
    // do not exclude) and any ordering drift in the parent list.
    expect(Object.keys(CI_LONG_SUITE_HALVES).sort()).toEqual(['a', 'b']);
    expect([...CI_LONG_SUITE_HALVES.a, ...CI_LONG_SUITE_HALVES.b].sort()).toEqual([
      ...CI_LONG_SUITES,
    ]);
    // No lane file may be an invariant guard: guards must ride every
    // selective shard's floor leg, and the lane would pull them out of it.
    for (const f of CI_LONG_SUITES) {
      expect(CI_GUARD_SUITES).not.toContain(f);
      for (const prefix of CI_GUARD_PREFIXES) expect(f.startsWith(prefix)).toBe(false);
    }
  });

  it('resolves every lane file against the REAL collected suite', () => {
    // A deleted or renamed lane file must fail here loudly; collectedLaneFiles
    // filtering it out silently is the fail-safe RUNTIME behavior, not the
    // maintained state.
    const { testFiles } = collectSuiteVisibility({
      root: REPO_ROOT,
      readdirSync,
      readFileSync,
      join: path.join,
      relative: path.relative,
      sep: path.sep,
    });
    const collected = new Set(testFiles);
    for (const f of CI_LONG_SUITES) expect(collected.has(f), f).toBe(true);
  });

  it('collectedLaneFiles keeps only collected, existing lane files', () => {
    expect(collectedLaneFiles({ testFiles: LANE_BASE.testFiles, exists: () => true })).toEqual([
      LANE_BLIND,
      LANE_GRAPH,
    ]);
    expect(collectedLaneFiles({ testFiles: COLLECTED, exists: () => true })).toEqual([]);
    expect(
      collectedLaneFiles({ testFiles: LANE_BASE.testFiles, exists: (p) => p !== LANE_GRAPH }),
    ).toEqual([LANE_BLIND]);
    // The suites override scopes the filter to one half's list.
    expect(
      collectedLaneFiles({
        testFiles: LANE_BASE.testFiles,
        exists: () => true,
        suites: CI_LONG_SUITE_HALVES.b,
      }),
    ).toEqual([]);
    expect(
      collectedLaneFiles({
        testFiles: LANE_BASE.testFiles,
        exists: () => true,
        suites: CI_LONG_SUITE_HALVES.a,
      }),
    ).toEqual([LANE_BLIND, LANE_GRAPH]);
  });

  it('pins exactly which suites read the WOC_FULL_BALANCE_SWEEP diet flag', () => {
    // The suite-side registry for the balance-harness diet (docs/qa-gate.md,
    // "The balance-harness diet"), mirroring the I18N_RELEASE_TIER precedent:
    // the workflow-side pins hold the flag ONTO the nightly test job and OUT
    // of ci.yml, and this list holds WHICH suites read it, so another
    // harness quietly growing a diet, or a listed reader quietly losing
    // it, is a conscious edit here. Every reader must also be a
    // CI_LONG_SUITES member: the diet exists to shrink the lane, and a diet
    // on a sharded suite would thin coverage nothing accounted for. The
    // needle carries the compared VALUE too: a harness drifting to a
    // different truthy check (=== 'true') while nightly.yml still sets '1'
    // would silently run the diet nightly forever. Split so this registry
    // does not match itself.
    const needle = ['process.env.', "WOC_FULL_BALANCE_SWEEP === '1'"].join('');
    const { testFiles } = collectSuiteVisibility({
      root: REPO_ROOT,
      readdirSync,
      readFileSync,
      join: path.join,
      relative: path.relative,
      sep: path.sep,
    });
    const readers = testFiles
      .filter((f) => readFileSync(path.join(REPO_ROOT, f), 'utf8').includes(needle))
      .sort();
    expect(readers).toEqual([
      'tests/hunter_dps_balance.test.ts',
      'tests/owned_class_balance_dps_metrics.test.ts',
      'tests/owned_class_balance_druid_bands.test.ts',
      'tests/owned_class_balance_healer_contract.test.ts',
      'tests/owned_class_balance_role_bands.test.ts',
      'tests/owned_class_raid_armor_avoidance.test.ts',
      'tests/owned_class_raid_sustain_bands.test.ts',
    ]);
    for (const f of readers) expect(CI_LONG_SUITES).toContain(f);
  });

  it('full mode excludes exactly the collected lane files from the shard leg', () => {
    const plan = buildShardPlan({ ...LANE_BASE, mode: 'full' });
    expect(plan.mode).toBe('full');
    expect(plan.laneExcluded).toEqual([LANE_BLIND, LANE_GRAPH]);
    expect(plan.legs).toEqual([
      {
        name: 'npm test (full suite minus the 2-file long-sims lane, shard 3/8)',
        cmd: 'npm',
        args: [
          'test',
          '--',
          '--shard=3/8',
          '--maxWorkers=2',
          `--exclude=${LANE_BLIND}`,
          `--exclude=${LANE_GRAPH}`,
        ],
      },
    ]);
  });

  it('every fail-closed fallback keeps the lane exclusions (the lane owns those files)', () => {
    for (const overrides of [
      { changedPaths: undefined as unknown as string[] },
      { changedPaths: ['--config=evil'] },
      { changedPaths: ['package.json'] },
      { alwaysRun: ['tests/architecture.test.ts'] },
    ]) {
      const plan = buildShardPlan({ ...LANE_BASE, ...overrides });
      expect(plan.mode).toBe('full');
      expect(plan.legs[0].args).toContain(`--exclude=${LANE_BLIND}`);
      expect(plan.legs[0].args).toContain(`--exclude=${LANE_GRAPH}`);
    }
  });

  it('selective mode moves floor lane files to the lane and keeps the merged leg unfiltered', () => {
    const plan = buildShardPlan({ ...LANE_BASE });
    expect(plan.mode).toBe('selective');
    expect(plan.legs).toHaveLength(1);
    const [merged] = plan.legs;
    // The FLOOR-SEED half of the merged argv is lane-filtered (the lane job
    // owns those files); the RELATED side stays unfiltered: no --exclude may
    // appear, so a lane file vitest's graph walk reaches still re-runs here
    // (duplicate work, never a gap).
    expect(merged.args).not.toContain(LANE_BLIND);
    expect(merged.args).not.toContain(LANE_GRAPH);
    expect(plan.laneFloorCount).toBe(1);
    // floorCount reports what this leg SEEDS. The fixture's whole floor is
    // the base fixture's floor plus LANE_BLIND (added to alwaysRun above);
    // the one lane member then moves to the lane, so the seed list is back
    // at the base figure.
    expect(plan.floorCount).toBe(FLOOR_SANITY_MIN + 27);
    expect(merged.args.join(' ')).not.toContain('--exclude');
  });

  it('a changed lane test rides the lane, not the floor leg', () => {
    const plan = buildShardPlan({ ...LANE_BASE, changedPaths: [LANE_GRAPH] });
    expect(plan.mode).toBe('selective');
    expect(plan.legs[0].args).not.toContain(LANE_GRAPH);
    expect(plan.laneFloorCount).toBe(2);
    const lanePlan = buildLanePlan({ ...LANE_BASE, changedPaths: [LANE_GRAPH] });
    expect(lanePlan.laneFiles).toEqual([LANE_BLIND, LANE_GRAPH]);
  });

  it('lane full mode runs every collected lane file of its half through npm test', () => {
    for (const mode of ['full', '', 'garbage']) {
      const plan = buildLanePlan({ ...LANE_BASE, mode });
      expect(plan.mode).toBe('full');
      expect(plan.laneFiles).toEqual([LANE_BLIND, LANE_GRAPH]);
      expect(plan.legs).toEqual([
        {
          name: 'npm test (long-sims-a lane, 2 file(s))',
          cmd: 'npm',
          args: ['test', '--', LANE_BLIND, LANE_GRAPH, '--maxWorkers=2'],
        },
      ]);
      // The other half collects none of this fixture's lane files: zero legs,
      // never an argument-less npm test.
      const other = buildLanePlan({ ...LANE_BASE, mode, half: 'b' });
      expect(other.laneFiles).toEqual([]);
      expect(other.legs).toEqual([]);
    }
  });

  it('throws loud on an unknown lane half (wiring bug, not a fail-closed input)', () => {
    expect(() => buildLanePlan({ ...LANE_BASE, half: 'c' as unknown as 'a' })).toThrowError(
      /unknown long-sims lane half/,
    );
    // A prototype-chain key is truthy on a bare index read; the own-property
    // guard must give the same loud message, not an opaque TypeError.
    expect(() =>
      buildLanePlan({ ...LANE_BASE, half: 'constructor' as unknown as 'a' }),
    ).toThrowError(/unknown long-sims lane half/);
  });

  it('lane fail-closed fallbacks mirror the shard ladder input for input', () => {
    for (const overrides of [
      { changedPaths: undefined as unknown as string[] },
      { changedPaths: ['--config=evil'] },
      { changedPaths: ['package.json'] },
      { alwaysRun: ['tests/architecture.test.ts'] },
      { testFiles: LANE_BASE.testFiles.filter((f) => f !== 'tests/world_api_parity.test.ts') },
      {
        changedPaths: ['src/ui/i18n.resolved.generated/da_DK.ts'],
        exists: (p: string) => p !== 'src/ui/i18n.resolved.generated/da_DK.ts',
      },
    ]) {
      const shardPlan = buildShardPlan({ ...LANE_BASE, ...overrides });
      const laneA = buildLanePlan({ ...LANE_BASE, ...overrides, half: 'a' });
      const laneB = buildLanePlan({ ...LANE_BASE, ...overrides, half: 'b' });
      expect(shardPlan.mode).toBe('full');
      expect(laneA.mode).toBe('full');
      expect(laneB.mode).toBe('full');
      // The REASON must mirror too, not just the decision: the lane's log is
      // part of the audit trail, and a lane that claims "mode=full from the
      // changes job" while it actually fell back on an unsafe relay would be
      // a false statement in exactly the line reviewers are told to read.
      expect(laneA.reason).toBe(shardPlan.reason);
      expect(laneB.reason).toBe(shardPlan.reason);
      // The union invariant under every fallback: the shard leg excludes
      // exactly what the two lane halves run between them.
      expect(
        shardPlan.legs[0].args.filter((a) => a.startsWith('--exclude=')).map((a) => a.slice(10)),
      ).toEqual([...laneA.laneFiles, ...laneB.laneFiles].sort());
    }
  });

  it('a lane file the walker cannot see stays inside the shards, end to end', () => {
    // The documented fail-safe direction (collectedLaneFiles' comment): a
    // lane file present in alwaysRun but ABSENT from the collected set is
    // neither excluded from the shard legs nor run by the lane, so it stays
    // wherever the pre-lane layout had it (the floor leg here). Coverage
    // keeps, latency loses.
    const uncollected = {
      ...LANE_BASE,
      alwaysRun: [...ALWAYS, LANE_BLIND],
      testFiles: [...COLLECTED, LANE_GRAPH],
    };
    const shardPlan = buildShardPlan({ ...uncollected });
    expect(shardPlan.mode).toBe('selective');
    expect(shardPlan.legs[0].args).toContain(LANE_BLIND);
    expect(shardPlan.legs[0].args.some((a) => a === `--exclude=${LANE_BLIND}`)).toBe(false);
    const lanePlan = buildLanePlan({ ...uncollected });
    expect(lanePlan.laneFiles).toEqual([]);
    const shardFull = buildShardPlan({ ...uncollected, mode: 'full' });
    expect(shardFull.legs[0].args).not.toContain(`--exclude=${LANE_BLIND}`);
    expect(shardFull.legs[0].args).toContain(`--exclude=${LANE_GRAPH}`);
  });

  it('lane selective mode runs only floor or changed lane files, zero legs when none', () => {
    const plan = buildLanePlan({ ...LANE_BASE });
    expect(plan.mode).toBe('selective');
    expect(plan.laneFiles).toEqual([LANE_BLIND]);
    expect(plan.legs).toEqual([
      {
        name: 'npm test (long-sims-a lane, 1 file(s))',
        cmd: 'npm',
        args: ['test', '--', LANE_BLIND, '--maxWorkers=2'],
      },
    ]);
    // No collected lane file on the floor: a zero-leg plan, NEVER an
    // argument-less npm test (which would run the entire suite).
    const none = buildLanePlan({
      ...LANE_BASE,
      alwaysRun: ALWAYS,
      testFiles: [...COLLECTED, LANE_GRAPH],
    });
    expect(none.mode).toBe('selective');
    expect(none.laneFiles).toEqual([]);
    expect(none.legs).toEqual([]);
    // Half b's selective floor-intersection path, with a real half-b member
    // on the floor: on the current tree half b has no floor-classified file,
    // so the real-tree subprocess case can only ever see its zero-leg shape;
    // this fixture keeps the non-empty b path asserted.
    const LANE_B_FLOOR = 'tests/druid_balance_probe.test.ts';
    const planB = buildLanePlan({
      ...LANE_BASE,
      alwaysRun: [...ALWAYS, LANE_B_FLOOR],
      testFiles: [...COLLECTED, LANE_B_FLOOR],
      half: 'b' as const,
    });
    expect(planB.mode).toBe('selective');
    expect(planB.laneFiles).toEqual([LANE_B_FLOOR]);
    expect(planB.legs).toEqual([
      {
        name: 'npm test (long-sims-b lane, 1 file(s))',
        cmd: 'npm',
        args: ['test', '--', LANE_B_FLOOR, '--maxWorkers=2'],
      },
    ]);
  });

  it('shards plus the two lanes partition the collected suite in both modes', () => {
    // Full mode: the lane halves together run exactly the files the shard
    // legs exclude, and everything else stays in the sharded collection.
    const shardFull = buildShardPlan({ ...LANE_BASE, mode: 'full' });
    const laneFullA = buildLanePlan({ ...LANE_BASE, mode: 'full', half: 'a' });
    const laneFullB = buildLanePlan({ ...LANE_BASE, mode: 'full', half: 'b' });
    expect(
      shardFull.legs[0].args.filter((a) => a.startsWith('--exclude=')).map((a) => a.slice(10)),
    ).toEqual([...laneFullA.laneFiles, ...laneFullB.laneFiles].sort());
    // Selective mode: the merged leg's floor SEEDS plus both halves' lane
    // files re-cover the whole floor with no overlap and no loss. Only the
    // tests/ positionals are floor seeds; the changed src/ source rides the
    // same argv but is not a floor member.
    const shardSel = buildShardPlan({ ...LANE_BASE });
    const laneSelA = buildLanePlan({ ...LANE_BASE, half: 'a' });
    const laneSelB = buildLanePlan({ ...LANE_BASE, half: 'b' });
    const floorLegFiles = shardSel.legs[0].args.filter((a) => a.startsWith('tests/'));
    const { floor } = buildFloor({
      alwaysRun: LANE_BASE.alwaysRun,
      testFiles: LANE_BASE.testFiles,
      changedTestFiles: [],
    });
    expect([...floorLegFiles, ...laneSelA.laneFiles, ...laneSelB.laneFiles].sort()).toEqual(
      [...floor].sort(),
    );
    expect(floorLegFiles).not.toContain(LANE_BLIND);
  });
});

// The entry is the wiring between the workflow env and the planner; it runs
// for real here in --plan-only mode (prints every decision and leg, spawns
// nothing), so a fail-open hole in the env parsing or the planner hookup
// cannot hide behind unit tests of the parts.
describe('ci_shard_test.mjs entry (subprocess, --plan-only)', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));

  it('vitest related runs a TEST-file seed and goes RED on an empty collection', async () => {
    // The merged selective leg feeds the floor files to `vitest related` as
    // positionals, relying on vitest keeping a spec whose own moduleId is
    // among the given paths (specifications.ts, filterTestsBySource's
    // `path === specification.moduleId` arm). This pins BOTH halves of that
    // contract by EXECUTION against the REAL installed vitest: the seed runs,
    // and with --passWithNoTests=false an empty collection exits 1 (the
    // related subcommand defaults the flag to TRUE internally, so the loud
    // direction only exists with the explicit false). A vitest upgrade that
    // dropped either half would otherwise silently un-floor every selective
    // shard, the worst failure class this planner has.
    //
    // A mkdtemp FIXTURE PROJECT, not the repo corpus: `vitest related`
    // transforms every collected spec for its reverse graph, and over the
    // repo's ~2,700 specs that took minutes under CI contention (a 60s
    // watchdog killed the first cut of this pin on a loaded runner). The
    // property under test is vitest's, not the repo's, so a one-file corpus
    // proves it in seconds with the same installed binary.
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'wocc-seed-pin-'));
    try {
      writeFileSync(
        path.join(fixtureRoot, 'vitest.config.mjs'),
        "export default { test: { include: ['*.test.mjs'] } };\n",
      );
      writeFileSync(
        path.join(fixtureRoot, 'a.test.mjs'),
        "import { expect, it } from 'vitest';\nit('seed runs', () => { expect(1).toBe(1); });\n",
      );
      writeFileSync(path.join(fixtureRoot, 'notes.md'), 'inert non-test seed\n');
      const runChild = (seeds: string[]) => {
        const child = spawn(
          'npx',
          [
            '--no-install',
            'vitest',
            'related',
            ...seeds,
            '--run',
            '--passWithNoTests=false',
            '--root',
            fixtureRoot,
            '--config',
            path.join(fixtureRoot, 'vitest.config.mjs'),
          ],
          {
            cwd: repoRoot,
            // A SCRUBBED env, like runEntry below: this test itself runs
            // inside vitest, and an inherited VITEST_* worker environment
            // makes the child vitest misbehave (observed: it prints the RUN
            // header, runs nothing, and exits 0). HOME rides along for the
            // npx cache.
            env: {
              PATH: process.env.PATH ?? '',
              ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
            },
          },
        );
        let log = '';
        child.stdout.on('data', (chunk) => {
          log += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          log += String(chunk);
        });
        return new Promise<{ exitCode: number | null; log: string }>((resolve, reject) => {
          const killer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`nested vitest hung; log tail:\n${log.slice(-2000)}`));
          }, 60_000);
          child.on('error', (error) => {
            clearTimeout(killer);
            reject(error);
          });
          child.on('close', (code) => {
            clearTimeout(killer);
            resolve({ exitCode: code, log });
          });
        });
      };
      // The MIXED argv shape the planner emits: an inert non-test path beside
      // the test-file seed. The seed must run.
      const seeded = await runChild(['notes.md', 'a.test.mjs']);
      // Full ANSI strip, ESC byte included (a CSI-tail-only strip leaves raw
      // ESC bytes between the summary tokens and \s does not match them);
      // constructed, not a literal, so no control character sits in a regex.
      const esc = String.fromCharCode(27);
      const clean = seeded.log
        .replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '')
        .split(esc)
        .join('');
      expect(seeded.exitCode, clean.slice(-2000)).toBe(0);
      expect(clean).toContain('a.test.mjs');
      expect(clean).toMatch(/Test Files\s+1 passed/);
      // The loud direction: a collection that matches nothing exits 1.
      const empty = await runChild(['missing.test.mjs']);
      expect(empty.exitCode, empty.log.slice(-1000)).toBe(1);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 120_000);

  async function runEntry(args: string[], env: Record<string, string>) {
    const child = spawn(process.execPath, ['scripts/ci_shard_test.mjs', ...args], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH ?? '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...env,
      },
    });
    let log = '';
    child.stdout.on('data', (chunk) => {
      log += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      log += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const killer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`entry did not exit within 60s; log so far:\n${log}`));
      }, 60_000);
      killer.unref();
      child.on('error', (err) => {
        clearTimeout(killer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(killer);
        resolve(code);
      });
    });
    return { exitCode, log };
  }

  it('fails loud on a missing or malformed shard spec', async () => {
    const bad = await runEntry([], {});
    expect(bad.exitCode).toBe(1);
    expect(bad.log).toContain('usage:');
    const malformed = await runEntry(['--shard=9/8'], {});
    expect(malformed.exitCode).toBe(1);
  });

  it('honors a valid WOC_TEST_WORKERS and reports the source in the job log', async () => {
    // The entry, not just the resolver: the ci.yml trial env line only works
    // if the spawned entry reads it. workers=1 is valid on every core count,
    // so this arm is machine-independent.
    const run = await runEntry(['--shard=1/8', '--plan-only'], {
      TEST_MODE: 'full',
      WOC_TEST_WORKERS: '1',
    });
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('shard 1/8, workers=1 (WOC_TEST_WORKERS)');
    // \b so a --maxWorkers=10..19 from a wide-cores regression cannot satisfy
    // a bare prefix match.
    expect(run.log).toMatch(/--maxWorkers=1\b/);
  });

  it('falls back loudly to the measured default on a junk WOC_TEST_WORKERS', async () => {
    const fallback = Math.max(1, Math.floor(os.availableParallelism() / 2));
    // GITHUB_ACTIONS gates the ::warning (same idiom as the leg runner's
    // known-flake annotation): set it so the annotation arm is exercised; a
    // local repro without it prints only the plain log line.
    const run = await runEntry(['--shard=1/8', '--plan-only'], {
      TEST_MODE: 'full',
      WOC_TEST_WORKERS: 'banana',
      GITHUB_ACTIONS: 'true',
    });
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('WOC_TEST_WORKERS="banana" is not an integer');
    expect(run.log).toContain('::warning title=ci-shard invalid WOC_TEST_WORKERS::');
    // The ` (default)` suffix bounds the number AND names the arm; the
    // honored marker must be absent (its positive control is the sibling
    // test above).
    expect(run.log).toContain(`shard 1/8, workers=${fallback} (default)`);
    expect(run.log).not.toContain('(WOC_TEST_WORKERS)');
  });

  it('fails loud on an unknown lane or an ambiguous lane-plus-shard spec', async () => {
    const unknown = await runEntry(['--lane=bogus', '--plan-only'], {});
    expect(unknown.exitCode).toBe(1);
    expect(unknown.log).toContain('usage:');
    // The pre-split flag is gone: an un-migrated caller must fail loud, not
    // silently run some default half.
    const legacy = await runEntry(['--lane=long-sims', '--plan-only'], {});
    expect(legacy.exitCode).toBe(1);
    const ambiguous = await runEntry(['--lane=long-sims-a', '--shard=1/8', '--plan-only'], {});
    expect(ambiguous.exitCode).toBe(1);
    // A MALFORMED shard token beside the lane must also fail: parseShardArg
    // returns null for it, so a parsed-value check would silently run the
    // lane and ignore the token, guessing a partition.
    const malformedBeside = await runEntry(
      ['--lane=long-sims-a', '--shard=0/8', '--plan-only'],
      {},
    );
    expect(malformedBeside.exitCode).toBe(1);
    // Duplicate lane flags are a wiring bug too, whatever their values.
    const duplicated = await runEntry(
      ['--lane=long-sims-a', '--lane=long-sims-b', '--plan-only'],
      {},
    );
    expect(duplicated.exitCode).toBe(1);
  });

  it('the two lanes own every CI_LONG_SUITES file between them when the changes job says full', async () => {
    const env = {
      TEST_MODE: 'full',
      TEST_MODE_REASON: 'broad or unclassified change ("pnpm-lock.yaml"): full suite',
      CHANGED_FILES: '[]',
    };
    const runA = await runEntry(['--lane=long-sims-a', '--plan-only'], env);
    const runB = await runEntry(['--lane=long-sims-b', '--plan-only'], env);
    for (const [run, half] of [
      [runA, 'a'],
      [runB, 'b'],
    ] as const) {
      expect(run.exitCode).toBe(0);
      expect(run.log).toContain('plan: mode=full (mode=full from the changes job)');
      for (const f of CI_LONG_SUITE_HALVES[half]) expect(run.log).toContain(f);
      expect(run.log).not.toContain('--shard=');
      // This pins the resolver DEFAULT: runEntry spawns with a scrubbed env,
      // so the assertion holds even inside a CI job that exports
      // WOC_TEST_WORKERS (the lane's real CI worker count is pinned in
      // tests/ci_workflow.test.ts). The default is the half-cores MEASURED
      // ruling (the full-core trial in run 31107474546 inflated the sims'
      // aggregate CPU time ~1.6x through contention and timed out the
      // eastbrook sweep); the budgets are calibrated against this bound, and
      // the ` (default)` suffix proves no env override leaked in.
      expect(run.log).toContain(
        `long-sims-${half} lane, workers=${Math.max(1, Math.floor(os.availableParallelism() / 2))} (default)`,
      );
    }
    // Each half runs ITS files and none of the other's; together they cover
    // the whole CI_LONG_SUITES union the shard legs exclude.
    expect(runA.log).toContain('npm test -- tests/nythraxis_matrix.test.ts');
    expect(runB.log).toContain('npm test -- tests/chronomancy_balance_targets.test.ts');
    for (const f of CI_LONG_SUITE_HALVES.b) expect(runA.log).not.toContain(f);
    for (const f of CI_LONG_SUITE_HALVES.a) expect(runB.log).not.toContain(f);
    for (const f of CI_LONG_SUITES) {
      expect(runA.log.includes(f) || runB.log.includes(f)).toBe(true);
    }
  });

  it('lane selective mode runs only the floor lane members of each half for a leaf UI diff', async () => {
    // Real-tree expectation: tests/nythraxis_matrix.test.ts (half a) is the
    // only lane file that classifies blind/partial (floor) today; every other
    // lane file, half b's entire membership included, is graph-visible. So a
    // UI-only diff's lane a runs exactly that one floor member and lane b
    // takes the documented zero-leg path. If a lane file's classification
    // changes, this pin fails and the lane cost model must be re-decided
    // consciously.
    const env = {
      TEST_MODE: 'selective',
      TEST_MODE_REASON: 'selective: 1 changed source file(s)',
      CHANGED_FILES: '["src/ui/unit_portrait.ts"]',
    };
    const runA = await runEntry(['--lane=long-sims-a', '--plan-only'], env);
    expect(runA.exitCode).toBe(0);
    // The exact reason line closes BOTH directions and the cardinality at
    // once: "1 of 7" fails if a second half-a lane file lands on the floor
    // (whatever its sort position) and if the half's list total drifts.
    expect(runA.log).toContain(
      'plan: mode=selective (selective: 1 of 7 lane file(s) on the floor or changed)',
    );
    expect(runA.log).toContain('lane runs: tests/nythraxis_matrix.test.ts');
    expect(runA.log).not.toContain('tests/owned_class_balance_role_bands.test.ts');
    expect(runA.log).not.toContain('tests/druid_balance_probe.test.ts');
    const runB = await runEntry(['--lane=long-sims-b', '--plan-only'], env);
    expect(runB.exitCode).toBe(0);
    // Half b currently has no floor-classified member, so a leaf diff plans
    // ZERO legs here: the documented empty-lane path, exercised on the real
    // tree (the fixture-based cases above cover the non-empty shapes).
    expect(runB.log).toContain(
      'plan: mode=selective (selective: 0 of 7 lane file(s) on the floor or changed)',
    );
    expect(runB.log).toContain('lane runs: nothing');
    // Binding negative: zero legs means no npm test invocation is printed at
    // all (a filename negative would be vacuous against the "nothing" line).
    expect(runB.log).not.toContain('npm test');
    // The same zero-leg path FOR REAL (no --plan-only): the entry must exit
    // green without spawning a leg AND without running pretest (nothing
    // below reads the artifacts), so the legCount arm of the entry decision
    // executes here rather than living only in its unit test.
    const runBReal = await runEntry(['--lane=long-sims-b'], env);
    expect(runBReal.exitCode).toBe(0);
    expect(runBReal.log).toContain('lane runs: nothing');
    expect(runBReal.log).toContain('PASS: 0 leg(s) green');
    expect(runBReal.log).not.toContain('i18n:gen');
  });

  async function listVitestFilesExcluding(
    excludePath: string,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const child = spawn(
      'npx',
      [
        '--no-install',
        'vitest',
        'list',
        '--filesOnly',
        `--exclude=${excludePath}`,
        // vite.config.ts turns on experimental.fsModuleCache for warm-rerun speed. The flag
        // below forces this spawn to skip that cache. Root cause of the flake this guards
        // against is not yet identified: fsModuleCache is a per-module transform cache keyed
        // by a sha1 over module id/source/config/NODE_ENV and never holds a collected file
        // set, so it cannot explain a stale --exclude result on its own, and the underlying
        // repro has not been pinned down. The flag is left in place as harmless: it is a
        // correctness check of vitest's live --exclude semantics, so it should not read a
        // cache in the first place regardless of the cache's actual role in any flake.
        '--experimental.fsModuleCache=false',
      ],
      { cwd: repoRoot, env: { ...process.env } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const killer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error(
            `vitest list did not exit within 60s; stdout:\n${stdout.slice(0, 4000)}\nstderr:\n${stderr.slice(0, 4000)}`,
          ),
        );
      }, 60_000);
      killer.unref();
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(killer);
        resolve(code);
      });
    });
    return { exitCode, stdout, stderr };
  }

  it('vitest honors exact-path --exclude flags additively (the one external assumption)', async () => {
    // The whole lane rests on `--exclude=<exact relative path>` removing that
    // file and ONLY that file, while the config-level excludes stay in force.
    // If a vitest bump changed either semantic, the lane files would run in
    // both halves (duplicate work, never a gap) and the perf win would vanish
    // silently; this spawn makes that loud. `vitest list --filesOnly` prints
    // the collected set without running anything.
    //
    // This test spawns a real `npx vitest` subprocess from INSIDE a vitest run, sharing the
    // same module/transform cache the outer run is concurrently writing to under full-suite
    // parallel load, which occasionally races the spawned list into a stale read. One retry
    // of the WHOLE attempt (spawn plus every assertion below) distinguishes that from a real
    // vitest exclude-semantics regression: a real regression fails identically both times,
    // transient cache or output noise does not. Only stdout is parsed for the file-set
    // assertions: stderr can carry unrelated `npm warn` lines from `.npmrc` on every spawn,
    // which must not be mistaken for part of the collected file list.
    async function attempt(): Promise<void> {
      const { exitCode, stdout, stderr } = await listVitestFilesExcluding(
        'tests/battleground.test.ts',
      );
      expect(exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
      const files = stdout.split('\n').map((l) => l.trim());
      // Exact, not glob-broadened: the excluded file is gone, its many
      // same-prefix siblings survive.
      expect(files.some((f) => f.endsWith('tests/battleground.test.ts'))).toBe(false);
      expect(files.some((f) => f.endsWith('tests/battleground_band.test.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('tests/battleground_hud.test.ts'))).toBe(true);
      // Additive to the config excludes, never replacing them.
      expect(files.some((f) => f.includes('tests/browser/'))).toBe(false);
      expect(files.some((f) => f.includes('node_modules/'))).toBe(false);
    }
    try {
      await attempt();
    } catch {
      await attempt();
    }
  }, 130_000);

  it('shard mode passes the lane exclusions through to the real leg argv', async () => {
    const run = await runEntry(['--shard=2/8', '--plan-only'], {
      TEST_MODE: 'full',
      TEST_MODE_REASON: 'broad or unclassified change ("pnpm-lock.yaml"): full suite',
      CHANGED_FILES: '[]',
    });
    expect(run.exitCode).toBe(0);
    for (const f of CI_LONG_SUITES) expect(run.log).toContain(`--exclude=${f}`);
    expect(run.log).toContain('owned by the "PR long sims A" and "PR long sims B" jobs');
  });

  it('plans the full suite when the mode env is missing (fail closed)', async () => {
    const run = await runEntry(['--shard=2/8', '--plan-only'], {});
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('plan: mode=full');
    expect(run.log).toContain('npm test -- --shard=2/8');
    expect(run.log).toContain('plan-only');
  });

  it('honors TEST_MODE=full from the changes job even with a parseable empty relay', async () => {
    // The one case every fail-closed changes-job decision produces
    // (TEST_MODE=full, CHANGED_FILES=[]), and the case that proves the entry
    // actually READS the mode env: hardcoding mode='selective' in the entry
    // would plan the floor legs here (an empty array parses fine) and skip
    // 1600+ graph-visible files on exactly the highest-risk PRs.
    const run = await runEntry(['--shard=4/8', '--plan-only'], {
      TEST_MODE: 'full',
      TEST_MODE_REASON: 'broad or unclassified change ("pnpm-lock.yaml"): full suite',
      CHANGED_FILES: '[]',
    });
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('plan: mode=full (mode=full from the changes job)');
    expect(run.log).toContain('npm test -- --shard=4/8');
    expect(run.log).not.toContain('vitest related');
  });

  it('plans the merged selective leg over the real tree and prints the audit trail', async () => {
    const run = await runEntry(['--shard=5/8', '--plan-only'], {
      TEST_MODE: 'selective',
      TEST_MODE_REASON:
        'selective: 1 changed source file(s), 0 changed test file(s), 0 inert path(s)',
      CHANGED_FILES: '["src/ui/unit_portrait.ts"]',
    });
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('plan: mode=selective');
    expect(run.log).toContain('always-run floor');
    expect(run.log).toContain('vitest related');
    expect(run.log).toContain('src/ui/unit_portrait.ts');
    expect(run.log).toContain('--shard=5/8');
    // The outside-floor line is the audit trail the plan requires. Its wording
    // must never claim N files were "skipped": the related leg covers an
    // unknown further share of them, so an overstated skip count would
    // undercut the very log this design tells reviewers to audit.
    expect(run.log).toMatch(/outside the floor: \d+ graph-visible test file\(s\)/);
    expect(run.log).not.toContain('skips:');
    expect(run.log).toContain('nightly');
  });

  it('falls back to the full plan on an unparseable relay (fail closed)', async () => {
    const run = await runEntry(['--shard=1/8', '--plan-only'], {
      TEST_MODE: 'selective',
      CHANGED_FILES: 'not json at all',
    });
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('plan: mode=full');
    expect(run.log).toContain('npm test -- --shard=1/8');
  });

  it('strips control characters from the relayed reason before echoing it', async () => {
    // The reason is log-only, but the consumer must not trust the producer's
    // strip: a newline smuggled through the env could otherwise start a fresh
    // log line (where `::` workflow commands are parsed).
    const run = await runEntry(['--shard=1/8', '--plan-only'], {
      TEST_MODE: 'full',
      TEST_MODE_REASON: 'line-one\n::error::line-two',
      CHANGED_FILES: '[]',
    });
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('(line-one::error::line-two)');
    expect(run.log).not.toMatch(/^::error::/m);
  });
});
