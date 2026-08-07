export const CI_GUARD_SUITES: readonly string[];
export const CI_GUARD_PREFIXES: readonly string[];
export const CI_LONG_SUITES: readonly string[];
export const FLOOR_SANITY_MIN: number;

export function collectedLaneFiles(opts: {
  testFiles: string[];
  exists: (p: string) => boolean;
}): string[];

export function parseShardArg(argv: string[]): { index: number; total: number } | null;

export function buildFloor(opts: {
  alwaysRun: string[];
  testFiles: string[];
  changedTestFiles: string[];
}): { floor: string[]; missingGuards: string[] };

export interface ShardLeg {
  name: string;
  cmd: string;
  args: string[];
}

export function buildShardPlan(opts: {
  mode: string;
  changedPaths: string[];
  alwaysRun: string[];
  testFiles: string[];
  shard: { index: number; total: number };
  workers: number;
  exists: (p: string) => boolean;
}): {
  mode: 'full' | 'selective';
  reason: string;
  legs: ShardLeg[];
  floorCount?: number;
  relatedCount?: number;
  outsideFloorCount?: number;
  laneExcluded: string[];
  laneFloorCount?: number;
};

export function buildLanePlan(opts: {
  mode: string;
  changedPaths: string[];
  alwaysRun: string[];
  testFiles: string[];
  workers: number;
  exists: (p: string) => boolean;
}): {
  mode: 'full' | 'selective';
  reason: string;
  legs: ShardLeg[];
  laneFiles: string[];
};
