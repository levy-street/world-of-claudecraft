import { describe, expect, it } from 'vitest';
import {
  concentration,
  type LinkResult,
  median,
  pairedAblation,
  quantile,
  renderLinkBenchReport,
  summarizePrograms,
} from '../scripts/lib/shader_link_bench_report.mjs';

function result(hash: string, timings: number[], ok = true): LinkResult {
  return {
    hash,
    name: `mat-${hash}`,
    kind: 'STANDARD',
    firstStep: 'boot',
    profiles: ['ultra'],
    runs: timings.map((ms) => ({ ms, ok })),
  };
}

describe('shader link bench report', () => {
  it('computes median and quantile on unsorted input', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(quantile([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0.9)).toBe(10);
  });

  it('keeps the first link apart and ranks on the median of the repeats', () => {
    const { rows } = summarizePrograms([
      result('a', [900, 100, 120]),
      result('b', [300, 250, 270]),
    ]);
    // b is dearer once the one-off first link is set aside, so it ranks first.
    expect(rows.map((r) => r.hash)).toEqual(['b', 'a']);
    expect(rows[1]).toMatchObject({ firstMs: 900, repeatMs: 110, costMs: 110 });
  });

  it('falls back to the first link when there is a single repetition', () => {
    const { rows } = summarizePrograms([result('a', [420])]);
    expect(rows[0]).toMatchObject({ firstMs: 420, repeatMs: 420, costMs: 420 });
  });

  it('reports a program with any failed link as a failure, never as a cheap row', () => {
    const failing = result('bad', [1, 1, 1], false);
    const { rows, failures } = summarizePrograms([result('a', [10, 10]), failing]);
    expect(rows.map((r) => r.hash)).toEqual(['a']);
    expect(failures.map((f) => f.hash)).toEqual(['bad']);
  });

  it('tells a flat corpus from a fat tail', () => {
    const flat = summarizePrograms(
      Array.from({ length: 100 }, (_, i) => result(`f${i}`, [50, 50, 50])),
    ).rows;
    const flatC = concentration(flat);
    expect(flatC.tailRatio).toBeCloseTo(1, 5);
    expect(flatC.top10Share).toBeCloseTo(0.1, 5);
    expect(flatC.top10FlatShare).toBeCloseTo(0.1, 5);

    const tailed = summarizePrograms([
      ...Array.from({ length: 90 }, (_, i) => result(`c${i}`, [20, 20, 20])),
      ...Array.from({ length: 10 }, (_, i) => result(`x${i}`, [2000, 2000, 2000])),
    ]).rows;
    const tailedC = concentration(tailed);
    expect(tailedC.top10Share).toBeGreaterThan(0.9);
    expect(tailedC.tailRatio).toBe(100);
    expect(tailedC.medianMs).toBe(20);
    expect(tailedC.maxMs).toBe(2000);
  });

  it('renders the ranking with the dearest program on top', () => {
    const report = renderLinkBenchReport({
      results: [result('cheap', [5, 5, 5]), result('dear', [800, 700, 700])],
      machine: { renderer: 'ANGLE (Test GPU Direct3D11)' },
      browser: 'Chrome/1',
      angle: 'd3d11',
      reps: 3,
      seconds: 1,
      corpus: { gitSha: 'abc', programCount: 2 },
    });
    expect(report).toContain('ANGLE (Test GPU Direct3D11)');
    expect(report.indexOf('| 1 | 700.0 |')).toBeGreaterThan(0);
    expect(report.indexOf('dear')).toBeLessThan(report.indexOf('cheap'));
  });

  it('pairs each ablation variant with the baseline of the same program', () => {
    const variant = (base: string, name: string, group: string, timings: number[]) => ({
      ...result(`${base}-${name}`, timings),
      base,
      variant: name,
      group,
    });
    const { rows } = summarizePrograms([
      variant('p1', 'baseline', 'worn', [500, 500, 500]),
      variant('p1', 'worn-flat', 'worn', [300, 300, 300]),
      variant('p2', 'baseline', 'worn', [900, 900, 900]),
      variant('p2', 'worn-flat', 'worn', [800, 800, 800]),
      // No baseline for p3: it must not be paired with someone else's.
      variant('p3', 'worn-flat', 'worn', [1, 1, 1]),
    ]);
    const [flat] = pairedAblation(rows);
    expect(flat).toMatchObject({ variant: 'worn-flat', group: 'worn', pairs: 2 });
    // Savings are per program (200 and 100), not a difference of medians.
    expect(flat.savedMedianMs).toBe(150);
    expect(flat.savedMinMs).toBe(100);
    expect(flat.savedMaxMs).toBe(200);
  });

  it('shows unequal repetitions and the draw cost a link-only figure would hide', () => {
    const deferred = (hash: string): LinkResult => ({
      hash,
      name: hash,
      kind: 'STANDARD',
      runs: [
        { ms: 8, ok: true, drawMs: 40, drawError: 0 },
        { ms: 92, ok: true, drawMs: 42, drawError: 0 },
        { ms: 8, ok: true, drawMs: 44, drawError: 1280 },
      ],
    });
    const { rows } = summarizePrograms([deferred('a'), deferred('b')]);
    expect(rows[0].linkMsByRep).toEqual([8, 92, 8]);
    expect(rows[0]).toMatchObject({ firstDrawMs: 40, drawMedianMs: 42, drawErrors: 1 });
    const report = renderLinkBenchReport({ results: [deferred('a'), deferred('b')], reps: 3 });
    expect(report).toContain('| 1 | 184.0 | 92.0 |');
    expect(report).toContain('## First draw after the link');
    expect(report).toContain('| STANDARD | 2 | 50.0 | 42.0 | 184.0 | 2 |');
  });

  it('leaves the draw section out of a link-only run', () => {
    const report = renderLinkBenchReport({ results: [result('a', [5, 5, 5])], reps: 3 });
    expect(report).not.toContain('## First draw after the link');
  });
});
