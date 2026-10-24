// The day's Honor world quests (src/sim/world_quest_honor_slots.ts): two
// rotating zones per cycle, the same for the whole realm, each paying a flat
// WORLD_QUEST_HONOR_REWARD on completion through grantHonor. Pure functions of
// the cycle id, so both hosts and the map agree; the award is driven here
// through the real credit arm (world_quests.ts awardWorldQuest).
import { describe, expect, it } from 'vitest';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldQuestDef } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import {
  WORLD_QUEST_HONOR_REWARD,
  WORLD_QUEST_HONOR_SLOTS_PER_CYCLE,
  WORLD_QUEST_HONOR_ZONES,
  worldQuestHonorRewardForQuest,
  worldQuestHonorZonesForCycle,
} from '../src/sim/world_quest_honor_slots';
import { WORLD_QUEST_ITEM_ZONES } from '../src/sim/world_quest_item_slots';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  activeWorldQuestsForCycle,
  worldQuestCycleForResetDay,
} from '../src/sim/world_quest_rotation';
import { onMobKilledForWorldQuests } from '../src/sim/world_quests';

const CYCLES = 400;
const EPOCH_DAY = Date.UTC(2026, 7, 31);

function isoDay(offset: number): string {
  return new Date(EPOCH_DAY + offset * 86_400_000).toISOString().slice(0, 10);
}

describe('the Honor slots', () => {
  it('pay 150 Honor on two quests a day', () => {
    expect(WORLD_QUEST_HONOR_REWARD).toBe(150);
    expect(WORLD_QUEST_HONOR_SLOTS_PER_CYCLE).toBe(2);
  });

  it('draw from the rotating zones only (the item slots pool)', () => {
    expect(WORLD_QUEST_HONOR_ZONES).toEqual(WORLD_QUEST_ITEM_ZONES);
    expect(WORLD_QUEST_HONOR_ZONES).not.toContain('galecrest');
  });

  it('pick two distinct zones per cycle, stable across calls and cycle spellings', () => {
    for (let n = 0; n < CYCLES; n++) {
      const zones = worldQuestHonorZonesForCycle(`wq1_${n}`);
      expect(zones).toHaveLength(WORLD_QUEST_HONOR_SLOTS_PER_CYCLE);
      expect(new Set(zones).size).toBe(WORLD_QUEST_HONOR_SLOTS_PER_CYCLE);
      for (const zoneId of zones) expect(WORLD_QUEST_HONOR_ZONES).toContain(zoneId);
      expect(worldQuestHonorZonesForCycle(`wq1_${n}`)).toEqual(zones);
    }
    // An ISO reset day and the legacy three-day id normalize to the same cycle.
    expect(worldQuestHonorZonesForCycle('2026-09-03')).toEqual(
      worldQuestHonorZonesForCycle('wq1_3'),
    );
    expect(worldQuestHonorZonesForCycle('wq3_1')).toEqual(worldQuestHonorZonesForCycle('wq1_3'));
  });

  it('pick nothing for an unknown cycle', () => {
    expect(worldQuestHonorZonesForCycle('')).toEqual([]);
    expect(worldQuestHonorZonesForCycle('nonsense')).toEqual([]);
    expect(worldQuestHonorZonesForCycle(undefined)).toEqual([]);
  });

  it('change with the daily cycle and reach every rotating zone', () => {
    const seen = new Set<string>();
    let changed = 0;
    for (let n = 0; n < CYCLES; n++) {
      const zones = worldQuestHonorZonesForCycle(`wq1_${n}`);
      for (const zoneId of zones) seen.add(zoneId);
      if (n > 0 && zones.join() !== worldQuestHonorZonesForCycle(`wq1_${n - 1}`).join()) changed++;
    }
    expect([...seen].sort()).toEqual([...WORLD_QUEST_HONOR_ZONES].sort());
    expect(changed).toBeGreaterThan(CYCLES * 0.8);
  });

  it('pins the first cycles, so a zone reorder or salt change cannot ship silently', () => {
    expect(worldQuestHonorZonesForCycle('wq1_0')).toEqual(['mirefen_marsh', 'farshore_isle']);
    expect(worldQuestHonorZonesForCycle('wq1_1')).toEqual(['nightbloom', 'thornpeak_heights']);
    expect(worldQuestHonorZonesForCycle('wq1_2')).toEqual(['amberfall', 'evergarden']);
    expect(worldQuestHonorZonesForCycle('wq1_3')).toEqual(['willowfen', 'veiled_hollow']);
  });
});

