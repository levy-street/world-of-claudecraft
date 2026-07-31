// The rift clear-time loot POOLS: which items each rank can pay out.
//
// The ranks pay the tier of gear their difficulty earns, and they pay it from the
// tables that tier already uses rather than from a bespoke rift-only list:
//
//   C  normal five-man loot   the level-20 normal dungeon drops (ilvl 23 rares,
//                             ilvl 26 epics), i.e. what a normal dungeon pays.
//   B  heroic five-man loot   the heroic five-man epic table (ilvl 31).
//   A  heroic five-man loot   the same table (A differs by mount tier, not gear).
//   S  heroic five-man loot   the same table, plus the two legendary chase rolls.
//
// Derived from the static content tables rather than hand-listed, so a new normal
// or heroic drop joins the matching rank automatically and the two can never drift
// apart. Nothing here re-prices anything: every id keeps the source level its own
// table already gave it (normal five-man drops stay at source 20, heroic five-man
// epics at HEROIC_LOOT_SOURCE_LEVEL 25), and the rift-only epics are registered at
// that same 25 in item_level.ts, so a rift is never a cheaper route to a tier than
// the content that tier belongs to.
//
// Determinism: built lazily, memoized, and SORTED. The sort is load-bearing, not
// cosmetic: the pools are indexed by rng.int(), so a stable order is what makes the
// same seed pay the same item. Insertion order would silently change when a content
// file is reordered.

import { HEROIC_BOSS_LOOT, NYTHRAXIS_RAID_BOSS_ID } from '../content/heroic_loot';
import { RIFT_EPIC_ITEM_IDS } from '../content/rift/items';
import { DUNGEONS, ITEMS, MOBS } from '../data';
import { itemSourceLevel, RAID_MIN_PLAYERS } from '../item_level';
import type { ItemDef } from '../types';

/** The source level a C rift reads as: the rank's own base level, which is also
 *  the level of the normal five-man tier it pays from. */
export const RIFT_NORMAL_LOOT_SOURCE_LEVEL = 20;

/** Uncommons are excluded from the C pool. A rank's guaranteed clear reward must
 *  never be a dead drop, and an ilvl-21 uncommon is below what a level-20 player
 *  already wears off the quest chain that gates the rank. Rares and epics only. */
const C_POOL_QUALITIES: ReadonlySet<ItemDef['quality']> = new Set(['rare', 'epic']);

let normalPool: readonly string[] | null = null;
let heroicPool: readonly string[] | null = null;

/** Every equippable rare/epic that the level-20 NORMAL five-man dungeons drop.
 *  This is the C-rank clear payout: "whatever a normal dungeon could drop". */
export function riftNormalClearPool(): readonly string[] {
  if (normalPool) return normalPool;
  const ids = new Set<string>();
  for (const dungeon of Object.values(DUNGEONS)) {
    if (dungeon.suggestedPlayers >= RAID_MIN_PLAYERS) continue; // five-mans only
    for (const spawn of dungeon.spawns) {
      const mob = MOBS[spawn.mobId];
      if (!mob?.loot) continue;
      for (const entry of mob.loot) {
        const itemId = entry.itemId;
        if (!itemId) continue;
        const item = ITEMS[itemId];
        // No slot means no gear (tools, reagents, quest items): never a payout.
        if (!item?.slot) continue;
        if (!C_POOL_QUALITIES.has(item.quality)) continue;
        // Only the tier the rank sits at. The same tables also carry level-10 and
        // level-13 drops, which would be a dead reward for a level-20 clear.
        if (itemSourceLevel(itemId) !== RIFT_NORMAL_LOOT_SOURCE_LEVEL) continue;
        ids.add(itemId);
      }
    }
  }
  normalPool = [...ids].sort();
  return normalPool;
}

/** Every epic the HEROIC five-man bosses drop, plus the four rift-signature epics,
 *  which sit at the same source level. This is the B/A/S clear payout. The heroic
 *  RAID (Nythraxis) is deliberately excluded: it is a tier above the five-mans and
 *  a rift must not be a back door into it. */
export function riftHeroicClearPool(): readonly string[] {
  if (heroicPool) return heroicPool;
  const ids = new Set<string>(RIFT_EPIC_ITEM_IDS);
  for (const [bossId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
    if (bossId === NYTHRAXIS_RAID_BOSS_ID) continue;
    for (const entry of entries) {
      const itemId = entry.itemId;
      if (!itemId) continue;
      const item = ITEMS[itemId];
      if (!item?.slot) continue; // skips the mount reins, which have no slot
      if (item.quality !== 'epic') continue;
      ids.add(itemId);
    }
  }
  heroicPool = [...ids].sort();
  return heroicPool;
}

/** Test seam, mirroring resetItemLevelCache(): drops the memoized pools so a suite
 *  that mutates the content tables sees the rebuild. */
export function resetRiftLootPoolCache(): void {
  normalPool = null;
  heroicPool = null;
}
