// The reward bundle every world quest pays (src/sim/world_quests.ts awardWorldQuest)
// and the day's item slot, driven through the real credit arm: XP, copper and
// standing on every completion; the fixed piece for the character's class when
// the quest's zone is one of the cycle's item slots and the character is in the
// item bracket; a full bag loses the piece and says so; and the owner's budget,
// the whole day's circuit at the cap under ten gold with every purse on top.
import { describe, expect, it } from 'vitest';
import { bagPools, bagsFullErrorText, canAddItem } from '../src/sim/bags';
import { CLUE_SCROLL_ITEM_ID } from '../src/sim/content/clue_hunts';
import { WORLD_QUEST_CLASS_LOOT } from '../src/sim/content/world_quest_loot';
import {
  WORLD_QUEST_COPPER,
  WORLD_QUEST_DAILY_COPPER_BUDGET,
  WORLD_QUEST_XP_RATE,
  WORLD_QUESTS_BY_ID,
} from '../src/sim/content/world_quests';
import { ITEMS } from '../src/sim/data';
import { worldQuestStandingReward } from '../src/sim/factions';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import {
  type Entity,
  MAX_LEVEL,
  type SimEvent,
  type WorldQuestDef,
  xpForLevel,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { FARSHORE_SALVAGE_AMBUSH } from '../src/sim/world_quest_ambush';
import { WISP_MAZE_HARD_BONUS, worldQuestBonusCopper } from '../src/sim/world_quest_bonus';
import {
  WORLD_QUEST_CHAMPION_TUNING,
  WORLD_QUEST_CHAMPION_TYPES,
} from '../src/sim/world_quest_champion';
import {
  WORLD_QUEST_ITEM_MIN_LEVEL,
  worldQuestItemRewardFor,
  worldQuestItemZonesForCycle,
} from '../src/sim/world_quest_item_slots';
import { playerActiveWorldQuests } from '../src/sim/world_quest_reroll';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  activeWorldQuestsForCycle,
  worldQuestCycleForResetDay,
} from '../src/sim/world_quest_rotation';
import {
  onMobKilledForWorldQuests,
  worldQuestCopperReward,
  worldQuestXpReward,
} from '../src/sim/world_quests';

const EPOCH_DAY = Date.UTC(2026, 7, 31);

function isoDay(offset: number): string {
  return new Date(EPOCH_DAY + offset * 86_400_000).toISOString().slice(0, 10);
}

/** The first cycle (from the rotation epoch) whose board holds a kill quest a
 *  character of `level` can take in one of that cycle's item zones, with the
 *  quest itself; the slots are drawn per cycle, so the test finds its day
 *  instead of pinning one. */
function killQuestOnAnItemSlot(level = 20): { day: string; cycle: string; quest: WorldQuestDef } {
  for (let offset = 0; offset < 60; offset++) {
    const day = isoDay(offset);
    const cycle = worldQuestCycleForResetDay(day);
    const zones = worldQuestItemZonesForCycle(cycle);
    const quest = activeWorldQuestsForCycle(cycle).find(
      (q) =>
        q.objective.type === 'kill' &&
        q.minLevel <= level &&
        zones.includes(q.zoneId) &&
        !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(q.id),
    );
    if (quest) return { day, cycle, quest };
  }
  throw new Error('No cycle in the first 60 offers a kill quest on an item slot');
}

/** The first cycle whose board holds a kill quest OFF every item slot. */
function killQuestOffTheSlots(): { day: string; quest: WorldQuestDef } {
  for (let offset = 0; offset < 60; offset++) {
    const day = isoDay(offset);
    const cycle = worldQuestCycleForResetDay(day);
    const zones = worldQuestItemZonesForCycle(cycle);
    const quest = activeWorldQuestsForCycle(cycle).find(
      (q) => q.objective.type === 'kill' && !zones.includes(q.zoneId),
    );
    if (quest) return { day, quest };
  }
  throw new Error('No cycle in the first 60 offers a kill quest off the item slots');
}

// Auto-equip stays OFF so a granted piece stays in the bags, where countItem
// reads; with it on the sim would equip the day's gear straight out of them.
function questSim(day: string, quest: WorldQuestDef, level: number, seed = 4711): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false });
  sim.setPlayerLevel(level);
  sim.utcDay = day;
  sim.resetDay = day;
  const player = sim.player;
  player.pos.x = quest.area.x;
  player.pos.z = quest.area.z;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
  sim.tick();
  sim.drainEvents();
  expect(sim.worldQuestLog.get(quest.id)?.state).toBe('active');
  return sim;
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('Missing player meta');
  return meta;
}

