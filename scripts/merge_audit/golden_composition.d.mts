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
  theirsOnlyFrameDiffs?: string[];
}

export interface AddDiffs {
  rng: string[];
  idDeltas: Map<number, number>;
  numeric: string[];
  other: string[];
  presence: string[];
}

export function newCtx(): CompositionCtx;
export function isIdPath(path: string): boolean;
export function composeLeaf(
  b: unknown,
  o: unknown,
  t: unknown,
  m: unknown,
  path: string,
  ctx: CompositionCtx,
): void;
export function checkShared(
  name: string,
  b: unknown,
  o: unknown,
  t: unknown,
  m: unknown,
): { ctx: CompositionCtx; frames: number; fourWay: number };
export function checkAdd(
  name: string,
  p: unknown,
  m: unknown,
  side: 'ours' | 'theirs',
): { ctx: CompositionCtx; diffs: AddDiffs; frames: number };
export function diffAgainst(
  p: unknown,
  m: unknown,
  path: string,
  diffs: AddDiffs,
  ctx: CompositionCtx,
): void;
