// Fresh-level-20 gear presets for the /dev kit command.
//
// Purpose: stop testers being geared by hand through the database. A tester picks
// their class-and-spec preset and lands in a coherent, reproducible set, so a
// balance run measures the encounter rather than whatever gear happened to be
// lying around.
//
// TIER: this is deliberately the PRE-SANCTUM set, because the thing being measured
// is whether a fresh level-20 group can clear Gravewyrm Sanctum. Wearing Sanctum
// loot into a Sanctum balance test would contaminate the very number under test, so
// every item that drops inside that dungeon is excluded. Heroic, raid, heroic-mark
// vendor and PvP gear are all excluded too: Sanctum sits BELOW all of them in
// progression, so none of it is reachable by the character this preset simulates.
//
// GEAR ONLY. This never touches level, spec, talents or quests: /dev level and the
// spec UI already own those, and welding them together would stop a tester varying
// one without the other.
//
// Deterministic: a pure argmax over the static content tables. No rng, no clock, so
// the same spec always yields byte-identical gear and a balance run is repeatable.

import { BAG_SOCKETS } from './bags';
import { type DevKitRole, devKitRole } from './content/dev_kit_roles';
import { HEROIC_ITEMS, RETIRED_HEROIC_ITEMS } from './content/heroic_loot';
import { HEROIC_VENDOR_ITEMS } from './content/heroic_vendor';
import { WARFARE_ITEMS } from './content/pvp_honor';
import { DUNGEONS, ITEMS, MOBS } from './data';
import { canEquipItem, canEquipItemInSlot, isShieldItem, weaponHand } from './equipment_rules';
import { itemFromRaid, itemSourceLevel } from './item_level';
import { meetsLevelRequirement } from './item_level_req';
import type { EquipSlot, ItemDef, PlayerClass } from './types';

// The level this preset dresses for. Not applied to the character: it only decides
// which items are legal to hand out.
export const DEV_KIT_LEVEL = 20;

// The dungeon whose loot is excluded, because it is the encounter under test.
export const DEV_KIT_EXCLUDED_DUNGEON = 'gravewyrm_sanctum';

// Slots the preset fills. Mirrors the paperdoll; offhand is handled with mainhand so
// two-handers and shields resolve together rather than fighting each other.
const KIT_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring1',
  'ring2',
];

// Armor is worth something to everyone but never as much as a primary stat, so it is
// divided down rather than weighted directly.
const ARMOR_DIVISOR = 12;
// A piece carrying none of the spec's identity stats still has armor and stamina, but
// handing a caster a strength plate chest because it is "heavy" is exactly the
// failure this discount prevents.
const DEAD_STAT_ARMOR_FACTOR = 0.3;
const MELEE_WEAPON_DPS_WEIGHT = 0.5;
const CASTER_WEAPON_DPS_WEIGHT = 0.1;
const SPELL_POWER_WEIGHT = 0.9;
const TANK_BLOCK_WEIGHT = 0.5;
const SECONDARY_RATING_WEIGHT = 0.3;

// The qualities a fresh level 20 can plausibly be wearing: quest and world greens
// and blues. Epic and legendary are excluded outright, and so is an item with NO
// declared quality, because unset cannot be shown to be below the cap and this list
// is the one place the tier is not allowed to leak.
export const FRESH_TWENTY_QUALITIES: ReadonlySet<string> = new Set([
  'poor',
  'common',
  'uncommon',
  'rare',
]);

// Every item id that sits ABOVE the fresh-20 tier, identified by the table that
// defines it. One entry per exclusion the tier calls for:
//   HEROIC_ITEMS / RETIRED_HEROIC_ITEMS - heroic dungeon gear (heroic_loot.ts)
//   HEROIC_VENDOR_ITEMS                 - the Heroic Marks badge vendor
//   WARFARE_ITEMS                       - PvP / honor gear
// Raid loot and Gravewyrm Sanctum drops are excluded separately (itemFromRaid and
// the per-dungeon loot sweep below) because they are drop-table facts, not tables.
const ABOVE_TIER_ITEM_IDS: ReadonlySet<string> = new Set([
  ...Object.keys(HEROIC_ITEMS),
  ...Object.keys(RETIRED_HEROIC_ITEMS),
  ...Object.keys(HEROIC_VENDOR_ITEMS),
  ...Object.keys(WARFARE_ITEMS),
]);

