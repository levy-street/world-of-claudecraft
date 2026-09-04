// Fixture pins for scripts/lib/ci_shard_weight_carry.mjs, the machine-readable
// attribution of every shard-weight row the newest CI harvest did not measure.
// A carried row must prove where its measurement came from; merely appending a
// fallback-valued row must not satisfy the coverage floor. Each arm here trips
// exactly one clause of the contract the committed-table pin applies.
//
// The last describe drives the ENTRY that consumes this module,
// scripts/ci_shard_weights_harvest.mjs, over full harvest and local-carry modes
// with injected I/O, so output, parsing and refusal paths remain executable
// rather than prose-only contracts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CarriedProvenance,
  CarriedWeightTable,
} from '../scripts/lib/ci_shard_weight_carry.mjs';
import {
  applyLocalCarry,
  CARRY_METHODS,
  carriedDefects,
  carriedRows,
  DEFAULT_LOCAL_CARRY_REASON,
  medianMs,
  missingWeightFiles,
  modes,
  PRUNE_MAX_DROPS,
  parseCarryLocalArgs,
  parseCarryLocalCli,
  pruneMissingRows,
  serializeWeightTable,
  tableRows,
} from '../scripts/lib/ci_shard_weight_carry.mjs';

// The injected spawner (and the rest of the entry's world). vi.mock is hoisted,
// so these bind before the entry is imported inside runEntry below.
const entryIo = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  walkShardTestFiles: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: entryIo.execFileSync,
  spawnSync: entryIo.spawnSync,
}));
vi.mock('node:fs', () => ({
  existsSync: entryIo.existsSync,
  readFileSync: entryIo.readFileSync,
  writeFileSync: entryIo.writeFileSync,
}));
vi.mock('../scripts/lib/ci_shard_walk.mjs', () => ({
  walkShardTestFiles: entryIo.walkShardTestFiles,
}));
vi.mock('../scripts/ci_shard_partition.mjs', () => ({
  MEASURED_WEIGHTS: { 'tests/measured.test.ts': 120 },
  MEASURED_FALLBACK_MS: 41,
}));

// applyLocalCarry refuses a table with no provenance, so every table it returns
// has one; read it through the declared type rather than casting the union away,
// and throw (not silently yield undefined) if that ever stops holding.
const provenanceOf = (t: CarriedWeightTable): CarriedProvenance => {
  const prov = t.__provenance;
  if (!prov) throw new Error('applyLocalCarry returned a table with no __provenance');
  return prov;
};

const table = (
  rows: Record<string, number>,
  prov: Record<string, unknown> = {},
): Record<string, unknown> => ({
  __provenance: { run: '100', harvested: '2026-08-10', files: Object.keys(rows).length, ...prov },
  ...rows,
});

describe('medianMs and modes', () => {
  it('medianMs takes the middle of an odd list and the rounded mean of the two middles of an even one', () => {
    expect(medianMs([9, 3, 5])).toBe(5);
    expect(medianMs([7])).toBe(7);
    expect(medianMs([1, 2, 3, 10])).toBe(3);
    expect(() => medianMs([])).toThrow(/at least one/);
  });
  it('modes returns every value sharing the top count', () => {
    expect(modes([4, 4, 5, 6])).toEqual([4]);
    expect(modes([4, 4, 5, 5, 6]).sort()).toEqual([4, 5]);
  });
});

