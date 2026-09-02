export type CarryMethod = 'local-median' | 'union-older-harvest' | 'prose-backfill';
export const CARRY_METHODS: readonly CarryMethod[];

export interface CarriedEntry {
  ms: number;
  method: CarryMethod;
  measured?: string;
  /** Required for `local-median`: why the row is carried, not harvested. */
  reason?: string;
  runs?: number[];
  run?: string;
}

export interface CarriedProvenance {
  run: string;
  harvested?: string;
  files?: number;
  harvestedFiles?: number;
  localMerge?: string;
  carried?: Record<string, CarriedEntry>;
  backfill?: { date: string; note: string };
}

export type CarriedWeightTable = Record<string, number | CarriedProvenance | null> & {
  __provenance: CarriedProvenance | null;
};

export function tableRows(table: Record<string, unknown>): string[];
export function medianMs(values: readonly number[]): number;
export function modes(values: readonly number[]): number[];
export function carriedRows(table: Record<string, unknown>): Record<string, CarriedEntry>;
export function carriedDefects(
  table: Record<string, unknown>,
  opts?: { fallbackMs?: number; requireMap?: boolean },
): string[];
export function applyLocalCarry(
  table: Record<string, unknown>,
  measurements: ReadonlyArray<{ file: string; runs: readonly number[] }>,
  opts: { measured: string; reason: string },
): CarriedWeightTable;
export function unionCarried(args: {
  newer: Record<string, unknown>;
  older: Record<string, unknown>;
  carriedKeys: readonly string[];
}): { carried: Record<string, CarriedEntry>; harvestedFiles: number };
export const DEFAULT_LOCAL_CARRY_REASON: string;
export function missingWeightFiles(
  walkedFiles: readonly string[],
  weights: Record<string, unknown>,
): string[];
export function parseCarryLocalCli(argv: readonly string[]): {
  reason: string;
  tokens: string[];
};
export function parseCarryLocalArgs(
  tokens: readonly string[],
): Array<{ file: string; runs: number[] }>;
export const PRUNE_MAX_DROPS: number;
export function pruneMissingRows(
  table: Record<string, unknown>,
  exists: (file: string) => boolean,
  options?: { maxDrops?: number },
): { table: Record<string, unknown>; gone: string[]; refusal: string | null };
export function serializeWeightTable(table: Record<string, unknown>): string;
