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
  // Base item-level budget this recipe's output is balanced against (issue
  // #1127). Informational for now: the higher-tier gating (P4), the wheel
  // (P5), and archetype-exclusive combos (P8) read this later to scale the
  // quality roll and gate access. A common-tier recipe always has skillReq 0
  // per the free-floor rule.
  itemLevelBudget: number;
  // Effective content level for the profession-XP green/gray curve
  // (professions/profession_xp.ts craftActionXp). Seeded from
  // itemLevelBudget at authoring time (same numeric scale as character
  // level) and hand-adjusted where a recipe's intended character level
  // clearly diverges from its gold-sink budget.
  level: number;
  // Dual-craft requirement (issue #1132): a combo recipe exclusive to one
  // specific adjacent pair on the CRAFT_RING (src/sim/content/professions.ts
  // adjacentCrafts). When present, the crafting player must hold BOTH
  // craftA and craftB at or above minTier's flat-skill threshold (see
  // wheel.ts tierForSkill/TIER_SKILL_STEP), independent of professionId
  // above (which only names the recipe's "home" craft for listing purposes).
  // A player's skill in any craft other than these two, no matter how high,
  // never substitutes for either requirement: only craftA and craftB count.
  comboRequirement?: {
    craftA: string;
    craftB: string;
    minTier: number;
  };
  // Acquisition source(s) a recipe can be learned from (issue #1299). A recipe
  // with no `acquisition` field (or an empty list) is GRANDFATHERED: known
  // automatically to every player with no learn step required, matching the
  // behavior every recipe in content/recipes.ts had before this issue (no
  // back-compat regression for existing common-tier/combo/tool recipes). A
  // recipe that DOES list one or more sources must be acquired (see
  // professions/crafting.ts acquireRecipe) via one of the listed sources
  // before it can be crafted, independent of the player's tier/skill: knowing
  // a recipe and being able to craft it at tier are orthogonal gates.
  acquisition?: readonly ('trainer' | 'drop' | 'quest')[];
  // Station-bound crafting (issue #1297): true only for the tier-4/5 recipes
  // that require the player to be present at the level-20 crafting hub (see
  // ../professions/crafting_hub.ts + content/professions.ts CRAFTING_HUB_*).
  // Absent (the default) for every common-tier and combo recipe today: the
  // free floor stays field-craftable, matching the existing "common tier
  // never costs anything beyond materials" rule.
  requiresHubStation?: boolean;
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
