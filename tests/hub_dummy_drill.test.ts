// The hub dummy lesson (q_hub_know_your_numbers): Drillmaster Hale on the
// Eastbrook quay introduces the training dummy and the Damage Meters. Credit
// rides every blow that lands on a dummy (tutorial/dummy_drill.ts), autoattacks
// included, because the lesson is the readout and not the button; and Hale
// himself has to stand on his authored mark beside the dummy, clear of the
// quay's other NPCs and props, or the pointer points at nothing.

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  HUB_DUMMY_DRILL_OBJECT_ITEM_ID,
  HUB_DUMMY_DRILL_QUEST_ID,
  HUB_PRACTICE_QUESTS,
  HUB_SPARRING_MASTER_ID,
  HUB_SPARRING_MASTER_POS,
  HUB_TRAINING_DUMMY_POS,
} from '../src/sim/content/practice_dummies';
import { BUILTIN_WORLD, MOBS, NPCS, QUEST_ORDER, QUESTS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import {
  creditDummyDrill,
  DUMMY_DRILL_QUEST_ID,
  isTrainingDummy,
} from '../src/sim/tutorial/dummy_drill';
import { startingAttackFor } from '../src/sim/tutorial/starting_attack';
import type { Entity, QuestProgress } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 42;

function makeSim(playerClass: 'warrior' | 'mage' = 'warrior'): Sim {
  return new Sim({ seed: SEED, playerClass, autoEquip: true });
}

function seedActiveDrill(sim: Sim): QuestProgress {
  const meta = sim.players.get(sim.playerId)!;
  const qp: QuestProgress = { questId: DUMMY_DRILL_QUEST_ID, counts: [0], state: 'active' };
  meta.questLog.set(DUMMY_DRILL_QUEST_ID, qp);
  return qp;
}

/** A stand-in dummy: only the fields the credit guard reads. */
function dummy(templateId = 'training_dummy'): Entity {
  return { templateId, kind: 'mob' } as unknown as Entity;
}

/** A REAL level-20 dummy in the world beside the player, for the live-damage
 *  wiring. The player is raised to the cap too: a level-1 swing at a level-20
 *  target mostly misses, which would make the credit test flaky for the wrong
 *  reason (the hub dummy is the same level-20 template as Highwatch's). */
function spawnDummyBesidePlayer(sim: Sim, id: number): Entity {
  sim.setPlayerLevel(20, sim.playerId);
  const p = sim.entities.get(sim.playerId)!;
  p.prevPos = { ...p.pos };
  const mob = createMob(id, MOBS.training_dummy, 20, sim.groundPos(p.pos.x + 1, p.pos.z));
  sim.entities.set(id, mob);
  return mob;
}

describe('the lesson is authored the way the credit arm reads it', () => {
  it('is a real quest on the quay sparring master, both ends', () => {
    const quest = QUESTS[HUB_DUMMY_DRILL_QUEST_ID];
    expect(quest).toBe(HUB_PRACTICE_QUESTS[HUB_DUMMY_DRILL_QUEST_ID]);
    expect(quest.giverNpcId).toBe(HUB_SPARRING_MASTER_ID);
    expect(quest.turnInNpcId).toBe(HUB_SPARRING_MASTER_ID);
    expect(NPCS[HUB_SPARRING_MASTER_ID]?.questIds).toContain(HUB_DUMMY_DRILL_QUEST_ID);
    expect(QUEST_ORDER).toContain(HUB_DUMMY_DRILL_QUEST_ID);
    // No prerequisite: a fresh character off the ferry can take it at once.
    expect(quest.requiresQuest).toBeUndefined();
  });

  it('carries the sentinel objective the credit keys on', () => {
    const objective = QUESTS[HUB_DUMMY_DRILL_QUEST_ID].objectives[0];
    expect(objective.type).toBe('interact');
    expect(objective.type === 'interact' && objective.targetObjectItemId).toBe(
      HUB_DUMMY_DRILL_OBJECT_ITEM_ID,
    );
    expect(objective.count).toBe(10);
  });

  it('names the Damage Meters and their keybind in the text a player reads', () => {
    const npc = NPCS[HUB_SPARRING_MASTER_ID];
    const quest = QUESTS[HUB_DUMMY_DRILL_QUEST_ID];
    for (const text of [npc.greeting, quest.text]) {
      expect(text).toMatch(/Damage Meters/);
      expect(text).toMatch(/Shift/);
      expect(text).toMatch(/\bH\b/);
    }
  });
});

describe('Drillmaster Hale stands beside the hub dummy', () => {
  it('on his authored mark, on dry ground, within a few yards of the dummy', () => {
    const { x, z } = HUB_SPARRING_MASTER_POS;
    expect(isBlocked(SEED, x, z, 0.5)).toBe(false);
    expect(groundHeight(x, z, SEED)).toBeGreaterThan(waterLevelAt(x, z, SEED));
    const toDummy = Math.hypot(x - HUB_TRAINING_DUMMY_POS.x, z - HUB_TRAINING_DUMMY_POS.z);
    expect(toDummy).toBeGreaterThan(3); // not on top of it
    expect(toDummy).toBeLessThan(8); // "the post behind me" is true
    // The FULL built-in world: the placement claims clearance from the quay's
    // other NPCs and props, and findSafePos must leave him where authored.
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: BUILTIN_WORLD });
    const hale = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === HUB_SPARRING_MASTER_ID,
    );
    expect(hale).toBeTruthy();
    expect(Math.round(hale!.pos.x)).toBe(x);
    expect(Math.round(hale!.pos.z)).toBe(z);
    for (const e of sim.entities.values()) {
      if (e.id === hale!.id || e.id === sim.player.id) continue;
      expect(Math.hypot(e.pos.x - hale!.pos.x, e.pos.z - hale!.pos.z)).toBeGreaterThan(2.5);
    }
  });

  it('is dynamic (spawned after the player by hub_practice.ts, never by the surface loop)', () => {
    expect(NPCS[HUB_SPARRING_MASTER_ID].dynamic).toBe(true);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: BUILTIN_WORLD });
    const hale = [...sim.entities.values()].filter((e) => e.templateId === HUB_SPARRING_MASTER_ID);
    expect(hale).toHaveLength(1);
    expect(hale[0].id).toBeGreaterThan(sim.playerId);
  });
});

