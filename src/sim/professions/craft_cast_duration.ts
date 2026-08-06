// Pure craft-cast duration (Craft Cast System Phase 1). Content-driven band
// table from content/professions.ts: skillReq (and combo membership) pick a
// duration, then floor/ceiling clamp. No rng, no player state, host-agnostic.

import {
  CRAFT_CAST_DURATION_CEILING_SEC,
  CRAFT_CAST_DURATION_FIELD_SEC,
  CRAFT_CAST_DURATION_FLOOR_SEC,
  CRAFT_CAST_DURATION_SKILL_25_SEC,
  CRAFT_CAST_DURATION_SKILL_50_SEC,
  CRAFT_CAST_DURATION_SKILL_75_SEC,
  CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC,
} from '../content/professions';

/** Minimal recipe shape the duration table needs (skill band + combo flag).
 *  Accepts full ProfessionRecipeRecord and the thinner RecipeDefLike the
 *  crafting window view builds from. */
export interface CraftCastDurationRecipe {
  skillReq: number;
  comboRequirement?: unknown;
}

/** Sim-seconds for one craft cast of `recipe`. Combo recipes always use the
 *  top band; otherwise skillReq steps the ladder. Clamped to the content
 *  floor/ceiling. Draw-free and pure. */
export function craftCastDurationSec(recipe: CraftCastDurationRecipe): number {
  let duration: number;
  if (recipe.comboRequirement) {
    duration = CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC;
  } else if (recipe.skillReq <= 0) {
    duration = CRAFT_CAST_DURATION_FIELD_SEC;
  } else if (recipe.skillReq <= 25) {
    duration = CRAFT_CAST_DURATION_SKILL_25_SEC;
  } else if (recipe.skillReq <= 50) {
    duration = CRAFT_CAST_DURATION_SKILL_50_SEC;
  } else if (recipe.skillReq <= 75) {
    duration = CRAFT_CAST_DURATION_SKILL_75_SEC;
  } else {
    duration = CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC;
  }
  return Math.min(
    CRAFT_CAST_DURATION_CEILING_SEC,
    Math.max(CRAFT_CAST_DURATION_FLOOR_SEC, duration),
  );
}
