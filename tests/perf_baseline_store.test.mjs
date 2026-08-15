import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aggregateSystemWindow,
  comparabilityIssues,
  compareRuns,
  formatCompare,
  historyTable,
  makeRunRecord,
  parseHistoryJsonl,
  SUITE_LABELS,
  summarizeScenario,
  sumProcessTreeCpu,
} from '../scripts/lib/perf_baseline_store.mjs';

// tier deliberately blank: a blank tier is exempt from the tierMismatch flag,
// so the compare tests exercise fps/gpu arms without tripping comparability;
// the flag tests set tier explicitly.
const scenario = (label, over = {}) => ({
  label,
  tier: '',
  autoGovernor: false,
  fpsMean: 100,
  fpsLow1: 60,
  p95Ms: 12,
  maxMs: 30,
  jankPct: 1,
  calls: 500,
  triangles: 1000000,
  cpuPct: 80,
  cpuSysPct: 30,
  gpuPct: 40,
  gpuPowerW: 5,
  ...over,
});

const record = (preset, scenarios) =>
  makeRunRecord({ at: '2026-07-30T00:00:00.000Z', preset, commit: 'abc123def456' }, scenarios);

describe('sumProcessTreeCpu', () => {
  const ps = ['100 1 2.0', '200 100 50.5', '201 200 25.0', '300 1 99.0', 'garbage line'].join('\n');

  it('sums the root and every descendant, excluding unrelated processes', () => {
    expect(sumProcessTreeCpu(ps, 100)).toBe(77.5);
  });

  it('returns null when the root pid is not present (missing evidence, not zero)', () => {
    expect(sumProcessTreeCpu(ps, 999)).toBeNull();
    expect(sumProcessTreeCpu('', 100)).toBeNull();
  });
});

describe('aggregateSystemWindow', () => {
  it('folds only in-window points and reports avg, max and count per metric', () => {
    const pts = [
      { t: 10, cpuPct: 10, gpuPct: 20 },
      { t: 20, cpuPct: 30 },
      { t: 20, procCpuPct: 120 },
      { t: 99, cpuPct: 999 },
    ];
    const w = aggregateSystemWindow(pts, 10, 20);
    expect(w.cpuPct).toEqual({ avg: 20, max: 30, n: 2 });
    expect(w.gpuPct).toEqual({ avg: 20, max: 20, n: 1 });
    expect(w.procCpuPct).toEqual({ avg: 120, max: 120, n: 1 });
  });

  it('reports null for a metric with no in-window points', () => {
    const w = aggregateSystemWindow([{ t: 5, cpuPct: 10 }], 100, 200);
    expect(w.cpuPct).toBeNull();
    expect(w.gpuPct).toBeNull();
  });
});

describe('summarizeScenario', () => {
  it('reduces a Profiler sample plus system window to the compact record', () => {
    const s = summarizeScenario(
      {
        label: 'town-idle',
        tier: 'insane',
        autoGovernor: false,
        frame: { fpsMean: 88.5, fpsLow1: 41.2, p95Ms: 14.1, maxMs: 55, jankPct: 2.5 },
        scene: { render: { calls: 900, triangles: 2500000 } },
      },
      {
        cpuPct: { avg: 33, max: 40, n: 5 },
        gpuPct: { avg: 71, max: 90, n: 5 },
        gpuPowerW: { avg: 8, max: 9, n: 5 },
        procCpuPct: { avg: 140, max: 180, n: 6 },
      },
    );
    expect(s).toMatchObject({
      label: 'town-idle',
      tier: 'insane',
      fpsMean: 88.5,
      fpsLow1: 41.2,
      calls: 900,
      triangles: 2500000,
      cpuPct: 140,
      cpuSysPct: 33,
      gpuPct: 71,
      gpuPowerW: 8,
    });
  });

  it('reports null, never NaN, for absent evidence', () => {
    const s = summarizeScenario({ label: 'x' }, null);
    expect(s.fpsMean).toBeNull();
    expect(s.cpuPct).toBeNull();
    expect(s.gpuPct).toBeNull();
  });
});

