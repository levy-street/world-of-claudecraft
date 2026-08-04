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

export interface SampleStats {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface ProfessionsObserverEvidence {
  label: string;
  role: 'gather' | 'fish';
  gaps: number;
  /** The observer's worst inter-snapshot gap in ms (gapStats(...).max). */
  gapMaxMs: number;
  sawStableTw: boolean;
  /** Snapshots whose own node-cooldown map arrived NON-empty (gather evidence). */
  ncdFrames: number;
  fishingOutcomes: number;
}

export declare function sampleStats(values: ReadonlyArray<number>): SampleStats;
export declare function profMinGapsFor(durationMs: number): number;
export declare function profMinRoleEventsFor(durationMs: number): number;
export declare const PROF_MAX_OBSERVER_GAP_MS: number;

export interface ProfessionsVerdict extends JitterVerdict {
  minRoleEvents: number;
}
export declare function evaluateProfessionsLoadRun(run: {
  joined: number;
  expected: number;
  aliveAtEnd: number;
  mode: 'gather' | 'fish' | 'mixed';
  stable: boolean;
  durationMs: number;
  observers: ReadonlyArray<ProfessionsObserverEvidence> | null | undefined;
}): ProfessionsVerdict;
