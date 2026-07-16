export interface TimingPair {
  p95: number;
  max: number;
}

export interface HeartbeatSample {
  online: number | null;
  ents: number | null;
  tickHz: number | null;
  tickMs: number | null;
  over: boolean;
  timings: Record<string, TimingPair>;
  visits: number | null;
  serializes: number | null;
  serializeMs: number | null;
  aggroVisits: number | null;
  threatVisits: number | null;
}

export interface SimlineBucket {
  mean: number;
  p95: number;
  max: number;
}

export interface StagingVerdict {
  ok: boolean;
  empty: boolean;
  detail: string;
}

export declare function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number;
export declare function timingPair(name: string, line: string): TimingPair | null;
export declare function parseHeartbeat(line: string): HeartbeatSample;
export declare function parseSimline(line: string): Record<string, SimlineBucket>;
export declare function evaluateStaging(
  fresh: ReadonlyArray<Pick<HeartbeatSample, 'aggroVisits' | 'threatVisits'>>,
  sig: 'aggro' | 'threat',
  botCount: number,
): StagingVerdict;
