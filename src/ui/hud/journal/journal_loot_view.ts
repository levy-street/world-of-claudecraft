// Pure loot model of the Adventure Journal's Loot tab: the real drops of a
// boss page on one difficulty, read off the Loot Explorer's index
// (hud/loot_explorer/loot_explorer_view.ts), which mirrors the loot roller's
// own per-difficulty gate. Nothing here is a second loot table: a page lists
// exactly what a kill can roll, quest-gated and class-restricted drops
// marked as such. A council page merges its members' tables.

import type { DungeonDifficulty, ItemDef, PlayerClass } from '../../../sim/types';
import {
  buildLootExplorerIndex,
  type LootExplorerCategory,
} from '../loot_explorer/loot_explorer_view';

/** The index categories whose source id is a mob (a kill's drop table). */
const MOB_DROP_CATEGORIES: ReadonlySet<LootExplorerCategory> = new Set<LootExplorerCategory>([
  'raid',
  'dungeon',
  'delve',
  'open_world',
]);

type Quality = NonNullable<ItemDef['quality']>;

const QUALITY_RANK: Readonly<Record<Quality, number>> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
  poor: 5,
};

export interface JournalLootRow {
  itemId: string;
  quality: Quality;
  /** 0..1 when the drop is a chance roll. */
  chance?: number;
  /** Drops sharing a group are exclusive on one kill. */
  rollGroup?: string;
  /** Only drops while this quest is active and unfinished. */
  gatedByQuestId?: string;
  restrictedToClass?: PlayerClass;
  /** The body that drops it, on a page that covers several (a council). */
  dropsFrom: string;
}

/** The drops of a page's bodies on one difficulty, best quality first, then
 *  the likeliest, then by id (a stable order for every locale). */
export function journalLoot(
  bodies: readonly string[],
  difficulty: DungeonDifficulty,
): JournalLootRow[] {
  const wanted = new Set(bodies);
  const rows: JournalLootRow[] = [];
  const seen = new Set<string>();
  for (const item of buildLootExplorerIndex().items) {
    for (const source of item.sources) {
      if (!MOB_DROP_CATEGORIES.has(source.category) || !wanted.has(source.sourceId)) continue;
      if (source.difficulty !== undefined && source.difficulty !== difficulty) continue;
      if (seen.has(item.itemId)) continue;
      seen.add(item.itemId);
      rows.push({
        itemId: item.itemId,
        quality: item.quality,
        ...(source.chance !== undefined ? { chance: source.chance } : {}),
        ...(source.rollGroup ? { rollGroup: source.rollGroup } : {}),
        ...(source.gatedByQuestId ? { gatedByQuestId: source.gatedByQuestId } : {}),
        ...(source.restrictedToClass ? { restrictedToClass: source.restrictedToClass } : {}),
        dropsFrom: source.sourceId,
      });
    }
  }
  rows.sort(
    (a, b) =>
      QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality] ||
      (b.chance ?? 1) - (a.chance ?? 1) ||
      a.itemId.localeCompare(b.itemId),
  );
  return rows;
}