describe('carriedDefects: the contract, one clause per arm', () => {
  const clean = table(
    { 'tests/a.test.ts': 10, 'tests/b.test.ts': 20, 'tests/c.test.ts': 7 },
    {
      harvestedFiles: 2,
      carried: {
        'tests/c.test.ts': {
          ms: 7,
          method: 'local-median',
          measured: '2026-08-31',
          reason: 'added after the last harvest',
          runs: [9, 7, 6],
        },
      },
    },
  );

  it('passes a clean table and pins the method list as literals', () => {
    expect(carriedDefects(clean, { fallbackMs: 31, requireMap: true })).toEqual([]);
    expect(CARRY_METHODS).toEqual(['local-median', 'prose-backfill']);
    expect(tableRows(clean)).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts']);
    expect(Object.keys(carriedRows(clean))).toEqual(['tests/c.test.ts']);
  });

  it('a row appended WITHOUT an attribution breaks the harvested + carried identity', () => {
    // The fabrication shape: a row at the fallback value, no entry, files bumped
    // so the old shape pin stays green.
    const t = { ...clean, 'tests/z.test.ts': 31 } as Record<string, unknown>;
    (t.__provenance as Record<string, unknown>).files = 4;
    const defects = carriedDefects(t, { fallbackMs: 31, requireMap: true });
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatch(/harvestedFiles 2 \+ 1 carried != 4 rows/);
  });

  it('a missing map or a missing harvested count is a defect when the map is required, and not otherwise', () => {
    const legacy = table({ 'tests/a.test.ts': 10 });
    expect(carriedDefects(legacy, { requireMap: true })).toEqual([
      '__provenance.carried is missing',
      '__provenance.harvestedFiles is missing',
    ]);
    expect(carriedDefects(legacy)).toEqual([]);
    expect(carriedDefects({} as Record<string, unknown>)).toEqual(['__provenance is missing']);
  });

  it('files must count the rows', () => {
    const t = table({ 'tests/a.test.ts': 10 }, { files: 3, harvestedFiles: 1, carried: {} });
    expect(carriedDefects(t)).toEqual(['files 3 != 1 rows']);
  });

  it('a carried entry must name a row and match its value', () => {
    const ghost = table(
      { 'tests/a.test.ts': 10 },
      { harvestedFiles: 1, carried: { 'tests/gone.test.ts': { ms: 5, method: 'local-median' } } },
    );
    expect(carriedDefects(ghost).some((d) => d.includes('carried but not a row'))).toBe(true);
    const mismatch = table(
      { 'tests/a.test.ts': 10 },
      {
        harvestedFiles: 0,
        carried: {
          'tests/a.test.ts': {
            ms: 12,
            method: 'local-median',
            measured: '2026-08-31',
            reason: 'added after the last harvest',
            runs: [12],
          },
        },
      },
    );
    expect(carriedDefects(mismatch)).toEqual(['tests/a.test.ts: row 10 != carried ms 12']);
    const nonInt = table(
      { 'tests/a.test.ts': 10 },
      { harvestedFiles: 0, carried: { 'tests/a.test.ts': { ms: 0, method: 'prose-backfill' } } },
    );
    expect(carriedDefects(nonInt).some((d) => d.includes('not a positive integer'))).toBe(true);
  });

  it('an unknown method is refused', () => {
    const t = table(
      { 'tests/a.test.ts': 10 },
      { harvestedFiles: 0, carried: { 'tests/a.test.ts': { ms: 10, method: 'guessed' } } },
    );
    expect(carriedDefects(t)).toEqual(['tests/a.test.ts: unknown carry method "guessed"']);
  });

  it('local-median needs runs whose median IS the row, positive integers, a date, and a reason', () => {
    const entry = (over: Record<string, unknown>) =>
      table(
        { 'tests/a.test.ts': 10 },
        {
          harvestedFiles: 0,
          carried: {
            'tests/a.test.ts': {
              ms: 10,
              method: 'local-median',
              measured: '2026-08-31',
              reason: 'added after the last harvest',
              runs: [8, 10, 12],
              ...over,
            },
          },
        },
      );
    expect(carriedDefects(entry({}))).toEqual([]);
    // The reason is REQUIRED, and blank does not count: a local carry is always
    // a stopgap for a harvest that could not run, and the row must say which.
    expect(carriedDefects(entry({ reason: undefined }))).toEqual([
      'tests/a.test.ts: local-median without a reason',
    ]);
    expect(carriedDefects(entry({ reason: '   ' }))).toEqual([
      'tests/a.test.ts: local-median without a reason',
    ]);
    expect(carriedDefects(entry({ reason: 42 }))).toEqual([
      'tests/a.test.ts: local-median without a reason',
    ]);
    expect(carriedDefects(entry({ runs: [1, 2, 3] }))).toEqual([
      'tests/a.test.ts: ms 10 is not the median of runs 1,2,3',
    ]);
    expect(carriedDefects(entry({ runs: [] }))).toEqual([
      'tests/a.test.ts: local-median without runs',
    ]);
    expect(carriedDefects(entry({ runs: [10, 0.5, 10] }))).toEqual([
      'tests/a.test.ts: local-median runs must be positive integers',
    ]);
    expect(carriedDefects(entry({ measured: 'yesterday' }))).toEqual([
      'tests/a.test.ts: local-median without a measured date',
    ]);
  });

  it('prose-backfill rows need the ONE dated backfill note on the provenance', () => {
    const rows = { 'tests/a.test.ts': 10, 'tests/b.test.ts': 4 };
    const carried = {
      'tests/a.test.ts': { ms: 10, method: 'prose-backfill' },
      'tests/b.test.ts': { ms: 4, method: 'prose-backfill' },
    };
    expect(carriedDefects(table(rows, { harvestedFiles: 0, carried }))).toEqual([
      '2 prose-backfill rows without a dated __provenance.backfill note',
    ]);
    expect(
      carriedDefects(
        table(rows, {
          harvestedFiles: 0,
          carried,
          backfill: { date: '2026-08-31', note: 'legacy carry batch attribution' },
        }),
      ),
    ).toEqual([]);
    expect(
      carriedDefects(
        table(rows, { harvestedFiles: 0, carried, backfill: { date: '2026-08-31', note: '  ' } }),
      ),
    ).toHaveLength(1);
  });

  it('the fallback-not-modal clause trips when the fallback is the carried mode, ties included', () => {
    const rows = { 'tests/a.test.ts': 31, 'tests/b.test.ts': 31, 'tests/c.test.ts': 4 };
    const carried = Object.fromEntries(
      Object.entries(rows).map(([k, ms]) => [k, { ms, method: 'prose-backfill' }]),
    );
    const prov = {
      harvestedFiles: 0,
      carried,
      backfill: { date: '2026-08-31', note: 'n' },
    };
    const modal = carriedDefects(table(rows, prov), { fallbackMs: 31 });
    expect(modal).toHaveLength(1);
    expect(modal[0]).toMatch(/MEASURED_FALLBACK_MS 31 is a modal value among the 3 carried rows/);
    // A different fallback: clean. A tie at the top: still a defect.
    expect(carriedDefects(table(rows, prov), { fallbackMs: 7 })).toEqual([]);
    const tied = { 'tests/a.test.ts': 31, 'tests/b.test.ts': 4 };
    const tiedCarried = Object.fromEntries(
      Object.entries(tied).map(([k, ms]) => [k, { ms, method: 'prose-backfill' }]),
    );
    expect(
      carriedDefects(table(tied, { ...prov, carried: tiedCarried }), { fallbackMs: 31 }),
    ).toHaveLength(1);
    // No carried rows: nothing to be modal.
    expect(
      carriedDefects(table({ 'tests/a.test.ts': 31 }, { harvestedFiles: 1, carried: {} }), {
        fallbackMs: 31,
      }),
    ).toEqual([]);
  });
});

