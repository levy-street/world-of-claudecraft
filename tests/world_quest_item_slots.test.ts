// The day's item slots (src/sim/world_quest_item_slots.ts): three rotating zones
// per cycle, the same for the whole realm, and one fixed piece per cycle, zone
// and class. Pure functions of the cycle id, so both hosts and the map agree.
import { describe, expect, it } from 'vitest';
import { WORLD_QUEST_CLASS_LOOT } from '../src/sim/content/world_quest_loot';
import { ALL_CLASSES } from '../src/sim/types';
import {
  WORLD_QUEST_ITEM_MIN_LEVEL,
  WORLD_QUEST_ITEM_SLOTS_PER_CYCLE,
  WORLD_QUEST_ITEM_ZONES,
  worldQuestItemRewardFor,
  worldQuestItemRewardForQuest,
  worldQuestItemZonesForCycle,
} from '../src/sim/world_quest_item_slots';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  activeWorldQuestsForCycle,
  WORLD_QUEST_ZONES,
  WORLD_QUESTS_BY_ZONE,
} from '../src/sim/world_quest_rotation';

const CYCLES = 400;

describe('the item zones', () => {
  it('are the rotating zones only, in WORLD_QUEST_ZONES order: a zone whose quests are all dailies never carries a slot', () => {
    for (const zoneId of WORLD_QUEST_ITEM_ZONES) {
      expect(WORLD_QUEST_ZONES).toContain(zoneId);
      expect(
        WORLD_QUESTS_BY_ZONE[zoneId].some((id) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(id)),
        zoneId,
      ).toBe(true);
    }
    // galecrest offers only the two always-active dailies today.
    expect(WORLD_QUEST_ITEM_ZONES).not.toContain('galecrest');
    // The ORDER is load-bearing: the item seed mixes the zone's position here,
    // so a reorder reshuffles every character's daily item (module header).
    expect(WORLD_QUEST_ITEM_ZONES).toEqual([
      'eastbrook_vale',
      'mirefen_marsh',
      'thornpeak_heights',
      'veiled_hollow',
      'drakelands',
      'frostveil',
      'amberfall',
      'willowfen',
      'nightbloom',
      'wraithwood',
      'palmreach',
      'evergarden',
      'farshore_isle',
    ]);
  });

  it('picks three distinct zones per cycle, stable across calls and cycle spellings', () => {
    for (let n = 0; n < CYCLES; n++) {
      const zones = worldQuestItemZonesForCycle(`wq1_${n}`);
      expect(zones).toHaveLength(WORLD_QUEST_ITEM_SLOTS_PER_CYCLE);
      expect(new Set(zones).size).toBe(WORLD_QUEST_ITEM_SLOTS_PER_CYCLE);
      for (const zoneId of zones) expect(WORLD_QUEST_ITEM_ZONES).toContain(zoneId);
      expect(worldQuestItemZonesForCycle(`wq1_${n}`)).toEqual(zones);
    }
    // The legacy three-day spelling and the ISO day resolve to the same cycle.
    expect(worldQuestItemZonesForCycle('2026-08-31')).toEqual(worldQuestItemZonesForCycle('wq1_0'));
    expect(worldQuestItemZonesForCycle('wq3_1')).toEqual(worldQuestItemZonesForCycle('wq1_3'));
    expect(worldQuestItemZonesForCycle('')).toEqual([]);
    expect(worldQuestItemZonesForCycle(undefined)).toEqual([]);
  });

  it('spreads the slots across every rotating zone over a year, and differs day to day', () => {
    const seen = new Map<string, number>();
    let unchangedDays = 0;
    for (let n = 0; n < CYCLES; n++) {
      const zones = worldQuestItemZonesForCycle(`wq1_${n}`);
      for (const zoneId of zones) seen.set(zoneId, (seen.get(zoneId) ?? 0) + 1);
      if (n > 0 && zones.join() === worldQuestItemZonesForCycle(`wq1_${n - 1}`).join())
        unchangedDays++;
    }
    for (const zoneId of WORLD_QUEST_ITEM_ZONES) {
      // Uniform expectation is 400 * 3 / 13, about 92; a zone under a third of
      // that would mean the draw is biased.
      expect(seen.get(zoneId) ?? 0, zoneId).toBeGreaterThan(30);
    }
    expect(unchangedDays).toBeLessThan(CYCLES / 20);
  });

  it('pins the first cycles, so a seed, mix or ordering change is a deliberate re-pin and never a silent reshuffle', () => {
    // A reshuffle across a deploy has an old client previewing one piece while
    // the server grants another; these literals make that a visible change.
    expect(worldQuestItemZonesForCycle('wq1_0')).toEqual([
      'thornpeak_heights',
      'wraithwood',
      'amberfall',
    ]);
    expect(worldQuestItemZonesForCycle('wq1_1')).toEqual([
      'amberfall',
      'drakelands',
      'eastbrook_vale',
    ]);
    expect(worldQuestItemZonesForCycle('wq1_2')).toEqual([
      'wraithwood',
      'veiled_hollow',
      'drakelands',
    ]);
    const perClass = Object.fromEntries(
      ALL_CLASSES.map((cls) => [cls, worldQuestItemRewardFor('wq1_0', 'thornpeak_heights', cls)]),
    );
    expect(perClass).toEqual({
      warrior: 'bloodmane_warleggings',
      paladin: 'ysols_pearl_greaves',
      hunter: 'wyrmshadow_legguards',
      rogue: 'wildgrowth_leggings',
      priest: 'mantle_of_the_unhorsed',
      shaman: 'hoarfrost_edge',
      mage: 'architects_cornerstone',
      warlock: 'staff_of_velkhar',
      druid: 'grovewardens_grips',
    });
  });
});

