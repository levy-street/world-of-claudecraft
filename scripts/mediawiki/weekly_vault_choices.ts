// What a Weekly Vault choice can turn into, read from the vault's own catalogs
// (src/sim/weekly_rewards.ts weeklyLootPool, src/sim/weekly_reward_tables.ts).
import { CLASSES } from '../../src/sim/data';
import type { PlayerClass } from '../../src/sim/types';
import { WEEKLY_REWARD_MAX_LEVEL_OFFSET } from '../../src/sim/weekly_reward_options';
import { WEEKLY_BOSS_TABLES, weeklyBossLootPool } from '../../src/sim/weekly_reward_tables';
import { type WeeklyPoolId, weeklyLootPool } from '../../src/sim/weekly_rewards';
import {
  byName,
  type ContentLinks,
  classList,
  itemCell,
  lootTable,
  qualityOf,
} from './item_contents';

export interface WeeklyLinks extends ContentLinks {
  mob(id: string): string;
  dungeon(id: string): string;
}

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

/** Each item any class can get from `poolFor`, with the classes that can get it. */
function itemsByClass(poolFor: (cls: PlayerClass) => readonly string[]) {
  const who = new Map<string, PlayerClass[]>();
  for (const cls of CLASS_IDS)
    for (const id of poolFor(cls)) who.set(id, [...(who.get(id) ?? []), cls]);
  return [...who].sort(([a], [b]) => byName(a, b));
}

function fixedRowTable(links: WeeklyLinks, pool: WeeklyPoolId): string {
  const rows = itemsByClass((cls) => weeklyLootPool(pool, cls));
  return (
    rows.length +
    ' pieces in all. Each piece your class can use is equally likely.\n\n' +
    lootTable(
      ['Item', 'Quality', 'Classes'],
      rows.map(([id, classes]) => [itemCell(links, id), qualityOf(id), classList(links, classes)]),
    )
  );
}

/** The "What the choices can be" body for the Weekly Vault page. */
export function weeklyVaultChoices(links: WeeklyLinks): string {
  const bossRows = WEEKLY_BOSS_TABLES.map((table) => {
    const count = (pool: WeeklyPoolId) =>
      itemsByClass((cls) => weeklyBossLootPool(table.bossId, pool, cls)).length;
    const normal = table.category === 'raid' ? 'raid' : 'dungeon';
    return [
      links.mob(table.bossId),
      links.dungeon(table.dungeonId),
      table.category === 'raid' ? 'Raid' : 'Dungeon',
      String(count(normal)),
      String(count(`${normal}_heroic`)),
    ];
  });
  return [
    'Each choice is one piece of gear your class can use. Its required level can be at most ' +
      WEEKLY_REWARD_MAX_LEVEL_OFFSET +
      ' above your level. If you set a loot focus with the Vault Keeper, only gear for that focus is offered. Two choices from the same week never show the same item.',
    '=== Raid and dungeon rows ===\nWhen you open one of these choices, you pick which bosses it can come from. You can only pick bosses you defeated that week. A Normal choice can use a boss you beat on Normal or Heroic. A Heroic choice needs a Heroic kill. Every piece on the lists you picked is equally likely. Each boss page shows its loot.\n\nThe counts below are for all classes together. Your own class sees fewer pieces.\n\n' +
      lootTable(['Boss', 'Place', 'Row', 'Normal pieces', 'Heroic pieces'], bossRows),
    '=== World quest row ===\nThis row has the Normal gear from the raid tier before the current one.\n\n' +
      fixedRowTable(links, 'world'),
    '=== PvP row ===\n' + fixedRowTable(links, 'pvp'),
  ].join('\n\n');
}