function complete(sim: Sim, quest: WorldQuestDef): SimEvent[] {
  if (quest.objective.type !== 'kill') throw new Error(`Expected a kill objective ${quest.id}`);
  const targetMobId = quest.objective.targetMobId;
  const target = [...sim.entities.values()].find(
    (entity): entity is Entity => entity.kind === 'mob' && entity.templateId === targetMobId,
  );
  if (!target) throw new Error(`Missing target ${targetMobId}`);
  target.pos.x = quest.area.x;
  target.pos.z = quest.area.z;
  const meta = metaOf(sim);
  for (let i = 0; i < quest.count; i++) onMobKilledForWorldQuests(sim.ctx, target, meta);
  expect(sim.worldQuestLog.get(quest.id)?.state).toBe('completed');
  return sim.drainEvents();
}

/** Fills the bags with unstackable filler until `itemId` no longer fits. */
function fillBagsAgainst(meta: PlayerMeta, itemId: string): void {
  const filler = Object.values(ITEMS).find(
    (item) => item.id !== itemId && item.kind === 'armor' && !!item.slot,
  );
  if (!filler) throw new Error('No filler item');
  while (canAddItem(meta.inventory, bagPools(meta.bags), itemId, 1))
    meta.inventory.push({ itemId: filler.id, count: 1 });
}

describe('the bundle', () => {
  it('pays XP, copper and standing on a completion, through the real credit arm', () => {
    const { day, quest } = killQuestOffTheSlots();
    const sim = questSim(day, quest, 20);
    const before = { xp: sim.lifetimeXp, copper: sim.copper };
    const events = complete(sim, quest);
    expect(sim.lifetimeXp - before.xp).toBe(worldQuestXpReward(quest, 20));
    expect(sim.copper - before.copper).toBe(worldQuestCopperReward(quest, 20));
    const texts = events.filter((ev) => ev.type === 'loot').map((ev) => ev.text);
    expect(texts.some((text) => text.startsWith('You receive '))).toBe(true);
    expect(texts.some((text) => text.includes('Standing'))).toBe(true);
  });

  it('follows the shared schedule: 31 silver and twelve percent of the bar at the cap', () => {
    const plain = { reward: undefined };
    expect(worldQuestCopperReward(plain, MAX_LEVEL)).toBe(
      WORLD_QUEST_COPPER.base + WORLD_QUEST_COPPER.perLevel * MAX_LEVEL,
    );
    expect(worldQuestCopperReward(plain, MAX_LEVEL)).toBe(3_100);
    expect(worldQuestXpReward(plain, MAX_LEVEL)).toBe(
      Math.round(xpForLevel(MAX_LEVEL) * WORLD_QUEST_XP_RATE),
    );
    expect(worldQuestCopperReward({ reward: { copper: { base: 100, perLevel: 1 } } }, 20)).toBe(
      120,
    );
    expect(worldQuestXpReward({ reward: { xpRate: 0.5 } }, 20)).toBe(
      Math.round(xpForLevel(20) * 0.5),
    );
  });

  it('pays every component at the turn-in level: a ding on the XP adds no item and no higher standing', () => {
    // The map hover showed this character the level-15 bundle: no item (below
    // the bracket) and the low standing rate. The quest's XP dings them to 16,
    // and the award still pays what the hover promised.
    const { day, cycle, quest } = killQuestOnAnItemSlot(15);
    const sim = questSim(day, quest, 15);
    const meta = metaOf(sim);
    meta.xp = xpForLevel(15) - 1;
    const piece = worldQuestItemRewardFor(cycle, quest.zoneId, 'warrior');
    if (!piece) throw new Error('Expected an item on the slot');
    const lowRate = worldQuestStandingReward(quest, 15);
    expect(lowRate).not.toBe(worldQuestStandingReward(quest, 16));
    const events = complete(sim, quest);
    expect(sim.player.level).toBe(16);
    expect(events.some((ev) => ev.type === 'levelup')).toBe(true);
    expect(sim.countItem(piece)).toBe(0);
    const standingLine = events.find((ev) => ev.type === 'loot' && / Standing\.$/.test(ev.text));
    expect(standingLine?.type === 'loot' ? standingLine.text : '').toMatch(
      new RegExp(`^\\+${lowRate} `),
    );
  });
});

