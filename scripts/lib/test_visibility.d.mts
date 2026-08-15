export type VisibilityClass = 'blind' | 'partial' | 'graph';

export interface Visibility {
  klass: VisibilityClass;
  reasons: string[];
  srcImports: boolean;
}

export const OUT_OF_GRAPH_PATTERNS: ReadonlyArray<readonly [string, RegExp]>;

export const FS_HELPER_DIRS: readonly string[];
export const HELPER_FS_PATTERN: RegExp;

export function buildHelperImportPattern(helperPaths: string[]): RegExp | null;

export function classifyTestSource(
  source: string,
  opts?: { helperImportPattern?: RegExp | null },
): Visibility;

export function requiresAlwaysRun(klass: VisibilityClass): boolean;

export function buildAlwaysRunSet(entries: Array<{ file: string; visibility: Visibility }>): {
  alwaysRun: string[];
  reasons: Record<string, string[]>;
  counts: Record<VisibilityClass, number>;
};
