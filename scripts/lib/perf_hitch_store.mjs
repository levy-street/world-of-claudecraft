// Pure record, calibration, gate, and report logic for the frozen hitch referee.
// Browser and server orchestration stays in scripts/perf_hitch.mjs and its I/O helpers.

import { estimateHeapFloorGrowthMb } from './perf_hitch_soak.mjs';

export const SCENARIO_SPECS = Object.freeze({
  'cold-zone-entry': Object.freeze({ mode: 'offline', warmupMs: 3000, measureMs: 12_000 }),
  'crowd-influx': Object.freeze({ mode: 'online', warmupMs: 3000, measureMs: 18_000 }),
  'cosmetic-churn': Object.freeze({ mode: 'online', warmupMs: 5000, measureMs: 20_000 }),
  'sky-crossing': Object.freeze({ mode: 'offline', warmupMs: 3000, measureMs: 18_000 }),
  soak: Object.freeze({ mode: 'online', warmupMs: 15_000, measureMs: 600_000 }),
  'combat-vfx-burst': Object.freeze({ mode: 'offline', warmupMs: 3000, measureMs: 18_000 }),
});

export const SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIO_SPECS));
export const COMPILE_MISSION_SCENARIOS = Object.freeze(['crowd-influx', 'cosmetic-churn']);
export const MAX_PROGRAM_COMPILES = 0;
// Calibration detection floor for the compile-mission scenarios: each of the
// three same-build runs must link at least this many programs during boot and
// warmup (the collector's baseline key set). The crowd links hundreds of
// programs there on any build because every run uses a fresh profile with
// Chrome's shader caches disabled, so this floor only trips when the program
// instrumentation breaks or the scenario stops drawing. Post-warmup compiles
// are deliberately NOT a calibration requirement: they are the mission metric
// the fixed build drives to zero, and requiring them to stay nonzero would
// deadlock recalibration forever (the same deadlock already removed for long
// frames).
export const MIN_BASELINE_PROGRAM_COUNT = 10;
export const MAX_WORST_FRAME_MS = 100;
export const MAX_PAGE_ERRORS = 0;
export const MAX_SOAK_SETTLED_HEAP_RELATIVE_SPREAD = 0.35;

// Every gate metric has one of two named kinds. A MISSION metric compares
// against a frozen mission target (worst frame at or below 100 ms, zero
// post-warmup compiles, zero page errors) that the unfixed build is expected to
// fail; the before-build may legitimately straddle such a target across
// same-build calibration runs (a GC pause lands inside the measured window in
// some runs and not others), so a straddling mission verdict never invalidates
// calibration and is recorded in gate.missionStraddles instead. A CALIBRATED
// metric compares against a bound derived from the three same-build calibration
// runs themselves, so a flapping calibrated verdict means the calibration is
// invalid. Both kinds stay fully enforced in every gate compare.
export const HITCH_METRIC_KINDS = Object.freeze({
  longFrames: 'calibrated',
  allocationRateMbPerSec: 'calibrated',
  settledHeapDeltaMb: 'calibrated',
  programCompiles: 'mission',
  worstFrameMs: 'mission',
  pageErrorCount: 'mission',
});

const round = (value, places = 2) => {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const finite = (value) => (Number.isFinite(value) ? value : null);

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return round(sorted[index]);
}

function positiveGrowth(frames, key) {
  if (!frames.length) return null;
  const first = finite(frames[0]?.[key]);
  if (first === null) return null;
  let peak = first;
  for (const frame of frames) {
    const value = finite(frame?.[key]);
    if (value !== null) peak = Math.max(peak, value);
  }
  return round(Math.max(0, peak - first));
}

function completePostWarmupFrames(frames, warmupMs) {
  return (frames ?? []).filter((frame) => {
    const atMs = finite(frame?.atMs);
    const dtMs = finite(frame?.dtMs);
    return atMs !== null && dtMs !== null && atMs - dtMs >= warmupMs - 0.5;
  });
}

