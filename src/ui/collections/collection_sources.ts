// Where a collectible comes from, DERIVED from the live content tables rather
// than authored twice.
//
// The Collections window has to answer, for every buddy, mount and item
// set in the game: where does it come from, who sells it, is it tradeable or
// soulbound, and what does a vendor pay for it. Every one of those answers
// already exists somewhere in src/sim/content (a mob's loot table, an NPC's
// vendorItems, the Heroic Quartermaster's marks stock, the buddy source tables,
// the ItemDef's own soulbound/sellValue fields). Authoring a second copy of it
// for the UI would rot on the first content change, so this module reads the
// merged tables and reports what it finds. A collectible nothing points at
// reports as UNOBTAINABLE, which is a real answer the window shows: the catalog
// deliberately carries buddies and mounts with no source assigned yet.
//
// Buddies are NOT items (src/sim/buddies.ts): a companion's sources are the
// per-player boss rolls and the deed that grants it (content/buddy_sources.ts),
// plus the vendor that sells its grant TOKEN where one still does.
//
// Pure and DOM-free (tests/collections_sources.test.ts drives it directly), and
// it holds no per-frame state: the catalog is static content, so the whole
// derivation is memoized once per id on first ask.

import type { BuddyKey } from '../../sim/content/buddies';
import { buddyBossDropsOf, buddyDeedOf } from '../../sim/content/buddy_sources';
import { HEROIC_BOSS_LOOT } from '../../sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../../sim/content/heroic_vendor';
import { DUNGEONS, ITEMS, MOBS, NPCS, zoneAt } from '../../sim/data';
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
  /** False when nothing in the game grants this item today. */
  obtainable: boolean;
}

/** One per-player boss roll for a companion (content/buddy_sources.ts). */
export interface CollectionBossDropSource {
  bossId: string;
  bossName: string;
  /** The dungeon the boss stands in, or its zone for a world boss. */
  location: string;
  chance: number;
  heroicChance: number | null;
  heroicOnly: boolean;
}

/** Everything the buddy tab needs about one companion's sources. */
export interface BuddySourceFacts {
  key: BuddyKey;
  bossDrops: CollectionBossDropSource[];
  /** The deed that grants it, or null. The window localizes the name. */
  deedId: string | null;
  /** The grant token's item facts (its vendors), or null when no token exists. */
  token: CollectionItemFacts | null;
  obtainable: boolean;
}

const cache = new Map<string, CollectionItemFacts>();
const buddyCache = new Map<string, BuddySourceFacts>();

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

/** Everything the Collections window needs about one collectible's item. */
export function collectionItemFacts(itemId: string): CollectionItemFacts | null {
  const cached = cache.get(itemId);
  if (cached) return cached;
  const def = ITEMS[itemId];
  if (!def) return null;
  const vendors = vendorsFor(itemId, def);
  const drops = dropsFor(itemId);
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
    obtainable: vendors.length > 0 || drops.length > 0,
  };
  cache.set(itemId, facts);
  return facts;
}

/** A boss's place: its dungeon, or the zone it stands in for a world boss. */
function bossLocation(bossId: string): string {
  const dungeon = dungeonOf(bossId);
  if (dungeon) return dungeon;
  return '';
}

/** The grant-token item for a companion, resolved from the item table rather
 *  than an id convention (the whistle record names the buddy). */
export function buddyTokenItemId(key: string): string | null {
  for (const def of Object.values(ITEMS)) {
    if (def.kind === 'buddy' && def.buddy === key) return def.id;
  }
  return null;
}

/** Everything the buddy tab needs about one companion's sources. */
export function buddySourceFacts(key: BuddyKey): BuddySourceFacts {
  const cached = buddyCache.get(key);
  if (cached) return cached;
  const bossDrops: CollectionBossDropSource[] = buddyBossDropsOf(key).map((row) => ({
    bossId: row.bossId,
    bossName: MOBS[row.bossId]?.name ?? row.bossId,
    location: bossLocation(row.bossId),
    chance: row.chance,
    heroicChance: row.heroicChance ?? null,
    heroicOnly: row.heroicOnly === true,
  }));
  const deedId = buddyDeedOf(key);
  const tokenId = buddyTokenItemId(key);
  const token = tokenId ? collectionItemFacts(tokenId) : null;
  const facts: BuddySourceFacts = {
    key,
    bossDrops,
    deedId,
    token,
    // A token nothing sells is not a source: the companion is obtainable only
    // through a boss, a deed, or a vendor that still stocks its whistle.
    obtainable: bossDrops.length > 0 || deedId !== null || (token?.vendors.length ?? 0) > 0,
  };
  buddyCache.set(key, facts);
  return facts;
}

/** Drop the memos. Only the tests need this (they swap the active world
 *  content, which re-resolves zones and NPCs under the same ids). */
export function resetCollectionSourceCache(): void {
  cache.clear();
  buddyCache.clear();
}
