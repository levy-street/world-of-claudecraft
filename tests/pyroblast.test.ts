import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'mage', autoEquip: true });
}

function nearestMob(sim: Sim) {
  const p = sim.player;
  let best: any = null,
    bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function teleportTo(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.onGround = true;
  p.fallStartY = p.pos.y;
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
    const wolf = nearestMob(sim);
    teleportTo(sim, wolf.pos.x + 15, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = sim.player.maxResource;
    const hpBefore = wolf.hp;
    sim.castAbility('pyroblast');
    expect(sim.player.castingAbility).toBe('pyroblast');
    // resolve the 6s cast plus several DoT ticks
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    expect(wolf.hp).toBeLessThan(hpBefore);
  });
});
