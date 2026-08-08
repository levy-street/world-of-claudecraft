// Item level: a single "how powerful is this drop" number derived from WHERE an
// item comes from (the level of the mob that drops it, or the boss a quest-reward
// is gated behind) plus a rarity bump, and the stat budget that an item of that
// level + quality + slot is expected to carry.
//
// This is a pure, host-agnostic leaf (no DOM, no rng, no Sim state): it reads only
// the static content tables and does arithmetic, so the HUD imports it directly the
// same way it already consumes other pure sim leaves (data, world, equipment_rules,
// lockpick). The architecture purity gate (tests/architecture.test.ts) keeps it
// host-agnostic. Keeping the formula on the sim side gives one source of truth;
// tests import it directly.
//
// Two distinct outputs:
//   - itemLevel(item): the tier number shown in the tooltip ("Item Level 10").
//   - primaryStatBudget(...): the total primary-stat points an item of that tier
//     SHOULD grant. normalizePrimaryStats() distributes that budget back across an
//     item's existing stats so two drops from the same place carry the same total
//     power while keeping their own stat identity (a warrior plate piece stays
//     str/sta, a mage cloth piece stays int/spi). itemScore() is the realized
//     power (stats + armor + weapon dps) for at-a-glance comparison.

import {
  HEROIC_BOSS_LOOT,
  HEROIC_LOOT_SOURCE_LEVEL,
  NYTHRAXIS_RAID_BOSS_ID,
  NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL,
} from './content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from './content/heroic_vendor';
import { FURY_STOCK, WARFARE_SOURCE_LEVEL } from './content/pvp_honor';
import {
  RIFT_EPIC_ITEM_IDS,
  RIFT_GEAR_ITEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
  RIFT_RARE_ITEM_IDS,
} from './content/rift/items';
import { ALL_RECIPES, DUNGEONS, ITEMS, MOBS, QUESTS } from './data';
// The pure budget primitives live in the leaf module ./item_budget (no ./data
// import, so content/heroic_variants.ts can share them at data-eval time without a
// cycle). Imported for internal use and re-exported so every existing importer of
// item_level keeps working unchanged.
import {
  HEROIC_VARIANT_SOURCE_LEVEL,
  normalizePrimaryStats,
  PRIMARY_STATS,
  type PrimaryStat,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  QUALITY_STAT_MULT,
  SLOT_STAT_MULT,
  STAT_PER_ILVL,
  slotStatMultForItem,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  WORN_OFFHAND_STAT_MULT,
} from './item_budget';
import type { ItemDef } from './types';

export {
  HEROIC_VARIANT_SOURCE_LEVEL,
  normalizePrimaryStats,
  PRIMARY_STATS,
  type PrimaryStat,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  QUALITY_STAT_MULT,
  SLOT_STAT_MULT,
  STAT_PER_ILVL,
  slotStatMultForItem,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  WORN_OFFHAND_STAT_MULT,
};

// Raid loot is one tier above same-level 5-player dungeon loot: a 10-player raid
// encounter confers this item-level bonus on top of the mob's character level, so
// the raid set (Nythraxis) reads as a higher item level than the dungeon set
// (Korzul) even though both bosses are level 20. RAID_MIN_PLAYERS is the
// suggestedPlayers threshold that marks a dungeon as a raid.
export const RAID_ILVL_BONUS = 3;
export const RAID_MIN_PLAYERS = 10;

// The source level the Heroic Quartermaster's stock reads as (heroic dungeons
// are level-20 content); see buildSourceIndex.
export const HEROIC_VENDOR_SOURCE_LEVEL = 20;

