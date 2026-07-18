// Profession quest objectives (#1292): successful authoritative craft and
// gather actions credit matching objectives exactly once. Denied and
// nonmatching actions never advance quest state.

import { afterEach, describe, expect, it } from 'vitest';
import { GATHER_NODES, QUESTS } from '../src/sim/data';
import { NODE_HARVEST_TABLE } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import type { QuestDef, QuestObjective, QuestProgress } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const TEST_QUEST_ID = 'q_test_profession_objectives';
const originalQuest = QUESTS[TEST_QUEST_ID];

afterEach(() => {
  if (originalQuest) QUESTS[TEST_QUEST_ID] = originalQuest;
  else delete QUESTS[TEST_QUEST_ID];
});

function installQuest(objectives: QuestObjective[]): void {
  const quest: QuestDef = {
    id: TEST_QUEST_ID,
    name: 'Test Profession Actions',
    giverNpcId: 'foreman_odell',
    turnInNpcId: 'foreman_odell',
    text: 'Test only.',
    completionText: 'Test complete.',
    objectives,
    xpReward: 0,
    copperReward: 0,
    itemRewards: {},
    retired: true,
  };
  QUESTS[TEST_QUEST_ID] = quest;
}

function trackedSim(objectives: QuestObjective[]): { sim: Sim; pid: number; qp: QuestProgress } {
  installQuest(objectives);
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Artisan');
  const qp: QuestProgress = {
    questId: TEST_QUEST_ID,
    counts: objectives.map(() => 0),
    state: 'active',
  };
  sim.meta(pid)!.questLog.set(TEST_QUEST_ID, qp);
  return { sim, pid, qp };
}

function teleportOntoNode(sim: Sim, pid: number, nodeId: string): void {
  const node = GATHER_NODES.find((candidate) => candidate.id === nodeId)!;
  const player = sim.entities.get(pid)!;
  player.pos.x = node.pos.x;
  player.pos.z = node.pos.z;
  player.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

describe('craft quest objectives', () => {
  it('credits only a successful craft of the matching recipe', () => {
    const { sim, pid, qp } = trackedSim([
      {
        type: 'craft',
        recipeId: 'recipe_minor_healing_potion',
        count: 1,
        label: 'Minor Healing Potion crafted',
      },
    ]);

    // A denied matching attempt has no quest side effect.
    sim.craftItem('recipe_minor_healing_potion', pid);
    expect(sim.meta(pid)!.lastCraftResult?.reason).toBe('insufficient_materials');
    expect(qp.counts).toEqual([0]);

    // A successful but different recipe does not count.
    sim.addItem('spider_leg', 1, pid);
    sim.craftItem('recipe_tough_jerky', pid);
    expect(sim.meta(pid)!.lastCraftResult?.ok).toBe(true);
    expect(qp.counts).toEqual([0]);

    sim.addItem('linen_scrap', 1, pid);
    sim.addItem('spider_leg', 1, pid);
    sim.craftItem('recipe_minor_healing_potion', pid);

    expect(sim.meta(pid)!.lastCraftResult?.ok).toBe(true);
    expect(qp.counts).toEqual([1]);
    expect(qp.state).toBe('ready');
  });
});

describe('gather quest objectives', () => {
  it('matches node type and gathered material only after a granted harvest', () => {
    const { sim, pid, qp } = trackedSim([
      { type: 'gather', nodeType: 'ore', count: 1, label: 'Ore vein harvested' },
      {
        type: 'gather',
        itemId: NODE_HARVEST_TABLE.ore.itemId,
        count: 1,
        label: 'Ore material gathered',
      },
    ]);
    const ore = GATHER_NODES.find((node) => node.type === 'ore')!;
    const wood = GATHER_NODES.find((node) => node.type === 'wood')!;

    // Too far away, so the server denies without quest credit.
    sim.harvestNode(ore.id, pid);
    expect(qp.counts).toEqual([0, 0]);

    // A successful nonmatching gather still does not count.
    teleportOntoNode(sim, pid, wood.id);
    sim.harvestNode(wood.id, pid);
    expect(qp.counts).toEqual([0, 0]);

    teleportOntoNode(sim, pid, ore.id);
    sim.harvestNode(ore.id, pid);
    expect(qp.counts).toEqual([1, 1]);
    expect(qp.state).toBe('ready');

    // The same node is now cooling down. Its denied replay cannot over-credit.
    sim.harvestNode(ore.id, pid);
    expect(qp.counts).toEqual([1, 1]);
  });
});