describe('isTrainingDummy', () => {
  it('is every authored dummy template and nothing else', () => {
    expect(isTrainingDummy(dummy('training_dummy'))).toBe(true);
    expect(isTrainingDummy(dummy('training_effigy'))).toBe(true);
    expect(isTrainingDummy(dummy('wolf'))).toBe(false);
    expect(
      isTrainingDummy({ templateId: 'training_dummy', kind: 'npc' } as unknown as Entity),
    ).toBe(false);
  });
});

describe('creditDummyDrill', () => {
  it('credits each blow and readies the quest at the count', () => {
    const sim = makeSim();
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    const need = QUESTS[DUMMY_DRILL_QUEST_ID].objectives[0].count;
    for (let i = 0; i < need - 1; i++) creditDummyDrill(sim.ctx, p, dummy());
    expect(qp.counts[0]).toBe(need - 1);
    expect(qp.state).toBe('active');
    creditDummyDrill(sim.ctx, p, dummy());
    expect(qp.counts[0]).toBe(need);
    expect(qp.state).toBe('ready');
  });

  it('draws no rng when it credits', () => {
    const sim = makeSim();
    seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    creditDummyDrill(sim.ctx, p, dummy());
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });

  it('never overshoots the count', () => {
    const sim = makeSim();
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    const need = QUESTS[DUMMY_DRILL_QUEST_ID].objectives[0].count;
    for (let i = 0; i < need + 5; i++) creditDummyDrill(sim.ctx, p, dummy());
    expect(qp.counts[0]).toBe(need);
  });

  it('ignores blows on anything that is not a dummy', () => {
    const sim = makeSim();
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    creditDummyDrill(sim.ctx, p, dummy('wolf'));
    expect(qp.counts[0]).toBe(0);
  });

  it('ignores a pet or mob source', () => {
    const sim = makeSim();
    const qp = seedActiveDrill(sim);
    creditDummyDrill(sim.ctx, dummy('wolf'), dummy());
    expect(qp.counts[0]).toBe(0);
  });

  it('credits nothing when the lesson is not active', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    creditDummyDrill(sim.ctx, p, dummy());
    expect(sim.players.get(sim.playerId)!.questLog.has(DUMMY_DRILL_QUEST_ID)).toBe(false);
  });
});

describe('the live damage path credits the drill', () => {
  it('a plain autoattack on a real dummy moves the count (the button is not the lesson)', () => {
    const sim = makeSim('warrior');
    const qp = seedActiveDrill(sim);
    const target = spawnDummyBesidePlayer(sim, 90301);
    sim.targetEntity(target.id);
    sim.startAutoAttack();
    let swings = 0;
    for (let i = 0; i < 300 && qp.state === 'active'; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === sim.playerId && ev.targetId === target.id)
          swings++;
      }
    }
    expect(swings, 'the autoattack never landed').toBeGreaterThan(0);
    expect(qp.counts[0]).toBeGreaterThan(0);
    // One credit per landed blow, never more.
    expect(qp.counts[0]).toBeLessThanOrEqual(swings);
  });

  it('a cast on a real dummy credits too', () => {
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const target = spawnDummyBesidePlayer(sim, 90302);
    sim.targetEntity(target.id);
    sim.castAbility(startingAttackFor('mage').abilityId!);
    for (let i = 0; i < 200 && qp.counts[0] === 0; i++) sim.tick();
    expect(qp.counts[0]).toBeGreaterThan(0);
  });
});
