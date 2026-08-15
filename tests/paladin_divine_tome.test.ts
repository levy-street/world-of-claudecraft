// Paladin Divine Tome chain: the resurrection ability (recall_the_fallen) is no
// longer trained by level/spec but EARNED by completing the two-step, paladin-only
// quest chain that ends with q_rite_of_redemption (q_divine_tome in the Vale ->
// q_rite_of_redemption with Aldric in Mirefen Marsh). Two seams are exercised:
//   1. abilitiesKnownAt's requiresQuest gate (the ability stays hidden until the
//      unlocking quest is in questsDone, then is known permanently for any spec).
//   2. computeQuestState's requiredClass gate (the chain is paladin-only) plus the
//      requiresQuest / minLevel chaining across the two steps.
// Referential integrity of the new quests (dangling ids, acquisition sources) is
// covered by tests/progression.test.ts.

import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { QUESTS } from '../src/sim/data';
import { acceptQuest, computeQuestState, turnInQuest } from '../src/sim/quests/quest_commands';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type Entity, type PlayerClass, type QuestProgress } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const FINAL_QUEST = 'q_rite_of_redemption';
const REZ = 'recall_the_fallen';

function knows(id: string, questsDone: Set<string>): boolean {
  // Level 20 is well above recall_the_fallen's learnLevel (12), so the ONLY gate
  // left is the quest gate: this isolates it from the level gate.
  return abilitiesKnownAt('paladin', 20, undefined, questsDone).some((k) => k.def.id === id);
}

describe('paladin Divine Tome: recall_the_fallen is quest-gated, not trained', () => {
  it('the ability declares the unlocking quest and carries no spec lock', () => {
    const def = ABILITIES[REZ];
    expect(def).toBeDefined();
    expect(def.requiresQuest).toBe(FINAL_QUEST);
    // Removed the holy-only lock: any paladin who completes the rite can resurrect.
    expect(def.specs).toBeUndefined();
    // It still resurrects a dead ally (unchanged mechanic).
    expect(def.effects.some((e) => e.type === 'resurrectAlly')).toBe(true);
  });

  it('is hidden with no quests done and with an empty questsDone set', () => {
    expect(knows(REZ, new Set())).toBe(false);
    // Missing questsDone (undefined) must also fail closed.
    expect(abilitiesKnownAt('paladin', 20).some((k) => k.def.id === REZ)).toBe(false);
  });

  it('is known once the final quest is in questsDone, for any spec', () => {
    expect(knows(REZ, new Set([FINAL_QUEST]))).toBe(true);
  });

  it('completing only the opening step does NOT unlock it', () => {
    expect(knows(REZ, new Set(['q_divine_tome']))).toBe(false);
  });
});