export function summarizeScenario(raw) {
  const name = raw?.name;
  const spec = SCENARIO_SPECS[name];
  if (!spec) throw new Error(`unknown hitch scenario: ${name ?? 'missing'}`);
  const warmupMs = finite(raw.warmupMs) ?? spec.warmupMs;
  const frames = Array.isArray(raw.frames) ? raw.frames : [];
  const post = completePostWarmupFrames(frames, finite(raw.warmupBoundaryMs) ?? warmupMs);
  const frameTimes = post.map((frame) => finite(frame.dtMs)).filter((value) => value !== null);
  const budgets = post.map((frame) => frame.renderBudget).filter(Boolean);
  const submitStallFrames = budgets.filter(
    (budget) => budget.reason === 'submit-stall' || Number(budget.recentSubmitStalls) > 0,
  ).length;
  const maxSubmitStallMs = budgets.reduce(
    (max, budget) => Math.max(max, finite(budget.lastSubmitStallMs) ?? 0),
    0,
  );
  const report = raw.report ?? {};
  const renderer = report.renderer ?? {};
  const heapSawtooth = report.heapSawtooth ?? null;
  const heapFloorSeries = raw.heapFloorSeries ?? null;
  const newProgramKeys = Array.isArray(raw.newProgramKeys) ? new Set(raw.newProgramKeys) : null;
  const baselineProgramKeys = Array.isArray(raw.baselineProgramKeys)
    ? new Set(raw.baselineProgramKeys)
    : null;
  return {
    name,
    warmupMs,
    measureMs: finite(raw.measureMs) ?? spec.measureMs,
    frames: frames.length,
    postWarmupFrames: post.length,
    longFrames: frameTimes.filter((ms) => ms >= 50).length,
    worstFrameMs: frameTimes.length ? round(Math.max(...frameTimes)) : null,
    p99FrameMs: percentile(frameTimes, 0.99),
    programCompiles: newProgramKeys !== null ? newProgramKeys.size : null,
    baselineProgramCount: baselineProgramKeys !== null ? baselineProgramKeys.size : null,
    texturesCreated:
      finite(raw.counterBaseline?.textures) !== null && finite(raw.counterPeaks?.textures) !== null
        ? round(Math.max(0, raw.counterPeaks.textures - raw.counterBaseline.textures))
        : positiveGrowth(post, 'textures'),
    pooledVisualsCreated:
      finite(raw.counterBaseline?.pooledVisuals) !== null &&
      finite(raw.counterPeaks?.pooledVisuals) !== null
        ? round(Math.max(0, raw.counterPeaks.pooledVisuals - raw.counterBaseline.pooledVisuals))
        : positiveGrowth(post, 'pooledVisuals'),
    submitStallLatched: submitStallFrames > 0,
    submitStallFrames,
    maxSubmitStallMs: round(maxSubmitStallMs),
    settledHeapDeltaMb: finite(raw.settledHeap?.deltaMb),
    heapFloorGrowthMb: estimateHeapFloorGrowthMb(heapFloorSeries),
    allocationRateMbPerSec: finite(heapSawtooth?.allocRateMbPerSec),
    pageErrorCount: Array.isArray(raw.pageErrors) ? raw.pageErrors.length : null,
    heapSawtooth,
    tier: typeof renderer.tier === 'string' ? renderer.tier : '',
    autoGovernor: renderer.autoGovernor === true,
    contextLost: finite(renderer.contextLost),
    glRenderer: typeof renderer.glRenderer === 'string' ? renderer.glRenderer : '',
  };
}