// Item ids that drop inside the excluded dungeon.
//
// Built here rather than read from item_level.ts because that module's source index
// deliberately keeps only { level, raid }: it can say an item is level-20 content but
// NOT which dungeon it came from, so it cannot answer this question. Memoized; the
// content tables are static.
let excludedDungeonLoot: Set<string> | null = null;

export function dungeonLootIds(dungeonId: string): ReadonlySet<string> {
  const dungeon = DUNGEONS[dungeonId];
  const ids = new Set<string>();
  if (!dungeon) return ids;
  const mobIds = new Set((dungeon.spawns ?? []).map((spawn) => spawn.mobId));
  for (const mobId of mobIds) {
    for (const entry of MOBS[mobId]?.loot ?? []) {
      if (entry.itemId) ids.add(entry.itemId);
    }
  }
  return ids;
}

function excludedLoot(): ReadonlySet<string> {
  if (!excludedDungeonLoot) {
    excludedDungeonLoot = new Set(dungeonLootIds(DEV_KIT_EXCLUDED_DUNGEON));
  }
  return excludedDungeonLoot;
}

// Reset the memoized exclusion set. Tests that mutate the content tables call this;
// production never needs it.
export function resetDevKitCache(): void {
  excludedDungeonLoot = null;
}

/**
 * Whether an item belongs in the fresh-20 pool for `cls`.
 *
 * The tier rules, in the order they bite:
 *  - must be equippable gear with a slot
 *  - never PvP/WARFARE gear (a separate currency track, not a PvE progression step)
 *  - never a heroic variant, heroic drop, or raid drop: all sit ABOVE Sanctum
 *  - never sourced from Sanctum itself, the encounter under test
 *  - must be class-legal AND level-legal at 20
 */
export function isFreshTwentyItem(cls: PlayerClass, item: ItemDef): boolean {
  if (!item.slot) return false;
  if (item.kind !== 'weapon' && item.kind !== 'armor' && item.kind !== 'held_offhand') return false;
  // QUALITY CAP, and the single most important rule here. A fresh 20 wears quest
  // greens and blues; epics are what you go INTO a dungeon to get, not what you
  // arrive in. Source filtering alone cannot express this: the scorer maximizes
  // stats, so given an epic in the pool it will always take it, and 43% of the first
  // shipped kits were epics reached through perfectly legal-looking sources.
  if (!FRESH_TWENTY_QUALITIES.has(item.quality ?? '')) return false;
  // Excluded by WHICH TABLE DEFINES the item, not by an inferred level.
  //
  // Level inference is not sound for this: the heroic-mark vendor registers its stock
  // at source level 20 (HEROIC_VENDOR_SOURCE_LEVEL), so a `source > 20` test lets
  // badge gear straight through, and some heroic pieces have NO derivable source at
  // all, so no level test can reach them. Both leaked into the first shipped priest
  // kit, the second case handing out a RETIRED id that is save-compat only and not
  // obtainable in game. Table membership is exactly the question being asked, so it
  // is what gets asked.
  if (ABOVE_TIER_ITEM_IDS.has(item.id)) return false;
  // Belt and braces for anything carrying PvP ratings that a table sweep missed.
  if (
    item.pvpOffenseRating !== undefined ||
    item.pvpDefenseRating !== undefined ||
    item.priceHonor !== undefined
  )
    return false;
  // heroicOf marks a generated heroic variant; both it and the bespoke heroic flag
  // are above this tier.
  if (item.heroicOf !== undefined || item.heroic === true) return false;
  if (itemFromRaid(item.id)) return false;
  // A derivable source above 20 is still disqualifying (raid tiers, heroic drops).
  const source = itemSourceLevel(item.id);
  if (source !== undefined && source > DEV_KIT_LEVEL) return false;
  if (excludedLoot().has(item.id)) return false;
  if (!canEquipItem(cls, item)) return false;
  // canEquipItem returns on the armor-rank check for anything with an armorType, so
  // a class-locked plate piece never reaches its own requiredClass test. Re-check it
  // here or a mail class ends up wearing warrior-only tier pieces.
  if (item.requiredClass && !item.requiredClass.includes(cls)) return false;
  return meetsLevelRequirement(DEV_KIT_LEVEL, item);
}