describe('paladin Divine Tome: the chain is class-locked and ordered', () => {
  const empty = new Map<string, QuestProgress>();

  function state(questId: string, done: Set<string>, level: number, cls: PlayerClass) {
    return computeQuestState(questId, empty, done, level, undefined, undefined, cls);
  }

  it('step 1 follows The Restless Dead and is invisible to other classes', () => {
    const afterRestlessDead = new Set(['q_bones']);
    expect(state('q_divine_tome', new Set(), 6, 'paladin')).toBe('unavailable');
    expect(state('q_divine_tome', afterRestlessDead, 6, 'paladin')).toBe('available');
    expect(state('q_divine_tome', afterRestlessDead, 6, 'warrior')).toBe('unavailable');
    // A class-less caller must also fail closed.
    expect(computeQuestState('q_divine_tome', empty, afterRestlessDead, 6, undefined)).toBe(
      'unavailable',
    );
  });

  it('step 1 respects its minimum level', () => {
    expect(state('q_divine_tome', new Set(['q_bones']), 5, 'paladin')).toBe('unavailable');
  });

  it('the online client forwards its mirrored player class to the shared quest gate', () => {
    function clientState(playerClass?: 'paladin' | 'warrior') {
      const client = Object.create(ClientWorld.prototype) as ClientWorld;
      const state = client as unknown as {
        questLog: Map<string, QuestProgress>;
        questsDone: Set<string>;
        pendingQuestCommands: Map<string, 'accept' | 'turnin'>;
        playerId: number;
        entities: Map<number, { level: number }>;
        cfg?: { seed: number; playerClass: 'paladin' | 'warrior' };
      };
      state.questLog = new Map();
      state.questsDone = new Set(['q_bones']);
      state.pendingQuestCommands = new Map();
      state.playerId = 1;
      state.entities = new Map([[1, { level: 6 }]]);
      if (playerClass) state.cfg = { seed: 20061, playerClass };
      return client.questState('q_divine_tome');
    }

    expect(clientState('paladin')).toBe('available');
    expect(clientState('warrior')).toBe('unavailable');
    expect(clientState()).toBe('unavailable');
  });

  it('the final rite needs step 1 done, level 6, and is still paladin-only', () => {
    const afterStep1 = new Set(['q_divine_tome']);
    expect(state(FINAL_QUEST, new Set(), 6, 'paladin')).toBe('unavailable'); // prereq gate
    expect(state(FINAL_QUEST, afterStep1, 5, 'paladin')).toBe('unavailable'); // level gate
    expect(state(FINAL_QUEST, afterStep1, 6, 'paladin')).toBe('available');
    expect(state(FINAL_QUEST, afterStep1, 6, 'warrior')).toBe('unavailable'); // class gate
  });

  // The two cases above check the gate against the warrior. This one closes it
  // against the whole roster, so adding a class (or widening requiredClass by
  // accident) cannot quietly open a paladin-only chain to someone else.
  it('is unavailable to every other class, and to a class-less caller', () => {
    const others: PlayerClass[] = [
      'warrior',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ];
    expect(others).toHaveLength(ALL_CLASSES.length - 1);
    expect(others).not.toContain('paladin');

    const step1Ready = new Set(['q_bones']);
    const riteReady = new Set(['q_bones', 'q_divine_tome']);
    // Every prerequisite satisfied, so class is the ONLY gate left standing.
    expect(state('q_divine_tome', step1Ready, 6, 'paladin')).toBe('available');
    expect(state(FINAL_QUEST, riteReady, 6, 'paladin')).toBe('available');

    for (const cls of others) {
      expect(state('q_divine_tome', step1Ready, 6, cls), `q_divine_tome for ${cls}`).toBe(
        'unavailable',
      );
      expect(state(FINAL_QUEST, riteReady, 6, cls), `${FINAL_QUEST} for ${cls}`).toBe(
        'unavailable',
      );
    }

    // Fails closed: a caller that cannot say who it is gets nothing.
    expect(computeQuestState('q_divine_tome', empty, step1Ready, 6, undefined)).toBe('unavailable');
    expect(computeQuestState(FINAL_QUEST, empty, riteReady, 6, undefined)).toBe('unavailable');
  });

  it('both quests are paladin-locked and the rite follows the Vale step', () => {
    expect(QUESTS['q_divine_tome'].requiredClass).toEqual(['paladin']);
    expect(QUESTS['q_divine_tome'].requiresQuest).toBe('q_bones');
    expect(QUESTS[FINAL_QUEST].requiredClass).toEqual(['paladin']);
    expect(QUESTS[FINAL_QUEST].requiresQuest).toBe('q_divine_tome');
  });

  it("the ability's learnLevel does not outlast the quest's minLevel", () => {
    // If learnLevel > minLevel, the level gate would keep the ability hidden after
    // turn-in until the higher level, defeating the quest reward.
    expect(ABILITIES[REZ].learnLevel).toBeLessThanOrEqual(QUESTS[FINAL_QUEST].minLevel ?? 1);
  });
});

describe('paladin Divine Tome: turning in the rite teaches the resurrection', () => {
  it('a paladin who turns in q_rite_of_redemption learns Recall the Fallen and is told', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin' }) as Sim & Record<string, any>;
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    const player = sim.player as Entity;
    // Meet the final quest's gates: level 6 and the Vale step already done.
    player.level = 6;
    meta.questsDone.add('q_divine_tome');

    // Stand at the marsh turn-in NPC (Brother Aldric).
    const npc = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === QUESTS[FINAL_QUEST].giverNpcId,
    )!;
    player.pos.x = npc.pos.x;
    player.pos.z = npc.pos.z;
    player.pos.y = terrainHeight(npc.pos.x, npc.pos.z, sim.cfg.seed);
    player.prevPos = { ...player.pos };
    sim.rebucket(player);

    // Before the rite, the resurrection is unknown.
    expect(meta.known.some((k) => k.def.id === REZ)).toBe(false);

    acceptQuest(sim.ctx, FINAL_QUEST, pid);
    sim.drainEvents();
    // Force the kill objective complete, then perform the rite.
    meta.questLog.get(FINAL_QUEST)!.state = 'ready';
    turnInQuest(sim.ctx, FINAL_QUEST, pid);
    const ev = sim.drainEvents();

    expect(meta.questsDone.has(FINAL_QUEST)).toBe(true);
    // The ability is now known...
    expect(meta.known.some((k) => k.def.id === REZ)).toBe(true);
    // ...and the player was told they learned it.
    expect(ev.some((e) => e.type === 'learnAbility' && (e as any).abilityId === REZ)).toBe(true);
  });
});