describe('the Honor reward per quest', () => {
  it('rides exactly two quests on every board, the rotating quest of each Honor zone', () => {
    for (let n = 0; n < CYCLES; n++) {
      const cycle = `wq1_${n}`;
      const zones = worldQuestHonorZonesForCycle(cycle);
      const paying = activeWorldQuestsForCycle(cycle).filter(
        (quest) => worldQuestHonorRewardForQuest(cycle, quest) > 0,
      );
      expect(paying).toHaveLength(WORLD_QUEST_HONOR_SLOTS_PER_CYCLE);
      expect(paying.map((quest) => quest.zoneId).sort()).toEqual([...zones].sort());
      for (const quest of paying) {
        expect(worldQuestHonorRewardForQuest(cycle, quest)).toBe(WORLD_QUEST_HONOR_REWARD);
        expect(ALWAYS_ACTIVE_WORLD_QUEST_IDS).not.toContain(quest.id);
      }
    }
  });

  it('never rides an always-active daily, even in a zone that holds a slot', () => {
    const evergardenDay = Array.from({ length: CYCLES }, (_, n) => `wq1_${n}`).find((cycle) =>
      worldQuestHonorZonesForCycle(cycle).includes('evergarden'),
    );
    expect(evergardenDay).toBeDefined();
    expect(
      worldQuestHonorRewardForQuest(evergardenDay, {
        id: 'wq_evergarden_wisp_maze',
        zoneId: 'evergarden',
      }),
    ).toBe(0);
  });

  it('follows the zone, so a reroll inside an Honor zone keeps the bonus', () => {
    const cycle = 'wq1_0';
    const [zoneId] = worldQuestHonorZonesForCycle(cycle);
    expect(worldQuestHonorRewardForQuest(cycle, { id: 'any_rotating_quest', zoneId })).toBe(
      WORLD_QUEST_HONOR_REWARD,
    );
  });
});

/** The first cycle whose board holds a kill quest a level-20 character can take,
 *  either on one of the day's Honor zones or off them. */
function killQuestFor(onSlot: boolean): { day: string; quest: WorldQuestDef } {
  for (let offset = 0; offset < 60; offset++) {
    const day = isoDay(offset);
    const cycle = worldQuestCycleForResetDay(day);
    const quest = activeWorldQuestsForCycle(cycle).find(
      (q) =>
        q.objective.type === 'kill' &&
        q.minLevel <= 20 &&
        worldQuestHonorRewardForQuest(cycle, q) > 0 === onSlot,
    );
    if (quest) return { day, quest };
  }
  throw new Error(`No cycle in the first 60 offers a kill quest (onSlot=${onSlot})`);
}

function questSim(day: string, quest: WorldQuestDef): Sim {
  const sim = new Sim({ seed: 4711, playerClass: 'warrior', autoEquip: false });
  sim.setPlayerLevel(20);
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

describe('the award', () => {
  it('pays 150 spendable and lifetime Honor on an Honor quest, with a world_quest honor event', () => {
    const { day, quest } = killQuestFor(true);
    const sim = questSim(day, quest);
    const meta = metaOf(sim);
    const before = { honor: meta.honor, lifetime: meta.lifetimeHonor };
    const events = complete(sim, quest);
    expect(meta.honor - before.honor).toBe(WORLD_QUEST_HONOR_REWARD);
    expect(meta.lifetimeHonor - before.lifetime).toBe(WORLD_QUEST_HONOR_REWARD);
    expect(events.filter((ev) => ev.type === 'honor')).toEqual([
      {
        type: 'honor',
        pid: sim.playerId,
        amount: WORLD_QUEST_HONOR_REWARD,
        reason: 'world_quest',
      },
    ]);
  });

  it('pays no Honor on a quest off the day slots', () => {
    const { day, quest } = killQuestFor(false);
    const sim = questSim(day, quest);
    const meta = metaOf(sim);
    const before = meta.honor;
    const events = complete(sim, quest);
    expect(meta.honor).toBe(before);
    expect(events.some((ev) => ev.type === 'honor')).toBe(false);
  });

  it('pays once per cycle: further kills after the completion grant nothing more', () => {
    const { day, quest } = killQuestFor(true);
    const sim = questSim(day, quest);
    const meta = metaOf(sim);
    complete(sim, quest);
    const after = meta.honor;
    if (quest.objective.type !== 'kill') throw new Error('kill objective expected');
    const targetMobId = quest.objective.targetMobId;
    const target = [...sim.entities.values()].find(
      (entity): entity is Entity => entity.kind === 'mob' && entity.templateId === targetMobId,
    );
    if (!target) throw new Error('Missing target');
    for (let i = 0; i < quest.count; i++) onMobKilledForWorldQuests(sim.ctx, target, meta);
    expect(meta.honor).toBe(after);
  });
});
