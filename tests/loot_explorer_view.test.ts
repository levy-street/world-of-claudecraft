// Loot Explorer pure-core behavior: the index built from live content tables,
// its filters, and the by-encounter grouping. Static-content only (no
// IWorld), so unlike a dual-host view core this drives buildLootExplorerIndex
// directly rather than against Sim- and ClientWorld-shaped stubs.

import { beforeEach, describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import {
  CLASSES,
  DELVES,
  DUNGEONS,
  GROUND_OBJECTS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
} from '../src/sim/data';
import { lootEntryRollsOnClaim } from '../src/sim/loot/loot_difficulty_gate';
import {
  buildDungeonKind,
  buildLootExplorerIndex,
  buildMobToDelve,
  buildMobToDungeon,
  filterLootExplorerItems,
  groupLootExplorerBySource,
  LOOT_EXPLORER_DEFAULT_FILTERS,
  type LootExplorerCategory,
  resetLootExplorerIndexCache,
} from '../src/ui/hud/loot_explorer/loot_explorer_view';

beforeEach(() => resetLootExplorerIndexCache());

describe('buildLootExplorerIndex', () => {
  it('memoizes until reset, and every row resolves against a real item with sources', () => {
    const first = buildLootExplorerIndex();
    expect(buildLootExplorerIndex()).toBe(first);
    resetLootExplorerIndexCache();
    expect(buildLootExplorerIndex()).not.toBe(first);
    expect(first.items.length).toBeGreaterThan(0);
    for (const item of first.items) {
      expect(ITEMS[item.itemId]).toBeDefined();
      expect(item.sources.length).toBeGreaterThan(0);
    }
  });

  // 'delve' is excluded: both current delve bosses drop only copper, no
  // itemId, so the category is correctly empty; its classification is pinned
  // directly below (buildMobToDelve), not through the built index.
  it('covers every category live content can populate today', () => {
    const seen = new Set<LootExplorerCategory>();
    for (const item of buildLootExplorerIndex().items)
      for (const s of item.sources) seen.add(s.category);
    const expected: LootExplorerCategory[] = [
      'raid',
      'dungeon',
      'open_world',
      'rift',
      'vendor',
      'quest_reward',
      'quest_objective',
      'ground_object',
      'starting_equipment',
    ];
    for (const category of expected) expect(seen.has(category), category).toBe(true);
  });

  it('classifies every mob correctly: dungeon spawns to raid/dungeon (never open_world), delve bosses to their delve, and the two never overlap', () => {
    const { items } = buildLootExplorerIndex();
    const mobToDungeon = buildMobToDungeon();
    const mobToDelve = buildMobToDelve();
    const dungeonKind = buildDungeonKind();
    for (const mobId of mobToDungeon.keys()) expect(mobToDelve.has(mobId)).toBe(false);
    for (const item of items) {
      for (const s of item.sources) {
        const dungeonId = mobToDungeon.get(s.sourceId);
        if (dungeonId && (s.category === 'raid' || s.category === 'dungeon')) {
          expect(s.category).toBe(dungeonKind.get(dungeonId));
        }
      }
    }
    for (const activity of FINDER_ACTIVITIES) {
      expect(dungeonKind.get(activity.dungeonId)).toBe(
        activity.kind === 'raid' ? 'raid' : 'dungeon',
      );
    }
    for (const dungeon of Object.values(DUNGEONS)) expect(dungeonKind.has(dungeon.id)).toBe(true);
    let delveChecked = 0;
    for (const delve of Object.values(DELVES)) {
      for (const bossId of delve.bosses) {
        expect(mobToDelve.get(bossId)).toBe(delve.id);
        delveChecked++;
      }
    }
    expect(delveChecked).toBeGreaterThan(0);
  });

  it('mirrors the roller difficulty gate: normalOnly entries never get a heroic row, HEROIC_BOSS_LOOT entries are heroic-only', () => {
    const { items } = buildLootExplorerIndex();
    const mobToDungeon = buildMobToDungeon();
    let normalOnlyChecked = 0;
    for (const mob of Object.values(MOBS)) {
      if (!mobToDungeon.has(mob.id)) continue;
      for (const entry of mob.loot ?? []) {
        if (!entry.itemId || !entry.normalOnly) continue;
        expect(lootEntryRollsOnClaim(entry, true)).toBe(false);
        const item = items.find((i) => i.itemId === entry.itemId);
        const heroicRows = item?.sources.filter(
          (s) => s.sourceId === mob.id && s.difficulty === 'heroic' && s.chance === entry.chance,
        );
        expect(heroicRows ?? []).toHaveLength(0);
        normalOnlyChecked++;
      }
    }
    expect(normalOnlyChecked).toBeGreaterThan(0);
    let heroicAppendChecked = 0;
    for (const [bossId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
      for (const entry of entries) {
        if (!entry.itemId || !ITEMS[entry.itemId]) continue;
        const rows =
          items
            .find((i) => i.itemId === entry.itemId)
            ?.sources.filter((s) => s.sourceId === bossId) ?? [];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row.difficulty).toBe('heroic');
        heroicAppendChecked++;
      }
    }
    expect(heroicAppendChecked).toBeGreaterThan(0);
  });

  it('every vendor, quest, ground-object, and starting-equipment source matches its live content record', () => {
    const { items } = buildLootExplorerIndex();
    const has = (itemId: string, pred: (s: { category: string; sourceId: string }) => boolean) =>
      items.find((i) => i.itemId === itemId)?.sources.some(pred) ?? false;

    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) {
        if (ITEMS[itemId])
          expect(has(itemId, (s) => s.category === 'vendor' && s.sourceId === npc.id)).toBe(true);
      }
    }
    let questChecked = 0;
    for (const quest of Object.values(QUESTS)) {
      for (const obj of quest.objectives ?? []) {
        if (obj.type !== 'collect' || !obj.itemId || !ITEMS[obj.itemId]) continue;
        expect(
          has(obj.itemId, (s) => s.category === 'quest_objective' && s.sourceId === quest.id),
        ).toBe(true);
        questChecked++;
      }
    }
    expect(questChecked).toBeGreaterThan(0);
    for (const [cls, def] of Object.entries(CLASSES)) {
      for (const itemId of [def.startWeapon, def.startChest]) {
        if (itemId)
          expect(
            has(itemId, (s) => s.category === 'starting_equipment' && s.sourceId === cls),
          ).toBe(true);
      }
    }
    expect(GROUND_OBJECTS.length).toBeGreaterThan(0);
    for (const obj of GROUND_OBJECTS) {
      if (!ITEMS[obj.itemId]) continue;
      const row = items
        .find((i) => i.itemId === obj.itemId)
        ?.sources.find((s) => s.category === 'ground_object');
      expect(row?.chance).toBe(1);
    }
  });

  it('deduplicates all-class quest rewards while preserving class-specific reward rows', () => {
    const { items } = buildLootExplorerIndex();
    const alienPlateRewards =
      items
        .find((i) => i.itemId === 'alien_armor_plate')
        ?.sources.filter(
          (s) => s.category === 'quest_reward' && s.sourceId === 'q_aldrics_fallen_star',
        ) ?? [];
    expect(alienPlateRewards).toHaveLength(1);
    expect(alienPlateRewards[0]?.restrictedToClass).toBeUndefined();

    const staffRewards =
      items
        .find((i) => i.itemId === 'apprentice_staff')
        ?.sources.filter((s) => s.category === 'quest_reward' && s.sourceId === 'q_bandits') ?? [];
    expect(staffRewards.map((s) => s.restrictedToClass).sort()).toEqual([
      'druid',
      'mage',
      'priest',
      'warlock',
    ]);
  });

  it('carries quest gates on gated vendor stock', () => {
    const source = buildLootExplorerIndex()
      .items.find((i) => i.itemId === 'linen_pouch')
      ?.sources.find((s) => s.category === 'vendor' && s.sourceId === 'quartermaster_finch');
    expect(source?.gatedByQuestId).toBe('q_ps_pouch_and_purse');
  });
});