describe('makeRunRecord', () => {
  it('rolls scenarios up into overall mean and min values', () => {
    const rec = record('low', [
      scenario('a', { fpsMean: 100, fpsLow1: 50, cpuPct: 80, gpuPct: 40 }),
      scenario('b', { fpsMean: 60, fpsLow1: 30, cpuPct: 120, gpuPct: 60 }),
    ]);
    expect(rec.overall).toEqual({
      fpsMean: 80,
      fpsMin: 60,
      fpsLow1Min: 30,
      cpuPct: 100,
      gpuPct: 50,
    });
    expect(rec.preset).toBe('low');
    expect(rec.v).toBe(1);
  });

  it('reports null overall values for an empty run', () => {
    const rec = record('low', []);
    expect(rec.overall.fpsMean).toBeNull();
    expect(rec.overall.fpsMin).toBeNull();
  });

  it('passes run meta through and computes comparability flags', () => {
    const rec = makeRunRecord(
      {
        at: '2026-07-30T00:00:00.000Z',
        preset: 'insane',
        commit: 'abc',
        branch: 'feature/x',
        dirty: true,
        note: 'n',
        machine: 'm',
        sampleMs: 5000,
        viewport: '1280x720',
      },
      [scenario('a', { tier: 'insane' })],
    );
    expect(rec).toMatchObject({
      preset: 'insane',
      branch: 'feature/x',
      dirty: true,
      note: 'n',
      machine: 'm',
      sampleMs: 5000,
      viewport: '1280x720',
      flags: { tierMismatch: false, governorEngaged: false },
    });
    const drifted = makeRunRecord({ at: 'x', preset: 'insane' }, [scenario('a', { tier: 'low' })]);
    expect(drifted.flags.tierMismatch).toBe(true);
  });
});

describe('compareRuns', () => {
  const base = record('low', [scenario('a'), scenario('b', { fpsMean: 50 })]);

  it('passes when every scenario meets the fps floor and system ceilings', () => {
    const cand = record('insane', [scenario('a', { fpsMean: 99 }), scenario('b', { fpsMean: 50 })]);
    const cmp = compareRuns(base, cand);
    expect(cmp.ok).toBe(true);
    expect(cmp.failures).toEqual([]);
  });

  it('passes exactly at the tolerance floor', () => {
    const cand = record('insane', [
      scenario('a', { fpsMean: 97 }),
      scenario('b', { fpsMean: 48.5 }),
    ]);
    expect(compareRuns(base, cand, { fpsTolerancePct: 3 }).ok).toBe(true);
  });

  it('fails when any scenario fps drops below the floor', () => {
    const cand = record('insane', [
      scenario('a', { fpsMean: 96.9 }),
      scenario('b', { fpsMean: 50 }),
    ]);
    const cmp = compareRuns(base, cand, { fpsTolerancePct: 3 });
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join(' ')).toContain('a: fpsMean 96.9 below baseline 100');
  });

  it('fails when a baseline scenario is missing from the candidate', () => {
    const cand = record('insane', [scenario('a')]);
    const cmp = compareRuns(base, cand);
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join(' ')).toContain('b: scenario missing');
  });

  it('fails on non-finite fps instead of letting NaN pass a comparison', () => {
    const cand = record('insane', [
      scenario('a', { fpsMean: null }),
      scenario('b', { fpsMean: 50 }),
    ]);
    const cmp = compareRuns(base, cand);
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join(' ')).toContain('a: fpsMean missing or non-finite');
  });

  it('fails when gpu exceeds the ceiling, while cpu over the ceiling stays advisory', () => {
    const cand = record('insane', [
      scenario('a', { cpuPct: 80 * 2 }),
      scenario('b', { fpsMean: 50, gpuPct: 40 * 1.2 }),
    ]);
    const cmp = compareRuns(base, cand, { sysTolerancePct: 15 });
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.some((f) => f.includes('cpuPct'))).toBe(false);
    expect(cmp.failures.some((f) => f.includes('b: gpuPct'))).toBe(true);
    const cpuRow = cmp.rows.find((r) => r.scenario === 'a' && r.metric === 'cpuPct');
    expect(cpuRow.advisory).toBe(true);
    expect(cpuRow.ok).toBe(false);
    const gpuRow = cmp.rows.find((r) => r.scenario === 'b' && r.metric === 'gpuPct');
    expect(gpuRow.advisory).toBe(false);
  });

  it('fails on a non-positive baseline fpsMean instead of gating nothing', () => {
    const zeroBase = record('low', [scenario('a', { fpsMean: 0 })]);
    const cmp = compareRuns(zeroBase, record('insane', [scenario('a', { fpsMean: 1 })]));
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join(' ')).toContain('not positive');
  });

  it('fails when either side carries a comparability flag', () => {
    const cand = record('insane', [
      scenario('a', { tier: 'high' }),
      scenario('b', { fpsMean: 50 }),
    ]);
    const cmp = compareRuns(base, cand);
    expect(cand.flags.tierMismatch).toBe(true);
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join(' ')).toContain('tier drifted');

    const shed = record('insane', [
      scenario('a', { autoGovernor: true }),
      scenario('b', { fpsMean: 50 }),
    ]);
    expect(shed.flags.governorEngaged).toBe(true);
    const cmp2 = compareRuns(base, shed);
    expect(cmp2.ok).toBe(false);
    expect(cmp2.failures.join(' ')).toContain('governor was armed');
  });

  it('treats an absent system metric as advisory, never a failure', () => {
    const cand = record('insane', [
      scenario('a', { cpuPct: null, gpuPct: null }),
      scenario('b', { fpsMean: 50, cpuPct: null, gpuPct: null }),
    ]);
    const cmp = compareRuns(base, cand);
    expect(cmp.ok).toBe(true);
    expect(cmp.rows.filter((r) => r.metric !== 'fpsMean')).toEqual([]);
  });

  it('fails an empty baseline outright', () => {
    const cmp = compareRuns(record('low', []), record('insane', [scenario('a')]));
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join(' ')).toContain('baseline has no scenarios');
  });
});

