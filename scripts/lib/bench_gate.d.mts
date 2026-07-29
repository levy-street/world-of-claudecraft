export interface CrowdSample {
  label: string;
  fps: number | null | undefined;
  tier?: string;
  calls?: number | null;
  expectedJoined?: number;
  actualJoined?: number;
}

export interface GateVerdict {
  ok: boolean;
  failures: string[];
}

export interface JitterVerdict extends GateVerdict {
  minGaps: number;
}

export interface JitterObserverStats {
  gaps: number;
  p95: number;
}

export interface GapStats {
  snapshots: number;
  gaps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over100: number;
  over150: number;
  over250: number;
  over500: number;
}

export declare const COMPOSER_TIERS: ReadonlyArray<string>;
export declare const FULLSCREEN_DRAW_FLOOR: number;

export declare function parseCeilingEnv(name: string, raw: string | undefined): number | null;
export declare function evaluateCrowdRun(run: {
  samples: ReadonlyArray<CrowdSample> | null | undefined;
  minFps: number | null;
}): GateVerdict;
export declare function minGapsFor(durationMs: number): number;
export declare function evaluateJitterRun(run: {
  joined: number;
  expected: number;
  observer: JitterObserverStats | null | undefined;
  durationMs: number;
  maxP95: number | null;
}): JitterVerdict;
export declare function pct(sorted: ReadonlyArray<number>, p: number): number;
export declare function gapStats(snapTimes: ReadonlyArray<number>): GapStats;
