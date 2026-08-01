// Pure record/compare/report logic for the graphics-preset performance baseline
// harness (scripts/perf_baseline.mjs). Side-effect-free so the Vitest suite
// (tests/perf_baseline_store.test.mjs) pins every verdict arm; the entry script
// stays a thin orchestrator per scripts/CLAUDE.md. Verdict philosophy follows
// scripts/lib/bench_gate.mjs: missing or non-finite evidence FAILS the gate, it
// never slides through a numeric comparison the way NaN slides through `<`.
//
// What the verdict gates, stated exactly: per-scenario mean FPS (the primary
// metric) and GPU utilization (a true per-window sample from macmon), plus the
// comparability flags (viewport, renderer tier drift, governor engagement).
// cpuPct is recorded and shown but ADVISORY only: macOS `ps pcpu` is a decaying
// average over up to a minute, not a per-window sample, so gating it would
// punish scenario order, not cost. 1% lows / p95 / jank are recorded for humans
// and agents to read but not gated: their run-to-run variance on a live desktop
// is far above any honest tolerance.

// The fixed scenario labels of the bench suite in scripts/perf_baseline.mjs.
// History rows and baseline comparisons key on these strings: editing one
// silently forks the history, so the test suite pins this list AND that the
// harness source uses exactly these labels.
export const SUITE_LABELS = ['town-idle', 'town-look', 'open-run', 'east-run', 'combat-vfx'];

const round = (v, d = 1) => {
  if (!Number.isFinite(v)) return 0;
  const m = 10 ** d;
  return Math.round(v * m) / m;
};

// Sum the %cpu of a process tree from `ps -Ao pid=,ppid=,pcpu=` output. Counts the
// root pid plus every descendant so a multi-process browser (renderer, GPU and
// utility processes) reads as one number. macOS pcpu is per-core, so the sum can
// exceed 100 on a multicore machine. Returns null when the root pid is absent
// (browser exited): the caller must treat that as a missing sample, not zero.
export function sumProcessTreeCpu(psText, rootPid) {
  const kids = new Map();
  const cpu = new Map();
  for (const line of String(psText ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const pcpu = Number(parts[2]);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(pcpu)) continue;
    cpu.set(pid, pcpu);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const root = Number(rootPid);
  if (!cpu.has(root)) return null;
  let total = 0;
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += cpu.get(pid) ?? 0;
    for (const k of kids.get(pid) ?? []) stack.push(k);
  }
  return round(total, 1);
}

// Fold timestamped system samples that fall inside [t0, t1] into avg/max per
// metric. Points may carry any subset of the metrics (macmon and the ps poller
// run on independent clocks); a metric with no in-window points reports null so
// the compare layer can treat it as advisory rather than gating on absence.
export function aggregateSystemWindow(points, t0, t1) {
  const inWindow = (points ?? []).filter((p) => p && p.t >= t0 && p.t <= t1);
  const fold = (key) => {
    const vals = inWindow.map((p) => p[key]).filter((v) => Number.isFinite(v));
    if (!vals.length) return null;
    return {
      avg: round(vals.reduce((a, b) => a + b, 0) / vals.length, 1),
      max: round(Math.max(...vals), 1),
      n: vals.length,
    };
  };
  return {
    cpuPct: fold('cpuPct'),
    gpuPct: fold('gpuPct'),
    gpuPowerW: fold('gpuPowerW'),
    procCpuPct: fold('procCpuPct'),
  };
}

// Reduce one Profiler sample (scripts/profiler/harness.mjs sample() shape) plus
// its aggregated system window into the compact per-scenario record history and
// comparisons key on. fpsMean (from the raw per-frame collector, vsync off) is
// the primary metric of the whole harness; cpuPct is the browser process tree,
// cpuSysPct / gpuPct are whole-system readings from macmon.
export function summarizeScenario(sample, sys) {
  const f = sample?.frame ?? {};
  const sc = sample?.scene ?? {};
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    label: sample?.label ?? 'unknown',
    tier: sample?.tier ?? '',
    autoGovernor: sample?.autoGovernor ?? null,
    budgetMode: sample?.budgetMode ?? '',
    fpsMean: num(f.fpsMean),
    fpsLow1: num(f.fpsLow1),
    p95Ms: num(f.p95Ms),
    maxMs: num(f.maxMs),
    jankPct: num(f.jankPct),
    calls: num(sc.render?.calls ?? sample?.calls),
    triangles: num(sc.render?.triangles ?? sample?.triangles),
    cpuPct: num(sys?.procCpuPct?.avg),
    cpuSysPct: num(sys?.cpuPct?.avg),
    gpuPct: num(sys?.gpuPct?.avg),
    gpuPowerW: num(sys?.gpuPowerW?.avg),
  };
}

