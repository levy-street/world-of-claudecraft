// The Source Cave reward-chest loot builder.
//
// clear.ts's armSourceCaveChest calls buildSourceCaveChestLoot once per cleared
// instance and assigns the result to the always-present chest's `.loot`. The
// slots are SHARED (no personalFor): the chest is tapped for the clearing group
// (tappedById + lootRecipientIds, set by the caller), so `lootCorpse`
// (interaction.ts) distributes them through the classic group-loot machinery,
// exactly like a boss corpse: need/greed, master loot, round robin, or
// looter-takes-all, per the party/raid's own configured strategies. This module
// owns PURELY the roll logic; it never mutates an entity and never touches the
// instance pool.
//
// Reward per clear (classic single-drop semantics, matching the cited
// korgath_the_bound "exactly one drops" group):
//   1. One GUARANTEED themed rare, picked uniformly from the cave's three
//      reward-archetype pieces (SOURCE_CAVE_GUARANTEED_RARE_POOL).
//   2. A low-chance themed rare bonus item (SOURCE_CAVE_RARE_ITEM_ID).
//   3. A low-chance themed epic weapon, picked uniformly from the cave's three
//      contributor weapons (SOURCE_CAVE_EPIC_WEAPON_POOL) when the roll hits.
//
// DETERMINISM (this is a sim-pure module; ctx.rng only, never Math.random/Date.now):
// the draw order is fixed and MUST NOT be reordered (a reorder forks replay, per the
// parity gate's rng-draw-order log). The draws happen in this order:
//   (a) ctx.rng.int(0, SOURCE_CAVE_GUARANTEED_RARE_POOL.length - 1)
//       -> which guaranteed rare
//   (b) ctx.rng.chance(SOURCE_CAVE_RARE_ITEM_CHANCE)          -> does the rare drop
//   (c) ctx.rng.chance(SOURCE_CAVE_EPIC_WEAPON_CHANCE)        -> does an epic drop
//   (d) ONLY when (c) hit: ctx.rng.int(0, pool - 1)           -> which epic weapon
// Do not add, remove, or reorder these draws without regenerating the parity goldens.

import type { SimContext } from '../sim_context';
import type { CorpseLoot, LootSlot } from '../types';

// One Source Cave rare per reward archetype: strength, agility, and caster.
// The chest yields exactly one, picked uniformly, through the existing shared
// group-loot path. Their stat profiles and armor proficiencies cover every class
// without introducing a new class-locking rule for armor.
export const SOURCE_CAVE_GUARANTEED_RARE_POOL = [
  'conflictbreaker_breastplate',
  'cherry_pickers_gauntlets',
  'maintainers_crown',
] as const;

// The themed rare bonus item (src/sim/content/items.ts). Stats copied verbatim from
// gravewyrm_mantle; name is a working title pending user sign-off (OPEN O2).
export const SOURCE_CAVE_RARE_ITEM_ID = 'source_cave_mantle';

// Drop chance for the themed rare, per clear. Cited: in the korgath_the_bound
// bonus group, the same-band rares boundstone_helm and gravewyrm_mantle each drop at
// 0.08 (src/sim/content/dungeons.ts), so 0.08 traces directly to the cited items'
// own chance and sits inside that table's 0.05-0.19 bonus-group range.
export const SOURCE_CAVE_RARE_ITEM_CHANCE = 0.08;

// The cave's three contributor weapons (src/sim/content/items.ts), the epic
// prestige reward: at most one per clear, picked uniformly when the roll hits.
export const SOURCE_CAVE_EPIC_WEAPON_POOL = [
  'commit_blade',
  'bug_squasher',
  'mech_keyboard',
] as const;

// Per-clear chance that one epic weapon drops. Deliberately at the rare-bonus
// floor (matches SOURCE_CAVE_RARE_ITEM_CHANCE's cited 0.08): the weapons are
// the cave's long-tail chase item, not an expected clear reward (user call).
export const SOURCE_CAVE_EPIC_WEAPON_CHANCE = 0.08;

// Builds the reward-chest loot for a cleared Source Cave instance: shared slots
// the group's loot method distributes (see the header). Returns the CorpseLoot
// payload for the chest's `.loot` field.
export function buildSourceCaveChestLoot(ctx: SimContext): CorpseLoot {
  const items: LootSlot[] = [];
  // (a) themed rare: one guaranteed reward-archetype item, uniform over the pool.
  const poolIndex = ctx.rng.int(0, SOURCE_CAVE_GUARANTEED_RARE_POOL.length - 1);
  items.push({ itemId: SOURCE_CAVE_GUARANTEED_RARE_POOL[poolIndex], count: 1 });
  // (b) themed rare bonus: a separate low-chance draw.
  if (ctx.rng.chance(SOURCE_CAVE_RARE_ITEM_CHANCE)) {
    items.push({ itemId: SOURCE_CAVE_RARE_ITEM_ID, count: 1 });
  }
  // (c)+(d) epic weapon: the which-weapon draw happens ONLY on a hit, so a miss
  // costs one draw. Fixed order after (b); see the determinism header.
  if (ctx.rng.chance(SOURCE_CAVE_EPIC_WEAPON_CHANCE)) {
    const weaponIndex = ctx.rng.int(0, SOURCE_CAVE_EPIC_WEAPON_POOL.length - 1);
    items.push({ itemId: SOURCE_CAVE_EPIC_WEAPON_POOL[weaponIndex], count: 1 });
  }
  return { copper: 0, items };
}