// The source level the rift-only clear-time gear (the four rift-signature epics
// plus the two legendaries) reads as. The B/A/S clear pool ALSO pays the heroic
// five-man epics, which register themselves off HEROIC_BOSS_LOOT below at this
// same level, so a rift never re-prices them (bump() is highest-level-wins and
// equal levels are a no-op). The rift mobs themselves are source level 23 (their
// maxLevel after the rank retune capped spawns at 23; the mob-loot block below
// picks this up), so the rare world-drops land at ilvl 26 (23 + rare bonus 3)
// automatically. The clear-time epics sit above the static drops and register at
// HEROIC_LOOT_SOURCE_LEVEL (25) just like the five-man heroic table, giving them
// ilvl 31 (25 + epic 6); the legendaries register one tier higher again, at
// RIFT_LEGENDARY_LOOT_SOURCE_LEVEL (27), for ilvl 37. The C rank pays from the
// level-20 NORMAL five-man pool, whose members keep their own source 20
// (ilvl 23 rares / 26 epics); see rift/loot_pools.ts. The riftbound
// rings (A/S personal gear, source level 20) and gems/essence (tools, no slot)
// are excluded from item-level registration: rings derive their level from the
// personal first-clear event (not a static loot source), and tools have no slot
// so isItemLevelEligible returns false already.
export const RIFT_CLEAR_LOOT_SOURCE_LEVEL = HEROIC_LOOT_SOURCE_LEVEL; // 25

// The two S-rank legendary chase items sit a tier ABOVE the clear-time epics, at
// the raid loot source level, so they land at item level 37 (27 + legendary 10).
// This is a deliberate exception to "a rift never mints above its own tier": the
// maintainer's call is that the S legendaries ARE top-of-game gear, gated behind
// a 0.3% roll on the hardest rank of content whose portals spawn a handful of
// times a day server-wide. They are NOT flagged as raid drops (itemFromRaid stays
// false); only the source level is shared.
export const RIFT_LEGENDARY_LOOT_SOURCE_LEVEL = NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL; // 27

// itemScore weights: how many armor points and how much weapon DPS count as one
// primary-stat point, so a single comparable number can span gear types.
export const ARMOR_PER_POINT = 12;
export const WEAPON_DPS_WEIGHT = 0.5;

// mobId -> the largest suggestedPlayers of any dungeon the mob spawns in (a raid
// boss therefore reports its raid size). Lets a drop know it came from a raid
// without a per-mob flag. Built lazily + memoized, pure over the static tables.
let encounterIndex: Map<string, number> | null = null;

function encounterIndexOf(): Map<string, number> {
  if (encounterIndex) return encounterIndex;
  const idx = new Map<string, number>();
  for (const def of Object.values(DUNGEONS)) {
    for (const spawn of def.spawns) {
      const prev = idx.get(spawn.mobId);
      if (prev === undefined || def.suggestedPlayers > prev)
        idx.set(spawn.mobId, def.suggestedPlayers);
    }
  }
  encounterIndex = idx;
  return idx;
}

function isRaidMob(mobId: string): boolean {
  return (encounterIndexOf().get(mobId) ?? 0) >= RAID_MIN_PLAYERS;
}

// itemId -> { level, raid }: the level the item drops at (top of the dropping mob's
// band, or the hardest boss a quest-reward is gated behind) and whether its best
// source is a raid encounter. Built once, lazily, from the static tables (so data.ts
// is fully initialized first) and memoized. Deterministic: pure function of the
// content tables, no rng, no clock.
interface ItemSource {
  level: number;
  raid: boolean;
}
let sourceIndex: Map<string, ItemSource> | null = null;

