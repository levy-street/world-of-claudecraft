// Hand-written declarations for scripts/merge_audit/shard_weight_union.mjs
// (scripts/CLAUDE.md: a script module imported by a type-checked Vitest suite
// carries a .d.mts beside it). Only the surface the fixture suite consumes.

import type { CarriedEntry } from '../lib/ci_shard_weight_carry.mjs';

export interface WeightProvenance {
  run: string;
  harvested?: string;
  files?: number;
  harvestedFiles?: number;
  localMerge?: string;
  carried?: Record<string, CarriedEntry>;
  backfill?: { date: string; note: string };
}

/** A weight table: one measured millisecond cost per test path, plus the
 *  provenance block naming the CI harvest it came from. */
export type WeightTable = Record<string, number | WeightProvenance | null> & {
  __provenance: WeightProvenance | null;
};

export interface UnionStats {
  oursKeys: number;
  theirsKeys: number;
  shared: number;
  union: number;
  newer: string;
  carried: string[];
}

export function unionTables(
  ours: WeightTable,
  theirs: WeightTable,
): { merged: WeightTable; stats: UnionStats };

/** Every non-browser `*.test.ts` under `<root>/tests`, by the same predicate the
 *  enforcing partition pin applies (browser/ and node_modules/dist/dot-dirs
 *  skipped, symlinks never followed). */
export function walkTestFiles(root: string): string[];