describe('filterLootExplorerItems', () => {
  const index = () => buildLootExplorerIndex();

  it('the default filters return the full index unnarrowed', () => {
    expect(filterLootExplorerItems(index(), LOOT_EXPLORER_DEFAULT_FILTERS).length).toBe(
      index().items.length,
    );
  });

  it('quality/category/requiredClass/statKey each narrow to a matching, non-empty, non-full subset', () => {
    const total = index().items.length;

    const epic = filterLootExplorerItems(index(), {
      ...LOOT_EXPLORER_DEFAULT_FILTERS,
      quality: 'epic',
    });
    expect(epic.length).toBeGreaterThan(0);
    expect(epic.length).toBeLessThan(total);
    for (const item of epic) expect(item.quality).toBe('epic');

    const vendor = filterLootExplorerItems(index(), {
      ...LOOT_EXPLORER_DEFAULT_FILTERS,
      category: 'vendor',
    });
    expect(vendor.length).toBeGreaterThan(0);
    for (const item of vendor) for (const s of item.sources) expect(s.category).toBe('vendor');

    const mage = filterLootExplorerItems(index(), {
      ...LOOT_EXPLORER_DEFAULT_FILTERS,
      requiredClass: 'mage',
    });
    for (const item of mage) if (item.requiredClass) expect(item.requiredClass).toContain('mage');
    for (const item of mage) {
      for (const source of item.sources) {
        if (source.restrictedToClass) expect(source.restrictedToClass).toBe('mage');
      }
    }
    const allClassQuestReward = mage
      .find((i) => i.itemId === 'alien_armor_plate')
      ?.sources.find((s) => s.category === 'quest_reward');
    expect(allClassQuestReward?.restrictedToClass).toBeUndefined();
    const staffRewardClasses =
      mage
        .find((i) => i.itemId === 'apprentice_staff')
        ?.sources.filter((s) => s.category === 'quest_reward' && s.sourceId === 'q_bandits')
        .map((s) => s.restrictedToClass) ?? [];
    expect(staffRewardClasses).toEqual(['mage']);
    const excluded = index().items.find(
      (i) => i.requiredClass && !i.requiredClass.includes('mage'),
    );
    expect(excluded).toBeDefined();
    expect(mage.some((i) => i.itemId === excluded?.itemId)).toBe(false);

    const int = filterLootExplorerItems(index(), {
      ...LOOT_EXPLORER_DEFAULT_FILTERS,
      statKey: 'int',
    });
    expect(int.length).toBeGreaterThan(0);
    for (const item of int) expect(item.statKeys).toContain('int');
  });
});

describe('groupLootExplorerBySource', () => {
  it('every drop traces back to the input list, and normal/heroic split into separate groups', () => {
    const items = buildLootExplorerIndex().items;
    const groups = groupLootExplorerBySource(items);
    expect(groups.length).toBeGreaterThan(0);
    const itemIds = new Set(items.map((i) => i.itemId));
    for (const group of groups) {
      expect(group.drops.length).toBeGreaterThan(0);
      for (const drop of group.drops) expect(itemIds.has(drop.itemId)).toBe(true);
    }
    const bossId = FINDER_ACTIVITIES.find(
      (a) => a.kind === 'dungeon' && a.encounters.some((e) => MOBS[e.mobId]?.loot?.length),
    )?.encounters.find((e) => MOBS[e.mobId]?.loot?.length)?.mobId;
    expect(bossId).toBeDefined();
    expect(groups.some((g) => g.sourceId === bossId && g.difficulty === 'normal')).toBe(true);
  });
});
