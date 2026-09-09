// Type surface for vendor_channel.mjs (the wiki's pattern-channel
// classification), so the vitest suite imports it under strict TS like the
// other declared scripts modules (still_key.d.mts, family_guard.d.mts).

/** A loot row as the wiki derivation reads it: only the optional item id
 *  matters here, so a table row with none (a coin or an xp roll) is skipped. */
export interface PatternLootRow {
  itemId?: string | undefined;
}

/** A bestiary def as the wiki derivation reads it. */
export interface PatternMobDef {
  loot?: readonly PatternLootRow[] | undefined;
}

/** A vendor offer as the wiki derivation reads it. */
export interface PatternVendorOffer {
  itemId: string;
}

/** A recipe def as the wiki derivation reads it. */
export interface PatternRecipeDef {
  id?: string;
  resultItemId: string;
  acquisition?: readonly string[] | undefined;
}

export interface PatternChannelTables {
  items?: Record<
    string,
    {
      kind: string;
      teachesRecipeId?: string;
      teachesRecipeIds?: readonly string[];
      teachesEnchantId?: string;
    }
  >;
  mobs: Record<string, PatternMobDef>;
  heroicBossLoot: Record<string, readonly PatternLootRow[]>;
  riftPatternItemIds: readonly string[];
  farmRiftDropItemIds: readonly string[];
  heroicVendorStock: readonly PatternVendorOffer[];
}

export interface PatternChannelSets {
  patternsByRecipe?: Map<string, Set<string>>;
  dropped: Set<string>;
  vendor: Set<string>;
}

/** The five values the wiki craft table's Source column renders. */
export type WikiAcquisitionChannel = 'trainer' | 'dropAndVendor' | 'vendor' | 'drop' | 'known';

export declare function patternItemIdFor(resultItemId: string): string;

export declare function patternChannelSets(tables: PatternChannelTables): PatternChannelSets;

export declare function dropTaughtRecipe(
  recipe: PatternRecipeDef,
  sets: PatternChannelSets,
): boolean;

export declare function vendorTaughtRecipe(
  recipe: PatternRecipeDef,
  sets: PatternChannelSets,
): boolean;

export declare function recipeAcquisitionChannel(
  recipe: PatternRecipeDef,
  sets: PatternChannelSets,
): WikiAcquisitionChannel;
