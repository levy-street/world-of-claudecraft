// Professions onboarding quest (issue #1701 follow-up): before this, nothing in
// the starting flow ever pointed a new player at gathering/crafting/town focus
// (see the professions.ts GATHERING_PROFESSIONS comment: no level/quest/tool gate
// exists at the mechanic level, so there was no natural "unlock" moment). This
// covers both the content shape (q_prof_intro wiring) and that its gather
// objective is actually satisfied by successful ore-node harvests.

import { describe, expect, it } from 'vitest';
import { GATHER_NODES, NPCS, QUEST_ORDER, QUESTS } from '../src/sim/data';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

const ORE_NODE_ID = GATHER_NODES.find((n) => n.type === 'ore')!.id;

function teleportOntoNode(sim: Sim, pid: number, nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId)!;
  const p = sim.entities.get(pid)!;
  p.pos.x = node.pos.x;
  p.pos.z = node.pos.z;
  p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

describe('q_prof_intro content wiring', () => {
  it('is a real, level-1-available quest given and turned in by foreman_odell', () => {
    const quest = QUESTS.q_prof_intro;
    expect(quest).toBeDefined();
    expect(quest.giverNpcId).toBe('foreman_odell');
    expect(quest.turnInNpcId).toBe('foreman_odell');
    expect(quest.minLevel).toBeUndefined();
    expect(quest.requiresQuest).toBeUndefined();
    expect(quest.retired).toBeUndefined();
  });

  it('is offered by foreman_odell and ordered into the zone quest chain', () => {
    expect(NPCS.foreman_odell.questIds).toContain('q_prof_intro');
    expect(QUEST_ORDER).toContain('q_prof_intro');
  });

  it('uses a genuine ore gather objective rather than a dedicated quest item', () => {
    const quest = QUESTS.q_prof_intro;
    expect(quest.objectives).toHaveLength(1);
    const objective = quest.objectives[0];
    expect(objective.type).toBe('gather');
    if (objective.type !== 'gather') throw new Error('expected gather objective');
    expect(objective.nodeType).toBe('ore');
    expect(objective.itemId).toBeUndefined();
    expect(objective.count).toBe(5);
  });

  it('grants xp and copper on completion, with no class-gated reward', () => {
    const quest = QUESTS.q_prof_intro;
    // Pinned literals: a >0 assertion alone can't catch a text/reward drift
    // (the quest text promises "5 chunks"; the test file's own promotion loop
    // below derives its bound from the same field, so an uncaught 5-to-1
    // mutation would silently desync the copy from the mechanic).
    expect(quest.xpReward).toBe(150);
    expect(quest.copperReward).toBe(50);
    expect(Object.keys(quest.itemRewards)).toHaveLength(0);
  });
});

describe('q_prof_intro: mining, and only mining, satisfies the gather objective', () => {
  it('an ore-node harvest advances progress and grants only the ordinary mining material', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Miner');
    const giver = NPCS.foreman_odell;
    const p = sim.entities.get(pid)!;
    p.pos.x = giver.pos.x;
    p.pos.z = giver.pos.z;
    p.pos.y = terrainHeight(giver.pos.x, giver.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.acceptQuest('q_prof_intro', pid);
    sim.tick();
    expect(sim.questState('q_prof_intro', pid)).toBe('active');

    teleportOntoNode(sim, pid, ORE_NODE_ID);

    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
    sim.harvestNode(ORE_NODE_ID, pid);
    expect(sim.countItem(nodeMaterialFor('ore', 'eastbrook_vale').itemId, pid)).toBe(1);
    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
    expect(sim.meta(pid)!.questLog.get('q_prof_intro')?.counts).toEqual([1]);
  });

  it('ordinary mining does not create the retired chunk_of_ore workaround item', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'NoQuest');
    teleportOntoNode(sim, pid, ORE_NODE_ID);
    // Never accepted q_prof_intro.
    sim.harvestNode(ORE_NODE_ID, pid);
    sim.tick();
    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
  });

  it('promotes after five granted ore harvests and can be turned in without collect items', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Miner');
    const giver = NPCS.foreman_odell;
    const player = sim.entities.get(pid)!;
    player.pos.x = giver.pos.x;
    player.pos.z = giver.pos.z;
    player.pos.y = terrainHeight(giver.pos.x, giver.pos.z, sim.cfg.seed);
    player.prevPos = { ...player.pos };
    sim.acceptQuest('q_prof_intro', pid);

    const oreNodes = GATHER_NODES.filter((node) => node.type === 'ore').slice(0, 5);
    expect(oreNodes).toHaveLength(5);
    oreNodes.forEach((node, index) => {
      teleportOntoNode(sim, pid, node.id);
      sim.harvestNode(node.id, pid);
      expect(sim.meta(pid)!.questLog.get('q_prof_intro')?.counts).toEqual([index + 1]);
    });
    expect(sim.questState('q_prof_intro', pid)).toBe('ready');

    player.pos.x = giver.pos.x;
    player.pos.z = giver.pos.z;
    player.pos.y = terrainHeight(giver.pos.x, giver.pos.z, sim.cfg.seed);
    player.prevPos = { ...player.pos };
    sim.turnInQuest('q_prof_intro', pid);
    expect(sim.questState('q_prof_intro', pid)).toBe('done');
  });
});
