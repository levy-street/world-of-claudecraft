// Loot Explorer encounter narrowing: the World Boss category, the Encounter
// filter on LootExplorerFilters, the dropdown's option groups, and the
// "By Encounter" card order (src/ui/hud/loot_explorer/loot_explorer_encounter_core.ts).

import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { ITEMS, MOBS } from '../src/sim/data';
import {
  buildLootExplorerIndex,
  buildMobToDungeon,
  filterLootExplorerItems,
  groupLootExplorerBySource,
  instanceEncounterFilter,
  LOOT_EXPLORER_DEFAULT_FILTERS,
  type LootExplorerEncounter,
  lootExplorerEncounterGroups,
  mobEncounterFilter,
  sortLootExplorerEncounters,
} from '../src/ui/hud/loot_explorer';

const index = () => buildLootExplorerIndex();
const sourcesOf = (filters: Partial<typeof LOOT_EXPLORER_DEFAULT_FILTERS>) =>
  filterLootExplorerItems(index(), { ...LOOT_EXPLORER_DEFAULT_FILTERS, ...filters }).flatMap(
    (item) => item.sources.map((s) => ({ ...s, itemId: item.itemId })),
  );

const finderBossWithHeroicLoot = (kind: 'raid' | 'dungeon') => {
  const mobToDungeon = buildMobToDungeon();
  for (const activity of FINDER_ACTIVITIES) {
    if (activity.kind !== kind) continue;
    for (const enc of activity.encounters) {
      const drops = (MOBS[enc.mobId]?.loot ?? []).filter((e) => e.itemId && ITEMS[e.itemId]);
      if (drops.some((e) => !e.normalOnly) && mobToDungeon.has(enc.mobId)) return enc.mobId;
    }
  }
  return undefined;
};

describe('world boss category', () => {
  it('classifies every world boss item drop as world_boss, never open_world', () => {
    let checked = 0;
    for (const mob of Object.values(MOBS)) {
      if (!mob.worldBoss) continue;
      for (const entry of mob.loot ?? []) {
        if (!entry.itemId || !ITEMS[entry.itemId]) continue;
        const sources =
          index()
            .items.find((i) => i.itemId === entry.itemId)
            ?.sources.filter((s) => s.sourceId === mob.id) ?? [];
        expect(sources.length, `${mob.id}/${entry.itemId}`).toBeGreaterThan(0);
        for (const s of sources) expect(s.category).toBe('world_boss');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    for (const s of sourcesOf({ category: 'open_world' })) {
      expect(MOBS[s.sourceId]?.worldBoss, s.sourceId).toBeFalsy();
    }
  });

  it('lists every world boss that pays an item in one flat group', () => {
    const groups = lootExplorerEncounterGroups(index(), 'world_boss');
    expect(groups).toHaveLength(1);
    expect(groups[0].contextId).toBeUndefined();
    const expected = new Set(sourcesOf({ category: 'world_boss' }).map((s) => s.sourceId));
    expect(new Set(groups[0].bossMobIds)).toEqual(expected);
    expect(expected.size).toBeGreaterThan(0);
  });
});

describe('encounter filter', () => {
  it('a boss pick narrows to that boss and keeps both its Normal and Heroic rows', () => {
    for (const kind of ['raid', 'dungeon'] as const) {
      const bossId = finderBossWithHeroicLoot(kind);
      expect(bossId, kind).toBeDefined();
      const sources = sourcesOf({ category: kind, encounter: mobEncounterFilter(bossId!) });
      expect(sources.length).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.sourceId).toBe(bossId);
        expect(s.category).toBe(kind);
      }
      const diffs = new Set(sources.map((s) => s.difficulty));
      expect(diffs.has('normal'), `${bossId} normal`).toBe(true);
      expect(diffs.has('heroic'), `${bossId} heroic`).toBe(true);
    }
  });

  it('an instance pick keeps every source in that instance, trash included, and nothing else', () => {
    const all = sourcesOf({ category: 'dungeon' });
    const dungeonId = all[0]?.contextId;
    expect(dungeonId).toBeDefined();
    const narrowed = sourcesOf({
      category: 'dungeon',
      encounter: instanceEncounterFilter(dungeonId!),
    });
    const expected = all.filter((s) => s.contextId === dungeonId);
    expect(narrowed).toHaveLength(expected.length);
    for (const s of narrowed) expect(s.contextId).toBe(dungeonId);
    expect(narrowed.length).toBeLessThan(all.length);
  });

  it('is ignored outside raid, dungeon, and world boss, so a stale pick never empties a category', () => {
    const bossId = finderBossWithHeroicLoot('raid')!;
    for (const category of ['vendor', 'open_world', 'all'] as const) {
      expect(sourcesOf({ category, encounter: mobEncounterFilter(bossId) })).toHaveLength(
        sourcesOf({ category }).length,
      );
    }
  });
});

