// Hand-written declarations for symbol_census.mjs (the repo convention for a script
// module a type-checked Vitest suite imports; see scripts/CLAUDE.md).

export const BASE_REF: string;
export const OURS_REF: string;
export const THEIRS_REF: string;
export const ABSORB_MERGE_COMMIT: string;
export const RELEASE_REF: string;
export const PRIOR_SYNC_TIP: string;
export const DELETION_LIST_PATH: string;
export const EXPORT_ROOTS: readonly string[];
export const CONTENT_ROOT: string;
export const I18N_CATALOG_ROOT: string;
export const SIM_ROOT: string;
export const SIM_EVENT_UNION_FILE: string;
export const SIM_EVENT_UNION_NAME: string;
export const SIM_EVENT_DISCRIMINANT: string;
export const SOURCE_EXTENSIONS: readonly string[];
export const EXCLUDED_DIR_SEGMENTS: readonly string[];
export const EXCLUDED_PATH_PREFIXES: readonly string[];
export const GENERATED_FILE_RE: RegExp;

export type CensusClass = 'exports' | 'contentIds' | 'i18nKeys' | 'simEventUnion' | 'simEventEmits';
export const CLASSES: readonly CensusClass[];
export const CLASS_LABELS: Readonly<Record<CensusClass, string>>;
export const FLOORS: Readonly<
  Record<CensusClass, { readonly ours: number; readonly theirs: number; readonly release: number }>
>;

export interface ExplainedExtra {
  readonly cls: CensusClass;
  readonly name: string;
  readonly phase: string;
  readonly ruling: string;
  readonly reason: string;
}
export const EXPLAINED_EXTRAS: readonly ExplainedExtra[];

export interface Token {
  t: 'id' | 'str' | 'tpl' | 'num' | 'regex' | 'punct';
  v: string;
  line: number;
  hasSubst?: boolean;
}
export function tokenize(src: string): Token[];

export function extractExports(src: string | Token[]): {
  names: string[];
  reexports: string[];
  limits: Record<string, number>;
};
export function extractContentIds(src: string | Token[]): {
  ids: string[];
  nonLiteral: number;
  annotationLike: number;
};
export function extractI18nKeys(src: string | Token[]): {
  keys: string[];
  spread: number;
  computed: number;
  nonLiteralLeaves: number;
  methods: number;
  shorthand: number;
  roots: number;
  typeLiteralRootsSkipped: number;
};
export function extractSimEventUnion(
  src: string | Token[],
  unionName?: string,
): { kinds: string[]; resolvedAliases: string[]; unresolvedAliases: string[] };
export function extractSimEventEmits(src: string | Token[]): {
  kinds: string[];
  sites: number;
  nonLiteral: number;
  declarations: number;
  helpers: Record<string, number>;
};

export interface DeletionRow {
  cls: CensusClass | null;
  classLabel: string;
  oldName: string;
  newName: string;
  phase: string;
  ruling: string;
  reason: string;
  line: number;
}
export function parseDeletionList(markdown: string): { rows: DeletionRow[]; defects: string[] };

export function isCensusPath(relPath: string): boolean;
export function readMergedTree(
  mergedRoot: string,
  roots?: readonly string[],
): Array<[string, string]>;
export function readRefTree(
  repoDir: string,
  ref: string,
  roots?: readonly string[],
): Array<[string, string]>;
export function deriveSyncRefs(repoDir: string, head?: string): Array<{ ref: string; via: string }>;

export interface TreeCensus {
  sets: Record<CensusClass, Map<string, Set<string>>>;
  limits: Record<string, unknown>;
  contentIdsByPath: Map<string, Set<string>>;
  exportDefinitions: Map<string, Set<string>>;
  fileCounts: Record<string, number>;
}
export function censusTree(files: Array<[string, string]>): TreeCensus;

export interface CompareArgs {
  ours: TreeCensus;
  theirs: TreeCensus;
  merged: TreeCensus;
  deletionRows: DeletionRow[];
  explainedExtras?: readonly ExplainedExtra[];
  floors?: Readonly<
    Record<
      CensusClass,
      { readonly ours: number; readonly theirs: number; readonly release: number }
    >
  >;
  releases?: TreeCensus[];
  base?: TreeCensus | null;
}
export function compareCensus(args: CompareArgs): {
  perClass: Record<CensusClass, unknown>;
  failed: boolean;
};

export function formatReport(report: unknown, limit?: number): string;
export function parseArgs(argv: string[]): Record<string, unknown>;
export function repoRootFromScript(): string;
export function runCensus(
  opts?: Record<string, unknown>,
): Record<string, unknown> & { failed: boolean };
