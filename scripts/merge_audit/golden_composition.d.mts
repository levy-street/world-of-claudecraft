// Hand-written declarations for scripts/merge_audit/golden_composition.mjs
// (scripts/CLAUDE.md: a script module imported by a type-checked Vitest suite
// carries a .d.mts beside it). Only the surface the fixture suite consumes.

export interface CompositionCtx {
  findings: string[];
  numericChecked: number;
  otherChecked: number;
  oursMoved: number;
  theirsMoved: number;
  theirsNonIdPaths: string[];
  oursNonIdPaths: string[];
  presenceMoves: number;
  stateMoves: number;
  eventsMoves: number;
  unalignedArrays: number;
  idShifts: Map<number, number>;
  /** Leaves whose merged value was byte-equal to a release parent's (counted,
   *  never silent); the first eight paths are sampled. */
  releaseComposed: number;
  releaseComposedPaths: string[];
  /** Both-moved numeric leaves where merged took one parent's value outright. */
  sidePicks: number;
  sidePickPaths: string[];
  theirsOnlyFrameDiffs?: string[];
}

export interface AddDiffs {
  rng: string[];
  idDeltas: Map<number, number>;
  numeric: string[];
  other: string[];
  presence: string[];
  releaseComposed: number;
  releaseComposedPaths: string[];
}

export type Lineage =
  | 'shared'
  | 'ours-only add'
  | 'theirs-only add'
  | 'release-only add'
  | 'orphan';
export function classifyLineage(args: {
  b: unknown;
  o: unknown;
  t: unknown;
  releases?: unknown[];
}): Lineage;
export function releaseParentRefs(args?: {
  releaseRef?: string;
  derived?: ReadonlyArray<{ ref: string; via: string }>;
  extra?: readonly string[];
  resolve?: (ref: string) => string;
}): Array<{ ref: string; via: string | null }>;
export function newestReleaseRef(args?: {
  releaseRef?: string;
  derived?: ReadonlyArray<{ ref: string; via: string }>;
}): string;
export function isAnchorPath(path: string): boolean;

/** One golden a parent carries that the merged tree does not, with the parents
 *  that carried it. */
export interface MissingGolden {
  file: string;
  sides: string[];
}

export const GOLDEN_FLOOR: number;
export function compositionVerdict(args: {
  goldenCount: number;
  missingCount: number;
  rowFindingCount: number;
  shifts: ReadonlyMap<number, number>;
  floor?: number;
}): {
  failures: number;
  floorFail: boolean;
  shiftDisagreement: boolean;
  distinctShifts: number[];
  failed: boolean;
};
export function checkUniformIdShift(diffs: AddDiffs, ctx: CompositionCtx, label: string): void;
export const EXPLAINED_MISSING_GOLDENS: Readonly<Record<string, string>>;
export function missingFromMerged(
  mergedFiles: readonly string[],
  parentSets: ReadonlyMap<string, ReadonlySet<string>>,
  explained?: Readonly<Record<string, string>>,
): MissingGolden[];
export function newCtx(): CompositionCtx;
export function isIdPath(path: string): boolean;
export function composeLeaf(
  b: unknown,
  o: unknown,
  t: unknown,
  m: unknown,
  path: string,
  ctx: CompositionCtx,
  rs?: readonly unknown[],
): void;
export function checkShared(
  name: string,
  b: unknown,
  o: unknown,
  t: unknown,
  m: unknown,
  releases?: readonly unknown[],
): {
  ctx: CompositionCtx;
  frames: number;
  fourWay: number;
  oursOnlyFrames: number;
  theirsOnlyFrames: number;
};
export function checkAdd(
  name: string,
  p: unknown,
  m: unknown,
  side: 'ours' | 'theirs' | 'release',
  releases?: readonly unknown[],
): { ctx: CompositionCtx; diffs: AddDiffs; frames: number };
export function diffAgainst(
  p: unknown,
  m: unknown,
  path: string,
  diffs: AddDiffs,
  ctx: CompositionCtx,
  rs?: readonly unknown[],
): void;
