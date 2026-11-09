import { CASKET_MOUNT_CHANCE, CASKET_MOUNT_REINS_ITEM_ID } from '../../src/sim/clue_casket';
import { CLUE_SCROLL_MIN_LEVEL, TREASURE_CASKET_ITEM_ID } from '../../src/sim/content/clue_hunts';
import { DELVE_SHOPS, delveShopGateClears } from '../../src/sim/content/delves/shop';
import { FARM_CROPS, farmCropSkillThreshold } from '../../src/sim/content/farm_crops';
import { RIFT_LEGENDARY_ITEM_IDS } from '../../src/sim/content/rift/items';
import {
  TREASURE_MAP_DROP_WEIGHTS,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
} from '../../src/sim/content/treasure_maps';
import { WEEKLY_QUEST_REWARD } from '../../src/sim/content/weekly_quests';
import { WORLD_QUEST_CLASS_LOOT } from '../../src/sim/content/world_quest_loot';
import { CLASSES, DELVES, ITEMS, QUESTS } from '../../src/sim/data';
import { riftHeroicClearPool, riftNormalClearPool } from '../../src/sim/rift/loot_pools';
import {
  FARM_RIFT_DROP_CHANCE,
  FARM_RIFT_DROP_ITEM_IDS,
  RIFT_BLUE_MOUNT_CHANCE,
  RIFT_BLUE_MOUNT_REINS,
  RIFT_EPIC_MOUNT_CHANCE,
  RIFT_EPIC_MOUNT_REINS,
  RIFT_GREEN_MOUNT_CHANCE,
  RIFT_GREEN_MOUNT_REINS,
  RIFT_LEGENDARY_CHANCE_S,
  RIFT_PATTERN_CHANCE,
  RIFT_PATTERN_ITEM_IDS,
} from '../../src/sim/rift/progression';
import {
  WORLD_QUEST_ITEM_MIN_LEVEL,
  WORLD_QUEST_ITEM_SLOTS_PER_CYCLE,
} from '../../src/sim/world_quest_item_slots';
import { type ArticleTools, append, pct, ref } from './entity_format';

