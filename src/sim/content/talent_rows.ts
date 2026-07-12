// ---------------------------------------------------------------------------
// Choice-row talent framework (Pandaria style, adapted to the 20-level cap).
//
// Instead of spending points across a branching tree, a character unlocks SIX
// rows as it levels (at 5 / 8 / 11 / 14 / 17 / 20) and picks ONE of THREE options
// per row. This is the framework only: the types, the load-time validator, the
// level-unlock math, and the fold from a player's picks into the flat
// TalentModifiers that the hot paths already read. It REUSES the existing effect
// engine (`accumulate` / `emptyModifiers` from talents.ts), so a choice-row option
// expresses its effect with the exact same `TalentEffect` buckets the point-tree
// uses, and nothing downstream (recalcPlayerStats, applyTalentMods) changes.
//
// The per-class row DATA and the Sim/UI/wire integration land in later slices;
// this module is pure and host-agnostic (Node-testable, no DOM/Three), same as
// talents.ts.
// ---------------------------------------------------------------------------

import type { PlayerClass } from '../types';
import { bridgedRowTrees } from './choice_row_tree_bridge';
import {
  accumulate,
  computeTalentModifiers,
  emptyModifiers,
  type TalentAllocation,
  type TalentEffect,
  type TalentModifiers,
} from './talents';
import { WARRIOR_ROWS } from './warrior_rows';

/** The character level at which each row (tier) unlocks. One row per level. */
export const ROW_LEVELS = [5, 8, 11, 14, 17, 20] as const;
export const ROW_COUNT = ROW_LEVELS.length;
export const OPTIONS_PER_ROW = 3;

/** One of the three picks in a row. Its `effect` uses the same `TalentEffect`
 *  buckets as a point-tree node, so it folds through the shared engine. */
export interface ChoiceRowOption {
  id: string;
  name: string;
  description: string;
  effect: TalentEffect;
}

/** A single tier: a level gate plus exactly three mutually exclusive options. */
export interface ChoiceRow {
  level: number;
  options: ChoiceRowOption[];
}

/** A class's full set of rows (expected length: ROW_COUNT). */
export type RowTree = ChoiceRow[];

/** A player's allocation: the chosen option id per row, or null for unpicked. */
export type RowPicks = (string | null)[];

/** A fresh, all-unpicked allocation. */
export function emptyRowPicks(): RowPicks {
  return new Array(ROW_COUNT).fill(null);
}

/** Validate a class row tree at load time. Returns a list of problems (empty =
 *  valid), mirroring `validateTalentTree`'s contract so a malformed tree is caught
 *  at import rather than in play. */
export function validateRowTree(tree: RowTree): string[] {
  const errs: string[] = [];
  if (tree.length !== ROW_COUNT) {
    errs.push(`expected ${ROW_COUNT} rows, got ${tree.length}`);
  }
  const seen = new Set<string>();
  tree.forEach((row, i) => {
    const wantLevel = ROW_LEVELS[i];
    if (wantLevel !== undefined && row.level !== wantLevel) {
      errs.push(`row ${i}: level ${row.level}, expected ${wantLevel}`);
    }
    if (row.options.length !== OPTIONS_PER_ROW) {
      errs.push(`row ${i}: ${row.options.length} options, expected ${OPTIONS_PER_ROW}`);
    }
    for (const opt of row.options) {
      if (!opt.id) errs.push(`row ${i}: an option has no id`);
      else if (seen.has(opt.id)) errs.push(`duplicate option id: ${opt.id}`);
      else seen.add(opt.id);
    }
  });
  return errs;
}

/** How many rows are unlocked at a given character level (a row unlocks once the
 *  character reaches its gate level). */
export function rowsUnlockedAt(level: number): number {
  let n = 0;
  for (const lv of ROW_LEVELS) if (level >= lv) n++;
  return n;
}

/** Fold a player's picks into an EXISTING modifier struct (the shared effect
 *  engine's accumulate). Unpicked rows and unknown ids contribute nothing. */
export function accumulateRowPicks(mods: TalentModifiers, tree: RowTree, picks: RowPicks): void {
  picks.forEach((pick, i) => {
    if (!pick) return;
    const row = tree[i];
    if (!row) return;
    const opt = row.options.find((o) => o.id === pick);
    if (opt) accumulate(mods, opt.effect, 1);
  });
}

