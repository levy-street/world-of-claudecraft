// Fixture pins for the CI shard-weight UNION tool
// (scripts/merge_audit/shard_weight_union.mjs), the third merge_audit script of
// the farming absorb (masterwrought Phase 11d). Inline fixtures only: no git, no
// repo walk, so the selective gate sees it through the import graph.
//
// The Phase 11d QA gate review flagged this as the one merge_audit tool with no
// coverage at all, no .d.mts, and no tsc reach, even though its output is a
// COMMITTED CI artifact (scripts/ci_shard_weights.generated.json). These arms
// pin the four properties the phase leaned on when it minted that table: the
// newer harvest wins every shared key, rows only the older table carried keep
// that table's measured value, the older table's own disclosure travels with
// them rather than being laundered into an apparent CI pedigree, and `files`
// counts the merged table. Plus the wrong-parent-wins refusal the review found.
import { describe, expect, it } from 'vitest';
import { carriedDefects } from '../scripts/lib/ci_shard_weight_carry.mjs';
import { unionTables } from '../scripts/merge_audit/shard_weight_union.mjs';

// The harvest DATE is part of the same provenance-honesty contract as the run id
// and the pedigree text, so the fixtures must not share one: with both sides on
// the same date, swapping which side's `harvested` is copied was invisible (Phase
// 11d QA pin audit). Each table now carries a date derived from its own run.
const table = (run: string, rows: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ({
    __provenance: {
      run,
      harvested: `2026-08-${String(run ?? 'xx').slice(0, 2)}`,
      files: Object.keys(rows).length,
      ...extra,
    },
    ...rows,
  }) as never;

describe('unionTables: which harvest wins', () => {
  it('takes every shared key from the NEWER run, never the older one', () => {
    const ours = table('100', { 'tests/a.test.ts': 10, 'tests/b.test.ts': 20 });
    const theirs = table('200', { 'tests/a.test.ts': 11, 'tests/b.test.ts': 22 });
    const { merged, stats } = unionTables(ours, theirs);
    expect(stats.newer).toBe('theirs');
    expect(merged['tests/a.test.ts']).toBe(11);
    expect(merged['tests/b.test.ts']).toBe(22);
    // The DATE travels with the run id it belongs to, never the other side's.
    const prov = merged.__provenance as { run: string; harvested: string };
    expect(prov.run).toBe('200');
    expect(prov.harvested).toBe('2026-08-20');
  });

  it('picks the newer run whichever SIDE carries it (not a fixed preference)', () => {
    const ours = table('900', { 'tests/a.test.ts': 10 });
    const theirs = table('200', { 'tests/a.test.ts': 11 });
    const { merged, stats } = unionTables(ours, theirs);
    expect(stats.newer).toBe('ours');
    expect(merged['tests/a.test.ts']).toBe(10);
  });

  it('REFUSES to guess when a run id is missing or not a number', () => {
    // The silent-pass shape the review found: Number(undefined) is NaN, every
    // NaN comparison is false, so "newer" fell to ours and promoted the WRONG
    // table's weights on every shared key with nothing to say so.
    const good = table('200', { 'tests/a.test.ts': 11 });
    const noRun = table(undefined as unknown as string, { 'tests/a.test.ts': 10 });
    const badRun = table('not-a-run', { 'tests/a.test.ts': 10 });
    expect(() => unionTables(noRun, good)).toThrow(/numeric __provenance.run/);
    expect(() => unionTables(badRun, good)).toThrow(/numeric __provenance.run/);
    expect(() => unionTables(good, noRun)).toThrow(/numeric __provenance.run/);
  });
});

describe('unionTables: the carried rows', () => {
  it('keeps a row only the older table had, at the older table MEASURED value', () => {
    const ours = table('100', { 'tests/only_ours.test.ts': 77, 'tests/shared.test.ts': 10 });
    const theirs = table('200', { 'tests/shared.test.ts': 12 });
    const { merged, stats } = unionTables(ours, theirs);
    expect(stats.carried).toEqual(['tests/only_ours.test.ts']);
    expect(merged['tests/only_ours.test.ts']).toBe(77);
    expect(stats.union).toBe(2);
  });

  it('counts `files` over the MERGED table, not either parent', () => {
    const ours = table('100', { 'tests/a.test.ts': 1, 'tests/b.test.ts': 2 });
    const theirs = table('200', { 'tests/b.test.ts': 3, 'tests/c.test.ts': 4 });
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as { files: number };
    expect(prov.files).toBe(3);
    expect(Object.keys(merged).filter((k) => k !== '__provenance')).toHaveLength(3);
  });
});

describe('unionTables: the machine-readable carried map (Phase 18)', () => {
  it('attributes every older-only row to the older harvest and keeps the identity', () => {
    const ours = table('100', { 'tests/only_ours.test.ts': 77, 'tests/shared.test.ts': 10 });
    const theirs = table('200', { 'tests/shared.test.ts': 12 });
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as {
      files: number;
      harvestedFiles: number;
      carried: Record<string, { ms: number; method: string; run?: string; measured?: string }>;
    };
    expect(prov.harvestedFiles).toBe(1);
    expect(prov.files).toBe(2);
    expect(prov.carried).toEqual({
      'tests/only_ours.test.ts': {
        ms: 77,
        method: 'union-older-harvest',
        run: '100',
        measured: '2026-08-10',
      },
    });
  });

  it("carries the older table's OWN attribution forward instead of re-attributing it", () => {
    const ours = table(
      '100',
      { 'tests/local.test.ts': 9, 'tests/shared.test.ts': 10 },
      {
        harvestedFiles: 1,
        carried: {
          'tests/local.test.ts': {
            ms: 9,
            method: 'local-median',
            measured: '2026-08-20',
            runs: [9, 9, 11],
          },
        },
      },
    );
    const theirs = table('200', { 'tests/shared.test.ts': 12 });
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as {
      harvestedFiles: number;
      carried: Record<string, { method: string; runs?: number[] }>;
    };
    expect(prov.carried['tests/local.test.ts'].method).toBe('local-median');
    expect(prov.carried['tests/local.test.ts'].runs).toEqual([9, 9, 11]);
    expect(prov.harvestedFiles).toBe(1);
  });

  it("keeps the NEWER table's carried attributions on its own rows, and the backfill note travels", () => {
    const ours = table('100', { 'tests/shared.test.ts': 10 });
    const theirs = table(
      '200',
      { 'tests/bf.test.ts': 4, 'tests/shared.test.ts': 12 },
      {
        harvestedFiles: 1,
        carried: { 'tests/bf.test.ts': { ms: 4, method: 'prose-backfill' } },
        backfill: { date: '2026-08-31', note: 'attributed from the localMerge prose' },
      },
    );
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as {
      harvestedFiles: number;
      carried: Record<string, { method: string }>;
      backfill?: { date: string; note: string };
    };
    expect(prov.carried['tests/bf.test.ts'].method).toBe('prose-backfill');
    expect(prov.harvestedFiles).toBe(1);
    expect(prov.backfill?.note).toContain('localMerge prose');
    // And the merged table passes the same defect check the committed-table pin runs.
    expect(carriedDefects(merged, { requireMap: true })).toEqual([]);
  });
});

describe('unionTables: provenance honesty', () => {
  it("carries the older table's OWN disclosure forward verbatim", () => {
    // The review-round fix: collapsing the carried rows to "run <older run>"
    // was FALSE for 27 of the absorb's 28 (they were local measurements the
    // older table disclosed as such), and it erased that disclosure one union
    // at a time until locally measured weights read as CI-harvested.
    const disclosure = '2026-08-19 local measurement, not a CI harvest';
    const ours = table('100', { 'tests/only_ours.test.ts': 5 }, { localMerge: disclosure });
    const theirs = table('200', { 'tests/shared.test.ts': 6 });
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as { localMerge: string; run: string };
    expect(prov.localMerge).toContain(disclosure);
    // And the merged run id is the NEWER harvest's, not the older one's.
    expect(prov.run).toBe('200');
  });

  it('says plainly when neither table had a disclosure of its own', () => {
    const ours = table('100', { 'tests/only_ours.test.ts': 5 });
    const theirs = table('200', { 'tests/shared.test.ts': 6 });
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as { localMerge: string };
    expect(prov.localMerge).toContain('CI harvest');
    expect(prov.localMerge).not.toContain('whose own provenance reads');
  });

  it("carries the NEWER table's disclosure too, never calling a union a CI harvest", () => {
    // The mirror of the arm above. The newer side used to be a hard-coded "the
    // newer CI harvest", which is exactly the laundering the review round fixed
    // on the older side. It matters now: the table 11d produced is itself a
    // union carrying 28 rows, 27 of them locally measured, and it is a parent
    // from here on.
    const disclosure = 'KEY UNION of two harvests; 28 carried, 27 locally measured';
    const ours = table('100', { 'tests/only_ours.test.ts': 5 });
    const theirs = table('200', { 'tests/shared.test.ts': 6 }, { localMerge: disclosure });
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as { localMerge: string };
    expect(prov.localMerge).toContain(disclosure);
    expect(prov.localMerge).toContain('the newer table (run 200');
    expect(prov.localMerge).not.toContain('the newer CI harvest');
  });
});
