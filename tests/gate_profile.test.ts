import { describe, expect, it } from 'vitest';
import {
  buildGateProfileSteps,
  classifyMachineTier,
  collectMachineFacts,
  extractFileDurations,
  formatMachineFacts,
  formatSlowFiles,
  formatStepTimings,
  helpText,
  parseGateProfileArgs,
  rankSlowestFiles,
} from '../scripts/lib/gate_profile.mjs';
import { resolveTurboBin } from '../scripts/lib/gate_task_cache.mjs';

const GIB = 1024 * 1024 * 1024;
// buildGateProfileSteps(workers) with no explicit opts.repoRoot falls back to
// process.cwd() (gate_steps.mjs's buildFullGateSteps), which vitest always
// runs from the repo root.
const EXPECTED_TURBO_BIN = resolveTurboBin(process.cwd());

describe('classifyMachineTier', () => {
  it('labels high when both CPU and RAM clear the high bar', () => {
    expect(classifyMachineTier({ cpuCount: 16, totalMemBytes: 64 * GIB })).toBe('high');
    expect(classifyMachineTier({ cpuCount: 12, totalMemBytes: 32 * GIB })).toBe('high');
  });

  it('labels low when both CPU and RAM sit in the low band', () => {
    expect(classifyMachineTier({ cpuCount: 4, totalMemBytes: 8 * GIB })).toBe('low');
    expect(classifyMachineTier({ cpuCount: 8, totalMemBytes: 16 * GIB })).toBe('low');
  });

  it('labels medium for mixed or mid-band hardware', () => {
    expect(classifyMachineTier({ cpuCount: 10, totalMemBytes: 24 * GIB })).toBe('medium');
    // Many cores but little RAM is not high.
    expect(classifyMachineTier({ cpuCount: 16, totalMemBytes: 16 * GIB })).toBe('medium');
    // Few cores but lots of RAM is not high.
    expect(classifyMachineTier({ cpuCount: 4, totalMemBytes: 64 * GIB })).toBe('medium');
  });
});

describe('collectMachineFacts', () => {
  it('snapshots injected os/process surfaces and classifies tier', () => {
    const facts = collectMachineFacts(
      {
        platform: 'darwin',
        arch: 'arm64',
        availableParallelism: () => 16,
        cpus: () => ({ length: 99 }),
        totalmem: () => 128 * GIB,
        freemem: () => 10 * GIB,
      },
      { version: 'v26.5.0', platform: 'darwin' },
      { GATE_MAX_WORKERS: '4' },
    );
    expect(facts.cpuCount).toBe(16);
    expect(facts.totalMemGb).toBe(128);
    expect(facts.freeMemGb).toBe(10);
    expect(facts.tier).toBe('high');
    expect(facts.gateMaxWorkers).toBe('4');
    expect(facts.nodeVersion).toBe('v26.5.0');
  });

  it('falls back to cpus().length when availableParallelism is absent', () => {
    const facts = collectMachineFacts(
      {
        platform: 'linux',
        arch: 'x64',
        cpus: () => ({ length: 8 }),
        totalmem: () => 16 * GIB,
        freemem: () => 4 * GIB,
      },
      { version: 'v22.0.0', platform: 'linux' },
      {},
    );
    expect(facts.cpuCount).toBe(8);
    expect(facts.tier).toBe('low');
    expect(facts.gateMaxWorkers).toBeNull();
  });

  it('invokes node:os-style platform/arch functions so JSON facts stay strings', () => {
    const facts = collectMachineFacts(
      {
        platform: () => 'darwin',
        arch: () => 'arm64',
        availableParallelism: () => 16,
        cpus: () => ({ length: 16 }),
        totalmem: () => 128 * GIB,
        freemem: () => 10 * GIB,
      },
      { version: 'v26.5.0', platform: 'darwin' },
      {},
    );
    expect(facts.platform).toBe('darwin');
    expect(facts.arch).toBe('arm64');
    expect(typeof facts.platform).toBe('string');
  });
});