/** Score `item` for `role`. Higher is better. Deterministic. */
export function roleItemScore(role: DevKitRole, item: ItemDef): number {
  let score = 0;
  let identity = 0;
  for (const [stat, weight] of Object.entries(role.weights)) {
    const value = item.stats?.[stat as 'str' | 'agi' | 'sta' | 'int' | 'spi'] ?? 0;
    score += value * (weight ?? 0);
    identity += value;
  }
  const armor = item.stats?.armor ?? 0;
  score += (armor / ARMOR_DIVISOR) * (identity > 0 ? 1 : DEAD_STAT_ARMOR_FACTOR);
  if (item.weapon) {
    // Same dps derivation itemScore uses (item_level.ts): WeaponInfo carries
    // min/max/speed, never a precomputed dps.
    const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
    score += dps * (role.melee ? MELEE_WEAPON_DPS_WEIGHT : CASTER_WEAPON_DPS_WEIGHT);
  }
  if (!role.melee) score += (item.spellPower ?? 0) * SPELL_POWER_WEIGHT;
  // blockValue lives on shields specifically. kind === 'armor' is not enough to
  // narrow: jewelry declares the same kind and carries no blockValue.
  if (role.tank && isShieldItem(item)) score += (item.blockValue ?? 0) * TANK_BLOCK_WEIGHT;
  score += ((item.critRating ?? 0) + (item.hasteRating ?? 0)) * SECONDARY_RATING_WEIGHT;
  return score;
}

// weaponHand narrows to WeaponItemDef, so guard before asking. Anything that is not a
// weapon is treated as not-a-two-hander, which is what every caller means.
function isTwoHanded(item: ItemDef): boolean {
  return item.kind === 'weapon' && weaponHand(item) === 'twohand';
}

// Deterministic argmax: ties break on id so the same spec always yields the same set.
function bestBy(items: readonly ItemDef[], score: (item: ItemDef) => number): ItemDef | null {
  let best: ItemDef | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const value = score(item);
    if (value > bestScore || (value === bestScore && best !== null && item.id < best.id)) {
      best = item;
      bestScore = value;
    }
  }
  return best;
}

/** The largest-capacity bag in the fresh-20 pool, or null if there is none. */
export function bestKitBag(): ItemDef | null {
  const bags = Object.values(ITEMS).filter((item) => (item.bagSlots ?? 0) > 0);
  return bestBy(bags, (item) => item.bagSlots ?? 0);
}

export interface DevKit {
  // slot -> item id. Weapons resolve into mainhand/offhand here.
  equip: Partial<Record<EquipSlot, string>>;
  // The bag equipped into every socket, or null when the tables carry no bag.
  bagId: string | null;
  bagSockets: number;
}

/**
 * Build the fresh-20 kit for one class-and-spec pair.
 *
 * Weapons are resolved before armor so a two-hander does not get chosen for mainhand
 * and then silently displace a shield the tank preset also picked.
 */
