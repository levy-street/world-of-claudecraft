import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWeightLines, SKIPPED_FILE_WEIGHT_MS } from '../scripts/lib/ci_shard_weight_parse.mjs';

const harvestIo = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFileSync: harvestIo.execFileSync }));
vi.mock('node:fs', () => ({
  readFileSync: harvestIo.readFileSync,
  writeFileSync: harvestIo.writeFileSync,
}));

const ESC = String.fromCharCode(27);

describe('ci shard weight log parser', () => {
  it('parses both ANSI encodings, both duration units, and skip-count lines', () => {
    const log = [
      `${ESC}[32m\u2713${ESC}[39m tests/a.test.ts ${ESC}[2m(${ESC}[22m12 tests${ESC}[2m)${ESC}[22m 159${ESC}[2mms${ESC}[22m`,
      '^[[32m\u2713^[[39m tests/b.test.ts ^[[2m(^[[22m3 tests | 2 skipped^[[2m)^[[22m 2.5^[[2ms^[[22m',
      'not a reporter line at all',
    ].join('\n');
    expect(parseWeightLines(log)).toEqual({ 'tests/a.test.ts': 159, 'tests/b.test.ts': 2500 });
  });

  it('keeps the MAX across repeated occurrences', () => {
    const into = parseWeightLines('\u2713 tests/a.test.ts (1 tests) 100ms');
    parseWeightLines('\u2713 tests/a.test.ts (1 tests) 90ms', into);
    parseWeightLines('\u2713 tests/a.test.ts (1 tests) 140ms', into);
    expect(into['tests/a.test.ts']).toBe(140);
  });

  it('records a small floor for fully-skipped files instead of omitting them', () => {
    // Permanently-skipped suites (no-database integration files) previously
    // never entered the table and fell to the unknown-file fallback forever.
    const into = parseWeightLines('\u2193 tests/db_integration.test.ts (9 tests | 9 skipped)');
    expect(into['tests/db_integration.test.ts']).toBe(SKIPPED_FILE_WEIGHT_MS);
    // A later RAN occurrence still wins over the skip floor.
    parseWeightLines('\u2713 tests/db_integration.test.ts (9 tests) 800ms', into);
    expect(into['tests/db_integration.test.ts']).toBe(800);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CI shard weight harvester provenance', () => {
  // Shared rig: a green full-mode run with the 8 shards + 2 lanes, and a
  // fresh execution of the harvester (its whole body runs at import time, so
  // every test must reset the module registry before importing again).
  function primeGreenRun() {
    const jobs = [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        name: `PR tests (${i + 1})`,
        conclusion: 'success',
      })),
      { id: 9, name: 'PR long sims', conclusion: 'success' },
      { id: 10, name: 'PR gate', conclusion: 'success' },
    ];
    harvestIo.execFileSync.mockImplementation((_file: string, args: string[]) =>
      args.includes('--json')
        ? JSON.stringify(jobs)
        : 'changes-job decision: mode=full\n\u2713 tests/example.test.ts (1 test) 20ms',
    );
    harvestIo.writeFileSync.mockClear();
  }

  async function runHarvester() {
    vi.resetModules();
    const priorArg = process.argv[2];
    process.argv[2] = '123456789';
    try {
      // @ts-expect-error The executable intentionally has no public module API.
      await import('../scripts/ci_shard_weights_harvest.mjs');
    } finally {
      if (priorArg === undefined) process.argv.splice(2, 1);
      else process.argv[2] = priorArg;
    }
  }

  it('warns before replacing the checked-in mergedLocal/mergedFiles rows', async () => {
    primeGreenRun();
    harvestIo.readFileSync.mockReturnValue(
      JSON.stringify({
        __provenance: {
          run: '32621561241',
          mergedLocal: '2026-08-24',
          mergedFiles: 46,
        },
      }),
    );
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runHarvester();

    const replacement = logs.mock.calls
      .map(([line]) => String(line))
      .find((line) => line.includes('locally measured rows'));
    expect(replacement).toContain('46 locally measured rows');
    expect(replacement).toContain('2026-08-24');
    expect(harvestIo.writeFileSync).toHaveBeenCalledOnce();
  });

  it('speaks up on an unrecognized provenance shape instead of a silent discard', async () => {
    // A THIRD local-merge shape (neither sibling mergedLocal/mergedFiles nor
    // nested localMerge) used to fall through the ?? chain and the bare
    // catch, printing NOTHING while the rewrite discarded its rows.
    primeGreenRun();
    harvestIo.readFileSync.mockReturnValue(
      JSON.stringify({
        __provenance: {
          run: '32621561241',
          harvested: '2026-08-23',
          files: 3188,
          merged: { at: '2026-08-24', rows: 46 },
        },
      }),
    );
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runHarvester();

    const warning = warns.mock.calls
      .map(([line]) => String(line))
      .find((line) => line.includes('unrecognized __provenance shape'));
    // Names the shape it could not parse and the consequence.
    expect(warning).toContain('merged');
    expect(warning).toContain('DISCARDS');
    // The known-shape advisory must NOT also fire.
    expect(
      logs.mock.calls
        .map(([line]) => String(line))
        .find((l) => l.includes('locally measured rows')),
    ).toBeUndefined();
    // The rewrite itself still proceeds: the arm warns, it does not block.
    expect(harvestIo.writeFileSync).toHaveBeenCalledOnce();
  });

  it('stays silent on the plain-harvest provenance this script writes itself', async () => {
    // A prior table with ONLY run/harvested/files carries no locally measured
    // rows, so neither the advisory nor the unrecognized-shape warning should
    // fire (a warning here would cry wolf on every routine re-harvest).
    primeGreenRun();
    harvestIo.readFileSync.mockReturnValue(
      JSON.stringify({
        __provenance: { run: '32621561241', harvested: '2026-08-23', files: 3188 },
      }),
    );
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runHarvester();

    expect(
      logs.mock.calls
        .map(([line]) => String(line))
        .find((l) => l.includes('locally measured rows')),
    ).toBeUndefined();
    expect(warns.mock.calls).toHaveLength(0);
    expect(harvestIo.writeFileSync).toHaveBeenCalledOnce();
  });
});