describe('lootExplorerEncounterGroups', () => {
  it('raid and dungeon groups cover every boss that drops an item, in finder progression order', () => {
    for (const kind of ['raid', 'dungeon'] as const) {
      const groups = lootExplorerEncounterGroups(index(), kind);
      expect(groups.length, kind).toBeGreaterThan(0);
      const contexts = new Set(sourcesOf({ category: kind }).map((s) => s.contextId));
      for (const g of groups) {
        expect(g.contextId, kind).toBeDefined();
        expect(contexts.has(g.contextId)).toBe(true);
      }
      const listed = new Set(groups.flatMap((g) => g.bossMobIds));
      const paying = new Set(sourcesOf({ category: kind }).map((s) => s.sourceId));
      const order: string[] = [];
      for (const activity of FINDER_ACTIVITIES) {
        if (activity.kind !== kind) continue;
        for (const enc of activity.encounters) {
          if (paying.has(enc.mobId)) {
            expect(listed.has(enc.mobId), enc.mobId).toBe(true);
            if (!order.includes(enc.mobId)) order.push(enc.mobId);
          }
        }
      }
      for (const g of groups) {
        const finderBosses = g.bossMobIds.filter((id) => order.includes(id));
        const sorted = [...finderBosses].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        expect(finderBosses, String(g.contextId)).toEqual(sorted);
      }
    }
  });

  it('never lists trash as a boss option', () => {
    const finderIds = new Set(
      FINDER_ACTIVITIES.flatMap((a) => a.encounters.map((enc) => enc.mobId)),
    );
    for (const kind of ['raid', 'dungeon'] as const) {
      for (const g of lootExplorerEncounterGroups(index(), kind)) {
        for (const id of g.bossMobIds) {
          const mob = MOBS[id];
          expect(finderIds.has(id) || mob?.boss || mob?.bossCorpseHold, id).toBeTruthy();
        }
      }
    }
  });
});

describe('sortLootExplorerEncounters', () => {
  it('puts each boss Normal card directly before its Heroic card', () => {
    const sorted = sortLootExplorerEncounters(groupLootExplorerBySource(index().items));
    let pairs = 0;
    sorted.forEach((enc, i) => {
      if (enc.difficulty !== 'heroic') return;
      const hasNormal = sorted.some(
        (o) =>
          o.category === enc.category && o.sourceId === enc.sourceId && o.difficulty === 'normal',
      );
      if (!hasNormal) return;
      const prev = sorted[i - 1];
      expect(prev?.sourceId, enc.sourceId).toBe(enc.sourceId);
      expect(prev?.difficulty).toBe('normal');
      pairs++;
    });
    expect(pairs).toBeGreaterThan(0);
  });

  it('orders cards by source category and keeps every card', () => {
    const groups = groupLootExplorerBySource(index().items);
    const sorted = sortLootExplorerEncounters(groups);
    expect(sorted).toHaveLength(groups.length);
    const seen: LootExplorerEncounter['category'][] = [];
    for (const enc of sorted) {
      if (seen.at(-1) !== enc.category) {
        expect(seen.includes(enc.category), enc.category).toBe(false);
        seen.push(enc.category);
      }
    }
    expect(seen.indexOf('raid')).toBeLessThan(seen.indexOf('vendor'));
  });
});
