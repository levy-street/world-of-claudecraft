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
export const GENERATED_MANIFEST_ARTIFACT_FILES: readonly string[];

export function isGeneratedI18nArtifactPath(p: string): boolean;
export function isGeneratedManifestArtifactPath(p: string): boolean;

export function classifySelectPaths(paths: string[]): {
  testFiles: string[];
  relatedSources: string[];
  broadConfigs: string[];
  nonCode: string[];
  generatedI18n: string[];
  generatedManifests: string[];
};

export function buildSelectPlan(opts: {
  changedPaths: string[];
  alwaysRunFiles: string[];
  exists?: (p: string) => boolean;
  floorSanityMin?: number;
}): SelectPlan;

export const FLOOR_SANITY_MIN: number;

export type SelectiveLeg =
  | { kind: 'merged-related'; files: string[]; strict: true }
  | { kind: 'floor-run'; files: string[]; index: number; of: number }
  | { kind: 'tolerant-related'; files: string[] };

export function planSelectiveLegs(opts: {
  relatedSources: string[];
  alwaysRunFiles: string[];
  platform: string;
}): SelectiveLeg[];

export function buildSelectiveLegArgs(leg: SelectiveLeg, workers: number): string[];

export function buildFullSuiteArgs(opts: { workers: number }): string[];
