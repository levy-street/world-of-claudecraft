export interface SystemPoint {
  t: number;
  cpuPct?: number;
  gpuPct?: number;
  gpuPowerW?: number;
  procCpuPct?: number;
}

export interface MetricFold {
  avg: number;
  max: number;
  n: number;
}

export interface SystemWindow {
  cpuPct: MetricFold | null;
  gpuPct: MetricFold | null;
  gpuPowerW: MetricFold | null;
  procCpuPct: MetricFold | null;
}

export declare const SUITE_LABELS: ReadonlyArray<string>;

export interface ScenarioSummary {
  label: string;
  tier: string;
  autoGovernor: boolean | null;
  budgetMode: string;
  fpsMean: number | null;
  fpsLow1: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  jankPct: number | null;
  calls: number | null;
  triangles: number | null;
  cpuPct: number | null;
  cpuSysPct: number | null;
  gpuPct: number | null;
  gpuPowerW: number | null;
}

export interface RunMeta {
  at: string;
  commit?: string | null;
  branch?: string | null;
  dirty?: boolean | null;
  preset: string;
  note?: string;
  machine?: string;
  sampleMs?: number | null;
  viewport?: string;
}

export interface RunRecord extends RunMeta {
  v: number;
  flags: {
    tierMismatch: boolean;
    governorEngaged: boolean;
  };
  scenarios: ScenarioSummary[];
  overall: {
    fpsMean: number | null;
    fpsMin: number | null;
    fpsLow1Min: number | null;
    cpuPct: number | null;
    gpuPct: number | null;
  };
}

export interface CompareRow {
  scenario: string;
  metric: string;
  base: number;
  cand: number;
  deltaPct: number;
  bound: number;
  ok: boolean;
  advisory?: boolean;
}

export interface CompareResult {
  ok: boolean;
  rows: CompareRow[];
  failures: string[];
  fpsTolerancePct: number;
  sysTolerancePct: number;
}

export declare function sumProcessTreeCpu(
  psText: string | null | undefined,
  rootPid: number,
): number | null;
export declare function aggregateSystemWindow(
  points: ReadonlyArray<SystemPoint> | null | undefined,
  t0: number,
  t1: number,
): SystemWindow;
export declare function summarizeScenario(
  sample: unknown,
  sys: SystemWindow | null,
): ScenarioSummary;
export declare function makeRunRecord(
  meta: RunMeta,
  scenarios: ReadonlyArray<ScenarioSummary>,
): RunRecord;
export declare function comparabilityIssues(
  baseline: RunRecord | null | undefined,
  candidate: RunRecord | null | undefined,
): string[];
export declare function compareRuns(
  baseline: RunRecord | null | undefined,
  candidate: RunRecord | null | undefined,
  opts?: { fpsTolerancePct?: number; sysTolerancePct?: number },
): CompareResult;
export declare function formatCompare(
  cmp: CompareResult,
  baselineLabel: string,
  candidateLabel: string,
): string[];
export declare function parseHistoryJsonl(text: string | null | undefined): {
  records: RunRecord[];
  skipped: number;
};
export declare function historyTable(
  records: ReadonlyArray<RunRecord> | null | undefined,
): string[];

export declare const perfBaselineStoreInternals: {
  round: (v: number, d?: number) => number;
  mean: (vals: number[]) => number | null;
};
