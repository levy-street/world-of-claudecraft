export type SelectMode = 'full' | 'selective';

export interface SelectPlan {
  mode: SelectMode;
  reason: string;
  alwaysRunFiles: string[];
  relatedSources: string[];
  changedTestFiles: string[];
}

export function isFullSuiteTrigger(p: string): boolean;

export const GENERATED_I18N_ARTIFACT_PREFIXES: readonly string[];
export const GENERATED_I18N_ARTIFACT_FILES: readonly string[];

export function isGeneratedI18nArtifactPath(p: string): boolean;

export function classifySelectPaths(paths: string[]): {
  testFiles: string[];
  relatedSources: string[];
  broadConfigs: string[];
  nonCode: string[];
  generatedI18n: string[];
};

export function buildSelectPlan(opts: {
  changedPaths: string[];
  alwaysRunFiles: string[];
  exists?: (p: string) => boolean;
}): SelectPlan;

export function buildAlwaysRunArgs(opts: { files: string[]; workers: number }): string[];

export function buildRelatedArgs(opts: { sources: string[]; workers: number }): string[] | null;

export function buildFullSuiteArgs(opts: { workers: number }): string[];
