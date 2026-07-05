import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  abandonPet,
  applyDemonHealTick,
  completeTame,
  feedPet,
  healPet,
  petOf,
  revivePet,
  serializePet,
  setPetMode,
  summonPet,
} from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Direct unit tests for the extracted pet command/lifecycle module (P1b). They drive
// the moved functions through the real Sim.ctx seam (so the still-on-Sim helpers they
// reach back for resolve), pinning the slice's behavior independent of the parity
// golden.

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function hunterWorld(seed = 11): { sim: AnySim; hid: number; hunter: AnyEntity } {
  const sim = new Sim({ seed, playerClass: 'hunter', noPlayer: true }) as AnySim;
  const hid = sim.addPlayer('hunter', 'Owner') as number;
  sim.setPlayerLevel(12, hid);
  const hunter = sim.entities.get(hid) as AnyEntity;
  return { sim, hid, hunter };
}

// Spawn a tameable wild beast next to `near` (forest_wolf: family beast, low level,
// outside the dungeon band so tameError passes).
function spawnWolf(sim: AnySim, near: AnyEntity, level = 2): AnyEntity {
  const wolf = createMob(sim.nextId++, MOBS.forest_wolf, level, {
    x: near.pos.x + 3,
    y: near.pos.y,
    z: near.pos.z,
  }) as AnyEntity;
  wolf.hostile = true;
  sim.addEntity(wolf);
  return wolf;
}

describe('pet_commands module (P1b)', () => {
  it('hunter lifecycle: tame -> setMode -> feed -> revive -> abandon', () => {
    const { sim, hid, hunter } = hunterWorld();
    const wolf = spawnWolf(sim, hunter);

    // Tame: completeTame builds the owned pet and scales it to the owner's level.
    completeTame(sim.ctx, hunter, wolf);
    const pet = petOf(sim.ctx, hid) as AnyEntity;
    expect(pet).toBeTruthy();
    expect(pet.ownerId).toBe(hid);
    expect(pet.level).toBe(hunter.level); // syncPetLevel scaled it up from level 2
    expect(pet.petMode).toBe('defensive');

    // setMode cycles.
    setPetMode(sim.ctx, 'aggressive', hid);
    expect(pet.petMode).toBe('aggressive');
    setPetMode(sim.ctx, 'defensive', hid);
    expect(pet.petMode).toBe('defensive');

    // Feed: wound the pet, hand the owner a food item, feed -> feed_pet HoT.
    pet.hp = Math.floor(pet.maxHp * 0.5);
    sim.addItem('baked_bread', 1, hid);
    feedPet(sim.ctx, 'baked_bread', hid);
    expect(pet.auras.some((a) => a.id === 'feed_pet')).toBe(true);

    // Revive a dead pet -> alive at 35% hp.
    pet.dead = true;
    pet.hp = 0;
    revivePet(sim.ctx, hid);
    expect(pet.dead).toBe(false);
    expect(pet.hp).toBe(Math.max(1, Math.round(pet.maxHp * 0.35)));

    // Abandon -> the pet is gone.
    abandonPet(sim.ctx, hid);
    expect(petOf(sim.ctx, hid, true)).toBeNull();
  });

  it("setPetMode('passive') clears aggroTargetId/inCombat/autoAttack", () => {
    const { sim, hid, hunter } = hunterWorld(12);
    const wolf = spawnWolf(sim, hunter);
    completeTame(sim.ctx, hunter, wolf);
    const pet = petOf(sim.ctx, hid) as AnyEntity;
    pet.aggroTargetId = 999;
    pet.inCombat = true;
    pet.autoAttack = true;

    setPetMode(sim.ctx, 'passive', hid);

    expect(pet.petMode).toBe('passive');
    expect(pet.aggroTargetId).toBeNull();
    expect(pet.inCombat).toBe(false);
    expect(pet.autoAttack).toBe(false);
  });

  it('warlock demon swap: answers vs fades-into-the-void + Demon Heal tick', () => {
    const sim = new Sim({ seed: 13, playerClass: 'warlock', noPlayer: true }) as AnySim;
    const wpid = sim.addPlayer('warlock', 'Demonist') as number;
    sim.setPlayerLevel(12, wpid);
    const warlock = sim.entities.get(wpid) as AnyEntity;
    warlock.resource = warlock.maxResource;

    // Summon an imp.
    summonPet(sim.ctx, warlock, 'imp');
    const imp = petOf(sim.ctx, wpid) as AnyEntity;
    expect(imp).toBeTruthy();
    expect(imp.templateId).toBe('imp');

    // Demon Heal channel tick heals the wounded demon (the channel driver feeds it).
    imp.hp = Math.floor(imp.maxHp * 0.4);
    healPet(sim.ctx, wpid);
    expect(warlock.castingAbility).toBe('demon_heal');
    const before = imp.hp;
    applyDemonHealTick(sim.ctx, warlock);
    expect(imp.hp).toBeGreaterThan(before);

    // Swap to a DIFFERENT demon: the imp is despawned, a voidwalker answers.
    summonPet(sim.ctx, warlock, 'voidwalker');
    const vw = petOf(sim.ctx, wpid) as AnyEntity;
    expect(vw.templateId).toBe('voidwalker');
    expect(vw.id).not.toBe(imp.id);
    expect(sim.entities.has(imp.id)).toBe(false); // old demon hard-gone

    // Swap to the SAME demon while alive: it fades into the void, leaving NO pet.
    summonPet(sim.ctx, warlock, 'voidwalker');
    expect(petOf(sim.ctx, wpid, true)).toBeNull();
  });

  it('is deterministic on seeded replay (same seed + same drive => identical state)', () => {
    const drive = (seed: number): string => {
      const { sim, hid, hunter } = hunterWorld(seed);
      const wolf = spawnWolf(sim, hunter);
      completeTame(sim.ctx, hunter, wolf);
      setPetMode(sim.ctx, 'aggressive', hid);
      const pet = petOf(sim.ctx, hid) as AnyEntity;
      pet.hp = Math.floor(pet.maxHp * 0.5);
      sim.addItem('baked_bread', 1, hid);
      feedPet(sim.ctx, 'baked_bread', hid);
      sim.tick();
      sim.tick();
      // Snapshot the moved-slice surface: the serialized pet + the id counter.
      return JSON.stringify({ pet: serializePet(sim.ctx, hid), nextId: sim.nextId });
    };
    // Same seed + identical drive => byte-identical moved-slice state (the lifecycle
    // path itself draws no world rng, so this also pins that the move kept it pure).
    expect(drive(21)).toBe(drive(21));
  });
});
