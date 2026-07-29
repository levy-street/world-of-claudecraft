export const GATE_FAST_GUARD_TESTS: readonly [
  'tests/architecture.test.ts',
  'tests/localization_fixes.test.ts',
];

export const GATE_FAST_STEP_NAMES: readonly [
  'malware scan',
  'biome (changed files)',
  'guard tests (architecture + localization)',
  'typecheck (check:ts incremental)',
  'vitest (related / changed tests)',
];

export function normalizeRepoPath(p: string): string;
export function isTestPath(p: string): boolean;
export function isBroadConfigPath(p: string): boolean;
export function isNonCodePath(p: string): boolean;
export function isRelatedSourcePath(p: string): boolean;

export function classifyChangedPaths(paths: Iterable<string>): {
  testFiles: string[];
  relatedSources: string[];
  broadConfigs: string[];
  nonCode: string[];
};

export function resolveFastChangedBase(opts?: {
  envBase?: string | null | undefined;
}): string | null;

export function buildDayLoopVitestPlan(opts: {
  workers: number;
  changedBase?: string | null;
  testFiles?: readonly string[];
  relatedSources?: readonly string[];
}): {
  mode: 'changed' | 'related' | 'run' | 'skip';
  args: string[] | null;
  reason?: string;
};

export function buildGuardVitestArgs(opts: {
  workers: number;
  guardFiles?: readonly string[];
}): string[];
