// Loot Explorer: the pure view core. Builds a searchable, filterable index of
// every item the game can hand a player and where it comes from (mob drops
// across open world/dungeon/raid/delve/rift, vendor stock, quest rewards and
// objectives, ground objects, class starting gear).
//
// STATIC CONTENT only, not live world state (the same tables
// scripts/export_loot_spreadsheet.mjs reads), so per the Dungeon Finder
// precedent (src/ui/dungeon_finder_view.ts) it needs no IWorld/world_api
// facet. DOM-free and i18n-free: emits raw ids/numbers/flags; the painter
// (loot_explorer_window.ts) localizes names and performs the text search.
//
// Registered in UI_PURE_CORES (tests/architecture.test.ts); driven directly
// by tests/loot_explorer_view.test.ts.

import { FINDER_ACTIVITIES } from '../../../sim/content/dungeon_finder';
import { HEROIC_BOSS_LOOT } from '../../../sim/content/heroic_loot';
import {
  CLASSES,
  DELVES,
  DUNGEONS,
  GROUND_OBJECTS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  REWARD_ARCHETYPE,
} from '../../../sim/data';
import { RAID_MIN_PLAYERS } from '../../../sim/item_level';
import { riftHeroicClearPool, riftNormalClearPool } from '../../../sim/rift/loot_pools';
import {
  ALL_CLASSES,
  type DungeonDifficulty,
  type ItemDef,
  type LootEntry,
  type PlayerClass,
} from '../../../sim/types';

export type LootExplorerCategory =
  | 'raid'
  | 'dungeon'
  | 'delve'
  | 'open_world'
  | 'rift'
  | 'vendor'
  | 'quest_reward'
  | 'quest_objective'
  | 'ground_object'
  | 'starting_equipment';

export const LOOT_EXPLORER_CATEGORIES: readonly LootExplorerCategory[] = [
  'raid',
  'dungeon',
  'delve',
  'open_world',
  'rift',
  'vendor',
  'quest_reward',
  'quest_objective',
  'ground_object',
  'starting_equipment',
];

/** Rift clear rank the pool pays out at; distinct from DungeonDifficulty
 *  because a rift has four ranks, not two. */
export type RiftRank = 'C' | 'B' | 'A' | 'S';

export interface LootExplorerSource {
  category: LootExplorerCategory;
  /** mobId (raid/dungeon/delve/open_world), npcId (vendor), questId
   *  (quest_reward/quest_objective), itemId (ground_object), class id
   *  (starting_equipment), or the rift rank letter (rift). */
  sourceId: string;
  /** dungeonId/delveId for raid, dungeon, and delve rows: lets the painter
   *  resolve the instance's display name alongside the boss's. */
  contextId?: string;
  difficulty?: DungeonDifficulty;
  /** 0..1, when the source is a chance roll (mob drops). Absent for a
   *  guaranteed source (vendor, quest, ground object, starting gear, and the
   *  rift pools, which pay from a uniform random pick rather than a chance). */
  chance?: number;
  /** Entries sharing a rollGroup are mutually exclusive on one kill. */
  rollGroup?: string;
  /** Only sourced while this quest is active and incomplete (mob drops). */
  gatedByQuestId?: string;
  /** Class the source is restricted to (quest reward archetype grant,
   *  starting equipment). Absent means every class can obtain it. */
  restrictedToClass?: PlayerClass;
}

export interface LootExplorerItem {
  itemId: string;
  quality: NonNullable<ItemDef['quality']>;
  slot?: ItemDef['slot'];
  requiredClass?: readonly PlayerClass[];
  /** Non-zero CoreStats keys this item carries, for the stat filter. */
  statKeys: readonly (keyof NonNullable<ItemDef['stats']>)[];
  sources: readonly LootExplorerSource[];
}

export interface LootExplorerIndex {
  readonly items: readonly LootExplorerItem[];
}

const STAT_KEYS = ['str', 'agi', 'sta', 'int', 'spi', 'armor'] as const;

function statKeysOf(item: ItemDef): readonly (keyof NonNullable<ItemDef['stats']>)[] {
  if (!item.stats) return [];
  return STAT_KEYS.filter((key) => (item.stats?.[key] ?? 0) !== 0);
}

/** mobId -> the dungeon/raid it is placed in, from every DungeonDef's spawn
 *  list (trash included, not just the finder's named encounters), so a mob
 *  never falls through to Open World just because it isn't a boss. */
export function buildMobToDungeon(): Map<string, string> {
  const out = new Map<string, string>();
  for (const dungeon of Object.values(DUNGEONS)) {
    for (const spawn of dungeon.spawns) out.set(spawn.mobId, dungeon.id);
  }
  return out;
}

/** dungeonId -> 'raid' | 'dungeon', from the Dungeon Finder's authored
 *  activity kind (never derived from spawn lists). A dungeonId absent from
 *  the finder registry (a development-only room) falls back to the same
 *  five-man/raid size split loot_pools.ts uses. Total over every DUNGEONS
 *  key, so every dungeon classifies without a second lookup. */