describe('extractFileDurations and rankSlowestFiles', () => {
  const sampleReport = {
    testResults: [
      {
        name: '/Users/dev/world-of-claudecraft/tests/sim.test.ts',
        startTime: 1000,
        endTime: 5000,
      },
      {
        name: '/Users/dev/world-of-claudecraft/tests/architecture.test.ts',
        duration: 9000,
      },
      {
        name: 'C:\\repo\\tests\\hud_perf_budget.test.ts',
        startTime: 0,
        endTime: 12000,
      },
      {
        // Missing timing: ignored
        name: '/Users/dev/world-of-claudecraft/tests/empty.test.ts',
      },
      {
        name: '/Users/dev/world-of-claudecraft/tests/fast.test.ts',
        durationMs: 50,
      },
    ],
  };

  it('extracts durations from duration, durationMs, and end-start', () => {
    const rows = extractFileDurations(sampleReport);
    expect(rows).toEqual([
      { file: 'tests/sim.test.ts', durationMs: 4000 },
      { file: 'tests/architecture.test.ts', durationMs: 9000 },
      { file: 'tests/hud_perf_budget.test.ts', durationMs: 12000 },
      { file: 'tests/fast.test.ts', durationMs: 50 },
    ]);
  });

  it('ranks descending and limits to top N with stable ranks', () => {
    const ranked = rankSlowestFiles(sampleReport, 3);
    expect(ranked).toEqual([
      { rank: 1, file: 'tests/hud_perf_budget.test.ts', durationMs: 12000 },
      { rank: 2, file: 'tests/architecture.test.ts', durationMs: 9000 },
      { rank: 3, file: 'tests/sim.test.ts', durationMs: 4000 },
    ]);
  });

  it('accepts a pre-built rows array and defaults limit to 10', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      file: `tests/f${i}.test.ts`,
      durationMs: i * 100,
    }));
    const ranked = rankSlowestFiles(rows);
    expect(ranked).toHaveLength(10);
    expect(ranked[0]).toEqual({ rank: 1, file: 'tests/f11.test.ts', durationMs: 1100 });
    expect(ranked[9]).toEqual({ rank: 10, file: 'tests/f2.test.ts', durationMs: 200 });
  });

  it('sums assertionResults durations when file-level timing is absent', () => {
    const rows = extractFileDurations({
      testResults: [
        {
          name: '/repo/tests/assert_sum.test.ts',
          assertionResults: [{ duration: 100 }, { duration: 250 }, { duration: null }],
        },
      ],
    });
    expect(rows).toEqual([{ file: 'tests/assert_sum.test.ts', durationMs: 350 }]);
  });

  it('returns empty for unusable payloads', () => {
    expect(extractFileDurations(null)).toEqual([]);
    expect(extractFileDurations({})).toEqual([]);
    expect(rankSlowestFiles({ testResults: [] }, 5)).toEqual([]);
  });
});

describe('parseGateProfileArgs', () => {
  it('defaults to running steps with top 10', () => {
    expect(parseGateProfileArgs([])).toMatchObject({
      help: false,
      factsOnly: false,
      steps: true,
      vitestSlow: false,
      top: 10,
      skipBrowser: false,
      dryRun: false,
    });
  });

  it('parses facts-only and skip flags', () => {
    const a = parseGateProfileArgs([
      '--facts',
      '--skip-browser',
      '--skip-builds',
      '--skip-vitest',
      '--skip-types',
      '--continue-on-error',
      '--dry-run',
    ]);
    expect(a.factsOnly).toBe(true);
    expect(a.steps).toBe(false);
    expect(a.skipBrowser).toBe(true);
    expect(a.skipBuilds).toBe(true);
    expect(a.skipVitest).toBe(true);
    expect(a.skipTypes).toBe(true);
    expect(a.continueOnError).toBe(true);
    expect(a.dryRun).toBe(true);
  });

  it('parses --from-json and implies no steps + vitest-slow ranking', () => {
    const a = parseGateProfileArgs(['--from-json', 'tmp/vitest.json', '--top', '20']);
    expect(a.fromJson).toBe('tmp/vitest.json');
    expect(a.steps).toBe(false);
    expect(a.vitestSlow).toBe(true);
    expect(a.top).toBe(20);
  });

  it('parses --workers and --json-out', () => {
    const a = parseGateProfileArgs(['--workers', '3', '--json-out', 'tmp/out.json', '--no-steps']);
    expect(a.workersOverride).toBe(3);
    expect(a.jsonOut).toBe('tmp/out.json');
    expect(a.steps).toBe(false);
  });

  it('throws on unknown flags and missing values', () => {
    expect(() => parseGateProfileArgs(['--nope'])).toThrow(/unknown argument/);
    expect(() => parseGateProfileArgs(['--from-json'])).toThrow(/requires a path/);
    expect(() => parseGateProfileArgs(['--top', '0'])).toThrow(/positive integer/);
    expect(() => parseGateProfileArgs(['--workers', 'x'])).toThrow(/positive integer/);
  });

  it('enables help', () => {
    expect(parseGateProfileArgs(['--help']).help).toBe(true);
    expect(parseGateProfileArgs(['-h']).help).toBe(true);
  });
});