export function makeRunRecord(meta, scenarios) {
  const rows = Array.isArray(scenarios) ? scenarios : [];
  const longFrames = rows.map((row) => finite(row.longFrames)).filter((value) => value !== null);
  const worstFrames = rows.map((row) => finite(row.worstFrameMs)).filter((value) => value !== null);
  const programCompiles = rows
    .map((row) => finite(row.programCompiles))
    .filter((value) => value !== null);
  const allocationRates = rows
    .map((row) => finite(row.allocationRateMbPerSec))
    .filter((value) => value !== null);
  const pageErrorCounts = rows
    .map((row) => finite(row.pageErrorCount))
    .filter((value) => value !== null);
  const soak = rows.find((row) => row.name === 'soak');
  const browserFlags = Array.isArray(meta.browserFlags) ? [...meta.browserFlags] : [];
  const glRenderers = new Set(rows.map((row) => row.glRenderer).filter(Boolean));
  const glRenderer = glRenderers.size === 1 ? [...glRenderers][0] : '';
  const record = {
    kind: 'hitch-run',
    v: 1,
    at: meta.at,
    commit: meta.commit ?? null,
    buildId: meta.buildId ?? null,
    branch: meta.branch ?? null,
    dirty: meta.dirty ?? null,
    preset: meta.preset,
    note: meta.note ?? '',
    machine: meta.machine ?? '',
    viewport: meta.viewport ?? '',
    browserVersion: meta.browserVersion ?? '',
    browserFlags,
    glRenderer,
    freshProfile: meta.freshProfile === true,
    scenarios: rows,
    flags: {
      contextLost: rows.some((row) => Number(row.contextLost) > 0),
      tierMismatch: rows.some((row) => row.tier && row.tier !== meta.preset),
      governorDisabled: rows.some((row) => row.autoGovernor !== true),
      rendererInvalid: rows.some(
        (row) => !row.glRenderer || /swiftshader|software|llvmpipe/i.test(row.glRenderer),
      ),
      rendererDrift: glRenderers.size !== 1,
      staleProfile:
        meta.freshProfile !== true || !browserFlags.includes('--disable-gpu-shader-disk-cache'),
      pageErrors: rows.some((row) => Number(row.pageErrorCount) > 0),
    },
    overall: {
      longFrames: longFrames.reduce((sum, value) => sum + value, 0),
      worstFrameMs: worstFrames.length ? round(Math.max(...worstFrames)) : null,
      programCompiles: programCompiles.reduce((sum, value) => sum + value, 0),
      settledHeapDeltaMb: finite(soak?.settledHeapDeltaMb),
      heapFloorGrowthMb: finite(soak?.heapFloorGrowthMb),
      allocationRateMbPerSec: allocationRates.length ? round(Math.max(...allocationRates)) : null,
      pageErrorCount:
        pageErrorCounts.length === rows.length
          ? pageErrorCounts.reduce((sum, value) => sum + value, 0)
          : null,
    },
  };
  return record;
}

function metricValues(records, scenarioName, metric) {
  return records.map((record) => {
    const row = record.scenarios?.find((scenario) => scenario.name === scenarioName);
    const value = finite(row?.[metric]);
    if (value === null) {
      throw new Error(`${scenarioName}: ${metric} missing from calibration run`);
    }
    return value;
  });
}

function rangeOf(values) {
  return round(Math.max(...values) - Math.min(...values));
}

function calibratedBound(values) {
  const range = rangeOf(values);
  return round(Math.max(...values) + range);
}

function relativeSpread(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return mean > 0 ? (Math.max(...values) - Math.min(...values)) / mean : null;
}

