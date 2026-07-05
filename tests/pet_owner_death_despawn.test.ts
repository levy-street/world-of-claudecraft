import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { completeTame, petOf } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Regression for the "immortal pet" bug: when a Hunter or Warlock OWNER dies, their
// pet/demon used to keep living forever. handleDeath's player branch tore down the
// dying player's own combat state but never touched the owned pet entity, so the pet
// hit a dead spot in updatePet (the despawn guard only fires when the owner is ABSENT,
// and petPickTarget is gated on `!owner.dead`): it could neither acquire targets nor be
// cleaned up. It sat in the world at full HP, unkillable. The owner's death must now
// kill the pet too: warlock demons unravel and despawn, hunter pets leave a revivable
// corpse (classic Revive Pet), so neither stays immortal.

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

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

function killEntity(sim: AnySim, e: AnyEntity): void {
  sim.dealDamage(null, e, e.maxHp + 100, false, 'physical', null, 'hit', true);
}

describe('a dead owner does not leave an immortal pet', () => {
  it('a slain hunter leaves a revivable pet corpse, not an immortal pet', () => {
    const sim = new Sim({ seed: 11, playerClass: 'hunter', noPlayer: true }) as AnySim;
    const hid = sim.addPlayer('hunter', 'Owner') as number;
    sim.setPlayerLevel(12, hid);
    const hunter = sim.entities.get(hid) as AnyEntity;
    const wolf = spawnWolf(sim, hunter);
    completeTame(sim.ctx, hunter, wolf);
    const pet = petOf(sim.ctx, hid) as AnyEntity;
    expect(pet).toBeTruthy();
    expect(pet.dead).toBe(false);

    killEntity(sim, hunter);
    expect(hunter.dead).toBe(true);

    // The pet is no longer a live, fighting entity.
    expect(pet.dead).toBe(true);
    expect(petOf(sim.ctx, hid)).toBeNull(); // no LIVE pet

    // Hunter pets persist as a revivable corpse rather than vanishing outright.
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    const corpse = petOf(sim.ctx, hid, true) as AnyEntity;
    expect(corpse).toBeTruthy();
    expect(corpse.id).toBe(pet.id);
    expect(corpse.dead).toBe(true);
  });

  it('a slain warlock unravels their demon (fully despawns), not immortal', () => {
    const sim = new Sim({ seed: 13, playerClass: 'warlock', noPlayer: true }) as AnySim;
    const wpid = sim.addPlayer('warlock', 'Demonist') as number;
    sim.setPlayerLevel(12, wpid);
    const warlock = sim.entities.get(wpid) as AnyEntity;
    warlock.resource = warlock.maxResource;
    (sim as any).summonPet(warlock, 'emberkin');
    const imp = petOf(sim.ctx, wpid) as AnyEntity;
    expect(imp).toBeTruthy();
    expect(MOBS[imp.templateId].family).toBe('demon');

    killEntity(sim, warlock);
    expect(warlock.dead).toBe(true);
    expect(imp.dead).toBe(true);

    // Brief corpse, then the demon is gone from the world entirely.
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(sim.entities.has(imp.id)).toBe(false);
  });

  it('is deterministic: the same seed kills the pet identically', () => {
    const run = () => {
      const sim = new Sim({ seed: 21, playerClass: 'hunter', noPlayer: true }) as AnySim;
      const hid = sim.addPlayer('hunter', 'Owner') as number;
      sim.setPlayerLevel(12, hid);
      const hunter = sim.entities.get(hid) as AnyEntity;
      completeTame(sim.ctx, hunter, spawnWolf(sim, hunter));
      killEntity(sim, hunter);
      const pet = petOf(sim.ctx, hid, true) as AnyEntity;
      return { dead: pet.dead, hp: pet.hp, corpseTimer: pet.corpseTimer };
    };
    expect(run()).toEqual(run());
  });
});
