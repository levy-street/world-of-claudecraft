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
import { unionTables } from '../scripts/merge_audit/shard_weight_union.mjs';

const table = (run: string, rows: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ({
    __provenance: { run, harvested: '2026-08-18', files: Object.keys(rows).length, ...extra },
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
    // union carrying 27 locally measured rows, and it is a parent from here on.
    const disclosure = 'KEY UNION of two harvests; 27 rows locally measured';
    const ours = table('100', { 'tests/only_ours.test.ts': 5 });
    const theirs = table('200', { 'tests/shared.test.ts': 6 }, { localMerge: disclosure });
    const { merged } = unionTables(ours, theirs);
    const prov = merged.__provenance as { localMerge: string };
    expect(prov.localMerge).toContain(disclosure);
    expect(prov.localMerge).toContain('the newer table (run 200');
    expect(prov.localMerge).not.toContain('the newer CI harvest');
  });
});
