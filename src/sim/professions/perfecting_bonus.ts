// Per-copy Perfecting contributions are immutable for the new raid collections.
// Swaps remove the old piece's exact contribution and apply the other piece's
// own saved profile. Existing Masterwrought tuning remains source level 28.
import { crucibleCollectionForItem } from '../content/crucible_collections';
import {
  PRIMARY_STATS,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  slotStatMultForItem,
  TWOHAND_STAT_MULT,
  tierDeltaStats,
} from '../item_budget';
import type { CoreStats, ItemDef, ItemInstancePayload } from '../types';
import type { ProfessionRecipeRecord } from './types';

export const PERFECTED_SOURCE_LEVEL = 28;
export const COLLECTION_PERFECTING_SOURCE_INCREASE = 3;
export const MAX_PERFECTING_BONUS_STAT = 10000;

function budgetAtSource(def: ItemDef, sourceLevel: number): number {
  const ilvl = Math.max(1, sourceLevel + (QUALITY_ILVL_BONUS[def.quality ?? 'common'] ?? 0));
  const base = primaryStatBudget(ilvl, def.quality, def.slot, slotStatMultForItem(def));
  return def.kind === 'weapon' && def.hand === 'twohand'
    ? Math.round(base * TWOHAND_STAT_MULT)
    : base;
}

export function perfectedBonusStats(
  def: ItemDef,
  recipe: Pick<ProfessionRecipeRecord, 'level'>,
): Partial<CoreStats> | null {
  if (!def.slot || !def.stats) return null;
  const profile: Partial<CoreStats> = {};
  for (const stat of PRIMARY_STATS) {
    const value = def.stats[stat] ?? 0;
    if (value > 0) profile[stat] = value;
  }
  if (Object.keys(profile).length === 0) return null;
  const target = crucibleCollectionForItem(def.id)
    ? recipe.level + COLLECTION_PERFECTING_SOURCE_INCREASE
    : PERFECTED_SOURCE_LEVEL;
  // Model-aware (item_budget.ts, the stamina baseline model): the line delta
  // over the profile's offense identity plus, for a caster piece, the growth of
  // its free stamina baseline between the two source levels.
  return tierDeltaStats(profile, budgetAtSource(def, recipe.level), budgetAtSource(def, target));
}

/** The line budget on each side of the Perfecting bump, for the stamina guard. */
export function perfectedLineBudgets(
  def: ItemDef,
  recipe: Pick<ProfessionRecipeRecord, 'level'>,
): { before: number; after: number } | null {
  if (!def.slot || !def.stats) return null;
  const target = crucibleCollectionForItem(def.id)
    ? recipe.level + COLLECTION_PERFECTING_SOURCE_INCREASE
    : PERFECTED_SOURCE_LEVEL;
  return { before: budgetAtSource(def, recipe.level), after: budgetAtSource(def, target) };
}

/** Atomic load bound. Unknown top-level payload fields stay untouched. */
export function isValidPerfectingBonus(value: unknown): value is Partial<CoreStats> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, amount]) =>
      (PRIMARY_STATS as readonly string[]).includes(key) &&
      typeof amount === 'number' &&
      Number.isSafeInteger(amount) &&
      amount >= 0 &&
      amount <= MAX_PERFECTING_BONUS_STAT,
  );
}

/** Mint only on collection copies, with no stat effect until they are Perfected. */
export function withPerfectingBonus(
  def: ItemDef | undefined,
  recipe: Pick<ProfessionRecipeRecord, 'level'>,
  payload: ItemInstancePayload,
): ItemInstancePayload {
  if (!def || !crucibleCollectionForItem(def.id) || payload.perfectingBonus !== undefined)
    return payload;
  return { ...payload, perfectingBonus: perfectedBonusStats(def, recipe) ?? {} };
}
