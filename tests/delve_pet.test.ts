import { describe, expect, it } from 'vitest';
import { DELVES, isDelvePos } from '../src/sim/data';
import { delveKeepsPet } from '../src/sim/delves/delve_pet';
import { isPrimaryOwnedPetEntity } from '../src/sim/pet/pet_selection';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// A hunter's beast and a warlock's demon come along into a delve and fight beside
// the delve companion (src/sim/delves/delve_pet.ts). The frost mage's Water
// Elemental is still stowed for the run.

function makeSim(cls: 'hunter' | 'warlock' | 'mage' = 'hunter', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

function teleport(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function tameBoar(sim: Sim): Entity {
  sim.setPlayerLevel(10);
  const boar = [...sim.entities.values()].find(
    (e) => e.templateId === 'wild_boar' && e.ownerId === null,
  );
  (sim as any).completeTame(sim.player, boar!);
  const pet = sim.petOf(sim.playerId);
  expect(pet?.templateId).toBe('wild_boar');
  return pet!;
}

function summonImp(sim: Sim): Entity {
  sim.setPlayerLevel(10);
  sim.castAbility('summon_imp');
  for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
  const imp = sim.petOf(sim.playerId);
  expect(imp?.templateId).toBe('emberkin');
  return imp!;
}

function enterReliquary(sim: Sim) {
  const door = DELVES.collapsed_reliquary.doorPos;
  teleport(sim, door.x, door.z);
  sim.enterDelve('collapsed_reliquary', 'normal');
}

function killPlayer(sim: Sim) {
  (sim as any).dealDamage(
    null,
    sim.player,
    sim.player.maxHp + 100,
    false,
    'physical',
    null,
    'hit',
    true,
  );
}

describe('delveKeepsPet', () => {
  it('keeps hunter and warlock pets and stows the mage elemental', () => {
    expect(delveKeepsPet('hunter')).toBe(true);
    expect(delveKeepsPet('warlock')).toBe(true);
    expect(delveKeepsPet('mage')).toBe(false);
  });
});

describe('hunter pet inside a delve', () => {
  it('enters the delve beside its owner, and the companion still spawns', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
    // Same entity, not a rebuilt copy: nothing was stowed.
    expect(sim.petOf(sim.playerId)?.id).toBe(pet.id);
    expect((sim as any).delvePetStash.has(sim.playerId)).toBe(false);
    expect(isDelvePos(pet.pos.x)).toBe(true);
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(3);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect(run.companion?.companionId).toBe('companion_tessa');
    expect(sim.entities.get(run.companion!.entityId)?.dead).toBe(false);
    // Both stay with the player over a few seconds of ticking.
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(sim.petOf(sim.playerId)?.id).toBe(pet.id);
    expect(sim.delveRunForPlayer(sim.playerId)?.companion).toBeDefined();
  });

  it('collides with the delve rooms: the pet resolves to its owner run', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect((sim as any).delveRunForEntity(pet)).toBe(run);
  });

  it('follows its owner through the tombstone into the next room', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const before = { ...pet.pos };
    run.exitPortalOpen = true;
    (sim as any).advanceDelveModule(run);
    expect(run.moduleIndex).toBe(1);
    expect(dist2d(pet.pos, before)).toBeGreaterThan(10);
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(3);
  });

  it('comes back out with its owner on leave', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    sim.leaveDelve();
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
    expect(sim.petOf(sim.playerId)?.id).toBe(pet.id);
    expect(isDelvePos(pet.pos.x)).toBe(false);
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(3);
  });

  it('returns with its owner on the in-delve respawn', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    killPlayer(sim);
    expect(sim.player.dead).toBe(true);
    expect(pet.dead).toBe(true);
    sim.releaseSpirit();
    expect(sim.player.dead).toBe(false);
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
    expect(sim.petOf(sim.playerId)?.id).toBe(pet.id);
    expect(pet.dead).toBe(false);
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(3);
  });

  it('is carried out to the door when a second death fails the run', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    killPlayer(sim);
    sim.releaseSpirit();
    killPlayer(sim);
    sim.releaseSpirit();
    sim.tick();
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
    expect(sim.petOf(sim.playerId)?.id).toBe(pet.id);
    expect(isDelvePos(pet.pos.x)).toBe(false);
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(3);
  });

  it('a dead member ejected by a failed run gets the pet their death took', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    killPlayer(sim);
    expect(pet.dead).toBe(true);
    // The run fails while this member still lies dead (a party wipe shape).
    (sim as any).failDelveRun(run);
    expect(sim.player.dead).toBe(false);
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
    expect(pet.dead).toBe(false);
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(3);
  });

  it('a dead pet corpse moves with its owner into the next room', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    (sim as any).dealDamage(null, pet, pet.maxHp + 100, false, 'physical', null, 'hit', true);
    expect(pet.dead).toBe(true);
    run.exitPortalOpen = true;
    (sim as any).advanceDelveModule(run);
    expect(sim.petOf(sim.playerId, true)?.id).toBe(pet.id);
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(3);
  });

  it('heels in a straight line inside a delve instead of a default-layout A* route', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    pet.pos = { ...sim.player.pos, z: sim.player.pos.z + 8 };
    pet.prevPos = { ...pet.pos };
    const before = dist2d(pet.pos, sim.player.pos);
    for (let i = 0; i < 10; i++) {
      sim.tick();
      expect(pet.petPath).toEqual([]);
    }
    expect(dist2d(pet.pos, sim.player.pos)).toBeLessThan(before);
  });

  it('the HUD pet identity never resolves to the delve companion', () => {
    const sim = makeSim();
    const pet = tameBoar(sim);
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const tessa = sim.entities.get(run.companion!.entityId)!;
    expect(isPrimaryOwnedPetEntity(tessa, sim.playerId)).toBe(false);
    expect(isPrimaryOwnedPetEntity(pet, sim.playerId)).toBe(true);
  });

  it('a mid-delve save persists the live pet', () => {
    const sim = makeSim();
    tameBoar(sim);
    enterReliquary(sim);
    expect(sim.serializeCharacter(sim.playerId)?.pet?.templateId).toBe('wild_boar');
  });

  it('a petless hunter in a delve is told "You have no pet.", not that pets are banned', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    expect(sim.petOf(sim.playerId)).toBeNull();
    enterReliquary(sim);
    sim.drainEvents();
    sim.setPetMode('aggressive');
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'You have no pet.')).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'Pets are not allowed inside the delves.',
      ),
    ).toBe(false);
  });
});

