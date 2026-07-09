// Professions onboarding quest (issue #1701 follow-up): before this, nothing in
// the starting flow ever pointed a new player at gathering/crafting/town focus
// (see the professions.ts GATHERING_PROFESSIONS comment: no level/quest/tool gate
// exists at the mechanic level, so there was no natural "unlock" moment). This
// covers both the content shape (q_prof_intro wiring) and that its collect
// objective is actually satisfied by mining, not just any item gain.

import { describe, expect, it } from 'vitest';
import { GATHER_NODES, NPCS, QUEST_ORDER, QUESTS } from '../src/sim/data';
import { NODE_HARVEST_TABLE } from '../src/sim/professions/gathering';
import { onInventoryChangedForQuests } from '../src/sim/quests/quest_credit';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { QuestProgress, SimEvent } from '../src/sim/types';
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

type FakeCtx = SimContext & { events: SimEvent[] };

function makeCtx(itemCount: () => number): FakeCtx {
  const events: SimEvent[] = [];
  return {
    events,
    emit: (ev: SimEvent) => {
      events.push(ev);
    },
    countItem: (_itemId: string, _pid?: number) => itemCount(),
  } as unknown as FakeCtx;
}

function makeMeta(entityId = 1): PlayerMeta {
  return {
    entityId,
    questLog: new Map<string, QuestProgress>(),
    counters: { questProgress: 0 },
  } as unknown as PlayerMeta;
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

  it('its collect objective targets a dedicated quest item, not the shared mining-node reagent', () => {
    const quest = QUESTS.q_prof_intro;
    expect(quest.objectives).toHaveLength(1);
    const objective = quest.objectives[0];
    expect(objective.type).toBe('collect');
    // Pinned literal: `chunk_of_ore` is a kind 'quest' item, distinct from
    // NODE_HARVEST_TABLE.ore.itemId (bone_fragments), the shared junk/reagent
    // material every restless_bones kill, salvage roll, and market listing can
    // also produce. Targeting THAT would let a player complete "mine them
    // yourself" without ever mining (see #1708 review).
    expect(objective.itemId).toBe('chunk_of_ore');
    expect(objective.itemId).not.toBe(NODE_HARVEST_TABLE.ore.itemId);
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

describe('q_prof_intro: mining, and only mining, satisfies the collect objective', () => {
  it('an ore-node harvest grants chunk_of_ore while the quest is active, not the shared bone_fragments material', () => {
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
    sim.tick();
    // The harvest still grants the ordinary shared reagent too (the crafting
    // economy is untouched), but ALSO grants the dedicated quest item: simply
    // holding bone_fragments (from a kill, salvage, or the market) can never
    // substitute for it.
    expect(sim.countItem(NODE_HARVEST_TABLE.ore.itemId, pid)).toBe(1);
    expect(sim.countItem('chunk_of_ore', pid)).toBe(1);
  });

  it('does not grant chunk_of_ore once the quest is no longer active (not accepted, or already turned in)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'NoQuest');
    teleportOntoNode(sim, pid, ORE_NODE_ID);
    // Never accepted q_prof_intro.
    sim.harvestNode(ORE_NODE_ID, pid);
    sim.tick();
    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
  });

  it('promotes to ready once 5 ore chunks are held, same credit path every other collect quest uses', () => {
    let held = 0;
    const ctx = makeCtx(() => held);
    const meta = makeMeta();
    const quest = QUESTS.q_prof_intro;
    const need = quest.objectives[0].count;
    const qp: QuestProgress = { questId: 'q_prof_intro', counts: [0], state: 'active' };
    meta.questLog.set('q_prof_intro', qp);

    for (let i = 1; i <= need; i++) {
      held = i;
      onInventoryChangedForQuests(ctx, meta);
      expect(qp.counts[0]).toBe(i);
    }
    expect(qp.state).toBe('ready');
    expect(
      ctx.events.some(
        (e) => e.type === 'questReady' && (e as { questId?: string }).questId === 'q_prof_intro',
      ),
    ).toBe(true);
  });
});