function validateCalibrationRuns(records) {
  if (!Array.isArray(records) || records.length !== 3) {
    throw new Error('calibration requires exactly three same-build runs');
  }
  const first = records[0];
  for (const [index, record] of records.entries()) {
    if (record?.kind !== 'hitch-run')
      throw new Error(`calibration run ${index + 1} is not a hitch run`);
    for (const key of ['commit', 'buildId', 'preset', 'viewport', 'machine', 'browserVersion']) {
      if (record[key] !== first[key]) {
        throw new Error(`calibration ${key} mismatch between same-build runs`);
      }
    }
    if (record.freshProfile !== true || record.flags?.staleProfile) {
      throw new Error(`calibration run ${index + 1} did not use a fresh cache-disabled profile`);
    }
    if (
      record.flags?.contextLost ||
      record.flags?.tierMismatch ||
      record.flags?.governorDisabled ||
      record.flags?.rendererInvalid ||
      record.flags?.rendererDrift
    ) {
      throw new Error(`calibration run ${index + 1} has invalid renderer evidence`);
    }
    if (record.glRenderer !== first.glRenderer) {
      throw new Error('calibration glRenderer mismatch between same-build runs');
    }
    if (JSON.stringify(record.browserFlags) !== JSON.stringify(first.browserFlags)) {
      throw new Error('calibration browserFlags mismatch between same-build runs');
    }
    for (const name of SCENARIO_NAMES) {
      const row = record.scenarios?.find((scenario) => scenario.name === name);
      if (!row) throw new Error(`${name}: scenario missing from calibration run ${index + 1}`);
      if (!Number.isInteger(row.pageErrorCount) || row.pageErrorCount < 0) {
        throw new Error(
          `${name}: page error evidence is missing from calibration run ${index + 1}`,
        );
      }
      if (row.pageErrorCount > MAX_PAGE_ERRORS) {
        throw new Error(
          `${name}: calibration run ${index + 1} recorded ${row.pageErrorCount} page error(s)`,
        );
      }
      if (row.glRenderer !== record.glRenderer) {
        throw new Error(`${name}: glRenderer drifted within calibration run ${index + 1}`);
      }
      if (row.warmupMs !== SCENARIO_SPECS[name].warmupMs) {
        throw new Error(`${name}: calibration warmup drifted from the frozen suite`);
      }
      if (row.measureMs !== SCENARIO_SPECS[name].measureMs) {
        throw new Error(`${name}: calibration duration drifted from the frozen suite`);
      }
    }
  }
}

