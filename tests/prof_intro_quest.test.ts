// Professions onboarding quest (issue #1701 follow-up): before this, nothing in
// the starting flow ever pointed a new player at gathering/crafting/town focus
// (at the time no level/quest/tool gate existed at the mechanic level, so there
// was no natural "unlock" moment; #2343 has since made a matching-profession
// tool mandatory for every node harvest, which is why the fixtures below carry
// a copper mining pick). This covers both the content shape (q_prof_intro
// wiring) and that its gather objective is actually satisfied by successful
// ore-node harvests.

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

// harvestNode STARTS a gather cast; quest credit lands at
// completion. Mirror the lifecycle completion arm synchronously (the
// gather_rare_events.test.ts completeCastNow idiom) so these seed-stable
// drives stay free of world-tick noise. Only called after a GRANTED start
// (a denied attempt starts no cast).
function completeCastNow(sim: Sim, pid: number): void {
  const p = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  if (!p || !meta) throw new Error('missing player');
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeGatherCast(p, meta);
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
    // #2343: every node harvest needs the matching-profession tool in bags.
    sim.addItem('copper_mining_pick', 1, pid);
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
    sim.harvestNode(ORE_NODE_ID, undefined, pid);
    completeCastNow(sim, pid);
    expect(sim.countItem(nodeMaterialFor('ore', 'eastbrook_vale').itemId, pid)).toBe(1);
    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
    expect(sim.meta(pid)!.questLog.get('q_prof_intro')?.counts).toEqual([1]);
  });

  it('ordinary mining does not create the retired chunk_of_ore workaround item', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'NoQuest');
    // #2343: every node harvest needs the matching-profession tool in bags.
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, ORE_NODE_ID);
    // Never accepted q_prof_intro.
    sim.harvestNode(ORE_NODE_ID, undefined, pid);
    completeCastNow(sim, pid);
    sim.tick();
    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
  });

  it('promotes after five granted ore harvests and can be turned in without collect items', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Miner');
    // #2343: every node harvest needs the matching-profession tool in bags. The
    // five nodes below are all tier 1, so the tier-1 pick covers the whole
    // promotion loop.
    sim.addItem('copper_mining_pick', 1, pid);
    const giver = NPCS.foreman_odell;
    const player = sim.entities.get(pid)!;
    player.pos.x = giver.pos.x;
    player.pos.z = giver.pos.z;
    player.pos.y = terrainHeight(giver.pos.x, giver.pos.z, sim.cfg.seed);
    player.prevPos = { ...player.pos };
    sim.acceptQuest('q_prof_intro', pid);

    // Deliberately spans two zones. The objective counts ORE, not a material, and
    // NODE_MATERIAL_TABLE is zone-keyed, so a run that stays in Eastbrook only
    // proves the counter moves on copper. This used to span zones by accident,
    // through `.slice(0, 5)` on a table where Eastbrook happened to hold three ore
    // veins; when it grew to six the same slice quietly became five Eastbrook
    // nodes and the cross-zone, cross-material coverage vanished with nothing red.
    // Selecting by zone states the intent so table order cannot take it away again.
    const oreNodes = [
      ...GATHER_NODES.filter((node) => node.type === 'ore' && node.zoneId === 'eastbrook_vale')
        .filter((node) => node.tier === 1)
        .slice(0, 3),
      ...GATHER_NODES.filter((node) => node.type === 'ore' && node.zoneId === 'mirefen_marsh')
        .filter((node) => node.tier === 1)
        .slice(0, 2),
    ];
    expect(oreNodes).toHaveLength(5);
    expect(new Set(oreNodes.map((n) => n.zoneId)).size, 'the run must cross a zone band').toBe(2);
    oreNodes.forEach((node, index) => {
      teleportOntoNode(sim, pid, node.id);
      sim.harvestNode(node.id, undefined, pid);
      completeCastNow(sim, pid);
      expect(sim.meta(pid)!.questLog.get('q_prof_intro')?.counts).toEqual([index + 1]);
    });
    expect(sim.questState('q_prof_intro', pid)).toBe('ready');
    // Name the two materials rather than leaving "cross-material" implied by the
    // zone-keyed table: the objective counts ore of any kind, so the run must have
    // banked both zones' yields and still credited five.
    const eastbrookOre = nodeMaterialFor('ore', 'eastbrook_vale').itemId;
    const mirefenOre = nodeMaterialFor('ore', 'mirefen_marsh').itemId;
    expect(eastbrookOre).not.toBe(mirefenOre);
    expect(sim.countItem(eastbrookOre, pid), eastbrookOre).toBeGreaterThan(0);
    expect(sim.countItem(mirefenOre, pid), mirefenOre).toBeGreaterThan(0);

    player.pos.x = giver.pos.x;
    player.pos.z = giver.pos.z;
    player.pos.y = terrainHeight(giver.pos.x, giver.pos.z, sim.cfg.seed);
    player.prevPos = { ...player.pos };
    sim.turnInQuest('q_prof_intro', pid);
    expect(sim.questState('q_prof_intro', pid)).toBe('done');
  });
});
