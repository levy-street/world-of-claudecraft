// The ordinary twin of a fine grade, across BOTH fine ladders.
//
// Two fine ladders live in this directory and they answer to different rules.
// MATERIAL_GRADES (material_grades.ts) holds the nine node yields, whose fine
// grade counts as the ordinary one wherever a recipe asks for it. The twelve
// farm fine twins (content/farm_crops.ts fineProduceItemId) are minted by the
// harvest roll and substitute in NEITHER direction (the rule stated beside
// fine_vale_wheat in content/items.ts). What the two share is the one thing
// this module answers: given a fine id, which ordinary item is it the fine
// grade OF. The crafting window uses that to tell a player holding the plain
// grade that it does not count toward a fine-only reagent (the Bronze Hoe
// report: "doesn't recognize that I am holding wheat").
//
// Pure leaf module: no SimContext, no rng, explicit arguments only, so a
// Vitest imports it directly. Deliberately NOT a widening of MATERIAL_GRADES,
// which the farm_crops.ts comment forbids: materialGradeIds walks that table
// alone, and a farm twin added there would start satisfying recipes asking
// for base produce.

import { FARM_CROPS } from '../content/farm_crops';
import { baseMaterialFor } from './material_grades';

const FARM_BASE_BY_FINE_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.values(FARM_CROPS).map((crop) => [crop.fineProduceItemId, crop.produceItemId]),
  ),
);

/** The ordinary item a fine id is the fine grade of (a node material's base
 *  or a farm crop's plain produce), or undefined for every other id. */
export function ordinaryGradeFor(fineItemId: string): string | undefined {
  const base = baseMaterialFor(fineItemId);
  if (base !== undefined) return base;
  return Object.hasOwn(FARM_BASE_BY_FINE_ID, fineItemId)
    ? FARM_BASE_BY_FINE_ID[fineItemId]
    : undefined;
}
