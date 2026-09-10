// Where a collectible comes from, DERIVED from the live content tables rather
// than authored twice.
//
// The Collections window has to answer four questions about every buddy, mount
// and item set in the game: where does it drop, who sells it, is it tradeable
// or soulbound, and what does a vendor pay for it. Every one of those answers
// already exists somewhere in src/sim/content (a mob's loot table, an NPC's
// vendorItems, the Heroic Quartermaster's marks stock, the global whistle drop
// tiers, the ItemDef's own soulbound/sellValue fields). Authoring a second copy
// of it for the UI would rot on the first content change, so this module reads
// the merged tables and reports what it finds. An item nothing points at
// reports as UNOBTAINABLE, which is a real answer the window shows: the catalog
// deliberately carries buddies and mounts with no source assigned yet.
//
// Pure and DOM-free (tests/collections_sources.test.ts drives it directly), and
// it holds no per-frame state: the catalog is static content, so the whole
// derivation is memoized once per item id on first ask.

import { HEROIC_BOSS_LOOT } from '../../sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../../sim/content/heroic_vendor';
import { DUNGEONS, ITEMS, MOBS, NPCS, zoneAt } from '../../sim/data';
import {
  buddyWhistlesOfQuality,
  FISHING_BUDDY_DROP,
  GLOBAL_BUDDY_DROP_TIERS,
} from '../../sim/loot/global_drops';
import type { ItemDef } from '../../sim/types';

/** What a vendor charges. Gold is copper; honor and marks are their own
 *  currencies, priced per purchase and never stack-multiplied. */
export type CollectionCurrency = 'gold' | 'honor' | 'marks';

export interface CollectionVendorSource {
  npcId: string;
  /** Canonical English NPC name; the window localizes through world_entity_i18n. */
  npcName: string;
  /** Zone the NPC stands in, by their authored position. */
  zoneName: string;
  currency: CollectionCurrency;
  /** Copper for 'gold', honor points for 'honor', Heroic Marks for 'marks'. */
  price: number;
}

export interface CollectionDropSource {
  /** Mob template id, or the boss id for a heroic-only table. */
  mobId: string;
  mobName: string;
  /** Dungeon name when the mob is a dungeon or raid boss, else its zone. */
  location: string;
  /** 0..1 per-kill chance as authored on the loot entry. */
  chance: number;
  /** The rate the same row drops at under a heroic claim, when it authors one
   *  (LootEntry.heroicChance). Null when the row drops at one rate on both
   *  difficulties, which is every other row in the game today. */
  heroicChance: number | null;
  /** True for a table that only rolls inside a heroic instance claim. */
  heroicOnly: boolean;
}

export interface CollectionGlobalDropSource {
  /** The item quality whose global tier this item rides. */
  quality: string;
  /** 0..1 per-kill chance for the TIER (shared with every item in it). */
  chance: number;
  /** How many items share the tier, so the window can say "one of N". */
  poolSize: number;
}

export interface CollectionItemFacts {
  itemId: string;
  /** English item name; the window localizes through the item i18n catalog. */
  name: string;
  quality: string;
  /** False for a soulbound item: it can never reach the market or a trade. */
  tradeable: boolean;
  /** Copper a vendor pays, or null when the item cannot be sold at all. */
  sellValue: number | null;
  vendors: CollectionVendorSource[];
  drops: CollectionDropSource[];
  /** Set when the item rides a global drop tier (the buddy whistles). Null
   *  while the tier is held at chance 0, which is how a withheld tier reads as
   *  "no source" rather than as a 0% drop the player could chase forever. */
  globalDrop: CollectionGlobalDropSource | null;
  /** The share of every landed catch that lands this whistle instead of a
   *  fish, for the one companion the water gives up (loot/global_drops.ts
   *  FISHING_BUDDY_DROP). Null for everything else, which is everything else.
   *  A number rather than a source record: fishing has no mob and no vendor to
   *  name, and "anywhere" is the whole of its location. */
  fishingDrop: number | null;
  /** False when nothing in the game grants this item today. */
  obtainable: boolean;
}

const cache = new Map<string, CollectionItemFacts>();

function zoneNameAt(x: number, z: number): string {
  return zoneAt(x, z).name;
}

/** The dungeon that spawns this mob, if any. A mob spawned by no dungeon is an
 *  overworld mob and reports its zone instead (see dropsFor). */
function dungeonOf(mobId: string): string | null {
  for (const dungeon of Object.values(DUNGEONS)) {
    if (dungeon.spawns.some((spawn) => spawn.mobId === mobId)) return dungeon.name;
  }
  return null;
}