export function buildDungeonKind(): Map<string, 'raid' | 'dungeon'> {
  const out = new Map<string, 'raid' | 'dungeon'>();
  for (const activity of FINDER_ACTIVITIES) {
    if (!out.has(activity.dungeonId)) {
      out.set(activity.dungeonId, activity.kind === 'raid' ? 'raid' : 'dungeon');
    }
  }
  for (const dungeon of Object.values(DUNGEONS)) {
    if (!out.has(dungeon.id)) {
      out.set(dungeon.id, dungeon.suggestedPlayers >= RAID_MIN_PLAYERS ? 'raid' : 'dungeon');
    }
  }
  return out;
}

/** mobId -> the delve it bosses, from every DelveDef's authored boss list.
 *  Delve trash is procedurally selected per run rather than statically
 *  placed, so only bosses (the content that carries hand-authored loot) are
 *  catalogued. */
export function buildMobToDelve(): Map<string, string> {
  const out = new Map<string, string>();
  for (const delve of Object.values(DELVES)) {
    for (const bossId of delve.bosses) out.set(bossId, delve.id);
  }
  return out;
}

function mobDropSource(
  entry: LootEntry,
  category: LootExplorerCategory,
  mobId: string,
  contextId: string | undefined,
  difficulty: DungeonDifficulty | undefined,
): LootExplorerSource {
  return {
    category,
    sourceId: mobId,
    contextId,
    difficulty,
    chance: entry.chance,
    rollGroup: entry.rollGroup,
    gatedByQuestId: entry.questId,
  };
}

/** Adds every source a mob's base loot table plus its heroic append can pay,
 *  mirroring the roller's difficulty gate exactly (src/sim/loot/loot_difficulty_gate.ts)
 *  so this never advertises a row a kill cannot actually roll: a normalOnly
 *  entry emits only a 'normal' row, every other entry emits both, and
 *  HEROIC_BOSS_LOOT rows emit 'heroic' only. Undefined difficulty (open
 *  world, delves) emits one undifferentiated row per entry. */
function addMobDropSources(
  add: (itemId: string | undefined, source: LootExplorerSource) => void,
  mob: { id: string; loot?: readonly LootEntry[] },
  category: LootExplorerCategory,
  contextId: string | undefined,
  instanced: boolean,
): void {
  for (const entry of mob.loot ?? []) {
    if (!instanced) {
      add(entry.itemId, mobDropSource(entry, category, mob.id, contextId, undefined));
      continue;
    }
    add(entry.itemId, mobDropSource(entry, category, mob.id, contextId, 'normal'));
    if (!entry.normalOnly) {
      add(entry.itemId, mobDropSource(entry, category, mob.id, contextId, 'heroic'));
    }
  }
  if (instanced) {
    for (const entry of HEROIC_BOSS_LOOT[mob.id] ?? []) {
      add(entry.itemId, mobDropSource(entry, category, mob.id, contextId, 'heroic'));
    }
  }
}

/** Builds the full item -> sources index from the static content tables.
 *  Pure, deterministic, and identical across all three hosts; memoized like
 *  the rift loot pools it reads (resetLootExplorerIndexCache is the matching
 *  test seam). */
let cached: LootExplorerIndex | null = null;

