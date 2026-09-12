export interface HuntProgram {
  id: number;
  name: string;
  cacheKey: string;
}

export interface HuntEvent {
  kind: string;
  key?: string;
  atMs?: number;
  readyRoots?: number;
  totalRoots?: number;
}

export interface HuntDiagnostics {
  newMaterials?: string[];
  firstVisibleObjects?: string[];
  programDelta?: number;
}

export interface HuntSample {
  t?: number;
  zone?: string;
  pos?: { x: number; z: number } | null;
  programs?: HuntProgram[];
  events?: HuntEvent[];
  diag?: HuntDiagnostics | null;
}

export interface LiveProgramRow {
  label: string;
  count: number;
  firstAtMs: number | null;
  zone: string;
  pos: string;
  materialName: string;
  keyShort: string;
  newMaterials: string[];
  firstVisibleObjects: string[];
  readyRoots: string;
}

export interface Burst {
  atMs: number;
  zone: string;
  count: number;
  labels: string[];
}

export interface GateFailure {
  kind: string;
  atMs: number;
  key: string;
  zone: string;
}

export interface HuntMeta {
  target?: string;
  gitSha?: string;
  dirty?: boolean;
  browser?: string;
  durationMs?: number;
  polls?: number;
  audit?: Record<string, unknown> | null;
}

export const BURST_WINDOW_MS: number;
export function shortKey(key: unknown): string;
export function aggregateLivePrograms(samples: HuntSample[]): LiveProgramRow[];
export function findBursts(samples: HuntSample[]): Burst[];
export function collectGateFailures(samples: HuntSample[]): GateFailure[];
export function renderReport(samples: HuntSample[], meta?: HuntMeta): string;