export function deriveCalibration(records) {
  validateCalibrationRuns(records);
  for (const name of COMPILE_MISSION_SCENARIOS) {
    // Detection proof: the warmup BASELINE program count shows the scenario
    // exercises first-draw work at all (the crowd links hundreds of programs
    // during boot and warmup regardless of how clean the live path is).
    // Post-warmup compiles and long frames are deliberately NOT detection
    // requirements here: the perf work drives both to zero on a healthy
    // build, so demanding brokenness would deadlock recalibration forever
    // (long frames hit this first, PR 3161; post-warmup compiles hit it once
    // the compile-storm fixes landed). Post-warmup compiles stay a mission
    // metric with a fixed zero target in every gate compare, and the
    // long-frame noise floor is still derived below and gates regressions.
    const baselineCounts = metricValues(records, name, 'baselineProgramCount');
    if (baselineCounts.some((value) => value < MIN_BASELINE_PROGRAM_COUNT)) {
      throw new Error(
        `${name}: warmup baseline program count ${Math.min(...baselineCounts)} is below ${MIN_BASELINE_PROGRAM_COUNT}; calibration cannot prove the scenario exercises first-draw work`,
      );
    }
  }
  const soakSettledHeap = metricValues(records, 'soak', 'settledHeapDeltaMb');
  // DELIBERATE (reviewed): unlike the removed compile requirement, this
  // positive-delta check stays. No mission targets driving the soak's settled
  // delta to zero (its gate bound is calibrated, not aspirational), and a
  // non-positive delta across a ten-minute cosmetic churn is far more likely
  // broken settle instrumentation than a healthy build, which is exactly what
  // calibration exists to refuse. Revisit only if a retention fix ever
  // legitimately flattens the soak, in which case this check, its tests, and
  // this comment move together.
  if (soakSettledHeap.some((value) => value <= 0)) {
    throw new Error('soak: calibration did not reproduce a positive settled heap delta');
  }
  const soakSettledHeapRelativeSpread = relativeSpread(soakSettledHeap);
  if (
    soakSettledHeapRelativeSpread === null ||
    soakSettledHeapRelativeSpread > MAX_SOAK_SETTLED_HEAP_RELATIVE_SPREAD
  ) {
    throw new Error(
      `soak: settled heap relative spread ${soakSettledHeapRelativeSpread ?? 'missing'} exceeds ${MAX_SOAK_SETTLED_HEAP_RELATIVE_SPREAD}`,
    );
  }

  const scenarios = {};
  for (const name of SCENARIO_NAMES) {
    const longFrames = metricValues(records, name, 'longFrames');
    const worstFrameMs = metricValues(records, name, 'worstFrameMs');
    const allocationRateMbPerSec = metricValues(records, name, 'allocationRateMbPerSec');
    const hasZeroLongFrameRun = longFrames.some((value) => value === 0);
    const allZeroLongFrames = longFrames.every((value) => value === 0);
    const longFrameNoiseFloor =
      allZeroLongFrames || !hasZeroLongFrameRun ? 0 : Math.max(...longFrames);
    const scenarioGate = {
      warmupMs: SCENARIO_SPECS[name].warmupMs,
      measureMs: SCENARIO_SPECS[name].measureMs,
      longFrames: {
        kind: HITCH_METRIC_KINDS.longFrames,
        samples: longFrames,
        observedRange: rangeOf(longFrames),
        noiseFloor: longFrameNoiseFloor,
      },
      worstFrameMs: {
        kind: HITCH_METRIC_KINDS.worstFrameMs,
        samples: worstFrameMs,
        target: MAX_WORST_FRAME_MS,
      },
      pageErrorCount: {
        kind: HITCH_METRIC_KINDS.pageErrorCount,
        samples: [0, 0, 0],
        target: MAX_PAGE_ERRORS,
      },
      allocationRateMbPerSec: {
        kind: HITCH_METRIC_KINDS.allocationRateMbPerSec,
        samples: allocationRateMbPerSec,
        observedRange: rangeOf(allocationRateMbPerSec),
        bound: calibratedBound(allocationRateMbPerSec),
      },
    };
    if (COMPILE_MISSION_SCENARIOS.includes(name)) {
      scenarioGate.programCompiles = {
        kind: HITCH_METRIC_KINDS.programCompiles,
        samples: metricValues(records, name, 'programCompiles'),
        target: MAX_PROGRAM_COMPILES,
      };
    }
    if (name === 'soak') {
      scenarioGate.settledHeapDeltaMb = {
        kind: HITCH_METRIC_KINDS.settledHeapDeltaMb,
        samples: soakSettledHeap,
        observedRange: rangeOf(soakSettledHeap),
        relativeSpread: round(soakSettledHeapRelativeSpread),
        bound: calibratedBound(soakSettledHeap),
      };
    }
    scenarios[name] = scenarioGate;
  }

  // A mission target the before-build straddles across the three runs is a fact
  // about the unfixed build, not a calibration defect: record it so the freeze
  // is honest about which mission verdicts were unstable at calibration time.
  const missionStraddles = [];
  for (const [name, scenarioGate] of Object.entries(scenarios)) {
    for (const [metric, entry] of Object.entries(scenarioGate)) {
      if (entry?.kind !== 'mission') continue;
      const verdicts = new Set(entry.samples.map((value) => value <= entry.target));
      if (verdicts.size > 1) {
        missionStraddles.push({
          scenario: name,
          metric,
          samples: [...entry.samples],
          target: entry.target,
        });
      }
    }
  }

  return {
    gate: {
      kind: 'hitch-gate',
      v: 1,
      frozen: true,
      calibratedAt: records[2].at,
      calibrationRuns: 3,
      commit: records[0].commit,
      calibrationBuildId: records[0].buildId,
      preset: records[0].preset,
      viewport: records[0].viewport,
      machine: records[0].machine,
      browserVersion: records[0].browserVersion,
      browserFlags: [...records[0].browserFlags],
      glRenderer: records[0].glRenderer,
      scenarios,
      mission: {
        maxProgramCompiles: MAX_PROGRAM_COMPILES,
        maxWorstFrameMs: MAX_WORST_FRAME_MS,
        maxPageErrors: MAX_PAGE_ERRORS,
        maxSoakSettledHeapRelativeSpread: MAX_SOAK_SETTLED_HEAP_RELATIVE_SPREAD,
      },
      missionStraddles,
    },
    before: records[2],
  };
}