const mean = (vals) =>
  vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) : null;

// Assemble the persisted run record: metadata plus per-scenario rows plus the
// overall roll-up the history table prints. Scenario labels are the comparison
// key, so the suite in scripts/perf_baseline.mjs must keep them stable.
// Comparability flags are computed HERE (testably), never in the orchestrator:
// tierMismatch means the renderer resolved a different tier than the requested
// preset; governorEngaged means the adaptive render governor was armed during a
// sample, which sheds visual density under load and makes the FPS dishonest.
export function makeRunRecord(meta, scenarios) {
  const rows = scenarios ?? [];
  const fps = rows.map((s) => s.fpsMean).filter(Number.isFinite);
  const low1 = rows.map((s) => s.fpsLow1).filter(Number.isFinite);
  const cpu = rows.map((s) => s.cpuPct).filter(Number.isFinite);
  const gpu = rows.map((s) => s.gpuPct).filter(Number.isFinite);
  const flags = {
    tierMismatch: rows.some((s) => s.tier && meta.preset && s.tier !== meta.preset),
    governorEngaged: rows.some((s) => s.autoGovernor === true),
  };
  return {
    flags,
    v: 1,
    at: meta.at,
    commit: meta.commit ?? null,
    branch: meta.branch ?? null,
    dirty: meta.dirty ?? null,
    preset: meta.preset,
    note: meta.note ?? '',
    machine: meta.machine ?? '',
    sampleMs: meta.sampleMs ?? null,
    viewport: meta.viewport ?? '',
    scenarios: rows,
    overall: {
      fpsMean: mean(fps),
      fpsMin: fps.length ? round(Math.min(...fps), 1) : null,
      fpsLow1Min: low1.length ? round(Math.min(...low1), 1) : null,
      cpuPct: mean(cpu),
      gpuPct: mean(gpu),
    },
  };
}

// Comparability preconditions for judging one run against another. Any hit is a
// gate failure: numbers from a mismatched viewport, a drifted renderer tier, or
// a governor-shed scene do not answer the question the comparison asks.
export function comparabilityIssues(baseline, candidate) {
  const issues = [];
  if (baseline?.viewport && candidate?.viewport && baseline.viewport !== candidate.viewport) {
    issues.push(
      `viewport mismatch (baseline ${baseline.viewport} vs candidate ${candidate.viewport}); re-record the baseline`,
    );
  }
  for (const [name, rec] of [
    ['baseline', baseline],
    ['candidate', candidate],
  ]) {
    if (rec?.flags?.tierMismatch) {
      issues.push(`${name}: renderer tier drifted from the requested preset; run is invalid`);
    }
    if (rec?.flags?.governorEngaged) {
      issues.push(
        `${name}: adaptive render governor was armed during sampling; density-shed FPS is dishonest`,
      );
    }
  }
  return issues;
}

