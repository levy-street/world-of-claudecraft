export interface BenchmarkAllocation {
  spec: string | null;
  rows: Partial<Record<number, string>>;
}

export function benchmarkAllocation(
  defaultAllocation: BenchmarkAllocation,
  spec: string,
  requestedRows?: Partial<Record<number, string>>,
): BenchmarkAllocation;

export const WARLOCK_BENCHMARK_ROWS: Readonly<Record<number, string>>;

export function combatElapsed(simTime: number, encounterStart: number): number;

export function activeDps(
  activeDamageDone: number,
  attemptSeconds: number,
  deathTime?: number,
): number;

export interface ComparisonPlan {
  tank: string;
  healerSet: string[];
  baselineDps: string[];
  pairKey: string;
  comparedKey: string;
}

export function comparisonPlans(options: {
  tanks: string[];
  healerSets: string[][];
  dps: string[];
  compared: string[];
  dpsSlots: number;
  limit: number;
}): ComparisonPlan[];

export function nythraxisDamageBucket(
  targetId: number,
  templateId: string | undefined,
  bossId: number,
): 'boss' | 'add' | null;
