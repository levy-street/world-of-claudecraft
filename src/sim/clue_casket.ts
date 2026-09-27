// The Treasure Casket (Clue Scrolls, Stage 3): what opening the casket the last
// hunt step hands pays out (docs/design/clue-scrolls.md, "The casket"). Owns
// the payout FUNCTIONS only; the lifetime count lives on
// PlayerMeta.clueCasketsOpened (world_quest_state.ts) and feeds the
// clueCasketsOpened deed meter (deeds.ts), which is why the open site marks a
// full deeds pass. Every roll draws from ctx.rng, so the three hosts agree.

import { delveChestItemsForTier } from './content/delves/lockpick_tiers';
import { HEROIC_MARK_ITEM_ID } from './content/dungeon_difficulty';
import type { MountKey } from './content/mounts';
import type { LootTier } from './lockpick';
import { mountOwned } from './mounts';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

/** Copper a casket pays: CASKET_COPPER_BASE + CASKET_COPPER_PER_LEVEL * level.
 *  A WORKING RULE, not a classic-era formula: 4g flat plus 10s per level (a
 *  level-20 casket pays 6g), sized to sit above a day's world-quest copper
 *  without rivalling a dungeon clear. Tune here, never inline. */
export const CASKET_COPPER_BASE = 40_000;
export const CASKET_COPPER_PER_LEVEL = 1_000;
/** Units of one top-tier gathered material every casket carries. */
export const CASKET_MATERIAL_COUNT = 4;
/** The material pool: the top gathering tier (ore, wood, herb) of the level 16
 *  to 20 zones (src/sim/professions/gathering_materials.ts NODE_MATERIAL_TABLE). */
export const CASKET_MATERIAL_POOL: readonly string[] = Object.freeze([
  'thorium_ore',
  'elderwood_log',
  'sunpetal_herb',
]);
/** Odds of a piece of gear from the delve chest ladder. */
export const CASKET_GEAR_CHANCE = 0.1;
/** The delve chest ladder rung the gear roll draws from: its lowest. */
export const CASKET_DELVE_TIER: LootTier = 'low';
/** Odds of a small stack of Heroic Marks, and its size. */
export const CASKET_HEROIC_MARK_CHANCE = 0.05;
export const CASKET_HEROIC_MARKS = 2;
/** The casket-exclusive mount (Grumbol the Lanternback): its reins and the odds
 *  of rolling them. A character who already owns the mount rolls nothing here. */
export const CASKET_MOUNT_REINS_ITEM_ID = 'reins_lanternback_troll';
export const CASKET_MOUNT_KEY: MountKey = 'lanternback_troll';
export const CASKET_MOUNT_CHANCE = 0.015;

export function treasureCasketCopper(level: number): number {
  return CASKET_COPPER_BASE + CASKET_COPPER_PER_LEVEL * Math.max(1, Math.floor(level));
}

/** One piece from the class's CASKET_DELVE_TIER delve chest rung. The ladder
 *  answers a LIST (a fixed pair for some archetypes on some rungs), so a
 *  multi-entry answer is narrowed to one through the same rng. */
function rollCasketPiece(ctx: SimContext, meta: PlayerMeta): { itemId: string; count: number } {
  const pieces = delveChestItemsForTier(CASKET_DELVE_TIER, meta.cls, ctx.rng);
  return pieces.length === 1 ? pieces[0] : pieces[ctx.rng.int(0, pieces.length - 1)];
}

/**
 * The `clueCasket` item-use arm (items.ts useItem, after the busy/dead gates):
 * spends the casket, then pays copper and a stack of one top-tier material,
 * and rolls the rare extras in a fixed order through ctx.rng (gear, marks, the
 * mount), so every host draws the same sequence. Bumps the lifetime count,
 * requests a full deeds pass and emits clueCasketOpened with the granted item
 * ids (one entry per grant) and the copper. The HUD paints the lines from the
 * ids; no loot prose is emitted here beyond addItem's own receipt.
 */
export function openTreasureCasket(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  consumeOneUnit: () => void,
): void {
  const pid = meta.entityId;
  consumeOneUnit();
  const copper = treasureCasketCopper(player.level);
  const itemIds: string[] = [];
  const material = CASKET_MATERIAL_POOL[ctx.rng.int(0, CASKET_MATERIAL_POOL.length - 1)];
  ctx.addItem(material, CASKET_MATERIAL_COUNT, pid);
  itemIds.push(material);
  if (ctx.rng.chance(CASKET_GEAR_CHANCE)) {
    const piece = rollCasketPiece(ctx, meta);
    ctx.addItem(piece.itemId, piece.count, pid);
    itemIds.push(piece.itemId);
  }
  if (ctx.rng.chance(CASKET_HEROIC_MARK_CHANCE)) {
    ctx.addItem(HEROIC_MARK_ITEM_ID, CASKET_HEROIC_MARKS, pid);
    itemIds.push(HEROIC_MARK_ITEM_ID);
  }
  // The mount roll is always drawn (the rng sequence never depends on what
  // the character owns); an owner simply receives nothing from it.
  if (ctx.rng.chance(CASKET_MOUNT_CHANCE) && !mountOwned(meta, CASKET_MOUNT_KEY)) {
    ctx.addItem(CASKET_MOUNT_REINS_ITEM_ID, 1, pid);
    itemIds.push(CASKET_MOUNT_REINS_ITEM_ID);
  }
  meta.copper += copper;
  meta.clueCasketsOpened = (meta.clueCasketsOpened ?? 0) + 1;
  // The clueCasketsOpened meter reads the top-level PlayerMeta field with no
  // narrow dirty key (deeds.ts METER_DIRTY_KEYS), so the open site itself
  // requests the full pass.
  ctx.markDeedsDirty(pid);
  ctx.emit({ type: 'clueCasketOpened', itemIds, copper, pid });
}
