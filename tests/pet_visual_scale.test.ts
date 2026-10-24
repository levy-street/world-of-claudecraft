import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  completeTame,
  petOf,
  restorePet,
  restorePetFromDelveStash,
  serializePet,
  stowPetForDelve,
  syncPetLevel,
} from '../src/sim/pet/pet_commands';
import { retainedTamedPetScale } from '../src/sim/pet/pet_visual_scale';
import { Sim } from '../src/sim/sim';
import {
  summonWorldQuestChampion,
  WORLD_QUEST_CHAMPION_TUNING,
  worldQuestChampionState,
} from '../src/sim/world_quest_champion';

function hunterWorld() {
  const sim = new Sim({
    seed: 11,
    playerClass: 'hunter',
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  sim.setPlayerLevel(12);
  return sim;
}

function tameChampion(sim: Sim, sameLevel = false) {
  const quest = {
    ...WORLD_QUESTS_BY_ID.wq_evergarden_watch,
    minLevel: sameLevel ? sim.player.level - WORLD_QUEST_CHAMPION_TUNING.levelAboveQuest : 2,
    area: { ...WORLD_QUESTS_BY_ID.wq_evergarden_watch.area, ...sim.player.pos },
    objective: { type: 'kill' as const, targetMobId: 'forest_wolf' },
  };
  expect(summonWorldQuestChampion(sim.ctx, quest, sim.meta(sim.playerId)!)).toBe(true);
  const champion = sim.entities.get(worldQuestChampionState(sim.ctx, quest.id)!.mobId)!;
  expect(champion.scale).toBe(WORLD_QUEST_CHAMPION_TUNING.scale);
  const championHp = champion.maxHp;
  completeTame(sim.ctx, sim.player, champion);
  const pet = petOf(sim.ctx, sim.playerId)!;
  expect(pet).toBeDefined();
  expect(pet.maxHp).toBeLessThan(championHp);
  expect(pet.dungeonSpawnMiniboss).toBeFalsy();
  return pet;
}

describe('tamed beast visual size', () => {
  it('retains sizes only for hunter beasts', () => {
    expect(retainedTamedPetScale(MOBS.forest_wolf, 'hunter', 1.4)).toBe(1.4);
    expect(retainedTamedPetScale(MOBS.forest_wolf, 'warlock', 1.4)).toBeUndefined();
    expect(retainedTamedPetScale(MOBS.forest_wolf, undefined, 1.4)).toBeUndefined();
    expect(retainedTamedPetScale(MOBS.emberkin, 'hunter', 1.4)).toBeUndefined();
  });

  it('replays the champion pet lifecycle identically for the same seed', () => {
    const run = () => {
      const sim = hunterWorld();
      tameChampion(sim);
      sim.setPlayerLevel(14);
      syncPetLevel(sim.ctx, sim.player);
      const before = JSON.parse(JSON.stringify(serializePet(sim.ctx, sim.playerId)));
      stowPetForDelve(sim.ctx, sim.playerId);
      restorePetFromDelveStash(sim.ctx, sim.playerId);
      return { before, after: serializePet(sim.ctx, sim.playerId) };
    };
    expect(run()).toEqual(run());
  });

  it.each([false, true])('keeps a champion large on tame (same level: %s)', (sameLevel) => {
    const sim = hunterWorld();
    const pet = tameChampion(sim, sameLevel);
    expect(pet.level).toBe(sim.player.level);
    expect(pet.scale).toBe(WORLD_QUEST_CHAMPION_TUNING.scale);
    sim.setPlayerLevel(14);
    syncPetLevel(sim.ctx, sim.player);
    expect(pet.level).toBe(14);
    expect(pet.scale).toBe(WORLD_QUEST_CHAMPION_TUNING.scale);
  });

  it.each([false, true])('retains champion size through save and parking (dead: %s)', (dead) => {
    const sim = hunterWorld();
    const pet = tameChampion(sim);
    pet.dead = dead;
    const saved = JSON.parse(JSON.stringify(sim.serializeCharacter(sim.playerId)));
    expect(saved.pet.scale).toBe(WORLD_QUEST_CHAMPION_TUNING.scale);
    const loaded = hunterWorld();
    const loadedId = loaded.addPlayer('hunter', 'Owner', { state: saved });
    expect(petOf(loaded.ctx, loadedId, true)?.scale).toBe(WORLD_QUEST_CHAMPION_TUNING.scale);
    expect(petOf(loaded.ctx, loadedId, true)?.dead).toBe(dead);
    stowPetForDelve(loaded.ctx, loadedId);
    expect(serializePet(loaded.ctx, loadedId)?.scale).toBe(WORLD_QUEST_CHAMPION_TUNING.scale);
    restorePetFromDelveStash(loaded.ctx, loadedId);
    expect(petOf(loaded.ctx, loadedId, true)?.scale).toBe(WORLD_QUEST_CHAMPION_TUNING.scale);
  });

  it('keeps ordinary beasts at template size without an extra save field', () => {
    const sim = hunterWorld();
    const wolf = createMob(sim.nextId++, MOBS.forest_wolf, 2, sim.player.pos);
    sim.addEntity(wolf);
    completeTame(sim.ctx, sim.player, wolf);
    expect(petOf(sim.ctx, sim.playerId)?.scale).toBe(MOBS.forest_wolf.scale);
    expect(serializePet(sim.ctx, sim.playerId)).not.toHaveProperty('scale');
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1.4'])(
    'uses template size for legacy or invalid saved scale %s',
    (scale) => {
      const sim = hunterWorld();
      restorePet(sim.ctx, sim.player, {
        templateId: 'forest_wolf',
        name: 'Wolf',
        level: 2,
        hp: 1,
        dead: false,
        ...({ scale } as object),
      });
      expect(petOf(sim.ctx, sim.playerId)?.scale).toBe(MOBS.forest_wolf.scale);
    },
  );
});