export function buildDevKit(cls: PlayerClass, spec: string): DevKit | null {
  const role = devKitRole(cls, spec);
  if (!role) return null;

  const pool = Object.values(ITEMS).filter((item) => isFreshTwentyItem(cls, item));
  const score = (item: ItemDef): number => roleItemScore(role, item);
  const equip: Partial<Record<EquipSlot, string>> = {};

  for (const slot of KIT_SLOTS) {
    const best = bestBy(
      pool.filter((item) => canEquipItemInSlot(cls, item, slot, spec)),
      score,
    );
    if (best) equip[slot] = best.id;
  }
  // Rings: the per-slot pass would put the same id in both, so the second ring takes
  // the best DIFFERENT one.
  if (equip.ring1) {
    const secondRing = bestBy(
      pool.filter(
        (item) => item.id !== equip.ring1 && canEquipItemInSlot(cls, item, 'ring2', spec),
      ),
      score,
    );
    if (secondRing) equip.ring2 = secondRing.id;
    else delete equip.ring2;
  }

  const weapons = pool.filter((item) => canEquipItemInSlot(cls, item, 'mainhand', spec));
  const mainhand = bestBy(weapons, score);
  if (mainhand) equip.mainhand = mainhand.id;

  if (role.hands === 'shield') {
    const shields = pool.filter(
      (item) => isShieldItem(item) && canEquipItemInSlot(cls, item, 'offhand', spec),
    );
    // A shield spec wants a ONE-hander so the shield fits beside it.
    const oneHand = bestBy(
      weapons.filter((item) => !isTwoHanded(item)),
      score,
    );
    if (oneHand) equip.mainhand = oneHand.id;
    const shield = bestBy(shields, score);
    if (shield) equip.offhand = shield.id;
  } else if (role.hands === 'dualWield') {
    const offhand = bestBy(
      weapons.filter(
        (item) => item.id !== equip.mainhand && canEquipItemInSlot(cls, item, 'offhand', spec),
      ),
      score,
    );
    if (offhand) equip.offhand = offhand.id;
    // Fall back to a held offhand rather than leaving the slot empty. Reached when a
    // role claims dual-wield that canDualWield refuses, or when the pool holds no
    // legal second weapon: either way an empty hand is worse than a held item.
    else if (mainhand && !isTwoHanded(mainhand)) {
      const held = bestBy(
        pool.filter((item) => item.kind === 'held_offhand' && canEquipItem(cls, item)),
        score,
      );
      if (held) equip.offhand = held.id;
    }
  } else if (mainhand && !isTwoHanded(mainhand)) {
    // Not a dual-wielder and not carrying a two-hander: take a held offhand if one is
    // legal, so the slot is not simply wasted.
    const offhand = bestBy(
      pool.filter((item) => item.kind === 'held_offhand' && canEquipItem(cls, item)),
      score,
    );
    if (offhand) equip.offhand = offhand.id;
  }

  const bag = bestKitBag();
  return { equip, bagId: bag?.id ?? null, bagSockets: BAG_SOCKETS };
}

// The subset of SimContext the kit application needs. Declared structurally so the
// applier can be driven by a plain stub in a unit test without standing up a Sim.
export interface DevKitApplyCtx {
  addItem(itemId: string, count: number, pid?: number): void;
  equipBag(itemId: string, socket?: number, pid?: number): void;
  equipItem(itemId: string, pid?: number): void;
  unequipItem(slot: EquipSlot, pid?: number): boolean;
}

export interface DevKitApplied {
  bagId: string | null;
  bagsEquipped: number;
  slots: number;
}

/**
 * Grant and wear the preset.
 *
 * ORDER IS LOAD-BEARING. Bags go on FIRST, into every socket, before a single piece
 * of gear is granted. Sim.addItem never refuses a grant, but equipping a piece
 * displaces whatever it replaces back into the bags, and that return leg IS capacity
 * gated: with the default backpack alone a full kit can run out of room and the
 * displaced piece has nowhere to go. Equipping the bags first means the pooled
 * capacity already exists by the time any gear moves.
 *
 * Both hands are cleared before the weapons land, so a two-hander already held cannot
 * block a shield or a second weapon from routing into the offhand.
 */
export function applyDevKit(
  ctx: DevKitApplyCtx,
  cls: PlayerClass,
  spec: string,
  pid?: number,
): DevKitApplied | null {
  const kit = buildDevKit(cls, spec);
  if (!kit) return null;

  let bagsEquipped = 0;
  if (kit.bagId) {
    for (let socket = 0; socket < kit.bagSockets; socket++) {
      ctx.addItem(kit.bagId, 1, pid);
      ctx.equipBag(kit.bagId, socket, pid);
      bagsEquipped++;
    }
  }

  // Clear both hands before the weapon pass so an incumbent two-hander cannot
  // pre-empt the offhand the preset picked.
  ctx.unequipItem('mainhand', pid);
  ctx.unequipItem('offhand', pid);

  let slots = 0;
  for (const [slot, itemId] of Object.entries(kit.equip)) {
    ctx.addItem(itemId, 1, pid);
    ctx.equipItem(itemId, pid);
    slots++;
  }
  return { bagId: kit.bagId, bagsEquipped, slots };
}
