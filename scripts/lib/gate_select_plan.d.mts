export type SelectMode = 'full' | 'selective';

export interface SelectPlan {
  mode: SelectMode;
  reason: string;
  alwaysRunFiles: string[];
  relatedSources: string[];
  changedTestFiles: string[];
}

export function isFullSuiteTrigger(p: string): boolean;

export function classifySelectPaths(paths: string[]): {
  testFiles: string[];
  relatedSources: string[];
  broadConfigs: string[];
  nonCode: string[];
};

export function buildSelectPlan(opts: {
  changedPaths: string[];
  alwaysRunFiles: string[];
}): SelectPlan;

export function buildAlwaysRunArgs(opts: { files: string[]; workers: number }): string[];

export function buildRelatedArgs(opts: { sources: string[]; workers: number }): string[] | null;

export function buildFullSuiteArgs(opts: { workers: number }): string[];