describe("the day's item", () => {
  it('hands a capped character the fixed piece for its class when the zone is a slot', () => {
    const { day, cycle, quest } = killQuestOnAnItemSlot();
    const sim = questSim(day, quest, 20);
    const expected = worldQuestItemRewardFor(cycle, quest.zoneId, 'warrior');
    if (!expected) throw new Error('Expected an item on the slot');
    expect(WORLD_QUEST_CLASS_LOOT.warrior).toContain(expected);
    const before = sim.countItem(expected);
    const events = complete(sim, quest);
    expect(sim.countItem(expected) - before).toBe(1);
    const receipt = events.find(
      (ev) => ev.type === 'loot' && ev.text.includes(ITEMS[expected].name),
    );
    expect(receipt).toBeDefined();
  });

  it('pays no piece below the item bracket, and none off the slots', () => {
    const onSlot = killQuestOnAnItemSlot(WORLD_QUEST_ITEM_MIN_LEVEL - 1);
    const young = questSim(onSlot.day, onSlot.quest, WORLD_QUEST_ITEM_MIN_LEVEL - 1);
    const youngBefore = young.player.level;
    const inventoryBefore = metaOf(young).inventory.length;
    complete(young, onSlot.quest);
    expect(young.player.level).toBe(youngBefore);
    expect(metaOf(young).inventory.length).toBe(inventoryBefore);

    const offSlot = killQuestOffTheSlots();
    const capped = questSim(offSlot.day, offSlot.quest, 20);
    const cappedBefore = metaOf(capped).inventory.length;
    complete(capped, offSlot.quest);
    expect(metaOf(capped).inventory.length).toBe(cappedBefore);
  });

  it('loses the piece to a full bag and says so, without touching the rest of the bundle', () => {
    const { day, cycle, quest } = killQuestOnAnItemSlot();
    const sim = questSim(day, quest, 20);
    const expected = worldQuestItemRewardFor(cycle, quest.zoneId, 'warrior');
    if (!expected) throw new Error('Expected an item on the slot');
    const meta = metaOf(sim);
    fillBagsAgainst(meta, expected);
    const copperBefore = sim.copper;
    const events = complete(sim, quest);
    expect(sim.countItem(expected)).toBe(0);
    expect(sim.copper - copperBefore).toBe(worldQuestCopperReward(quest, 20));
    const error = events.find((ev) => ev.type === 'error');
    expect(error?.type === 'error' ? error.text : '').toBe(bagsFullErrorText(meta, expected));
  });

  it("with one free bag slot on the slate's last quest, the day's piece lands and the Clue Scroll is lost for the day", () => {
    // The quest's own reward pays first (the order the Clue Scroll test pins),
    // so the scroll meets the bag-capacity rule that already governs it: lost
    // for the day, the cycle marked, never re-rolled on a later turn-in.
    // 2026-08-31 is cycle wq1_0, whose slots include thornpeak_heights
    // (pinned in tests/world_quest_item_slots.test.ts).
    const quest = WORLD_QUESTS_BY_ID.wq_thornpeak_stormcrag;
    const sim = questSim('2026-08-31', quest, 20);
    const meta = metaOf(sim);
    for (const slot of playerActiveWorldQuests(meta)) {
      if (slot.id === quest.id || ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(slot.id)) continue;
      meta.worldQuestLog.set(slot.id, { questId: slot.id, count: slot.count, state: 'completed' });
    }
    const expected = worldQuestItemRewardFor(meta.worldQuestCycle, quest.zoneId, 'warrior');
    if (!expected) throw new Error('Expected an item on the slot');
    fillBagsAgainst(meta, expected);
    meta.inventory.pop();
    expect(canAddItem(meta.inventory, bagPools(meta.bags), expected, 1)).toBe(true);
    const events = complete(sim, quest);
    expect(sim.countItem(expected)).toBe(1);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(0);
    expect(events.some((ev) => ev.type === 'clueScrollLost')).toBe(true);
    expect(events.some((ev) => ev.type === 'clueScrollEarned')).toBe(false);
    expect(meta.clueScrollCycle).toBe(meta.worldQuestCycle);
  });
});

describe('the daily budget', () => {
  it('keeps a full day at the cap under ten gold with every purse on top, for a month of cycles', () => {
    for (let n = 0; n < 32; n++) {
      const cycle = `wq1_${n}`;
      const board = activeWorldQuestsForCycle(cycle);
      let copper = 0;
      for (const quest of board) {
        copper += worldQuestCopperReward(quest, MAX_LEVEL);
        if (WORLD_QUEST_CHAMPION_TYPES.has(quest.objective.type))
          copper += worldQuestBonusCopper(
            WORLD_QUEST_CHAMPION_TUNING.purse.base,
            WORLD_QUEST_CHAMPION_TUNING.purse.perLevel,
            MAX_LEVEL,
          );
        if (quest.id === FARSHORE_SALVAGE_AMBUSH.questId)
          copper += worldQuestBonusCopper(
            FARSHORE_SALVAGE_AMBUSH.purse.base,
            FARSHORE_SALVAGE_AMBUSH.purse.perLevel,
            MAX_LEVEL,
          );
      }
      // Purses a day can pay at most once, counted whether or not the board
      // offers them: the hard wisp maze's first completion.
      copper += worldQuestBonusCopper(
        WISP_MAZE_HARD_BONUS.base,
        WISP_MAZE_HARD_BONUS.perLevel,
        MAX_LEVEL,
      );
      expect(copper, `cycle ${cycle}`).toBeLessThanOrEqual(WORLD_QUEST_DAILY_COPPER_BUDGET);
    }
  });
});
