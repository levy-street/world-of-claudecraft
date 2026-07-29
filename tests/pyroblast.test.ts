import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'mage', autoEquip: true });
}

// An idle hostile mob `dz` yards in front of the player, targeted and faced. Staged in
// the collider-free open-field lane: the ability under test is what matters here, and a
// live overworld mob couples the assertion to whatever fences and props the authored
// world happens to place on the firing line (which is a Line of sight cast refusal, not
// a Pyrelance regression).
function spawnDummy(sim: Sim, dz = 15): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 5, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id);
  return mob;
}

describe('Pyroblast (mage)', () => {
  it('is a level-20 fire nuke with a direct hit and a fire DoT', () => {
    const pyro = ABILITIES.pyroblast;
    expect(pyro).toBeTruthy();
    expect(pyro.class).toBe('mage');
    expect(pyro.learnLevel).toBe(5);
    expect(pyro.school).toBe('fire');
    expect(pyro.castTime).toBeGreaterThan(3); // a deliberately long cast
    expect(pyro.effects.some((e: any) => e.type === 'directDamage')).toBe(true);
    expect(pyro.effects.some((e: any) => e.type === 'dot')).toBe(true);
  });

  it('is learned only at level 5', () => {
    // Pyroblast is the Pyromancy SIGNATURE since the owner leveling pass
    // (talents_classic.ts): the spec pick grants it, and grants bypass the
    // learnLevel gate, so the level-5 arrival is enforced by the spec unlock
    // (SPEC_UNLOCK_LEVEL = 5). Resolve the allocation at the player level like
    // every live caller does; repairAllocation strips the spec below 5.
    const alloc = { ...emptyAllocation(), spec: 'fire' } as never;
    const at4 = computeTalentModifiers('mage', alloc, 4);
    const at5 = computeTalentModifiers('mage', alloc, 5);
    expect(abilitiesKnownAt('mage', 4, at4).some((k) => k.def.id === 'pyroblast')).toBe(false);
    expect(abilitiesKnownAt('mage', 5, at5).some((k) => k.def.id === 'pyroblast')).toBe(true);
  });

  it('casts with its cast time and damages the target over time', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    expect(sim.setSpec('fire')).toBe(true);
    placePlayerInOpenField(sim);
    const wolf = spawnDummy(sim);
    sim.player.resource = sim.player.maxResource;
    const hpBefore = wolf.hp;
    sim.castAbility('pyroblast');
    expect(sim.player.castingAbility).toBe('pyroblast');
    // resolve the 6s cast plus several DoT ticks
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    expect(wolf.hp).toBeLessThan(hpBefore);
  });
});