function compareValue(rows, failures, scenario, metric, actual, bound) {
  const ok = Number.isFinite(actual) && Number.isFinite(bound) && actual <= bound;
  rows.push({
    scenario,
    metric,
    kind: HITCH_METRIC_KINDS[metric],
    actual: finite(actual),
    bound: finite(bound),
    ok,
  });
  if (!Number.isFinite(actual)) failures.push(`${scenario}: ${metric} missing or non-finite`);
  else if (!ok) failures.push(`${scenario}: ${metric} ${actual} above ${bound}`);
}

export function compareRunToGate(record, gate, opts = {}) {
  const rows = [];
  const failures = [];
  if (record?.kind !== 'hitch-run') failures.push('candidate is not a hitch run record');
  if (gate?.kind !== 'hitch-gate' || gate?.frozen !== true)
    failures.push('gate is missing or not frozen');
  for (const key of ['preset', 'viewport', 'machine', 'browserVersion', 'glRenderer']) {
    if (record?.[key] !== gate?.[key]) {
      failures.push(`${key} mismatch (gate ${gate?.[key] ?? '-'} vs run ${record?.[key] ?? '-'})`);
    }
  }
  if (record?.freshProfile !== true || record?.flags?.staleProfile) {
    failures.push(
      'run did not use a fresh temporary browser profile with the GPU shader cache disabled',
    );
  }
  if (record?.flags?.contextLost) failures.push('run lost a WebGL context');
  if (record?.flags?.tierMismatch) failures.push('renderer tier drifted from the requested preset');
  if (record?.flags?.governorDisabled) failures.push('adaptive render governor was disabled');
  if (record?.flags?.rendererInvalid) failures.push('run did not use a reported real GPU renderer');
  if (record?.flags?.rendererDrift) failures.push('GPU renderer drifted between scenarios');
  if (record?.flags?.pageErrors) failures.push('run recorded page errors');
  if (JSON.stringify(record?.browserFlags) !== JSON.stringify(gate?.browserFlags)) {
    failures.push('browser flags drifted from the frozen gate');
  }

  const names = opts.scenario ? [opts.scenario] : SCENARIO_NAMES;
  for (const name of names) {
    const scenarioGate = gate?.scenarios?.[name];
    const scenario = record?.scenarios?.find((row) => row.name === name);
    if (!scenarioGate) {
      failures.push(`${name}: scenario missing from gate`);
      continue;
    }
    if (!scenario) {
      failures.push(`${name}: scenario missing from candidate run`);
      continue;
    }
    if (scenario.glRenderer !== gate.glRenderer) {
      failures.push(`${name}: GPU renderer drifted from the frozen gate`);
    }
    if (
      scenario.warmupMs !== scenarioGate.warmupMs ||
      scenario.measureMs !== scenarioGate.measureMs
    ) {
      failures.push(`${name}: warmup or measurement duration drifted from the frozen gate`);
    }
    compareValue(
      rows,
      failures,
      name,
      'longFrames',
      scenario.longFrames,
      scenarioGate.longFrames.noiseFloor,
    );
    if (scenarioGate.programCompiles) {
      compareValue(
        rows,
        failures,
        name,
        'programCompiles',
        scenario.programCompiles,
        scenarioGate.programCompiles.target,
      );
    }
    compareValue(
      rows,
      failures,
      name,
      'worstFrameMs',
      scenario.worstFrameMs,
      scenarioGate.worstFrameMs.target,
    );
    compareValue(
      rows,
      failures,
      name,
      'pageErrorCount',
      scenario.pageErrorCount,
      scenarioGate.pageErrorCount.target,
    );
    if (scenarioGate.settledHeapDeltaMb) {
      compareValue(
        rows,
        failures,
        name,
        'settledHeapDeltaMb',
        scenario.settledHeapDeltaMb,
        scenarioGate.settledHeapDeltaMb.bound,
      );
    }
    compareValue(
      rows,
      failures,
      name,
      'allocationRateMbPerSec',
      scenario.allocationRateMbPerSec,
      scenarioGate.allocationRateMbPerSec.bound,
    );
  }
  return { ok: failures.length === 0, rows, failures };
}

