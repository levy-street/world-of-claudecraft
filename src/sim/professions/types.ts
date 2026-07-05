// Shared professions contracts (#1164): skill/craft/recipe/node record shapes,
// content-as-code friendly per `src/sim/content/` conventions. Populated content
// tables and mechanics land in later issues (#1119/#1120/#1125/#1126/#1140);
// this file settles the shapes those issues build against so nobody duplicates
// them ad hoc.
//
// Zero DOM/browser/Three.js imports here (this is `src/sim/`, guarded by
// tests/architecture.test.ts). No randomness: pure declarative shapes.

export type ProfessionCategory = 'gathering' | 'crafting' | 'secondary';

// A profession itself (mining, herbalism, alchemy, cooking, ...). Content
// authors add one ProfessionRecord per profession under src/sim/content/.
export interface ProfessionRecord {
  id: string;
  category: ProfessionCategory;
  maxSkill: number;
}

// A gathering node (ore vein, herb patch, skinnable corpse, ...) a gathering
// profession can harvest.
export interface ProfessionNodeRecord {
  id: string;
  professionId: string;
  zoneId: string;
  respawnSeconds: number;
  skillReq: number;
  lootTable: readonly { itemId: string; weight: number }[];
}

// A single reagent requirement line inside a RecipeRecord.
export interface ProfessionReagent {
  itemId: string;
  count: number;
}

// A static recipe a crafting profession can learn: what it consumes, what it
// produces, and the skill gates around it.
export interface ProfessionRecipeRecord {
  id: string;
  professionId: string;
  resultItemId: string;
  resultCount: number;
  reagents: readonly ProfessionReagent[];
  skillReq: number;
  // Skill at which the recipe stops granting skill-ups ("grey"/trivial).
  trivialAt: number;
}

// One performed craft (a runtime instance of a RecipeRecord being worked),
// distinct from the static recipe it is derived from.
export interface ProfessionCraftRecord {
  recipeId: string;
  professionId: string;
  craftSeconds: number;
}

// A player's current standing in one profession.
export interface PlayerProfessionSkill {
  professionId: string;
  skill: number;
  maxSkill: number;
}
