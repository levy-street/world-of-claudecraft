// Pure apex-recipe presentation decisions for the crafting window
// (Masterwrought phase 14, deliverable C): whether a KNOWN recipe row gets the
// restrained apex treatment, whether it links to the Perfecting window, and
// where its pattern came from. A sibling pure core beside crafting_view.ts
// (module-first) so the window stays a thin painter and a Vitest drives the
// decisions directly.
//
// A closed ruling says the crafting window lists the viewer's KNOWN recipes
// only, so everything here decorates rows that already render; nothing ever
// reveals or lists an unlearned recipe.
//
// The provenance channel is CONTENT-derived, never invented: the R8 channel
// doctrine (content/apex_patterns.ts header) splits the apex patterns across
// three pillars, and this module reads the same tables those channels are
// authored in (the recipe arrays for raid/rift membership, the Heroic
// Quartermaster stock for the vendor rows). A pattern-taught recipe outside
// all three (a future channel) answers the generic 'drop' so the hint never
// asserts a route content does not name.

import { HEROIC_VENDOR_STOCK } from '../../../sim/content/heroic_vendor';
import { APEX_ARMOR_RECIPES, APEX_GEAR_RECIPES, ROD_RECIPES } from '../../../sim/content/recipes';
import { ITEMS } from '../../../sim/data';
import { craftForApexItem } from '../../../sim/professions/perfecting';

// The apex tier's skill floor (the phase 09 apex rung: every apex recipe is
// authored at skillReq 100; masterwrought Phase 11o retired the fictional 150).
export const APEX_TIER_SKILL_REQ = 100;

/** Where a pattern-taught recipe's pattern comes from (the R8 channels), or
 *  null for a recipe no pattern teaches (trainer/grandfathered rows). */
export type ApexPatternChannel = 'raid' | 'rift' | 'vendor' | 'drop' | null;

export interface ApexRecipePresentation {
  /** On the apex tier at all: output on the Perfecting track, or authored at
   *  the apex skill floor. Drives the restrained apex chip + treatment. */
  apex: boolean;
  /** The output is a masterwrought piece (craftForApexItem non-null): the row
   *  earns the subtle Perfecting-window affordance. */
  perfectingTrack: boolean;
  channel: ApexPatternChannel;
}

// Channel membership, derived once from static content (both hosts serve the
// same tables). The raid channel is the ten APEX_GEAR patterns riding the
// Nythraxis loot table; the rift channel is the APEX_ARMOR patterns on
// winning B/A/S clears; the vendor channel is whatever pattern items the
// Heroic Quartermaster actually stocks (read off the stock itself rather than
// restating the consumable list, so an added vendor row reclassifies here for
// free).
const RAID_RECIPE_IDS: ReadonlySet<string> = new Set(APEX_GEAR_RECIPES.map((r) => r.id));
const RIFT_RECIPE_IDS: ReadonlySet<string> = new Set(APEX_ARMOR_RECIPES.map((r) => r.id));
const VENDOR_TAUGHT_RECIPE_IDS: ReadonlySet<string> = new Set(
  HEROIC_VENDOR_STOCK.map((offer) => ITEMS[offer.itemId])
    .filter((def) => def?.kind === 'recipe')
    .map((def) => (def as { teachesRecipeId: string }).teachesRecipeId),
);

// Every recipe a kind:'recipe' pattern item teaches, so the generic 'drop'
// fallback fires only where a pattern really exists (the consumable/rod rows
// are pattern-taught AND vendor-stocked; membership order below resolves them
// to 'vendor').
const PATTERN_TAUGHT_RECIPE_IDS: ReadonlySet<string> = new Set(
  Object.values(ITEMS)
    .filter((def) => def.kind === 'recipe')
    .map((def) => (def as { teachesRecipeId: string }).teachesRecipeId),
);

// The apex rod rung rides the vendor channel by content (its schematic is
// quartermaster stock); listed here only so the apex CHIP fires for it even
// though its output is a tool, not Perfecting-track gear.
const APEX_ROD_RECIPE_IDS: ReadonlySet<string> = new Set(
  ROD_RECIPES.filter((r) => r.skillReq >= APEX_TIER_SKILL_REQ).map((r) => r.id),
);

export function apexPatternChannel(recipeId: string): ApexPatternChannel {
  if (RAID_RECIPE_IDS.has(recipeId)) return 'raid';
  if (RIFT_RECIPE_IDS.has(recipeId)) return 'rift';
  if (VENDOR_TAUGHT_RECIPE_IDS.has(recipeId)) return 'vendor';
  return PATTERN_TAUGHT_RECIPE_IDS.has(recipeId) ? 'drop' : null;
}

export function apexRecipePresentation(
  recipeId: string,
  resultItemId: string,
  skillReq: number,
): ApexRecipePresentation {
  const perfectingTrack = craftForApexItem(resultItemId) !== null;
  const apex =
    perfectingTrack || skillReq >= APEX_TIER_SKILL_REQ || APEX_ROD_RECIPE_IDS.has(recipeId);
  return { apex, perfectingTrack, channel: apex ? apexPatternChannel(recipeId) : null };
}
