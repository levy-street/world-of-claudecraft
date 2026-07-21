import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerClass } from '../src/sim/types';

const SEED = 42;
const makeSim = (cls: PlayerClass) => new Sim({ seed: SEED, playerClass: cls, autoEquip: true });

// Spawn Mirejaw the Ravenous next to the player (at the player's level for an
// even hit table) and swing until a hit connects — a swing can miss/dodge.
const setup = (cls: PlayerClass) => {
  const sim = makeSim(cls);
  const player = sim.player;
  const mob = createMob(990700, MOBS.mirejaw_the_ravenous, player.level, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return { sim, player, mob };
};

const KEEP_ALIVE = 1e7; // an elite one-shots a low-level victim; keep it alive so
// the post-hit drain (guarded on `!target.dead`) can fire.
const swingUntilDrain = (sim: Sim, mob: any, target: any, max = 300) => {
  for (let i = 0; i < max; i++) {
    target.maxHp = KEEP_ALIVE;
    target.hp = KEEP_ALIVE; // top up so a hit never kills (death would reset state)
    const before = target.resource;
    (sim as any).mobSwing(mob, target);
    if (target.resource < before) return true;
  }
  return false;
};

describe('mob sap vigor (Sapping Bite)', () => {
  it('Mirejaw the Ravenous template carries the sapVigor mechanic', () => {
    expect(MOBS.mirejaw_the_ravenous.sapVigor).toBeDefined();
    expect(MOBS.mirejaw_the_ravenous.sapVigor!.name).toBe('Sapping Bite');
  });

  it('a landed hit drains the template amount of energy from an energy user', () => {
    const { sim, player, mob } = setup('rogue');
    expect(player.resourceType).toBe('energy');
    const sap = MOBS.mirejaw_the_ravenous.sapVigor!;
    player.resource = player.maxResource;
    const old = sap.chance;
    sap.chance = 1;
    try {
      const start = player.resource;
      expect(swingUntilDrain(sim, mob, player)).toBe(true);
      expect(player.resource).toBe(start - sap.amount);
    } finally {
      sap.chance = old;
    }
  });

  it('drain clamps at zero — it never pushes the resource negative', () => {
    const { sim, player, mob } = setup('rogue');
    const sap = MOBS.mirejaw_the_ravenous.sapVigor!;
    player.resource = 10; // less than sap.amount (25)
    const old = sap.chance;
    sap.chance = 1;
    try {
      expect(swingUntilDrain(sim, mob, player)).toBe(true);
      expect(player.resource).toBe(0);
    } finally {
      sap.chance = old;
    }
  });

  it('a mana user is unaffected (melee-resource only)', () => {
    const { sim, player, mob } = setup('mage');
    expect(player.resourceType).toBe('mana');
    const sap = MOBS.mirejaw_the_ravenous.sapVigor!;
    const old = sap.chance;
    sap.chance = 1;
    player.resource = player.maxResource;
    try {
      for (let i = 0; i < 50; i++) { player.maxHp = KEEP_ALIVE; player.hp = KEEP_ALIVE; (sim as any).mobSwing(mob, player); }
    } finally {
      sap.chance = old;
    }
    // a caster's mana is never touched by Sapping Bite.
    expect(player.resource).toBe(player.maxResource);
  });

  it('a friendly pet never drains its target (hostile guard)', () => {
    const { sim, player, mob } = setup('rogue');
    mob.hostile = false; // emulate a tamed pet swinging
    player.resource = player.maxResource;
    const sap = MOBS.mirejaw_the_ravenous.sapVigor!;
    const old = sap.chance;
    sap.chance = 1;
    try {
      for (let i = 0; i < 50; i++) { player.maxHp = KEEP_ALIVE; player.hp = KEEP_ALIVE; (sim as any).mobSwing(mob, player); }
    } finally {
      sap.chance = old;
    }
    expect(player.resource).toBe(player.maxResource);
  });
});
