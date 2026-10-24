import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, createPlayer } from '../src/sim/entity';
import { canStartMobAggro } from '../src/sim/mob/aggro_gate';

function fixture() {
  const target = createPlayer(1, 'hunter', { x: 0, y: 0, z: 0 }, 'Synthetic');
  const mob = createMob(2, MOBS.forest_wolf, 20, { x: 1, y: 0, z: 0 });
  const entities = new Map([
    [target.id, target],
    [mob.id, mob],
  ]);
  return { target, mob, entities };
}

describe('mob aggro admission', () => {
  it('admits a normal idle mob without mutation, and refuses a dead or already engaged mob', () => {
    const { entities, mob, target } = fixture();
    expect(canStartMobAggro(entities, mob, target, false)).toBe(true);
    expect(mob.aiState).toBe('idle');
    expect(mob.inCombat).toBe(false);
    mob.dead = true;
    expect(canStartMobAggro(entities, mob, target, false)).toBe(false);
    mob.dead = false;
    for (const state of ['evade', 'chase', 'attack', 'flee'] as const) {
      mob.aiState = state;
      expect(canStartMobAggro(entities, mob, target, false)).toBe(false);
    }
  });

  it('preserves dev no-aggro, Feign Death and the world freeze guards', () => {
    const { entities, mob, target } = fixture();
    target.devNoAggro = true;
    expect(canStartMobAggro(entities, mob, target, false)).toBe(false);
    delete target.devNoAggro;
    target.auras.push({
      id: 'feign_death',
      name: 'Feign Death',
      kind: 'feign_death',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: target.id,
      school: 'physical',
    });
    expect(canStartMobAggro(entities, mob, target, false)).toBe(false);
    target.auras.length = 0;
    expect(canStartMobAggro(entities, mob, target, true)).toBe(false);
    expect(canStartMobAggro(entities, mob, target, false)).toBe(true);
  });

  it('refuses a hidden GM and its pet while permitting them again after reveal', () => {
    const { entities, mob, target } = fixture();
    const pet = createMob(3, MOBS.forest_wolf, 20, { x: 0, y: 0, z: 0 });
    pet.ownerId = target.id;
    entities.set(pet.id, pet);
    target.gmHidden = true;
    expect(canStartMobAggro(entities, mob, target, false)).toBe(false);
    expect(canStartMobAggro(entities, mob, pet, false)).toBe(false);
    delete target.gmHidden;
    expect(canStartMobAggro(entities, mob, target, false)).toBe(true);
    expect(canStartMobAggro(entities, mob, pet, false)).toBe(true);
  });
});