function vendorPrice(def: ItemDef): { currency: CollectionCurrency; price: number } | null {
  if (def.priceHonor !== undefined && def.priceHonor > 0) {
    return { currency: 'honor', price: Math.floor(def.priceHonor) };
  }
  if (def.buyValue !== undefined && def.buyValue > 0) {
    return { currency: 'gold', price: def.buyValue };
  }
  return null;
}

function vendorsFor(itemId: string, def: ItemDef): CollectionVendorSource[] {
  const found: CollectionVendorSource[] = [];
  // The Heroic Quartermaster's marks stock is a table of its own (it is not an
  // NpcDef vendorItems list), so it is resolved first and its price wins: a
  // marks row is never also a copper row.
  const marks = HEROIC_VENDOR_STOCK.find((offer) => offer.itemId === itemId);
  for (const npc of Object.values(NPCS)) {
    const sellsForCurrency = npc.vendorItems?.includes(itemId) ?? false;
    const sellsForMarks = marks !== undefined && npc.heroicVendor === true;
    if (!sellsForCurrency && !sellsForMarks) continue;
    const priced = sellsForMarks
      ? { currency: 'marks' as const, price: marks.marks }
      : vendorPrice(def);
    // A stocked row with no price is a content bug, not a free item: skip it
    // rather than render a vendor the player cannot actually buy from.
    if (!priced) continue;
    found.push({
      npcId: npc.id,
      npcName: npc.name,
      zoneName: zoneNameAt(npc.pos.x, npc.pos.z),
      currency: priced.currency,
      price: priced.price,
    });
  }
  return found;
}

function dropsFor(itemId: string): CollectionDropSource[] {
  const found: CollectionDropSource[] = [];
  for (const mob of Object.values(MOBS)) {
    for (const entry of mob.loot) {
      if (entry.itemId !== itemId) continue;
      found.push({
        mobId: mob.id,
        mobName: mob.name,
        location: dungeonOf(mob.id) ?? '',
        chance: entry.chance,
        heroicChance: entry.heroicChance ?? null,
        heroicOnly: false,
      });
    }
  }
  for (const [bossId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
    for (const entry of entries) {
      if (entry.itemId !== itemId) continue;
      found.push({
        mobId: bossId,
        mobName: MOBS[bossId]?.name ?? bossId,
        location: dungeonOf(bossId) ?? '',
        chance: entry.chance,
        heroicChance: null,
        heroicOnly: true,
      });
    }
  }
  return found;
}

/** Buddy whistles only: the tier this quality rides, when it can actually
 *  drop. A tier held at chance 0 (epic today) reports null, and so does a
 *  whistle the tier's pool withholds -- the Crystal Tide, which fishing owns
 *  outright. Both the membership test and the count come from the roller's
 *  own pool rather than a second sweep over ITEMS, so the line can never claim
 *  a source the loot table would not actually pay. */
function globalDropFor(def: ItemDef): CollectionGlobalDropSource | null {
  if (def.kind !== 'buddy') return null;
  const quality = def.quality ?? 'common';
  const tier = GLOBAL_BUDDY_DROP_TIERS.find((t) => t.quality === quality);
  if (!tier || tier.chance <= 0) return null;
  const pool = buddyWhistlesOfQuality(quality);
  if (!pool.includes(def.id)) return null;
  return { quality, chance: tier.chance, poolSize: pool.length };
}

/** The catch share, for the one whistle fishing hands out. */
function fishingDropFor(itemId: string): number | null {
  return itemId === FISHING_BUDDY_DROP.itemId ? FISHING_BUDDY_DROP.chance : null;
}

/** Everything the Collections window needs about one collectible's item. */
export function collectionItemFacts(itemId: string): CollectionItemFacts | null {
  const cached = cache.get(itemId);
  if (cached) return cached;
  const def = ITEMS[itemId];
  if (!def) return null;
  const vendors = vendorsFor(itemId, def);
  const drops = dropsFor(itemId);
  const globalDrop = globalDropFor(def);
  const fishingDrop = fishingDropFor(itemId);
  const facts: CollectionItemFacts = {
    itemId,
    name: def.name,
    quality: def.quality ?? 'common',
    tradeable: def.soulbound !== true,
    // noVendorSell and a zero value are the same answer to the player: no
    // vendor hands over copper for this, so the window says so once.
    sellValue: def.noVendorSell === true || !def.sellValue ? null : def.sellValue,
    vendors,
    drops,
    globalDrop,
    fishingDrop,
    obtainable:
      vendors.length > 0 || drops.length > 0 || globalDrop !== null || fishingDrop !== null,
  };
  cache.set(itemId, facts);
  return facts;
}

/** Drop the memo. Only the tests need this (they swap the active world
 *  content, which re-resolves zones and NPCs under the same item ids). */
export function resetCollectionSourceCache(): void {
  cache.clear();
}