export function indexActivityItems(
  w: ArticleTools,
  sources: Map<string, Set<string>>,
  uses: Map<string, Set<string>>,
) {
  for (const [cls, def] of Object.entries(CLASSES))
    append(
      sources,
      def.startChest,
      'The chest armor a new ' + ref(w, 'class', cls) + ' starts with.',
    );
  for (const q of Object.values(QUESTS))
    for (const id of q.requiredItems ?? [])
      append(
        sources,
        id,
        'Given to you when you accept ' + ref(w, 'quest', q.id) + ', if you do not have it.',
      );
  append(sources, WEEKLY_QUEST_REWARD.cacheItemId, 'Finish a weekly charge from the emissary.');
  append(sources, TREASURE_CASKET_ITEM_ID, 'Finish every step of a clue hunt you have started.');
  append(
    sources,
    CASKET_MOUNT_REINS_ITEM_ID,
    pct(CASKET_MOUNT_CHANCE) +
      ' chance when opening ' +
      ref(w, 'item', TREASURE_CASKET_ITEM_ID) +
      ' if you do not yet own this mount.',
  );
  const total = Object.values(TREASURE_MAP_DROP_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const r of TREASURE_MAP_RARITIES)
    append(
      sources,
      TREASURE_MAP_ITEM_IDS[r],
      'Finish the rotating world quest slate at level ' +
        CLUE_SCROLL_MIN_LEVEL +
        ' or higher. You get one map per cycle. The chance that it is this rarity is ' +
        pct(TREASURE_MAP_DROP_WEIGHTS[r] / total) +
        '.',
    );
  for (const [cls, ids] of Object.entries(WORLD_QUEST_CLASS_LOOT))
    for (const id of ids)
      append(
        sources,
        id,
        'A rotating world quest reward for ' +
          ref(w, 'class', cls) +
          ' at level ' +
          WORLD_QUEST_ITEM_MIN_LEVEL +
          ' or higher. Each cycle, ' +
          WORLD_QUEST_ITEM_SLOTS_PER_CYCLE +
          ' zones give gear. The piece is set by the zone, the class and the cycle.',
      );
  for (const [delve, entries] of Object.entries(DELVE_SHOPS))
    for (const row of entries) {
      const count = delveShopGateClears(row.gate);
      append(
        sources,
        row.itemId,
        'Buy in ' +
          DELVES[delve].name +
          ' for ' +
          row.marks +
          ' Delve Marks.' +
          (row.gate === 'heroicClear'
            ? ' You must clear the delve on Heroic first.'
            : count !== null
              ? ' You must clear it ' + count + ' times first.'
              : ''),
      );
    }
  const normal = riftNormalClearPool(),
    heroic = riftHeroicClearPool();
  for (const id of normal)
    append(
      sources,
      id,
      'Be the first group to clear a rank C natural rift. The final boss always drops one shared gear piece, and this item has a 1 in ' +
        normal.length +
        ' chance to be it.',
    );
  for (const id of heroic)
    append(
      sources,
      id,
      'Be the first group to clear a rank B, A or S natural rift. Each shared Heroic gear piece has a 1 in ' +
        heroic.length +
        ' chance to be this item. Rank S may drop a second piece. Loot the final boss.',
    );
  for (const id of RIFT_LEGENDARY_ITEM_IDS)
    append(
      sources,
      id,
      'Be the first group to clear a rank S natural rift. The final boss drops this as shared loot ' +
        pct(RIFT_LEGENDARY_CHANCE_S) +
        ' of the time, rolled on its own.',
    );
  const pools: readonly [readonly string[], number, string][] = [
    [RIFT_BLUE_MOUNT_REINS, RIFT_BLUE_MOUNT_CHANCE, 'A'],
    [RIFT_EPIC_MOUNT_REINS, RIFT_EPIC_MOUNT_CHANCE, 'S'],
    [RIFT_GREEN_MOUNT_REINS, RIFT_GREEN_MOUNT_CHANCE, 'B'],
    [RIFT_PATTERN_ITEM_IDS, RIFT_PATTERN_CHANCE, 'B, A or S'],
    [FARM_RIFT_DROP_ITEM_IDS, FARM_RIFT_DROP_CHANCE, 'B, A or S'],
  ];
  for (const [ids, chance, rank] of pools)
    for (const id of ids)
      append(
        sources,
        id,
        'Be the first group to finish a rank ' +
          rank +
          ' natural rift. Its final boss has a ' +
          pct(chance) +
          ' chance to drop one of these ' +
          ids.length +
          ' items, each equally likely.',
      );
  for (const crop of Object.values(FARM_CROPS)) {
    append(
      uses,
      crop.seedItemId,
      'Plant it at Farming skill ' +
        farmCropSkillThreshold(crop.tier) +
        ' to grow ' +
        ref(w, 'item', crop.produceItemId) +
        '. It takes ' +
        crop.durationMs / 60000 +
        ' minutes to grow (base time). A fine-grade harvest gives ' +
        ref(w, 'item', crop.fineProduceItemId) +
        '.',
    );
    for (const id of [crop.produceItemId, crop.fineProduceItemId])
      append(
        sources,
        id,
        'Harvest a farm bed planted with ' + ref(w, 'item', crop.seedItemId) + '.',
      );
  }
  for (const [base, ability] of [
    ['conjured_water', 'conjure_water'],
    ['conjured_bread', 'conjure_food'],
  ]) {
    for (const id of Object.keys(ITEMS).filter(
      (id) => id === base || new RegExp('^' + base + '[0-9]+$').test(id),
    )) {
      const rank = Number(id.slice(base.length)) || 1;
      append(
        sources,
        id,
        'Cast ' +
          ref(w, 'ability', ability) +
          ' at rank ' +
          rank +
          '. Each cast makes two, so leave room in your bags.',
      );
    }
  }
}