// Judge a candidate run against a baseline run, scenario by scenario. Passes only
// when comparability holds (see comparabilityIssues) and EVERY baseline scenario
// exists in the candidate with a finite fpsMean at or above
// baseline * (1 - fpsTolerancePct/100). GPU gates the other way (at or below
// baseline * (1 + sysTolerancePct/100)) and only when BOTH sides carry the
// metric: a machine without macmon must not fail runs on absent GPU data.
// cpuPct rows are shown but advisory (see the header for why).
export function compareRuns(baseline, candidate, opts = {}) {
  const fpsTol = opts.fpsTolerancePct ?? 3;
  const sysTol = opts.sysTolerancePct ?? 15;
  const rows = [];
  const failures = [...comparabilityIssues(baseline, candidate)];
  const baseRows = baseline?.scenarios ?? [];
  const candByLabel = new Map((candidate?.scenarios ?? []).map((s) => [s.label, s]));
  if (!baseRows.length) {
    failures.push('baseline has no scenarios; record one with the baseline subcommand');
  }
  for (const base of baseRows) {
    const cand = candByLabel.get(base.label);
    if (!cand) {
      failures.push(`${base.label}: scenario missing from candidate run`);
      continue;
    }
    if (!Number.isFinite(base.fpsMean) || !Number.isFinite(cand.fpsMean)) {
      failures.push(`${base.label}: fpsMean missing or non-finite; missing evidence fails`);
    } else if (!(base.fpsMean > 0)) {
      failures.push(
        `${base.label}: baseline fpsMean ${base.fpsMean} is not positive; a zero baseline gates nothing`,
      );
    } else {
      const floor = round(base.fpsMean * (1 - fpsTol / 100), 2);
      const ok = cand.fpsMean >= floor;
      rows.push({
        scenario: base.label,
        metric: 'fpsMean',
        base: base.fpsMean,
        cand: cand.fpsMean,
        deltaPct:
          base.fpsMean !== 0 ? round((100 * (cand.fpsMean - base.fpsMean)) / base.fpsMean, 1) : 0,
        bound: floor,
        ok,
      });
      if (!ok) {
        failures.push(
          `${base.label}: fpsMean ${cand.fpsMean} below baseline ${base.fpsMean} (floor ${floor} at ${fpsTol}% tolerance)`,
        );
      }
    }
    for (const [key, gated] of [
      ['cpuPct', false],
      ['gpuPct', true],
    ]) {
      if (!Number.isFinite(base[key]) || !Number.isFinite(cand[key])) continue;
      const ceiling = round(base[key] * (1 + sysTol / 100), 2);
      const ok = cand[key] <= ceiling;
      rows.push({
        scenario: base.label,
        metric: key,
        base: base[key],
        cand: cand[key],
        deltaPct: base[key] !== 0 ? round((100 * (cand[key] - base[key])) / base[key], 1) : 0,
        bound: ceiling,
        ok,
        advisory: !gated,
      });
      if (gated && !ok) {
        failures.push(
          `${base.label}: ${key} ${cand[key]} above baseline ${base[key]} (ceiling ${ceiling} at ${sysTol}% tolerance)`,
        );
      }
    }
  }
  return {
    ok: failures.length === 0,
    rows,
    failures,
    fpsTolerancePct: fpsTol,
    sysTolerancePct: sysTol,
  };
}

const pad = (v, w) => String(v ?? '-').padStart(w);

// Render a compareRuns result as printable lines.
export function formatCompare(cmp, baselineLabel, candidateLabel) {
  const lines = [];
  lines.push(`comparison: ${candidateLabel} vs baseline ${baselineLabel}`);
  lines.push(
    `${'scenario'.padEnd(12)} ${'metric'.padEnd(8)} ${pad('base', 8)} ${pad('cand', 8)} ${pad('delta%', 8)} ${pad('bound', 8)}  verdict`,
  );
  for (const r of cmp.rows) {
    const verdict = r.advisory ? (r.ok ? 'ok (adv)' : 'over (adv)') : r.ok ? 'ok' : 'FAIL';
    lines.push(
      `${r.scenario.padEnd(12)} ${r.metric.padEnd(8)} ${pad(r.base, 8)} ${pad(r.cand, 8)} ${pad(r.deltaPct, 8)} ${pad(r.bound, 8)}  ${verdict}`,
    );
  }
  for (const f of cmp.failures) lines.push(`FAIL: ${f}`);
  lines.push(
    cmp.ok
      ? `PASS: candidate meets the baseline (fps tolerance ${cmp.fpsTolerancePct}%, system tolerance ${cmp.sysTolerancePct}%)`
      : `FAIL: ${cmp.failures.length} check(s) below the baseline`,
  );
  return lines;
}

// Parse a history JSONL file's text. Corrupt lines are counted, never fatal: an
// interrupted append must not brick the report subcommand.
export function parseHistoryJsonl(text) {
  const records = [];
  let skipped = 0;
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec && typeof rec === 'object' && rec.preset) records.push(rec);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

// Render history records as a fixed-width table, oldest first: the change of
// performance over time, one row per recorded run.
export function historyTable(records) {
  const lines = [];
  lines.push(
    `${'when'.padEnd(17)} ${'commit'.padEnd(13)} ${'preset'.padEnd(7)} ${pad('fps', 7)} ${pad('minFps', 7)} ${pad('1%low', 7)} ${pad('cpu%', 7)} ${pad('gpu%', 7)}  note`,
  );
  for (const r of records ?? []) {
    const o = r.overall ?? {};
    const when = String(r.at ?? '')
      .replace('T', ' ')
      .slice(0, 16);
    const commit = `${String(r.commit ?? '-').slice(0, 12)}${r.dirty ? '*' : ''}`;
    lines.push(
      `${when.padEnd(17)} ${commit.padEnd(13)} ${String(r.preset).padEnd(7)} ${pad(o.fpsMean, 7)} ${pad(o.fpsMin, 7)} ${pad(o.fpsLow1Min, 7)} ${pad(o.cpuPct, 7)} ${pad(o.gpuPct, 7)}  ${r.note ?? ''}`,
    );
  }
  return lines;
}

export const perfBaselineStoreInternals = { round, mean };