describe('applyLocalCarry', () => {
  const base = table(
    { 'tests/a.test.ts': 10, 'tests/old.test.ts': 5 },
    {
      harvestedFiles: 1,
      carried: { 'tests/old.test.ts': { ms: 5, method: 'prose-backfill' } },
      backfill: { date: '2026-08-31', note: 'legacy carry batch attribution' },
    },
  );

  it('adds a row at the median of the runs with a local-median entry, keeps the identity, sorts', () => {
    const out = applyLocalCarry(
      base,
      [
        { file: 'tests/new_b.test.ts', runs: [12, 9, 11] },
        { file: 'tests/aa.test.ts', runs: [3] },
      ],
      { measured: '2026-08-31', reason: 'pending harvest' },
    );
    expect(tableRows(out)).toEqual([
      'tests/a.test.ts',
      'tests/aa.test.ts',
      'tests/new_b.test.ts',
      'tests/old.test.ts',
    ]);
    expect(out['tests/new_b.test.ts']).toBe(11);
    const prov = provenanceOf(out);
    expect(prov.files).toBe(4);
    expect(prov.harvestedFiles).toBe(1);
    expect(carriedRows(out)['tests/new_b.test.ts']).toEqual({
      ms: 11,
      method: 'local-median',
      measured: '2026-08-31',
      reason: 'pending harvest',
      runs: [12, 9, 11],
    });
    expect(carriedDefects(out, { fallbackMs: 31, requireMap: true })).toEqual([]);
    // The input is not mutated.
    expect(tableRows(base)).toEqual(['tests/a.test.ts', 'tests/old.test.ts']);
  });

  it('re-carrying an already carried row replaces its attribution', () => {
    const out = applyLocalCarry(base, [{ file: 'tests/old.test.ts', runs: [6, 7, 8] }], {
      measured: '2026-08-31',
      reason: 'pending harvest',
    });
    expect(out['tests/old.test.ts']).toBe(7);
    expect(carriedRows(out)['tests/old.test.ts'].method).toBe('local-median');
    expect(provenanceOf(out).harvestedFiles).toBe(1);
  });

  it('REFUSES to overwrite a harvested row, a non-tests path, or non-integer runs', () => {
    expect(() =>
      applyLocalCarry(base, [{ file: 'tests/a.test.ts', runs: [1] }], {
        measured: '2026-08-31',
        reason: 'r',
      }),
    ).toThrow(/harvested row; a local run never overwrites a CI weight/);
    expect(() =>
      applyLocalCarry(base, [{ file: 'src/x.test.ts', runs: [1] }], {
        measured: '2026-08-31',
        reason: 'r',
      }),
    ).toThrow(/not under tests\//);
    expect(() =>
      applyLocalCarry(base, [{ file: 'tests/n.test.ts', runs: [1.5] }], {
        measured: '2026-08-31',
        reason: 'r',
      }),
    ).toThrow(/positive integer/);
    expect(() =>
      applyLocalCarry(base, [{ file: 'tests/n.test.ts', runs: [1] }], {
        measured: 'today',
        reason: 'r',
      }),
    ).toThrow(/YYYY-MM-DD/);
  });

  it('derives harvestedFiles for a legacy table with no map (every existing row counts as harvested)', () => {
    const legacy = table({ 'tests/a.test.ts': 10, 'tests/b.test.ts': 20 });
    const out = applyLocalCarry(legacy, [{ file: 'tests/c.test.ts', runs: [4] }], {
      measured: '2026-08-31',
      reason: 'pending harvest',
    });
    expect(provenanceOf(out).harvestedFiles).toBe(2);
    expect(carriedDefects(out, { requireMap: true })).toEqual([]);
  });
});

describe('missingWeightFiles', () => {
  it('keeps walk order and treats anything not a number as unmeasured', () => {
    const walked = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts', 'tests/d.test.ts'];
    const weights = {
      'tests/a.test.ts': 10,
      // A null, a string and an absent key are all "no measurement": the table
      // is generated, but a hand-edit or a bad merge can leave any of them, and
      // planning a shard off a non-number is worse than planning off the
      // fallback, so they must be reported as missing rather than skipped.
      'tests/b.test.ts': null,
      'tests/c.test.ts': '12',
    } as unknown as Record<string, unknown>;
    expect(missingWeightFiles(walked, weights)).toEqual([
      'tests/b.test.ts',
      'tests/c.test.ts',
      'tests/d.test.ts',
    ]);
    expect(missingWeightFiles(walked, { ...weights, 'tests/b.test.ts': 1 })).toEqual([
      'tests/c.test.ts',
      'tests/d.test.ts',
    ]);
    expect(missingWeightFiles([], weights)).toEqual([]);
  });
});

describe('parseCarryLocalCli: the --reason flag', () => {
  it('defaults the reason and passes every other token through untouched', () => {
    const { reason, tokens } = parseCarryLocalCli(['tests/a.test.ts=1,2,3', 'tests/b.test.ts=4']);
    expect(tokens).toEqual(['tests/a.test.ts=1,2,3', 'tests/b.test.ts=4']);
    expect(reason).toBe(DEFAULT_LOCAL_CARRY_REASON);
    // Pinned as a literal so a default-reason change is intentional.
    expect(DEFAULT_LOCAL_CARRY_REASON).toBe('local carry pending the next full-mode harvest');
  });

  it('takes an explicit reason from anywhere in the list, trimmed, and removes both tokens', () => {
    const { reason, tokens } = parseCarryLocalCli([
      'tests/a.test.ts=1',
      '--reason',
      '  release sync backfill  ',
      'tests/b.test.ts=2',
    ]);
    expect(reason).toBe('release sync backfill');
    expect(tokens).toEqual(['tests/a.test.ts=1', 'tests/b.test.ts=2']);
  });

  it('REFUSES a valueless, blank, or repeated --reason rather than silently defaulting', () => {
    // Silently defaulting is the dangerous shape: every row would claim the
    // pending-harvest reason while the operator believed they had set another.
    expect(() => parseCarryLocalCli(['tests/a.test.ts=1', '--reason'])).toThrow(
      /--reason needs a non-empty value/,
    );
    expect(() => parseCarryLocalCli(['--reason', '   ', 'tests/a.test.ts=1'])).toThrow(
      /--reason needs a non-empty value/,
    );
    expect(() => parseCarryLocalCli(['--reason', '--reason', 'tests/a.test.ts=1'])).toThrow(
      /--reason needs a non-empty value/,
    );
    expect(() => parseCarryLocalCli(['--reason', 'a', '--reason', 'b'])).toThrow(
      /--reason given twice/,
    );
  });

  it('the reason reaches every carried row, and a row without one is a defect', () => {
    const t = table({ 'tests/a.test.ts': 10 }, { harvestedFiles: 1, carried: {} });
    const cli = parseCarryLocalCli(['--reason', 'why this row exists', 'tests/new.test.ts=5,6,7']);
    const out = applyLocalCarry(t, parseCarryLocalArgs(cli.tokens), {
      measured: '2026-08-31',
      reason: cli.reason,
    });
    expect(carriedRows(out)['tests/new.test.ts'].reason).toBe('why this row exists');
    expect(carriedDefects(out, { fallbackMs: 31, requireMap: true })).toEqual([]);
    // Strip the reason back off and the committed-table contract rejects it.
    const stripped = JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
    const carried = (stripped.__provenance as { carried: Record<string, { reason?: string }> })
      .carried;
    carried['tests/new.test.ts'].reason = undefined;
    expect(carriedDefects(stripped, { fallbackMs: 31, requireMap: true })).toEqual([
      'tests/new.test.ts: local-median without a reason',
    ]);
  });

  it('applyLocalCarry itself refuses a missing or blank reason', () => {
    const t = table({ 'tests/a.test.ts': 10 }, { harvestedFiles: 1, carried: {} });
    const m = [{ file: 'tests/new.test.ts', runs: [5] }];
    expect(() =>
      applyLocalCarry(t, m, { measured: '2026-08-31' } as { measured: string; reason: string }),
    ).toThrow(/opts.reason must say why the rows are carried/);
    expect(() => applyLocalCarry(t, m, { measured: '2026-08-31', reason: '  ' })).toThrow(
      /opts.reason must say why the rows are carried/,
    );
  });
});

describe('parseCarryLocalArgs', () => {
  it('parses one measurement per token, keeping the runs in measured order', () => {
    expect(parseCarryLocalArgs(['tests/a.test.ts=120,131,127', 'tests/b/c.test.ts=90'])).toEqual([
      { file: 'tests/a.test.ts', runs: [120, 131, 127] },
      { file: 'tests/b/c.test.ts', runs: [90] },
    ]);
    // Surrounding whitespace inside the run list is tolerated (a shell-quoted
    // token pasted from a spreadsheet), the path is taken verbatim.
    expect(parseCarryLocalArgs(['tests/a.test.ts=5, 7'])).toEqual([
      { file: 'tests/a.test.ts', runs: [5, 7] },
    ]);
  });

  it('REFUSES every malformed token rather than measuring something else', () => {
    expect(() => parseCarryLocalArgs([])).toThrow(/at least one/);
    expect(() => parseCarryLocalArgs(['tests/a.test.ts'])).toThrow(/is not <path>=/);
    expect(() => parseCarryLocalArgs(['=12'])).toThrow(/is not <path>=/);
    expect(() => parseCarryLocalArgs(['tests/a.test.ts='])).toThrow(/is not an integer ms/);
    expect(() => parseCarryLocalArgs(['tests/a.test.ts=12.5'])).toThrow(/is not an integer ms/);
    expect(() => parseCarryLocalArgs(['tests/a.test.ts=-4'])).toThrow(/is not an integer ms/);
    expect(() => parseCarryLocalArgs(['tests/a.test.ts=0'])).toThrow(/at least one positive/);
    expect(() => parseCarryLocalArgs(['tests/a.test.ts=1', 'tests/a.test.ts=2'])).toThrow(
      /measured twice/,
    );
  });

  it('feeds applyLocalCarry directly (the median of the parsed runs becomes the row)', () => {
    const t = table({ 'tests/a.test.ts': 10 }, { harvestedFiles: 1, carried: {} });
    const out = applyLocalCarry(t, parseCarryLocalArgs(['tests/new.test.ts=120,131,127']), {
      measured: '2026-08-31',
      reason: 'pending harvest',
    });
    expect(out['tests/new.test.ts']).toBe(127);
    expect(carriedRows(out)['tests/new.test.ts']).toEqual({
      ms: 127,
      method: 'local-median',
      measured: '2026-08-31',
      reason: 'pending harvest',
      runs: [120, 131, 127],
    });
    expect(carriedDefects(out, { fallbackMs: 31, requireMap: true })).toEqual([]);
  });
});

describe('serializeWeightTable', () => {
  it('round-trips, and emits byte for byte what the repo formatter would', () => {
    const t = table(
      { 'tests/a.test.ts': 10, 'tests/c.test.ts': 7 },
      {
        harvestedFiles: 1,
        carried: {
          'tests/c.test.ts': {
            ms: 7,
            method: 'local-median',
            measured: '2026-08-31',
            runs: [9, 7, 6],
          },
        },
        backfill: { date: '2026-08-31', note: 'n' },
      },
    );
    const text = serializeWeightTable(t);
    expect(JSON.parse(text)).toEqual(t);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toMatch(/\n {2}"tests\/a\.test\.ts": 10,\n/);
    expect(text).toMatch(/\n {2}"__provenance": \{\n {4}"run": "100",\n/);
    // Each carried entry is expanded, one field per line, under its file key.
    expect(text).toContain('\n      "tests/c.test.ts": {\n        "ms": 7,\n');
  });

  it('emits the exact bytes the repo formatter would, pinned as a literal', () => {
    // Spelled out rather than compared against JSON.stringify: asserting
    // toBe(JSON.stringify(t, null, 2)) would re-run the implementation's own
    // expression on both sides and pass for any layout the function might
    // later adopt. These are the bytes biome prints for a .json file, and the
    // whole point of the function is that the writer and the formatter agree
    // (a custom layout is reformatted straight back and fails
    // `npm run ci:changed` on the format diff).
    const tiny = {
      __provenance: { run: '7', harvestedFiles: 1, carried: {} },
      'tests/a.test.ts': 10,
    };
    expect(serializeWeightTable(tiny)).toBe(
      '{\n' +
        '  "__provenance": {\n' +
        '    "run": "7",\n' +
        '    "harvestedFiles": 1,\n' +
        '    "carried": {}\n' +
        '  },\n' +
        '  "tests/a.test.ts": 10\n' +
        '}\n',
    );
  });
});

describe('the harvest entry: full harvest and local-carry modes (injected I/O)', () => {
  // gate-census items 3, 4 and 6. Two behaviors of this mode are load-bearing
  // and were unpinned: it ENUMERATES the unmeasured set itself rather than
  // taking a list, and it REFUSES rather than substituting a guess when a run
  // yields no measurement. A third was misdiagnosed: vitest prints a FAILED
  // file as `tests/x.test.ts (1 test | 1 failed)`, which the duration regex
  // does not match, so a RED suite used to be reported as "printed no parsable
  // duration" and walked the operator into hand-carrying a weight for a broken
  // file.
  const CARRIED = 'tests/measured.test.ts';
  const NEW_A = 'tests/new_a.test.ts';
  const NEW_B = 'tests/new_b.test.ts';

  const baseTable = () => ({
    __provenance: {
      run: '123',
      harvested: '2026-08-01',
      files: 1,
      harvestedFiles: 0,
      carried: {
        [CARRIED]: {
          ms: 120,
          method: 'local-median',
          measured: '2026-08-01',
          reason: 'an earlier carry',
          runs: [120],
        },
      },
    },
    [CARRIED]: 120,
  });

  class ProcessExited extends Error {
    constructor(readonly code: number) {
      super(`process.exit(${code})`);
    }
  }

  async function runEntry(args: string[]) {
    vi.resetModules();
    const priorArgv = process.argv;
    const priorExitCode = process.exitCode;
    process.argv = ['node', 'scripts/ci_shard_weights_harvest.mjs', ...args];
    const logs: string[] = [];
    const errs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errs.push(a.map(String).join(' '));
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExited(code ?? 0);
    }) as never);
    let exitCode = 0;
    try {
      // @ts-expect-error The executable intentionally has no public module API.
      await import('../scripts/ci_shard_weights_harvest.mjs');
      exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
    } catch (e) {
      if (!(e instanceof ProcessExited)) throw e;
      exitCode = e.code;
    } finally {
      process.argv = priorArgv;
      process.exitCode = priorExitCode;
      log.mockRestore();
      err.mockRestore();
      exit.mockRestore();
    }
    return { exitCode, logs, errs, out: errs.concat(logs).join('\n') };
  }

  /** The file a `vitest run <file>` invocation was pointed at. */
  const spawnedFiles = () => entryIo.spawnSync.mock.calls.map((call) => (call[1] as string[])[2]);

  const written = () => {
    expect(entryIo.writeFileSync).toHaveBeenCalledTimes(1);
    return JSON.parse(String(entryIo.writeFileSync.mock.calls[0][1]));
  };

  function primeGreen(durations: Record<string, number>) {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.walkShardTestFiles.mockReturnValue([CARRIED, NEW_A, NEW_B]);
    entryIo.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      const file = args[2];
      return {
        status: 0,
        signal: null,
        stdout: `\u2713 ${file} (1 test) ${durations[file] ?? 0}ms`,
        stderr: '',
      };
    });
  }

  afterEach(() => {
    entryIo.execFileSync.mockReset();
    entryIo.spawnSync.mockReset();
    entryIo.readFileSync.mockReset();
    entryIo.writeFileSync.mockReset();
    entryIo.walkShardTestFiles.mockReset();
  });

  it('a complete CI harvest replaces local attribution with a valid empty carried map', async () => {
    const jobs = [
      ...Array.from({ length: 8 }, (_, i) => `PR tests (${i + 1})`),
      'PR long sims',
      'PR gate',
    ].map((name, i) => ({ id: i + 1, name, conclusion: 'success' }));
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--json')) return JSON.stringify(jobs);
      const job = Number(args[args.indexOf('--job') + 1]);
      return (
        '[ci-shard-test] changes-job decision: mode=full\n' +
        `\u2713 ${CARRIED} (1 test) ${200 + job}ms\n` +
        `\u2713 tests/full_${job}.test.ts (1 test) ${30 + job}ms`
      );
    });

    const { exitCode, out } = await runEntry(['456']);
    expect(exitCode).toBe(0);
    expect(out).toContain('replacing 1 carried weights with CI-harvested weights');
    expect(entryIo.execFileSync).toHaveBeenCalledTimes(11);
    const refreshed = written();
    expect(refreshed[CARRIED]).toBe(210);
    expect(refreshed.__provenance).toEqual({
      run: '456',
      harvested: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      files: 11,
      harvestedFiles: 11,
      carried: {},
    });
    expect(carriedDefects(refreshed, { fallbackMs: 41, requireMap: true })).toEqual([]);
    expect(entryIo.spawnSync).not.toHaveBeenCalled();
  });

  it('ENUMERATES the unmeasured set itself and ignores any file named on the CLI', () => {
    primeGreen({ [NEW_A]: 200, [NEW_B]: 300 });
    return runEntry([
      '--carry-local-missing',
      '--runs',
      '1',
      // A hand-written token: this mode takes no file list, and honoring one
      // would be the exact hand-listing the enumeration exists to prevent.
      'tests/never_asked_for.test.ts=999',
    ]).then(({ exitCode, out }) => {
      expect(out).not.toContain('never_asked_for');
      expect(exitCode).toBe(0);
      expect(spawnedFiles().sort()).toEqual([NEW_A, NEW_B]);
      // The already-carried row is SKIPPED, not re-measured: missingWeightFiles
      // filters on `typeof weights[f] !== 'number'`. Its attribution is
      // untouched, which is what the mode's header comment now says.
      expect(spawnedFiles()).not.toContain(CARRIED);
      const table = written();
      expect(table[NEW_A]).toBe(200);
      expect(table[NEW_B]).toBe(300);
      expect(table.__provenance.carried[CARRIED]).toEqual(
        baseTable().__provenance.carried[CARRIED],
      );
      expect(Object.keys(table.__provenance.carried).sort()).toEqual([CARRIED, NEW_A, NEW_B]);
    });
  });

  it('takes the MEDIAN of --runs measurements and records every run', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.walkShardTestFiles.mockReturnValue([CARRIED, NEW_A]);
    const runs = [500, 200, 300];
    let i = 0;
    entryIo.spawnSync.mockImplementation((_cmd: string, args: string[]) => ({
      status: 0,
      signal: null,
      stdout: `\u2713 ${args[2]} (1 test) ${runs[i++]}ms`,
      stderr: '',
    }));
    const { exitCode } = await runEntry(['--carry-local-missing', '--runs', '3']);
    expect(exitCode).toBe(0);
    expect(spawnedFiles()).toEqual([NEW_A, NEW_A, NEW_A]);
    const table = written();
    expect(table[NEW_A]).toBe(300);
    expect(table.__provenance.carried[NEW_A].runs).toEqual(runs);
  });

  it('REFUSES when a green run prints no parsable duration, and writes nothing', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.walkShardTestFiles.mockReturnValue([CARRIED, NEW_A]);
    entryIo.spawnSync.mockReturnValue({
      status: 0,
      signal: null,
      // A summary-only reporter: exit 0, no per-file line, nothing to measure.
      stdout: 'Test Files  1 passed (1)\n',
      stderr: '',
    });
    const { exitCode, out } = await runEntry(['--carry-local-missing', '--runs', '1']);
    expect(exitCode).toBe(1);
    expect(out).toContain('printed no parsable duration');
    // The refusal is the point: never a guess, never the fallback weight.
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });

  it('names the FAILURE when the run is red, instead of blaming the parser', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.walkShardTestFiles.mockReturnValue([CARRIED, NEW_A]);
    entryIo.spawnSync.mockReturnValue({
      status: 1,
      signal: null,
      // The real vitest 4 shape for a red file: no duration, a failed count.
      stdout: `\u276f ${NEW_A} (1 test | 1 failed)\nTest Files  1 failed (1)\n`,
      stderr: '',
    });
    const { exitCode, out } = await runEntry(['--carry-local-missing', '--runs', '1']);
    expect(exitCode).toBe(1);
    expect(out).toContain('FAILED with exit code 1');
    // The misdiagnosis this replaces: it used to reach the no-duration refusal
    // and tell the operator to hand-carry a weight for a red test file.
    expect(out).not.toContain('printed no parsable duration');
    expect(out).not.toContain('--carry-local rather than guessing');
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });

  it('reports a spawner that could not start at all, and still writes nothing', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.walkShardTestFiles.mockReturnValue([CARRIED, NEW_A]);
    entryIo.spawnSync.mockReturnValue({
      status: null,
      signal: null,
      error: new Error('spawn npx ENOENT'),
      stdout: '',
      stderr: '',
    });
    const { exitCode, out } = await runEntry(['--carry-local-missing', '--runs', '1']);
    expect(exitCode).toBe(1);
    expect(out).toContain('could not be started (spawn npx ENOENT)');
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });

  it('does nothing at all when every walked file already has a weight', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.walkShardTestFiles.mockReturnValue([CARRIED]);
    const { exitCode, out } = await runEntry(['--carry-local-missing', '--runs', '1']);
    expect(exitCode).toBe(0);
    expect(out).toContain('nothing to do');
    expect(entryIo.spawnSync).not.toHaveBeenCalled();
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });

  // This is the branch an operator reaches for by hand and the local-missing
  // mode delegates to. With writeFileSync injected, nothing real is written.
  it('--carry-local writes the median row with its attribution and exits 0', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    const { exitCode, out } = await runEntry([
      '--carry-local',
      '--reason',
      'a stated reason',
      `${NEW_A}=500,200,300`,
    ]);
    expect(exitCode).toBe(0);
    // No measuring: this branch takes the operator's numbers, it never spawns.
    expect(entryIo.spawnSync).not.toHaveBeenCalled();
    const table = written();
    expect(table[NEW_A]).toBe(300);
    expect(table.__provenance.carried[NEW_A]).toMatchObject({
      ms: 300,
      method: 'local-median',
      reason: 'a stated reason',
      runs: [500, 200, 300],
    });
    // A local carry never moves a row it did not measure.
    expect(table.__provenance.carried[CARRIED]).toEqual(baseTable().__provenance.carried[CARRIED]);
    expect(table[CARRIED]).toBe(120);
    expect(out).toContain('a stated reason');
  });

  it('--carry-local refuses a token that is not <path>=<ms>, and writes nothing', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    const { exitCode, out } = await runEntry(['--carry-local', NEW_A]);
    expect(exitCode).toBe(1);
    expect(out).toContain('is not <path>=<ms>');
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });

  // --prune-missing, the third mode. The pure half is pinned above; these drive
  // the WIRING, which is where an inverted callback, a dropped refusal or a
  // missing write would live and where nothing looked before.
  it('--prune-missing writes nothing when every row names a file that exists', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.existsSync.mockReturnValue(true);
    const { exitCode, out } = await runEntry(['--prune-missing']);
    expect(exitCode).toBe(0);
    expect(out).toContain('nothing to do');
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });

  it('--prune-missing drops exactly the absent row and writes the table', async () => {
    // baseTable() carries ONE row, and dropping it would trip the empty-table
    // refusal rather than exercising the write, so this arm brings its own
    // two-row table: one harvested (the victim) and the shared carried row.
    const base = baseTable() as Record<string, unknown> & {
      __provenance: { files: number; harvestedFiles: number };
    };
    const victim = 'tests/victim.test.ts';
    base[victim] = 55;
    base.__provenance = { ...base.__provenance, files: 2, harvestedFiles: 1 };
    entryIo.readFileSync.mockReturnValue(JSON.stringify(base));
    entryIo.existsSync.mockImplementation(((p: string) => !String(p).endsWith(victim)) as never);
    const { exitCode, out } = await runEntry(['--prune-missing']);
    expect(exitCode).toBe(0);
    expect(out).toContain(`dropped ${victim}`);
    expect(entryIo.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(entryIo.writeFileSync.mock.calls[0][1] as string);
    expect(Object.keys(written)).not.toContain(victim);
    // The callback is really consulted per row, and in the right sense: an
    // INVERTED `exists` would drop everything else and keep this one.
    expect(tableRows(written).length).toBe(1);
  });

  it('--prune-missing refuses a bad --max-drops and writes nothing', async () => {
    // The refusal message tells the operator to raise the bound deliberately, so
    // the bound is reachable from the CLI; a bad value must not fall through to
    // a default and silently prune with the wrong one.
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.existsSync.mockReturnValue(true);
    const { exitCode, out } = await runEntry(['--prune-missing', '--max-drops', '0']);
    expect(exitCode).toBe(1);
    expect(out).toContain('--max-drops takes a positive integer');
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });

  it('--prune-missing REFUSES a mass prune and writes nothing', async () => {
    entryIo.readFileSync.mockReturnValue(JSON.stringify(baseTable()));
    entryIo.existsSync.mockReturnValue(false);
    const { exitCode, out } = await runEntry(['--prune-missing']);
    // This fixture is small enough that the DROP BOUND is never reached, which
    // is exactly how the first draft of this mode would have written an emptied
    // table: the arm found it, and the empty-table refusal is the fix.
    expect(exitCode).toBe(1);
    expect(out).toContain('refusing to prune EVERY row');
    expect(entryIo.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('pruneMissingRows: dropping a retired row without hand-editing the table', () => {
  // The mode exists because retiring a test file leaves a weight row naming a
  // path that is gone, tests/ci_shard_partition.test.ts reds on exactly that,
  // and the full harvest that would fix it needs a green FULL-MODE CI run. The
  // arithmetic below is what makes the write safe, so it is pinned here rather
  // than only exercised through the entry.
  const table = () => ({
    __provenance: {
      run: '1',
      files: 3,
      harvestedFiles: 2,
      carried: {
        'tests/c.test.ts': {
          ms: 5,
          method: 'local-median',
          measured: '2026-09-01',
          reason: 'a stated reason',
          runs: [4, 5, 6],
        },
      },
    },
    'tests/a.test.ts': 10,
    'tests/b.test.ts': 20,
    'tests/c.test.ts': 5,
  });

  it('is a no-op when every row still names a file that exists', () => {
    const input = table();
    const { table: out, gone } = pruneMissingRows(input, () => true);
    expect(gone).toEqual([]);
    expect(out).toBe(input);
  });

  it('drops a HARVESTED row and decrements harvestedFiles with it', () => {
    const { table: out, gone } = pruneMissingRows(table(), (file) => file !== 'tests/b.test.ts');
    expect(gone).toEqual(['tests/b.test.ts']);
    expect(tableRows(out)).toEqual(['tests/a.test.ts', 'tests/c.test.ts']);
    const prov = (out as { __provenance: { files: number; harvestedFiles: number } }).__provenance;
    expect(prov.files).toBe(2);
    // The row was harvested, so the harvested half pays for it.
    expect(prov.harvestedFiles).toBe(1);
    expect(carriedDefects(out, { fallbackMs: 41, requireMap: true })).toEqual([]);
  });

  it('drops a CARRIED row by deleting its attribution, leaving harvestedFiles alone', () => {
    const { table: out, gone } = pruneMissingRows(table(), (file) => file !== 'tests/c.test.ts');
    expect(gone).toEqual(['tests/c.test.ts']);
    const prov = (
      out as { __provenance: { files: number; harvestedFiles: number; carried: object } }
    ).__provenance;
    expect(prov.files).toBe(2);
    // NOT decremented: the carried map paid for this one.
    expect(prov.harvestedFiles).toBe(2);
    expect(Object.keys(prov.carried)).toEqual([]);
    expect(carriedDefects(out, { fallbackMs: 41, requireMap: true })).toEqual([]);
  });

  it('leaves the input table untouched (the caller re-checks before writing)', () => {
    const input = table();
    const snapshot = JSON.stringify(input);
    pruneMissingRows(input, (file) => file !== 'tests/b.test.ts');
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('REFUSES a mass prune, which the table contract cannot catch', () => {
    // The dangerous case, and carriedDefects is blind to it BY CONSTRUCTION:
    // pruneMissingRows preserves harvestedFiles + carried == rows whatever it
    // drops, so an emptied table has a self-consistent provenance and no
    // defects at all. A wrong-root or wrong-tree `exists` callback (a sparse
    // checkout, a partial clone, a branch predating most tests) is the live
    // trigger. Shown both ways: the emptied result really does pass the
    // contract, and the floor really does refuse it.
    const emptied = { __provenance: { ...table().__provenance }, ...{} } as Record<string, unknown>;
    (emptied.__provenance as { files: number; harvestedFiles: number; carried: object }).files = 0;
    (emptied.__provenance as { harvestedFiles: number }).harvestedFiles = 0;
    (emptied.__provenance as { carried: object }).carried = {};
    expect(
      carriedDefects(emptied, { fallbackMs: 41, requireMap: true }),
      'an emptied table passes the contract, which is why the floor exists',
    ).toEqual([]);

    const { table: out, gone, refusal } = pruneMissingRows(table(), () => false, { maxDrops: 1 });
    expect(refusal, 'a prune past the bound must be refused').toContain('refusing to prune');
    expect(gone).toHaveLength(3);
    expect(out, 'a refused prune returns the table untouched').toEqual(table());
    expect(PRUNE_MAX_DROPS).toBe(25);
  });

  it('handles a MIXED drop, and tables missing the optional provenance fields', () => {
    // The arithmetic that can invert is `gone.length - goneCarried`, and neither
    // single-kind arm above exercises it: drop one harvested AND one carried in
    // the same call.
    const { table: out, gone } = pruneMissingRows(
      table(),
      (file) => file !== 'tests/b.test.ts' && file !== 'tests/c.test.ts',
    );
    expect(gone.sort()).toEqual(['tests/b.test.ts', 'tests/c.test.ts']);
    const prov = (out as { __provenance: { files: number; harvestedFiles: number } }).__provenance;
    expect(prov.files).toBe(1);
    // One of the two was carried, so only the other decrements harvestedFiles.
    expect(prov.harvestedFiles).toBe(1);
    expect(carriedDefects(out, { fallbackMs: 41, requireMap: true })).toEqual([]);

    // Both optional provenance fields are guarded branches; drive them.
    const bare = { __provenance: { run: '1' }, 'tests/a.test.ts': 10, 'tests/b.test.ts': 20 };
    const pruned = pruneMissingRows(bare, (file) => file !== 'tests/b.test.ts');
    const bareProv = (pruned.table as { __provenance: Record<string, unknown> }).__provenance;
    expect(bareProv.files).toBe(1);
    expect(bareProv.harvestedFiles, 'absent harvestedFiles is left absent').toBeUndefined();
    expect(bareProv.carried).toBeUndefined();
  });

  it('a prune that moved the WRONG attribution would fail the table contract', () => {
    // The negative control for the arithmetic above: hand-build the result the
    // naive prune produces (rows dropped, attribution left alone) and show
    // carriedDefects refuses it. Without this, the two arms above would pass
    // against a function that never touched harvestedFiles at all.
    const naive = table() as Record<string, unknown> & {
      __provenance: { files: number; harvestedFiles: number };
    };
    delete naive['tests/b.test.ts'];
    naive.__provenance = { ...naive.__provenance, files: 2 };
    const defects = carriedDefects(naive, { fallbackMs: 41, requireMap: true });
    expect(defects.length).toBeGreaterThan(0);
    expect(defects.join(' ')).toContain('harvestedFiles');
  });
});
