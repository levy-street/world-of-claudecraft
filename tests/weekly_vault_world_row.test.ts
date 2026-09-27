// The Weekly Vault's world row (docs/design/weekly-vault.md, "World quest
// integration"): the catch-up shelf. Pins the tier the row pays, that every
// class can wear what it rolls, that the pool ignores raid kills, and that a
// rotating world quest counts exactly once through the real credit arm.
import { describe, expect, it } from 'vitest';
import { IGNIVAR_LOOT_ITEM_IDS } from '../src/sim/content/ignivar_loot';
import { WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { BUILTIN_WORLD, ITEMS, NPCS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { itemLevel } from '../src/sim/item_level';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES } from '../src/sim/types';
import {
  advanceWeeklyRewards,
  earnedWeeklyRolls,
  emptyWeeklyRewards,
  recordWeeklyWorldQuest,
  WEEKLY_KEEPER_ID,
  WEEKLY_POOL_IDS,
  WEEKLY_THRESHOLDS,
  weeklyLootPool,
  weeklyRewardInfoFor,
} from '../src/sim/weekly_rewards';
import { terrainHeight } from '../src/sim/world';
import { onMobKilledForWorldQuests } from '../src/sim/world_quests';

// Nythraxis Normal: source level 20 plus the epic and raid bonuses. The previous
// raid tier, one shelf under the Crucible's 35 (docs/prd/ignivar-raid-loot.md).
const PREVIOUS_TIER_ITEM_LEVEL = 29;
const WORLD_POOL_INDEX = WEEKLY_POOL_IDS.indexOf('world');
const WEEK = 604800000;
const THORNPEAK = 'wq_thornpeak_stormcrag';

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('Missing player meta');
  return meta;
}

function placeAt(sim: Sim, x: number, z: number): void {
  const player = sim.player;
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = terrainHeight(x, z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

/** A capped warrior standing inside the Thornpeak kill quest on the first cycle. */
function questSim(seed = 4711): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  const quest = WORLD_QUESTS_BY_ID[THORNPEAK];
  sim.setPlayerLevel(20);
  sim.utcDay = '2026-08-31';
  sim.resetDay = '2026-08-31';
  placeAt(sim, quest.area.x, quest.area.z);
  sim.tick();
  sim.drainEvents();
  expect(metaOf(sim).worldQuestLog.get(THORNPEAK)?.state).toBe('active');
  return sim;
}

/** Turns Thornpeak in through the real kill-credit path. */
function completeThornpeak(sim: Sim): void {
  const quest = WORLD_QUESTS_BY_ID[THORNPEAK];
  if (quest.objective.type !== 'kill') throw new Error('Expected a kill objective');
  const targetMobId = quest.objective.targetMobId;
  const target = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.templateId === targetMobId,
  );
  if (!target) throw new Error(`Missing target ${targetMobId}`);
  target.pos.x = quest.area.x;
  target.pos.z = quest.area.z;
  const meta = metaOf(sim);
  for (let i = 0; i < quest.count; i++) onMobKilledForWorldQuests(sim.ctx, target, meta);
  expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('completed');
}

describe('the world pool', () => {
  it('is the previous raid tier at Normal, wearable by the class, for every class', () => {
    for (const cls of ALL_CLASSES) {
      const pool = weeklyLootPool('world', cls);
      expect(pool.length, `${cls} has a world pool`).toBeGreaterThan(0);
      for (const id of pool) {
        const item = ITEMS[id];
        expect(['weapon', 'armor', 'held_offhand'], `${cls} ${id} kind`).toContain(item.kind);
        expect(['rare', 'epic'], `${cls} ${id} quality`).toContain(item.quality);
        expect(canEquipItem(cls, item), `${cls} can wear ${id}`).toBe(true);
        if (item.requiredClass) expect(item.requiredClass, `${id} class lock`).toContain(cls);
        expect(item.heroicOf, `${id} is a Normal piece`).toBeUndefined();
        expect(itemLevel(item), `${cls} ${id} item level`).toBe(PREVIOUS_TIER_ITEM_LEVEL);
        expect(IGNIVAR_LOOT_ITEM_IDS, `${id} is not the current tier`).not.toContain(id);
      }
    }
  });

  it('equals the raid row with only Nythraxis Normal unlocked, and ignores raid kills', () => {
    for (const cls of ALL_CLASSES) {
      expect(weeklyLootPool('world', cls), cls).toEqual(weeklyLootPool('raid', cls, [1, 0, 0]));
      expect(weeklyLootPool('world', cls, [0, 0, 0]), cls).toEqual(weeklyLootPool('world', cls));
    }
  });
});

describe('the completion count', () => {
  it('counts a rotating world quest once, through the real credit arm', () => {
    const sim = questSim();
    const meta = metaOf(sim);
    expect(meta.weeklyRewards?.world ?? 0).toBe(0);
    completeThornpeak(sim);
    expect(meta.weeklyRewards?.world).toBe(1);
    // The quest is turned in: further kills of its target credit nothing.
    completeThornpeak(sim);
    expect(meta.weeklyRewards?.world).toBe(1);
  });

  it('caps at the eighth completion and never counts a leaving character', () => {
    const sim = questSim();
    const meta = metaOf(sim);
    for (let i = 0; i < 10; i++) recordWeeklyWorldQuest(sim.ctx, sim.playerId);
    expect(meta.weeklyRewards?.world).toBe(WEEKLY_THRESHOLDS.world[2]);
    meta.leaving = true;
    recordWeeklyWorldQuest(sim.ctx, sim.playerId);
    expect(meta.weeklyRewards?.world).toBe(WEEKLY_THRESHOLDS.world[2]);
  });

  it('mints one world choice per threshold reached at the reset, then clears the count', () => {
    const state = emptyWeeklyRewards(WEEK);
    state.world = WEEKLY_THRESHOLDS.world[1];
    expect(earnedWeeklyRolls(state)[WORLD_POOL_INDEX]).toBe(2);
    advanceWeeklyRewards(
      state,
      WEEK,
      (now) => now + WEEK,
      (pool) => weeklyLootPool(pool, 'mage').length > 0,
    );
    const worldChoices = state.vaults[0]?.choices.filter((choice) => choice.pool === 'world');
    expect(worldChoices).toHaveLength(2);
    expect(state.world).toBe(0);
  });
});

describe('the keeper', () => {
  it('reports the world row available', () => {
    const world = {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
      groundObjects: [],
    };
    const sim = new Sim({
      seed: 42,
      playerClass: 'mage',
      noPlayer: true,
      world,
      lockoutNowMs: () => 1000,
      weeklyRaidResetMs: (n) => (Math.floor(n / WEEK) + 1) * WEEK,
    });
    const pid = sim.addPlayer('mage', 'Collector');
    const player = sim.entities.get(pid);
    const keeper = [...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID);
    if (!player || !keeper) throw new Error('Missing player or keeper');
    player.pos = { ...keeper.pos, x: keeper.pos.x - 1 };
    player.prevPos = { ...player.pos };
    sim.ctx.rebucket(player);
    expect(weeklyRewardInfoFor(sim.ctx, pid)?.worldQuestsAvailable).toBe(true);
  });
});
