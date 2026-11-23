export const RELATED_WALK_BATCH: number;

export const VERIFIED_VITEST_VERSION: string;

export const BOUNDED_RELATED_PROVIDE_KEY: 'wocBoundedRelated';

export function filterTestsBySourceBounded<S extends { moduleId: string }>(io: {
  specs: readonly S[];
  config: {
    related?: string[];
    changed?: unknown;
    watch?: boolean;
    root: string;
    forceRerunTriggers: string[];
  };
  findChangedFiles: (opts: { root: string; changedSince: unknown }) => Promise<string[]>;
  getTestDependencies: (spec: S) => Promise<Set<string>>;
  matchesAny: (patterns: string[]) => (file: string) => boolean;
  batch?: number;
}): Promise<S[]>;

export function installBoundedRelatedFilter(
  vitest: unknown,
  options?: { batch?: number; vitestVersion?: string; log?: (line: string) => void },
): void;

export function vitestBoundedRelatedPlugin(): {
  name: string;
  configureVitest(context: {
    vitest: unknown;
    project: { provide(key: string, value: unknown): void };
  }): void;
};