describe('buildGateProfileSteps', () => {
  it('includes the full gate step list with worker-bound vitest args', () => {
    const steps = buildGateProfileSteps(8);
    const names = steps.map((s) => s.name);
    // Phase 8: pure artifacts via turbo; typecheck + env/server parallel multi-task.
    expect(names).toEqual([
      'i18n + wiki + sfx artifacts',
      'i18n freshness',
      'malware scan',
      'biome (changed files)',
      'vitest (full suite)',
      'browser regressions',
      'typecheck + env/server/bot builds',
      'client build',
    ]);
    const vitest = steps.find((s) => s.name === 'vitest (full suite)');
    expect(vitest?.args).toEqual(['test', '--', '--maxWorkers=8']);
    // Generate-once: skip pretest after i18n + wiki; client build is turbo build:bundle.
    expect(vitest?.env).toEqual({ WOC_SKIP_PRETEST: '1' });
    const i18n = steps.find((s) => s.name === 'i18n + wiki + sfx artifacts');
    expect(i18n?.cmd).toBe(EXPECTED_TURBO_BIN);
    expect(i18n?.args).toEqual(
      expect.arrayContaining(['run', 'i18n:gen', 'wiki:content', 'sfx:check']),
    );
    const client = steps.find((s) => s.name === 'client build');
    expect(client?.cmd).toBe(EXPECTED_TURBO_BIN);
    expect(client?.args).toEqual(expect.arrayContaining(['run', 'build:bundle']));
  });

  it('honors skip flags without dropping unskipped steps', () => {
    const steps = buildGateProfileSteps(4, {
      skipBrowser: true,
      skipBuilds: true,
      skipVitest: true,
      skipTypes: true,
    });
    expect(steps.map((s) => s.name)).toEqual([
      'i18n + wiki + sfx artifacts',
      'i18n freshness',
      'malware scan',
      'biome (changed files)',
    ]);
  });
});

describe('formatters and help', () => {
  it('formats machine facts and step timings without em/en dashes', () => {
    const facts = collectMachineFacts(
      {
        platform: 'darwin',
        arch: 'arm64',
        availableParallelism: () => 16,
        cpus: () => ({ length: 16 }),
        totalmem: () => 128 * GIB,
        freemem: () => 12 * GIB,
      },
      { version: 'v26.5.0', platform: 'darwin' },
      {},
    );
    const text = formatMachineFacts(facts, {
      workers: 8,
      gitSha: 'abc123',
      npmVersion: '11.0.0',
      dateUtc: '2026-08-02T12:00:00.000Z',
    });
    expect(text).toContain('Tier:            high');
    expect(text).toContain('gate workers:    8');
    expect(text).not.toMatch(/[\u2013\u2014]/);
    // Availability is optional: omitted here, so the block must not invent the line.
    expect(text).not.toContain('RAM available:');

    // When the caller resolves it (gate_profile.mjs does, through the same sensor the
    // gate uses), it prints alongside the free figure so a macOS worker count that does
    // not follow freemem is explainable rather than surprising.
    const withAvailable = formatMachineFacts(facts, { workers: 8, availableMemGb: 41.5 });
    expect(withAvailable).toContain('RAM total/free:  128 / 12 GiB');
    expect(withAvailable).toContain('RAM available:   41.5 GiB');

    const timings = formatStepTimings([
      { name: 'i18n artifacts', seconds: 12.34, status: 'ok' },
      { name: 'vitest (full suite)', seconds: 100, status: 'fail' },
      { name: 'client build', seconds: 0, status: 'skipped' },
    ]);
    expect(timings).toContain('i18n artifacts');
    expect(timings).toContain('TOTAL');
    // Skipped does not add to total: 12.3 + 100 = 112.3
    expect(timings).toMatch(/112\.3/);
    expect(timings).not.toMatch(/[\u2013\u2014]/);
  });

  it('formats slow file ranks', () => {
    const text = formatSlowFiles([
      { rank: 1, file: 'tests/a.test.ts', durationMs: 1234.5 },
      { rank: 2, file: 'tests/b.test.ts', durationMs: 99 },
    ]);
    expect(text).toContain('tests/a.test.ts');
    expect(text).toContain('1235');
    expect(formatSlowFiles([])).toContain('no file durations');
  });

  it('help text documents the main flags', () => {
    const h = helpText();
    expect(h).toContain('--facts');
    expect(h).toContain('--vitest-slow');
    expect(h).toContain('--from-json');
    expect(h).toContain('--skip-browser');
    expect(h).not.toMatch(/[\u2013\u2014]/);
  });
});