describe('the item for a class', () => {
  it('is fixed per cycle, zone and class, drawn from that class table, and null off the slots', () => {
    for (let n = 0; n < 40; n++) {
      const cycle = `wq1_${n}`;
      const zones = worldQuestItemZonesForCycle(cycle);
      for (const cls of ALL_CLASSES) {
        for (const zoneId of WORLD_QUEST_ITEM_ZONES) {
          const item = worldQuestItemRewardFor(cycle, zoneId, cls);
          if (zones.includes(zoneId)) {
            expect(item, `${cycle} ${zoneId} ${cls}`).not.toBeNull();
            expect(WORLD_QUEST_CLASS_LOOT[cls]).toContain(item);
            expect(worldQuestItemRewardFor(cycle, zoneId, cls)).toBe(item);
          } else {
            expect(item, `${cycle} ${zoneId} ${cls}`).toBeNull();
          }
        }
      }
    }
  });

  it('varies by class on every slot and by cycle for the same class', () => {
    // Nine classes draw with adjacent seeds on the same slot; measured over the
    // first forty cycles the slot's distinct count never drops below seven
    // (mean 8.6), so six is the floor that would catch a collapse of the mix.
    for (let n = 0; n < 40; n++) {
      const cycle = `wq1_${n}`;
      for (const zoneId of worldQuestItemZonesForCycle(cycle)) {
        const byClass = new Set(
          ALL_CLASSES.map((cls) => worldQuestItemRewardFor(cycle, zoneId, cls)),
        );
        expect(byClass.size, `${cycle} ${zoneId}`).toBeGreaterThanOrEqual(6);
      }
    }
    const warriorDays = new Set<string | null>();
    for (let n = 0; n < CYCLES; n++) {
      const zones = worldQuestItemZonesForCycle(`wq1_${n}`);
      warriorDays.add(worldQuestItemRewardFor(`wq1_${n}`, zones[0], 'warrior'));
    }
    expect(warriorDays.size).toBeGreaterThan(WORLD_QUEST_CLASS_LOOT.warrior.length / 2);
  });

  it('gates the award on the item bracket but not the preview by zone', () => {
    const cycle = 'wq1_3';
    const zoneId = worldQuestItemZonesForCycle(cycle)[1];
    const rotatingId = WORLD_QUESTS_BY_ZONE[zoneId].find(
      (id) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(id),
    );
    if (!rotatingId) throw new Error(`No rotating quest in ${zoneId}`);
    const quest = { id: rotatingId, zoneId };
    expect(
      worldQuestItemRewardForQuest(cycle, quest, 'mage', WORLD_QUEST_ITEM_MIN_LEVEL - 1),
    ).toBeNull();
    expect(worldQuestItemRewardForQuest(cycle, quest, 'mage', WORLD_QUEST_ITEM_MIN_LEVEL)).toBe(
      worldQuestItemRewardFor(cycle, zoneId, 'mage'),
    );
    expect(worldQuestItemRewardForQuest(cycle, quest, 'mage', 20)).toBe(
      worldQuestItemRewardFor(cycle, zoneId, 'mage'),
    );
  });

  it('pays exactly three quests a cycle: the rotating quest of each slot zone, never an always-active daily', () => {
    for (let n = 0; n < 60; n++) {
      const cycle = `wq1_${n}`;
      const paying = activeWorldQuestsForCycle(cycle).filter((quest) =>
        worldQuestItemRewardForQuest(cycle, quest, 'warrior', 20),
      );
      expect(paying, cycle).toHaveLength(WORLD_QUEST_ITEM_SLOTS_PER_CYCLE);
      expect(new Set(paying.map((quest) => quest.zoneId)).size).toBe(
        WORLD_QUEST_ITEM_SLOTS_PER_CYCLE,
      );
      for (const quest of paying) expect(ALWAYS_ACTIVE_WORLD_QUEST_IDS).not.toContain(quest.id);
    }
    // evergarden holds both kinds (the watch rotates, the wisp maze is a daily):
    // on an evergarden day the rotating quest pays and the maze does not, so
    // the day never hands out a fourth, duplicate piece.
    const evergardenCycle = Array.from({ length: CYCLES }, (_, n) => `wq1_${n}`).find((cycle) =>
      worldQuestItemZonesForCycle(cycle).includes('evergarden'),
    );
    if (!evergardenCycle) throw new Error('evergarden never drawn');
    const board = activeWorldQuestsForCycle(evergardenCycle);
    const maze = board.find(
      (quest) => quest.zoneId === 'evergarden' && ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id),
    );
    const watch = board.find(
      (quest) => quest.zoneId === 'evergarden' && !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id),
    );
    if (!maze || !watch) throw new Error('evergarden board shape changed');
    expect(worldQuestItemRewardForQuest(evergardenCycle, maze, 'warrior', 20)).toBeNull();
    expect(worldQuestItemRewardForQuest(evergardenCycle, watch, 'warrior', 20)).not.toBeNull();
  });
});
