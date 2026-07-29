import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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
  CI_LONG_SUITES,
  collectedLaneFiles,
  FLOOR_SANITY_MIN,
  parseShardArg,
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
      'tests/localization_fixes.test.ts',
      'tests/localization_coverage.test.ts',
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
  });
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
  it('builds the floor leg through npm test and the related leg through vitest related', () => {
    const plan = buildShardPlan({ ...BASE });
    expect(plan.mode).toBe('selective');
    expect(plan.legs).toHaveLength(2);
    const [floorLeg, relatedLeg] = plan.legs;
    // npm test, never bare vitest: pretest must regenerate the i18n artifacts
    // in every shard exactly as the old run line did.
    expect(floorLeg.cmd).toBe('npm');
    expect(floorLeg.args.slice(0, 2)).toEqual(['test', '--']);
    expect(floorLeg.args).toContain('tests/architecture.test.ts');
    expect(floorLeg.args).toContain('tests/world_api_parity.test.ts');
    expect(floorLeg.args).toContain('tests/parity/golden_warrior.test.ts');
    expect(floorLeg.args).toContain('--shard=3/8');
    expect(floorLeg.args).toContain('--maxWorkers=2');
    expect(floorLeg.args).not.toContain('--passWithNoTests');
    expect(relatedLeg.cmd).toBe('npx');
    expect(relatedLeg.args).toEqual([
      '--no-install',
      'vitest',
      'related',
      'src/ui/unit_portrait.ts',
      '--run',
      '--passWithNoTests',
      '--shard=3/8',
      '--maxWorkers=2',
    ]);
  });

  it('omits the related leg when the diff has no live sources', () => {
    const docsOnly = buildShardPlan({ ...BASE, changedPaths: ['docs/a.md', 'README.md'] });
    expect(docsOnly.mode).toBe('selective');
    expect(docsOnly.legs).toHaveLength(1);
    const deleted = buildShardPlan({ ...BASE, exists: (p) => !p.startsWith('src/') });
    expect(deleted.legs).toHaveLength(1);
  });

  it('adds a changed test file to the floor leg and drops a deleted one from the argv', () => {
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
    // plus localization_coverage, world_api_parity, and the parity file via
    // the guard union = FLOOR_SANITY_MIN + 25; COLLECTED holds two more pure
    // tests, which are exactly the outside-floor remainder.
    expect(plan.floorCount).toBe(FLOOR_SANITY_MIN + 25);
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
    ],
  ])('%s falls back to the full leg', (_label, overrides) => {
    const plan = buildShardPlan({ ...BASE, ...overrides });
    expect(plan.mode).toBe('full');
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
  // (mirroring the real tree, where tests/battleground.test.ts is blind and
  // the other lane files are graph-visible).
  const LANE_BLIND = 'tests/battleground.test.ts';
  const LANE_GRAPH = 'tests/chronomancy_balance.test.ts';
  const LANE_BASE = {
    ...BASE,
    alwaysRun: [...ALWAYS, LANE_BLIND],
    testFiles: [...COLLECTED, LANE_BLIND, LANE_GRAPH],
  };

  it('pins the lane membership list as a literal', () => {
    // Literal list: a rename or removal must be a conscious decision here AND
    // in the measured record (docs/qa-gate.md, "The long-sims lane"), never a
    // refactor side effect.
    expect([...CI_LONG_SUITES]).toEqual([
      'tests/audit_conservation_property.test.ts',
      'tests/battleground.test.ts',
      'tests/chronomancy_balance.test.ts',
      'tests/eastbrook_gameplay_integration.test.ts',
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

  it('selective mode moves floor lane files to the lane and leaves related unfiltered', () => {
    const plan = buildShardPlan({ ...LANE_BASE });
    expect(plan.mode).toBe('selective');
    const [floorLeg, relatedLeg] = plan.legs;
    expect(floorLeg.args).not.toContain(LANE_BLIND);
    expect(floorLeg.args).not.toContain(LANE_GRAPH);
    expect(plan.laneFloorCount).toBe(1);
    // floorCount reports what THIS leg runs. The fixture's whole floor is the
    // base fixture's FLOOR_SANITY_MIN + 25 plus LANE_BLIND (added to
    // alwaysRun above); the one lane member then moves to the lane, so the
    // leg is back at the base figure.
    expect(plan.floorCount).toBe(FLOOR_SANITY_MIN + 25);
    expect(relatedLeg.args).not.toContain('--exclude=' + LANE_BLIND);
    expect(relatedLeg.args.join(' ')).not.toContain('--exclude');
  });

  it('a changed lane test rides the lane, not the floor leg', () => {
    const plan = buildShardPlan({ ...LANE_BASE, changedPaths: [LANE_GRAPH] });
    expect(plan.mode).toBe('selective');
    expect(plan.legs[0].args).not.toContain(LANE_GRAPH);
    expect(plan.laneFloorCount).toBe(2);
    const lanePlan = buildLanePlan({ ...LANE_BASE, changedPaths: [LANE_GRAPH] });
    expect(lanePlan.laneFiles).toEqual([LANE_BLIND, LANE_GRAPH]);
  });

  it('lane full mode runs every collected lane file through npm test', () => {
    for (const mode of ['full', '', 'garbage']) {
      const plan = buildLanePlan({ ...LANE_BASE, mode });
      expect(plan.mode).toBe('full');
      expect(plan.laneFiles).toEqual([LANE_BLIND, LANE_GRAPH]);
      expect(plan.legs).toEqual([
        {
          name: 'npm test (long-sims lane, 2 file(s))',
          cmd: 'npm',
          args: ['test', '--', LANE_BLIND, LANE_GRAPH, '--maxWorkers=2'],
        },
      ]);
    }
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
      const lanePlan = buildLanePlan({ ...LANE_BASE, ...overrides });
      expect(shardPlan.mode).toBe('full');
      expect(lanePlan.mode).toBe('full');
      // The REASON must mirror too, not just the decision: the lane's log is
      // part of the audit trail, and a lane that claims "mode=full from the
      // changes job" while it actually fell back on an unsafe relay would be
      // a false statement in exactly the line reviewers are told to read.
      expect(lanePlan.reason).toBe(shardPlan.reason);
      // The union invariant under every fallback: the shard leg excludes
      // exactly what the lane runs.
      expect(
        shardPlan.legs[0].args.filter((a) => a.startsWith('--exclude=')).map((a) => a.slice(10)),
      ).toEqual(lanePlan.laneFiles);
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
        name: 'npm test (long-sims lane, 1 file(s))',
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
  });

  it('shards plus lane partition the collected suite in both modes', () => {
    // Full mode: the lane runs exactly the files the shard legs exclude, and
    // everything else stays in the sharded collection.
    const shardFull = buildShardPlan({ ...LANE_BASE, mode: 'full' });
    const laneFull = buildLanePlan({ ...LANE_BASE, mode: 'full' });
    expect(
      shardFull.legs[0].args.filter((a) => a.startsWith('--exclude=')).map((a) => a.slice(10)),
    ).toEqual(laneFull.laneFiles);
    // Selective mode: the floor leg plus the lane files re-cover the whole
    // floor with no overlap and no loss.
    const shardSel = buildShardPlan({ ...LANE_BASE });
    const laneSel = buildLanePlan({ ...LANE_BASE });
    const floorLegFiles = shardSel.legs[0].args.filter(
      (a) => a.startsWith('tests/') || a.startsWith('src/'),
    );
    const { floor } = buildFloor({
      alwaysRun: LANE_BASE.alwaysRun,
      testFiles: LANE_BASE.testFiles,
      changedTestFiles: [],
    });
    expect([...floorLegFiles, ...laneSel.laneFiles].sort()).toEqual([...floor].sort());
    expect(floorLegFiles).not.toContain(LANE_BLIND);
  });
});

// The entry is the wiring between the workflow env and the planner; it runs
// for real here in --plan-only mode (prints every decision and leg, spawns
// nothing), so a fail-open hole in the env parsing or the planner hookup
// cannot hide behind unit tests of the parts.
describe('ci_shard_test.mjs entry (subprocess, --plan-only)', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

  it('fails loud on an unknown lane or an ambiguous lane-plus-shard spec', async () => {
    const unknown = await runEntry(['--lane=bogus', '--plan-only'], {});
    expect(unknown.exitCode).toBe(1);
    expect(unknown.log).toContain('usage:');
    const ambiguous = await runEntry(['--lane=long-sims', '--shard=1/8', '--plan-only'], {});
    expect(ambiguous.exitCode).toBe(1);
    // A MALFORMED shard token beside the lane must also fail: parseShardArg
    // returns null for it, so a parsed-value check would silently run the
    // lane and ignore the token, guessing a partition.
    const malformedBeside = await runEntry(['--lane=long-sims', '--shard=0/8', '--plan-only'], {});
    expect(malformedBeside.exitCode).toBe(1);
    // Duplicate lane flags are a wiring bug too, whatever their values.
    const duplicated = await runEntry(['--lane=long-sims', '--lane=long-sims', '--plan-only'], {});
    expect(duplicated.exitCode).toBe(1);
  });

  it('lane mode owns every CI_LONG_SUITES file when the changes job says full', async () => {
    const run = await runEntry(['--lane=long-sims', '--plan-only'], {
      TEST_MODE: 'full',
      TEST_MODE_REASON: 'broad or unclassified change ("pnpm-lock.yaml"): full suite',
      CHANGED_FILES: '[]',
    });
    expect(run.exitCode).toBe(0);
    expect(run.log).toContain('plan: mode=full (mode=full from the changes job)');
    for (const f of CI_LONG_SUITES) expect(run.log).toContain(f);
    expect(run.log).toContain('npm test -- tests/audit_conservation_property.test.ts');
    expect(run.log).not.toContain('--shard=');
    // The lane keeps the half-cores bound, a MEASURED decision (see the
    // entry's comment: the full-core trial in run 31107474546 inflated the
    // sims' aggregate CPU time ~1.6x through contention and timed out the
    // eastbrook sweep). Pinned so neither direction changes silently: the
    // budgets are calibrated against this bound.
    expect(run.log).toContain(
      `long-sims lane, workers=${Math.max(1, Math.floor(os.availableParallelism() / 2))}`,
    );
  });

  it('lane selective mode runs only the floor lane member for a leaf UI diff', async () => {
    // Real-tree expectation: tests/battleground.test.ts classifies
    // blind/partial (floor) today and the other lane files are graph-visible,
    // so a UI-only diff's lane is exactly the one floor member. If a lane
    // file's classification changes, this pin fails and the lane cost model
    // must be re-decided consciously (see the phase notes).
    const run = await runEntry(['--lane=long-sims', '--plan-only'], {
      TEST_MODE: 'selective',
      TEST_MODE_REASON: 'selective: 1 changed source file(s)',
      CHANGED_FILES: '["src/ui/unit_portrait.ts"]',
    });
    expect(run.exitCode).toBe(0);
    // The exact reason line closes BOTH directions and the cardinality at
    // once: "1 of 4" fails if any second lane file joins (whatever its sort
    // position) and if the list total drifts.
    expect(run.log).toContain(
      'plan: mode=selective (selective: 1 of 4 lane file(s) on the floor or changed)',
    );
    expect(run.log).toContain('lane runs: tests/battleground.test.ts');
    expect(run.log).not.toContain('tests/chronomancy_balance.test.ts');
  });

  it('vitest honors exact-path --exclude flags additively (the one external assumption)', async () => {
    // The whole lane rests on `--exclude=<exact relative path>` removing that
    // file and ONLY that file, while the config-level excludes stay in force.
    // If a vitest bump changed either semantic, the lane files would run in
    // both halves (duplicate work, never a gap) and the perf win would vanish
    // silently; this spawn makes that loud. `vitest list --filesOnly` prints
    // the collected set without running anything.
    const child = spawn(
      'npx',
      [
        '--no-install',
        'vitest',
        'list',
        '--filesOnly',
        `--exclude=${'tests/battleground.test.ts'}`,
      ],
      { cwd: repoRoot, env: { ...process.env } },
    );
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      out += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const killer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`vitest list did not exit within 120s; output:\n${out.slice(0, 4000)}`));
      }, 120_000);
      killer.unref();
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(killer);
        resolve(code);
      });
    });
    expect(exitCode).toBe(0);
    const files = out.split('\n').map((l) => l.trim());
    // Exact, not glob-broadened: the excluded file is gone, its many
    // same-prefix siblings survive.
    expect(files.some((f) => f.endsWith('tests/battleground.test.ts'))).toBe(false);
    expect(files.some((f) => f.endsWith('tests/battleground_band.test.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('tests/battleground_hud.test.ts'))).toBe(true);
    // Additive to the config excludes, never replacing them.
    expect(files.some((f) => f.includes('tests/browser/'))).toBe(false);
    expect(files.some((f) => f.includes('node_modules/'))).toBe(false);
  }, 130_000);

  it('shard mode passes the lane exclusions through to the real leg argv', async () => {
    const run = await runEntry(['--shard=2/8', '--plan-only'], {
      TEST_MODE: 'full',
      TEST_MODE_REASON: 'broad or unclassified change ("pnpm-lock.yaml"): full suite',
      CHANGED_FILES: '[]',
    });
    expect(run.exitCode).toBe(0);
    for (const f of CI_LONG_SUITES) expect(run.log).toContain(`--exclude=${f}`);
    expect(run.log).toContain('owned by the "PR gate (long sims)" job');
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
    expect(run.log).not.toContain('npm test (always-run floor');
    expect(run.log).not.toContain('vitest related');
  });

  it('plans the two selective legs over the real tree and prints the audit trail', async () => {
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