// Calibration validity: the three same-build runs must produce identical pass
// or fail verdicts for every CALIBRATED metric, because those bounds are
// derived from the runs themselves and a flap means the derived bound does not
// describe the build. MISSION metrics are exempt: their frozen targets are
// expectations the unfixed build may straddle across runs, which
// deriveCalibration records in gate.missionStraddles, and the target itself
// stays fully enforced in every gate compare. Only an explicit mission kind is
// exempt, so an unclassified metric fails closed into strict flap detection.
export function assertNoCalibrationFlaps(records, gate) {
  const verdicts = records.map((record) => compareRunToGate(record, gate).rows);
  const first = new Map(verdicts[0].map((row) => [`${row.scenario}:${row.metric}`, row.ok]));
  for (const rows of verdicts.slice(1)) {
    for (const row of rows) {
      if (row.kind === 'mission') continue;
      if (first.get(`${row.scenario}:${row.metric}`) !== row.ok) {
        throw new Error(
          `${row.scenario}:${row.metric} pass or fail verdict flapped during calibration`,
        );
      }
    }
  }
}

const pad = (value, width) => String(value ?? '-').padStart(width);
const terminalSafe = (value, maxLength = 120) =>
  [...String(value ?? '')]
    .map((character) => {
      const code = character.codePointAt(0);
      const unsafe =
        code <= 0x1f ||
        (code >= 0x7f && code <= 0x9f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069);
      return unsafe ? ' ' : character;
    })
    .join('')
    .slice(0, maxLength);

export function formatGateComparison(comparison) {
  const lines = ['hitch gate comparison'];
  lines.push(
    `${'scenario'.padEnd(20)} ${'metric'.padEnd(24)} ${pad('actual', 9)} ${pad('bound', 9)}  verdict`,
  );
  for (const row of comparison.rows ?? []) {
    lines.push(
      `${row.scenario.padEnd(20)} ${row.metric.padEnd(24)} ${pad(row.actual, 9)} ${pad(row.bound, 9)}  ${row.ok ? 'ok' : 'FAIL'}`,
    );
  }
  for (const failure of comparison.failures ?? []) lines.push(`FAIL: ${failure}`);
  lines.push(
    comparison.ok
      ? 'PASS: run meets the frozen hitch gate'
      : `FAIL: ${comparison.failures.length} frozen hitch check(s) failed`,
  );
  return lines;
}

export function parseHistoryJsonl(text) {
  const records = [];
  let skipped = 0;
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record?.kind === 'hitch-run' && record?.v === 1) records.push(record);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

export function historyTable(records) {
  const lines = [];
  lines.push(
    `${'when'.padEnd(17)} ${'commit'.padEnd(13)} ${'preset'.padEnd(7)} ${pad('long50', 8)} ${pad('worst', 8)} ${pad('compile', 8)} ${pad('settled', 8)} ${pad('floorDiag', 9)} ${pad('alloc/s', 8)} ${pad('errors', 8)}  note`,
  );
  for (const record of records ?? []) {
    const when = String(record.at ?? '')
      .replace('T', ' ')
      .slice(0, 16);
    const commit = `${String(record.commit ?? '-').slice(0, 12)}${record.dirty ? '*' : ''}`;
    const overall = record.overall ?? {};
    lines.push(
      `${when.padEnd(17)} ${commit.padEnd(13)} ${String(record.preset ?? '-').padEnd(7)} ${pad(overall.longFrames, 8)} ${pad(overall.worstFrameMs, 8)} ${pad(overall.programCompiles, 8)} ${pad(overall.settledHeapDeltaMb, 8)} ${pad(overall.heapFloorGrowthMb, 9)} ${pad(overall.allocationRateMbPerSec, 8)} ${pad(overall.pageErrorCount, 8)}  ${terminalSafe(record.note)}`,
    );
  }
  return lines;
}

export const perfHitchStoreInternals = {
  calibratedBound,
  completePostWarmupFrames,
  percentile,
  rangeOf,
  relativeSpread,
  round,
};
