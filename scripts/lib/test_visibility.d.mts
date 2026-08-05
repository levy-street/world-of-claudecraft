export type VisibilityClass = 'blind' | 'partial' | 'graph';

export interface Visibility {
  klass: VisibilityClass;
  reasons: string[];
  srcImports: boolean;
}

export const OUT_OF_GRAPH_PATTERNS: ReadonlyArray<readonly [string, RegExp]>;

export function classifyTestSource(source: string): Visibility;

export function requiresAlwaysRun(klass: VisibilityClass): boolean;

export function buildAlwaysRunSet(entries: Array<{ file: string; visibility: Visibility }>): {
  alwaysRun: string[];
  reasons: Record<string, string[]>;
  counts: Record<VisibilityClass, number>;
};