describe('comparabilityIssues', () => {
  it('reports a viewport mismatch and clean runs report nothing', () => {
    const a = { ...record('low', [scenario('a')]), viewport: '1280x720' };
    const b = { ...record('insane', [scenario('a')]), viewport: '1920x1080' };
    expect(comparabilityIssues(a, b).join(' ')).toContain('viewport mismatch');
    expect(comparabilityIssues(a, { ...b, viewport: '1280x720' })).toEqual([]);
    expect(comparabilityIssues(a, { ...b, viewport: '' })).toEqual([]);
  });
});

describe('suite contract', () => {
  it('pins the scenario labels the whole history keys on', () => {
    expect(SUITE_LABELS).toEqual(['town-idle', 'town-look', 'open-run', 'east-run', 'combat-vfx']);
  });

  it('pins the default tolerances of the verdict', () => {
    const base = record('low', [scenario('a')]);
    const cmp = compareRuns(base, record('insane', [scenario('a')]));
    expect(cmp.fpsTolerancePct).toBe(3);
    expect(cmp.sysTolerancePct).toBe(15);
  });

  it('the harness builds its suite from SUITE_LABELS, never from forked literals', () => {
    const src = readFileSync(new URL('../scripts/perf_baseline.mjs', import.meta.url), 'utf8');
    expect(src).toContain('] = SUITE_LABELS');
    for (const label of SUITE_LABELS) {
      expect(src.includes(`'${label}'`)).toBe(false);
    }
  });
});

describe('formatCompare', () => {
  it('renders a verdict line that states pass or fail', () => {
    const base = record('low', [scenario('a')]);
    const pass = formatCompare(
      compareRuns(base, record('insane', [scenario('a')])),
      'low',
      'insane',
    );
    expect(pass.at(-1)).toContain('PASS');
    const fail = formatCompare(
      compareRuns(base, record('insane', [scenario('a', { fpsMean: 10 })])),
      'low',
      'insane',
    );
    expect(fail.at(-1)).toContain('FAIL');
  });
});

describe('parseHistoryJsonl and historyTable', () => {
  it('parses records, skips corrupt lines, and renders one table row per run', () => {
    const rec = record('insane', [scenario('a')]);
    const text = `${JSON.stringify(rec)}\nnot json\n\n${JSON.stringify(rec)}\n`;
    const { records, skipped } = parseHistoryJsonl(text);
    expect(records).toHaveLength(2);
    expect(skipped).toBe(1);
    const lines = historyTable(records);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('abc123def456');
    expect(lines[1]).toContain('insane');
    expect(lines[1]).toContain('100');
  });
});
