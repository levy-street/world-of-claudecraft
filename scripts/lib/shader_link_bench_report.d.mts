export interface LinkRun {
  ms: number;
  ok: boolean;
  log?: string;
  drawMs?: number;
  drawError?: number;
}

export interface LinkResult {
  base?: string;
  variant?: string;
  group?: string;
  hash: string;
  name: string;
  kind: string;
  firstStep?: string;
  profiles?: string[];
  runs?: LinkRun[];
}

export interface LinkRow {
  base?: string;
  variant?: string;
  group?: string;
  hash: string;
  name: string;
  kind: string;
  firstStep?: string;
  profiles: string[];
  firstMs: number;
  repeatMs: number;
  costMs: number;
  linkMsByRep: number[];
  firstDrawMs: number | null;
  drawMedianMs: number | null;
  drawErrors: number;
}

export interface Concentration {
  count: number;
  totalMs: number;
  medianMs: number;
  p90Ms: number;
  p95Ms: number;
  maxMs: number;
  tailRatio: number;
  top10Share: number;
  top10FlatShare: number;
  top10PercentShare: number;
}

export function median(values: number[]): number;
export function quantile(values: number[], q: number): number;
export function summarizePrograms(results: LinkResult[]): {
  rows: LinkRow[];
  failures: { hash: string; name: string; log: string }[];
};
export interface AblationPairing {
  variant: string;
  group: string;
  pairs: number;
  baseMedianMs: number;
  variantMedianMs: number;
  savedMedianMs: number;
  savedMinMs: number;
  savedMaxMs: number;
}
export function pairedAblation(rows: LinkRow[]): AblationPairing[];
export function concentration(rows: LinkRow[]): Concentration;
export function renderLinkBenchReport(payload: {
  results: LinkResult[];
  machine?: { renderer?: string };
  browser?: string;
  angle?: string;
  reps?: number;
  seconds?: number;
  corpus?: { gitSha?: string; programCount?: number };
}): string;
