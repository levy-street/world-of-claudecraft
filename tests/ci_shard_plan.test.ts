import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildFloor,
  buildShardPlan,
  CI_GUARD_PREFIXES,
  CI_GUARD_SUITES,
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

describe('buildShardPlan: full mode is byte-identical to the old step', () => {
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