function buildSourceIndex(): Map<string, ItemSource> {
  const idx = new Map<string, ItemSource>();
  const bump = (itemId: string | undefined, level: number | undefined, raid: boolean): void => {
    if (!itemId || level === undefined) return;
    const prev = idx.get(itemId);
    // Highest level wins; the raid flag is OR'd so a raid source always counts.
    if (prev === undefined || level > prev.level)
      idx.set(itemId, { level, raid: raid || (prev?.raid ?? false) });
    else if (raid && !prev.raid) idx.set(itemId, { ...prev, raid: true });
  };
  // Mob loot: an item is "current" at the top of the dropping mob's level band.
  for (const mob of Object.values(MOBS)) {
    if (!mob.loot) continue;
    const raid = isRaidMob(mob.id);
    for (const entry of mob.loot) bump(entry.itemId, mob.maxLevel, raid);
  }
  // Quest rewards: gated behind the quest's hardest combat source: direct kill
  // objectives, or collected quest items traced back to the mob that drops them.
  // Fall back to the quest's own minLevel when no concrete source exists.
  for (const quest of Object.values(QUESTS)) {
    let source: ItemSource | undefined;
    const consider = (level: number | undefined, raid: boolean): void => {
      if (level === undefined) return;
      if (source === undefined || level > source.level)
        source = { level, raid: raid || (source?.raid ?? false) };
      else if (raid && !source.raid) source = { ...source, raid: true };
    };
    for (const objective of quest.objectives) {
      if (objective.type === 'kill' && objective.targetMobId) {
        const mob = MOBS[objective.targetMobId];
        consider(mob?.maxLevel, mob ? isRaidMob(mob.id) : false);
      } else if (objective.type === 'collect' && objective.itemId) {
        const collectedSource = idx.get(objective.itemId);
        consider(collectedSource?.level, collectedSource?.raid ?? false);
      }
    }
    consider(quest.minLevel, false);
    for (const itemId of Object.values(quest.itemRewards))
      bump(itemId, source?.level, source?.raid ?? false);
  }
  // Heroic Quartermaster stock: the marks-vendor jewelry never drops from a mob,
  // but it IS level-20 heroic content (Heroic Marks only come from heroic final
  // bosses), so the stock reads that source level: the epic pieces land at item
  // level 26 (20 + the epic bump) and get budget-enforced like any drop.
  for (const offer of HEROIC_VENDOR_STOCK) bump(offer.itemId, HEROIC_VENDOR_SOURCE_LEVEL, false);
  // FURY's WARFARE stock is level-22 PvP content. The epic quality bump puts
  // every piece at item level 28, including vendor-only necks and rings.
  for (const itemId of FURY_STOCK) bump(itemId, WARFARE_SOURCE_LEVEL, false);
  // Heroic boss drops: level-20 content one tier up (the heroic bump), so the
  // five-man epic pieces read item level 31 (25 + the epic bump). The 10-player
  // raid (Heroic Nythraxis) is one tier ABOVE the five-mans: its heroic-only
  // weapons register at NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL (27) so they land at
  // item level 33.
  for (const [bossId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
    const src =
      bossId === NYTHRAXIS_RAID_BOSS_ID
        ? NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL
        : HEROIC_LOOT_SOURCE_LEVEL;
    for (const entry of entries) {
      if (entry.itemId) bump(entry.itemId, src, false);
    }
  }
  // Heroic upgraded drop variants (content/heroic_variants.ts): the "Heroic X"
  // copies of base dungeon drops read one tier up (source 22), so their epics land
  // at item level 28 and rares at 25. Registered here so a variant's tooltip level
  // and budget derive from the index like any other drop. The exception is the
  // heroic RAID: the Nythraxis raid boss's own set pieces and legendaries upgrade
  // to the raid tier (source 27, item level 33/37), anchored on the raid boss's
  // normal loot so the auto-swap in a heroic claim reads the raid tier too.
  const raidBases = new Set(
    (MOBS[NYTHRAXIS_RAID_BOSS_ID]?.loot ?? []).flatMap((e) => (e.itemId ? [e.itemId] : [])),
  );
  for (const item of Object.values(ITEMS)) {
    if (!item.heroicOf) continue;
    const src = raidBases.has(item.heroicOf)
      ? NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL
      : HEROIC_VARIANT_SOURCE_LEVEL;
    bump(item.id, src, false);
  }
  // Rift-only clear-time epics and legendaries: gated behind B+/A/S final-boss
  // kills (addRiftClearGearLoot), they never appear on static mob loot tables, so
  // the mob-loot block above never registers them. The epics register at
  // RIFT_CLEAR_LOOT_SOURCE_LEVEL (25) for item level 31; the legendaries at
  // RIFT_LEGENDARY_LOOT_SOURCE_LEVEL (27) for item level 37. Both sit above the
  // rift world-drop rares (ilvl 26, auto-registered via the mob-loot block above
  // since rift mobs are maxLevel 23). Neither is a raid source.
  for (const id of RIFT_EPIC_ITEM_IDS) bump(id, RIFT_CLEAR_LOOT_SOURCE_LEVEL, false);
  for (const id of RIFT_LEGENDARY_ITEM_IDS) bump(id, RIFT_LEGENDARY_LOOT_SOURCE_LEVEL, false);
  // Rift rare world-drops: already picked up by the mob-loot block (rift mobs are
  // maxLevel 23) but listed here explicitly so the intent is clear. The bump() call
  // is a no-op when the mob block already registered a higher-or-equal level.
  for (const id of RIFT_RARE_ITEM_IDS) bump(id, 23, false);
  // Riftbound rings (RIFT_GEAR_ITEM_IDS): personal gear created on first-clear via
  // createRiftGearInstance. They have no static loot source, so we skip registration
  // here. Their tooltip defers to the instance payload's rolled quality.
  void RIFT_GEAR_ITEM_IDS; // referenced to keep the import non-dead
  // Crafted gear (content/recipes.ts): a recipe's output is current at the recipe's
  // own level (the level a character can learn/use it, mirroring how a mob's level
  // stands in for its loot). Without this, any crafted item with primary stats has
  // no derivable item level: the budget gates below skip it and the tooltip's item
  // level/score lines never show. Not a raid source.
  for (const recipe of ALL_RECIPES) bump(recipe.resultItemId, recipe.level, false);
  return idx;
}

function sourceIndexOf(): Map<string, ItemSource> {
  if (!sourceIndex) sourceIndex = buildSourceIndex();
  return sourceIndex;
}

// The level of the content an item drops from, or undefined for items with no
// drop/quest source (vendor stock, starter gear, junk, conjured/quest items).
export function itemSourceLevel(itemId: string): number | undefined {
  return sourceIndexOf().get(itemId)?.level;
}

// Whether an item's best source is a 10-player raid encounter (drives the raid
// item-level bonus). False for dungeon/world drops and quest rewards.
export function itemFromRaid(itemId: string): boolean {
  return sourceIndexOf().get(itemId)?.raid ?? false;
}

// Item level is a combat-gear concept. Slot-bearing non-combat oddities (tools,
// quest objects, cosmetics) can exist in the item model, but should not get an
// item-level readout or stat budget.
export function isItemLevelEligible(item: ItemDef): boolean {
  return (
    !!item.slot && (item.kind === 'armor' || item.kind === 'weapon' || item.kind === 'held_offhand')
  );
}

// The item level (tier number) shown in the tooltip, or undefined when there is no
// derivable source (so the UI simply omits the line for sourceless items). Adds the
// raid bonus so raid loot reads a tier above same-level dungeon loot.
export function itemLevel(item: ItemDef): number | undefined {
  if (!isItemLevelEligible(item)) return undefined;
  const src = sourceIndexOf().get(item.id);
  if (src === undefined) return undefined;
  const bonus = QUALITY_ILVL_BONUS[item.quality ?? 'common'] ?? 0;
  const raid = src.raid ? RAID_ILVL_BONUS : 0;
  return Math.max(1, src.level + bonus + raid);
}

// The budget an item is expected to carry given its own source/quality/slot, or
// undefined when the item has no derivable item level. A two-handed weapon carries
// only the modest TWOHAND_STAT_MULT premium over the mainhand line (its real
// compensation is weapon dps, TWOHAND_DPS_MULT); rounded so budgets stay integral.
export function expectedStatBudget(item: ItemDef): number | undefined {
  const level = itemLevel(item);
  if (level === undefined) return undefined;
  const base = primaryStatBudget(level, item.quality, item.slot, slotStatMultForItem(item));
  return item.kind === 'weapon' && item.hand === 'twohand'
    ? Math.round(base * TWOHAND_STAT_MULT)
    : base;
}

// The sum of an item's primary stats (its realized stat budget).
export function primaryStatSum(item: ItemDef): number {
  if (!item.stats) return 0;
  let sum = 0;
  for (const k of PRIMARY_STATS) sum += item.stats[k] ?? 0;
  return sum;
}

// A single comparable power number: primary stats + armor (converted) + weapon DPS
// (converted). Rounded to one decimal for stable display/sorting.
export function itemScore(item: ItemDef): number {
  let score = primaryStatSum(item);
  if (item.stats?.armor) score += item.stats.armor / ARMOR_PER_POINT;
  if (item.weapon) {
    const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
    score += dps * WEAPON_DPS_WEIGHT;
  }
  return Math.round(score * 10) / 10;
}

// Test/tooling hook: drop the memoized index so a test that mutates the tables can
// rebuild it. Not used by the running game.
export function resetItemLevelCache(): void {
  sourceIndex = null;
  encounterIndex = null;
}
