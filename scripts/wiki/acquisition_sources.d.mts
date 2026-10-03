// Type surface for acquisition_sources.mjs (where a pattern, formula, or crafting
// material comes from), so the vitest suite imports it under strict TS like the
// other declared scripts modules (vendor_channel.d.mts, still_key.d.mts).

/** Where an item drops, by kind only (the wiki never names an instance or boss). */
export type DropPlace = 'world' | 'dungeon' | 'heroic' | 'raid' | 'rift';

export type QuartermasterOffer =
  | { kind: 'heroic'; marks: number }
  | { kind: 'crucible'; sigilId: string }
  | { kind: 'faction'; factionId: string | null; tier: string; marks: number };

export interface SourceLootRow {
  itemId?: string | undefined;
  questId?: string | undefined;
}

export interface SourceMobDef {
  name: string;
  elite?: boolean | undefined;
  boss?: boolean | undefined;
  rare?: boolean | undefined;
  worldBoss?: boolean | undefined;
  loot?: readonly SourceLootRow[] | undefined;
}

export interface SourceDungeonDef {
  suggestedPlayers?: number | undefined;
  spawns?: readonly { mobId?: string | undefined }[] | undefined;
}

export interface SourceTables {
  mobs: Record<string, SourceMobDef>;
  dungeons: readonly SourceDungeonDef[];
  overworldZonesOfMob: (mobId: string) => readonly string[];
  heroicBossLoot: Record<string, readonly SourceLootRow[]>;
  riftItemIds: readonly string[];
  heroicVendorStock: readonly { itemId: string; marks: number }[];
  crucibleVendorStock: readonly { itemId: string; sigilId: string }[];
  factionVendorGates: Record<
    string,
    { factionId?: string | undefined; standingTier: string; currencyCost: number }
  >;
}

export interface SourceIndex {
  dropPlaces: Map<string, Set<DropPlace>>;
  questDropPlaces: Map<string, Set<DropPlace>>;
  namedDroppers: Map<string, Set<string>>;
  eliteZones: Map<string, Set<string>>;
  offers: Map<string, QuartermasterOffer[]>;
}

export interface TeachingSources {
  drops: DropPlace[];
  offers: QuartermasterOffer[];
}

export declare function isWithheldCarrier(mob: SourceMobDef | undefined): boolean;

export declare function instanceKind(dungeon: SourceDungeonDef): 'raid' | 'dungeon';

export declare function buildSourceIndex(tables: SourceTables): SourceIndex;

export declare function dropPlacesFor(itemId: string, index: SourceIndex): DropPlace[];

export declare function questDropPlacesFor(itemId: string, index: SourceIndex): DropPlace[];

export declare function offersFor(itemId: string, index: SourceIndex): QuartermasterOffer[];

export declare function namedDroppersFor(
  itemId: string,
  index: SourceIndex,
): { name: string; zone: string }[];

export declare function eliteZonesFor(itemId: string, index: SourceIndex): string[];

export declare function teachingSources(
  patternIds: readonly string[],
  index: SourceIndex,
): TeachingSources | null;