describe('warlock demon inside a delve', () => {
  it('enters beside its owner, alongside the companion', () => {
    const sim = makeSim('warlock');
    const imp = summonImp(sim);
    enterReliquary(sim);
    expect(sim.petOf(sim.playerId)?.id).toBe(imp.id);
    expect((sim as any).delvePetStash.has(sim.playerId)).toBe(false);
    expect(isDelvePos(imp.pos.x)).toBe(true);
    expect(dist2d(imp.pos, sim.player.pos)).toBeLessThan(3);
    expect(sim.delveRunForPlayer(sim.playerId)?.companion?.companionId).toBe('companion_tessa');
  });

  it('follows its owner into the next room and back out on leave', () => {
    const sim = makeSim('warlock');
    const imp = summonImp(sim);
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.exitPortalOpen = true;
    (sim as any).advanceDelveModule(run);
    expect(dist2d(imp.pos, sim.player.pos)).toBeLessThan(3);
    sim.leaveDelve();
    expect(sim.petOf(sim.playerId)?.id).toBe(imp.id);
    expect(isDelvePos(imp.pos.x)).toBe(false);
    expect(dist2d(imp.pos, sim.player.pos)).toBeLessThan(3);
  });

  it('returns with its owner on the in-delve respawn', () => {
    const sim = makeSim('warlock');
    summonImp(sim);
    enterReliquary(sim);
    killPlayer(sim);
    sim.releaseSpirit();
    expect(sim.player.dead).toBe(false);
    const imp = sim.petOf(sim.playerId);
    expect(imp?.templateId).toBe('emberkin');
    expect(dist2d(imp!.pos, sim.player.pos)).toBeLessThan(3);
  });
});

describe('the mage elemental is still stowed', () => {
  it('is parked on enter and serialized from the stash mid-delve', () => {
    const sim = makeSim('mage');
    sim.setPlayerLevel(10);
    (sim as any).summonPet(sim.player, 'water_elemental');
    expect(sim.petOf(sim.playerId)?.templateId).toBe('water_elemental');
    enterReliquary(sim);
    expect(sim.petOf(sim.playerId)).toBeNull();
    expect((sim as any).delvePetStash.has(sim.playerId)).toBe(true);
    expect((sim as any).serializePet(sim.playerId)?.templateId).toBe('water_elemental');
  });
});