export function buildLootExplorerIndex(): LootExplorerIndex {
  if (cached) return cached;
  const sourcesByItem = new Map<string, LootExplorerSource[]>();
  const add = (itemId: string | undefined, source: LootExplorerSource) => {
    if (!itemId || !ITEMS[itemId]) return;
    const list = sourcesByItem.get(itemId) ?? [];
    list.push(source);
    sourcesByItem.set(itemId, list);
  };

  const mobToDungeon = buildMobToDungeon();
  const dungeonKind = buildDungeonKind();
  const mobToDelve = buildMobToDelve();

  for (const mob of Object.values(MOBS)) {
    if (!mob.loot?.length) continue;
    const dungeonId = mobToDungeon.get(mob.id);
    const delveId = mobToDelve.get(mob.id);
    let category: LootExplorerCategory;
    let contextId: string | undefined;
    let instanced = false;
    if (dungeonId) {
      category = dungeonKind.get(dungeonId) === 'raid' ? 'raid' : 'dungeon';
      contextId = dungeonId;
      instanced = true;
    } else if (delveId) {
      category = 'delve';
      contextId = delveId;
    } else {
      category = 'open_world';
    }
    addMobDropSources(add, mob, category, contextId, instanced);
  }

  for (const itemId of riftNormalClearPool()) {
    add(itemId, { category: 'rift', sourceId: 'C' });
  }
  for (const itemId of riftHeroicClearPool()) {
    for (const rank of ['B', 'A', 'S'] as const) add(itemId, { category: 'rift', sourceId: rank });
  }
  // riftHeroicClearPool() already seeds itself from RIFT_EPIC_ITEM_IDS, so no
  // separate emission here: re-adding it would double the B/A/S source rows.

  for (const npc of Object.values(NPCS)) {
    for (const itemId of npc.vendorItems ?? []) {
      add(itemId, { category: 'vendor', sourceId: npc.id });
    }
  }

  for (const quest of Object.values(QUESTS)) {
    for (const obj of quest.objectives ?? []) {
      if (obj.type !== 'collect' || !obj.itemId) continue;
      add(obj.itemId, { category: 'quest_objective', sourceId: quest.id });
    }
    for (const cls of ALL_CLASSES) {
      const rewardItem = quest.itemRewards?.[cls] ?? quest.itemRewards?.[REWARD_ARCHETYPE[cls]];
      if (!rewardItem) continue;
      add(rewardItem, { category: 'quest_reward', sourceId: quest.id, restrictedToClass: cls });
    }
  }

  for (const obj of GROUND_OBJECTS) {
    add(obj.itemId, { category: 'ground_object', sourceId: obj.itemId, chance: 1 });
  }

  for (const [cls, def] of Object.entries(CLASSES) as [
    PlayerClass,
    (typeof CLASSES)[PlayerClass],
  ][]) {
    if (def.startWeapon) {
      add(def.startWeapon, {
        category: 'starting_equipment',
        sourceId: cls,
        restrictedToClass: cls,
      });
    }
    if (def.startChest) {
      add(def.startChest, {
        category: 'starting_equipment',
        sourceId: cls,
        restrictedToClass: cls,
      });
    }
  }

  const items: LootExplorerItem[] = [...sourcesByItem.entries()].map(([itemId, sources]) => {
    const item = ITEMS[itemId];
    return {
      itemId,
      quality: item.quality ?? 'common',
      slot: item.slot,
      requiredClass: item.requiredClass,
      statKeys: statKeysOf(item),
      sources,
    };
  });
  items.sort((a, b) => a.itemId.localeCompare(b.itemId));

  cached = { items };
  return cached;
}

/** Test seam mirroring resetRiftLootPoolCache(): drops the memoized index so
 *  a suite that mutates the content tables sees the rebuild. */
export function resetLootExplorerIndexCache(): void {
  cached = null;
}

export interface LootExplorerFilters {
  category: LootExplorerCategory | 'all';
  requiredClass: PlayerClass | 'all';
  statKey: (typeof STAT_KEYS)[number] | 'all';
  quality: NonNullable<ItemDef['quality']> | 'all';
}

export const LOOT_EXPLORER_DEFAULT_FILTERS: LootExplorerFilters = {
  category: 'all',
  requiredClass: 'all',
  statKey: 'all',
  quality: 'all',
};

/** Filters the index to items matching every active facet. Text search is
 *  deliberately NOT here (it needs localized names, painter-side). Returns a
 *  new item list; each item's sources are narrowed to the ones matching the
 *  category filter alone, so a "By Encounter" grouping built from the result
 *  never mixes a category the player filtered out back in. */
export function filterLootExplorerItems(
  index: LootExplorerIndex,
  filters: LootExplorerFilters,
): LootExplorerItem[] {
  const out: LootExplorerItem[] = [];
  for (const item of index.items) {
    if (filters.quality !== 'all' && item.quality !== filters.quality) continue;
    if (filters.requiredClass !== 'all') {
      const classGate = item.requiredClass;
      if (classGate && !classGate.includes(filters.requiredClass)) continue;
    }
    if (filters.statKey !== 'all' && !item.statKeys.includes(filters.statKey)) continue;
    const sources =
      filters.category === 'all'
        ? item.sources
        : item.sources.filter((s) => s.category === filters.category);
    if (sources.length === 0) continue;
    out.push({ ...item, sources });
  }
  return out;
}

export interface LootExplorerEncounter {
  category: LootExplorerCategory;
  sourceId: string;
  contextId?: string;
  difficulty?: DungeonDifficulty;
  drops: { itemId: string; chance?: number; rollGroup?: string }[];
}

/** Pivots a flat item list into per-encounter drop tables (the "By Encounter"
 *  browse mode): one card per (category, sourceId, difficulty), each listing
 *  every item it can pay. Pure regrouping, no new data. */
export function groupLootExplorerBySource(
  items: readonly LootExplorerItem[],
): LootExplorerEncounter[] {
  const byKey = new Map<string, LootExplorerEncounter>();
  for (const item of items) {
    for (const source of item.sources) {
      const key = `${source.category}:${source.sourceId}:${source.difficulty ?? ''}`;
      let enc = byKey.get(key);
      if (!enc) {
        enc = {
          category: source.category,
          sourceId: source.sourceId,
          contextId: source.contextId,
          difficulty: source.difficulty,
          drops: [],
        };
        byKey.set(key, enc);
      }
      enc.drops.push({ itemId: item.itemId, chance: source.chance, rollGroup: source.rollGroup });
    }
  }
  return [...byKey.values()];
}