/** Fold a player's picks into fresh flat `TalentModifiers`. Deterministic (a
 *  pure function of tree + picks). */
export function computeRowModifiers(tree: RowTree, picks: RowPicks): TalentModifiers {
  const mods = emptyModifiers();
  accumulateRowPicks(mods, tree, picks);
  return mods;
}

/** Drop picks a character is not entitled to: unknown option ids (stale saves,
 *  renamed content, tampering) and rows above the character's level. Returns a
 *  fresh ROW_COUNT-length array; a null/missing tree clears everything. */
export function sanitizeRowPicks(
  tree: RowTree | null,
  picks: readonly (string | null)[] | undefined,
  level: number,
): RowPicks {
  const clean = emptyRowPicks();
  if (!tree || !picks) return clean;
  for (let i = 0; i < ROW_COUNT; i++) {
    const pick = picks[i];
    const row = tree[i];
    if (!pick || !row || level < row.level) continue;
    if (row.options.some((o) => o.id === pick)) clean[i] = pick;
  }
  return clean;
}

/** Double-apply guard. The OLD model's saved rows (alloc.rows, folded inside
 *  computeTalentModifiers via CHOICE_ROWS) and the NEW model's rowPicks now
 *  describe the SAME options for every bridged class, so folding both would
 *  count one option twice (or stack two options in one row). Per row, the new
 *  model wins: a row with a rowPick has its alloc.rows entry dropped; a row
 *  without one keeps honoring the old save (the convention the warrior
 *  overhaul shipped: legacy saved rows keep applying until re-picked, pinned
 *  by the old-model Sim suites). Returns a fresh allocation, never mutates. */
function withSupersededRowsDropped(
  alloc: TalentAllocation,
  tree: RowTree,
  picks: RowPicks,
): TalentAllocation {
  const saved: Record<string, unknown> = alloc.rows ?? {};
  const savedLevels = Object.keys(saved);
  if (savedLevels.length === 0 || picks.every((p) => !p)) return alloc;
  const rows: Record<string, unknown> = {};
  for (const rawLevel of savedLevels) {
    const level = Number(rawLevel);
    const rowIndex = tree.findIndex((row) => row.level === level);
    if (rowIndex >= 0 && picks[rowIndex]) continue; // superseded by the new pick
    rows[rawLevel] = saved[rawLevel];
  }
  return { spec: alloc.spec ?? null, rows };
}

/** The full bake used everywhere a player's REAL build is resolved: the point
 *  tree's modifiers plus the choice-row picks folded on top, into one flat
 *  struct. (Fiesta's standardized bouts deliberately skip the row fold.) */
export function computeModifiersWithRows(
  cls: PlayerClass,
  alloc: TalentAllocation,
  picks: RowPicks,
  // Optional player level so spec-mastery magnitudes scale with it (min(1, level/20)
  // inside computeTalentModifiers); omitted callers get the max-level bake.
  level?: number,
): TalentModifiers {
  const tree = rowTreeFor(cls);
  const effective = tree ? withSupersededRowsDropped(alloc, tree, picks) : alloc;
  const mods = computeTalentModifiers(cls, effective, level);
  if (tree) accumulateRowPicks(mods, tree, picks);
  return mods;
}

// ---------------------------------------------------------------------------
// Registry. Like TALENTS in talents.ts: per-class authored row content, validated
// at import so a malformed tree fails loudly at boot rather than in play.
// ---------------------------------------------------------------------------

// Bridged trees first (every class's old-model rows converted 1:1, including
// warrior_classic), then the authored trees override their bridged stand-ins
// (the warrior keeps its hand-authored overhaul rows).
export const ROW_TREES: Partial<Record<PlayerClass, RowTree>> = {
  ...bridgedRowTrees(),
  warrior: WARRIOR_ROWS,
};

export function rowTreeFor(cls: PlayerClass): RowTree | null {
  return ROW_TREES[cls] ?? null;
}

for (const [cls, tree] of Object.entries(ROW_TREES)) {
  const errs = validateRowTree(tree);
  if (errs.length > 0) {
    throw new Error(`Invalid choice-row tree for ${cls}: ${errs.join('; ')}`);
  }
}
