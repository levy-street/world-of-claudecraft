import { STATIONS } from '../../src/sim/content/professions';
import { ITEMS, QUESTS } from '../../src/sim/data';
import { trainingFeeFor, trainingStationTypeFor } from '../../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../../src/sim/professions/types';

// Where a player learns a crafting recipe: the station master who trains it, the
// pattern items that teach it, or the quest that rewards it. The recipe pages and
// the per-profession recipe tables both read this, so the two always agree.

export type Station = (typeof STATIONS)[number];

/** Pattern item ids that teach each recipe, keyed by recipe id. */
export const RECIPE_PATTERN_ITEMS: ReadonlyMap<string, readonly string[]> = (() => {
  const out = new Map<string, string[]>();
  for (const item of Object.values(ITEMS)) {
    if (item.kind !== 'recipe') continue;
    for (const id of item.teachesRecipeIds ?? [item.teachesRecipeId]) {
      if (!id) continue;
      const entries = out.get(id) ?? [];
      entries.push(item.id);
      out.set(id, entries);
    }
  }
  return out;
})();

/** Quest ids whose reward teaches each recipe, keyed by recipe id. */
export const RECIPE_REWARD_QUESTS: ReadonlyMap<string, readonly string[]> = (() => {
  const out = new Map<string, string[]>();
  for (const quest of Object.values(QUESTS)) {
    if (!quest.recipeReward) continue;
    const entries = out.get(quest.recipeReward) ?? [];
    entries.push(quest.id);
    out.set(quest.recipeReward, entries);
  }
  return out;
})();

/** The station whose master trains this recipe, when a trainer teaches it. */
export function recipeTrainerStation(recipe: ProfessionRecipeRecord): Station | undefined {
  return recipe.acquisition?.includes('trainer')
    ? STATIONS.find((s) => s.type === trainingStationTypeFor(recipe))
    : undefined;
}

export interface RecipeSourceLinks {
  item(id: string): string;
  npc(id: string): string;
  quest(id: string): string;
}

/** A training fee in coin words: "no fee", "50 copper", "25 silver", "1 gold 20 silver". */
export function feeWords(copper: number): string {
  if (copper <= 0) return 'no fee';
  const parts: string[] = [];
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const rest = copper % 100;
  if (gold) parts.push(`${gold} gold`);
  if (silver) parts.push(`${silver} silver`);
  if (rest) parts.push(`${rest} copper`);
  return parts.join(' ');
}

/** One short "Learned from" line: each way to learn the recipe, joined with "or". */
export function recipeLearnedFrom(
  recipe: ProfessionRecipeRecord,
  links: RecipeSourceLinks,
): string {
  if (!recipe.acquisition?.length) return 'Known from the start';
  const ways = recipe.acquisition.map((source) => {
    if (source === 'trainer') {
      const station = recipeTrainerStation(recipe);
      const fee = feeWords(trainingFeeFor(recipe));
      return station
        ? `Trainer: ${links.npc(station.masterNpcId)} (${fee})`
        : `A profession trainer (${fee})`;
    }
    if (source === 'drop') {
      const patterns = RECIPE_PATTERN_ITEMS.get(recipe.id) ?? [];
      return patterns.length
        ? 'Pattern: ' + patterns.map((id) => links.item(id)).join(' or ')
        : 'A pattern';
    }
    const quests = RECIPE_REWARD_QUESTS.get(recipe.id) ?? [];
    return quests.length ? 'Quest: ' + quests.map((id) => links.quest(id)).join(' or ') : 'A quest';
  });
  return ways.join(' or ');
}
