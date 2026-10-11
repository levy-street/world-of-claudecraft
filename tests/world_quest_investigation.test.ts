import { describe, expect, it, vi } from 'vitest';
import {
  handlePickedEntity,
  type PickInteractionHud,
  type PickInteractionWorld,
} from '../src/game/interactions';
import {
  type NearbyInteractionHud,
  type NearbyInteractionWorld,
  tryNearbyInteraction,
} from '../src/game/nearby_interaction';
import { dealDamage } from '../src/sim/combat/damage';
import {
  INVESTIGATION_QUEST_ID as ID,
  INVESTIGATION_CLUES,
  INVESTIGATION_MOB_ID,
  INVESTIGATION_NPC_IDS,
  INVESTIGATION_NPCS,
  INVESTIGATION_VARIANTS,
} from '../src/sim/content/world_quest_investigation';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import {
  activeWorldQuestsForCycle,
  worldQuestPuzzleVariantForCycle,
} from '../src/sim/world_quest_rotation';
import { WORLD_SEED } from '../src/sim/world_seed';

function setup(variant = 0) {
  // Searched over the LIVE daily ids: a legacy wq3_N id is day 3N, and with
  // Mirefen's pool seven deep since the round-2 zone hunts the infiltrator
  // lands on days 1 mod 7, which under a three-day stride only ever meets two
  // of the six weekly variants.
  const cycle = Array.from({ length: 210 }, (_, index) => `wq1_${index}`).find(
    (candidate) =>
      activeWorldQuestsForCycle(candidate).some((quest) => quest.id === ID) &&
      worldQuestPuzzleVariantForCycle(candidate, INVESTIGATION_VARIANTS.length) === variant,
  );
  if (!cycle) throw new Error(`No investigation rotation for variant ${variant}`);
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: Object.fromEntries(INVESTIGATION_NPCS.map((npc) => [npc.id, npc])),
      groundObjects: [],
    },
  });
  sim.resetDay = '2026-09-06';
  sim.chat('/dev infiltrator');
  sim.meta(sim.playerId)!.devWorldQuestCycle = cycle;
  sim.tick();
  return sim;
}
function near(sim: Sim, id: number, pid = sim.playerId) {
  const entity = sim.entities.get(id)!;
  sim.entities.get(pid)!.pos = sim.groundPos(entity.pos.x + 1, entity.pos.z);
}
function investigate(sim: Sim, pid = sim.playerId) {
  for (const id of INVESTIGATION_NPC_IDS) {
    near(sim, id, pid);
    sim.talkToNpc(id, pid);
  }
  for (const clue of INVESTIGATION_CLUES) {
    near(sim, clue.entityId, pid);
    sim.pickUpObject(clue.entityId, pid);
  }
}
function culprit(sim: Sim, pid = sim.playerId) {
  const variant = worldQuestPuzzleVariantForCycle(
    sim.meta(pid)!.worldQuestCycle,
    INVESTIGATION_VARIANTS.length,
  );
  return INVESTIGATION_NPC_IDS[INVESTIGATION_VARIANTS[variant].culprit + 1];
}
/** The accusation is made at the sergeant's post, naming a guard. */
function accuse(sim: Sim, id = culprit(sim), pid = sim.playerId) {
  near(sim, INVESTIGATION_NPC_IDS[0], pid);
  sim.accuseWorldQuestSuspect(id, pid);
}
function ctx(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

describe('A Borrowed Face', () => {
  it.each(INVESTIGATION_VARIANTS.map((_, index) => index))(
    'solves variant %s through real NPC/object commands and ordinary combat credit',
    (variant) => {
      const sim = setup(variant);
      investigate(sim);
      const progress = sim.worldQuestLog.get(ID)!;
      expect(progress.investigation).toEqual({ heard: 15, clues: 3, cleared: 0 });
      accuse(sim);
      const mob = sim.entities.get(progress.investigation!.mobId!)!;
      expect(mob.templateId).toBe(INVESTIGATION_MOB_ID);
      expect(mob.tappedById).toBe(sim.playerId);
      expect(mob.aggroTargetId).toBe(sim.playerId);
      expect(mob.ownerId).toBeNull();
      expect(mob.runScoped).toBe(true);
      expect(mob.hardDespawnTimer).toBe(180);
      const before = sim.meta(sim.playerId)!.xp;
      dealDamage(ctx(sim), sim.player, mob, 99999, false, 'physical', 'Test Strike', 'hit');
      expect(progress.state).toBe('completed');
      expect(sim.meta(sim.playerId)!.xp).toBeGreaterThan(before);
      expect(sim.meta(sim.playerId)!.deedsEarned.has('exp_borrowed_face')).toBe(true);
      const after = sim.meta(sim.playerId)!.xp;
      sim.player.inCombat = false;
      accuse(sim);
      expect(sim.meta(sim.playerId)!.xp).toBe(after);
      const saved = sim.serializeCharacter(sim.playerId)!;
      expect(
        saved.worldQuests?.progress.find((row) => row.questId === ID)?.investigation,
      ).toBeUndefined();
      expect(saved.worldQuests?.progress.find((row) => row.questId === ID)?.state).toBe(
        'completed',
      );
    },
  );

  it('requires evidence, real identities, proximity, a living player and the active rotation', () => {
    const sim = setup();
    const id = culprit(sim);
    accuse(sim, id);
    expect(sim.worldQuestLog.get(ID)?.investigation?.mobId).toBeUndefined();
    investigate(sim);
    sim.player.pos = sim.groundPos(0, 200);
    sim.accuseWorldQuestSuspect(id);
    expect(sim.worldQuestLog.get(ID)?.investigation?.mobId).toBeUndefined();
    // Standing beside the accused guard is not enough: the sergeant hears accusations.
    near(sim, id);
    sim.accuseWorldQuestSuspect(id);
    expect(sim.worldQuestLog.get(ID)?.investigation?.mobId).toBeUndefined();
    near(sim, INVESTIGATION_NPC_IDS[0]);
    sim.player.dead = true;
    sim.accuseWorldQuestSuspect(id);
    sim.player.dead = false;
    sim.accuseWorldQuestSuspect(Number.NaN);
    const npc = sim.entities.get(id)!;
    const template = npc.templateId;
    npc.templateId = 'forged';
    sim.accuseWorldQuestSuspect(id);
    npc.templateId = template;
    expect(sim.worldQuestLog.get(ID)?.investigation?.mobId).toBeUndefined();
    sim.meta(sim.playerId)!.devWorldQuestCycle = 'wq3_0';
    sim.accuseWorldQuestSuspect(id);
    expect(sim.worldQuestLog.has(ID)).toBe(false);
  });

  it('keeps clues after wrong accusations and prevents duplicate summons even after movement', () => {
    const sim = setup();
    investigate(sim);
    const correct = culprit(sim);
    const wrong = INVESTIGATION_NPC_IDS.slice(1).find((id) => id !== correct)!;
    accuse(sim, wrong);
    const state = sim.worldQuestLog.get(ID)!.investigation!;
    expect(state.cleared).toBeGreaterThan(0);
    expect(state.heard).toBe(15);
    expect(state.clues).toBe(3);
    expect(state.mobId).toBeUndefined();
    accuse(sim, correct);
    const id = state.mobId!;
    sim.entities.get(id)!.pos.z += 20;
    sim.player.inCombat = false;
    accuse(sim, correct);
    expect(state.mobId).toBe(id);
    expect(
      [...sim.entities.values()].filter((e) => e.templateId === INVESTIGATION_MOB_ID),
    ).toHaveLength(1);
  });

  it.each(['death', 'departure', 'despawn', 'evade', 'rotation'] as const)(
    'recovers from %s without stranded summons',
    (reason) => {
      const sim = setup();
      investigate(sim);
      accuse(sim);
      const progress = sim.worldQuestLog.get(ID)!;
      const id = progress.investigation!.mobId!;
      if (reason === 'death') sim.player.dead = true;
      if (reason === 'departure') sim.player.pos.z = 200;
      if (reason === 'despawn') sim.entities.delete(id);
      if (reason === 'evade') sim.entities.get(id)!.aiState = 'evade';
      if (reason === 'rotation') sim.meta(sim.playerId)!.devWorldQuestCycle = 'wq3_0';
      sim.tick();
      expect(progress.investigation?.mobId).toBeUndefined();
      expect(sim.entities.has(id)).toBe(false);
      if (reason !== 'rotation') {
        sim.player.dead = false;
        sim.player.inCombat = false;
        accuse(sim);
        expect(progress.investigation?.mobId).toBeDefined();
        expect(progress.investigation?.mobId).not.toBe(id);
      }
    },
  );

  it('keeps personal evidence and kill credit separate while allies can help in ordinary combat', () => {
    const sim = setup();
    const second = sim.addPlayer('mage', 'Witness');
    sim.chat('/dev infiltrator', second);
    investigate(sim);
    accuse(sim);
    const firstState = sim.worldQuestLog.get(ID)!.investigation!;
    const mob = sim.entities.get(firstState.mobId!)!;
    expect(sim.meta(second)!.worldQuestLog.get(ID)?.investigation).toBeUndefined();
    near(sim, culprit(sim), second);
    ctx(sim).onMobKilledForWorldQuests(mob, sim.meta(second)!);
    expect(sim.meta(second)!.worldQuestLog.get(ID)?.state).toBe('active');
    const secondStateBefore = sim.meta(second)!.worldQuestLog.get(ID);
    dealDamage(
      ctx(sim),
      sim.entities.get(second)!,
      mob,
      99999,
      false,
      'physical',
      'Test Strike',
      'hit',
    );
    expect(sim.worldQuestLog.get(ID)?.state).toBe('completed');
    expect(secondStateBefore?.state).toBe('active');
  });

  it.each([0, 2])('button %i sends world.interact instead of local quest dialog', (button) => {
    const sim = setup();
    const player = sim.player;
    const captainDef = INVESTIGATION_NPCS[0];
    player.pos = { x: captainDef.pos.x, y: 0, z: captainDef.pos.z + 1 };
    const interact = vi.fn();
    const world = {
      player,
      questLog: new Map(),
      entities: new Map(),
      targetEntity: vi.fn(),
      interact,
    } as unknown as PickInteractionWorld;
    const hud = {
      openQuestDialog: vi.fn(),
      closeContextMenu: vi.fn(),
      showError: vi.fn(),
    } as unknown as PickInteractionHud;

    for (const [index, def] of INVESTIGATION_NPCS.entries()) {
      const id = INVESTIGATION_NPC_IDS[index];
      world.entities.set(id, {
        ...player,
        id,
        kind: 'npc',
        templateId: def.id,
        pos: { ...def.pos, y: 0 },
      });
      player.pos = { x: def.pos.x, y: 0, z: def.pos.z + 1 };
      expect(handlePickedEntity(world, hud, id, button, 0, 0)).toBe(true);
    }
    expect(interact).toHaveBeenCalledTimes(INVESTIGATION_NPCS.length);
    expect(hud.openQuestDialog).not.toHaveBeenCalled();
    expect(hud.showError).not.toHaveBeenCalled();
  });

  it('tryNearbyInteraction targets and interacts with nearby investigation NPCs', () => {
    const sim = setup();
    const player = sim.player;
    const guardDef = INVESTIGATION_NPCS[1];
    player.pos = { x: guardDef.pos.x, y: 0, z: guardDef.pos.z + 1 };
    const interact = vi.fn();
    const targetEntity = vi.fn();
    const guardId = INVESTIGATION_NPC_IDS[1];
    const entities = new Map();
    entities.set(guardId, {
      ...player,
      id: guardId,
      kind: 'npc',
      templateId: guardDef.id,
      pos: { ...guardDef.pos, y: 0 },
    });
    const world = {
      player,
      questLog: new Map(),
      entities,
      targetEntity,
      interact,
    } as unknown as NearbyInteractionWorld;
    const hud = {
      openQuestDialog: vi.fn(),
      showError: vi.fn(),
    } as unknown as NearbyInteractionHud;

    expect(tryNearbyInteraction(world, hud, 'away', 'nothing')).toBe(true);
    expect(targetEntity).toHaveBeenCalledWith(guardId);
    expect(interact).toHaveBeenCalledOnce();
    expect(hud.openQuestDialog).not.toHaveBeenCalled();
  });
});
