import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerClass } from '../src/sim/types';

const SEED = 42;
const makeSim = (cls: PlayerClass = 'mage') => new Sim({ seed: SEED, playerClass: cls, autoEquip: true });

// Spawn a Wyrmcult Necromancer next to the player, force its Mana Sear to always
// land, and swing until a hit connects (a swing can miss/dodge).
const setup = (cls: PlayerClass = 'mage') => {
  const sim = makeSim(cls);
  const player = sim.player;
  const mob = createMob(990600, MOBS.wyrmcult_necromancer, 18, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return { sim, player, mob };
};

const KEEP_ALIVE = 1e7; // a level-18 mob one-shots a low-level caster; keep the
// victim alive so the post-hit drain (guarded on `!target.dead`) can fire.
const swingUntilDrain = (sim: Sim, mob: any, target: any, max = 200) => {
  for (let i = 0; i < max; i++) {
    target.maxHp = KEEP_ALIVE;
    target.hp = KEEP_ALIVE; // top up so a hit never kills (death would reset state)
    const before = target.resource;
    (sim as any).mobSwing(mob, target);
    if (target.resource < before) return true;
  }
  return false;
};

describe('mob mana burn (Mana Sear)', () => {
  it('Wyrmcult Necromancer template carries the manaBurn mechanic', () => {
    expect(MOBS.wyrmcult_necromancer.manaBurn).toBeDefined();
    expect(MOBS.wyrmcult_necromancer.manaBurn!.name).toBe('Mana Sear');
  });

  it('a landed hit drains the template amount of mana from a mana user', () => {
    const { sim, player, mob } = setup('mage');
    expect(player.resourceType).toBe('mana');
    const burn = MOBS.wyrmcult_necromancer.manaBurn!;
    player.resource = player.maxResource;
    const old = burn.chance;
    burn.chance = 1;
    try {
      const start = player.resource;
      expect(swingUntilDrain(sim, mob, player)).toBe(true);
      expect(player.resource).toBe(start - burn.amount);
    } finally {
      burn.chance = old;
    }
  });

  it('drain clamps at zero — it never pushes mana negative', () => {
    const { sim, player, mob } = setup('mage');
    const burn = MOBS.wyrmcult_necromancer.manaBurn!;
    player.resource = 10; // less than burn.amount (80)
    const old = burn.chance;
    burn.chance = 1;
    try {
      expect(swingUntilDrain(sim, mob, player)).toBe(true);
      expect(player.resource).toBe(0);
    } finally {
      burn.chance = old;
    }
  });

  it('a rage/energy user is unaffected (mana-only)', () => {
    const { sim, player, mob } = setup('warrior');
    expect(player.resourceType).not.toBe('mana');
    const burn = MOBS.wyrmcult_necromancer.manaBurn!;
    const old = burn.chance;
    burn.chance = 1;
    const startRes = player.resource;
    try {
      for (let i = 0; i < 50; i++) { player.maxHp = KEEP_ALIVE; player.hp = KEEP_ALIVE; (sim as any).mobSwing(mob, player); }
    } finally {
      burn.chance = old;
    }
    // rage may rise from taking hits, but the mob never *drains* it.
    expect(player.resource).toBeGreaterThanOrEqual(startRes);
  });

  it('a friendly pet never drains its target (hostile guard)', () => {
    const { sim, player, mob } = setup('mage');
    mob.hostile = false; // emulate a tamed pet swinging
    player.resource = player.maxResource;
    const burn = MOBS.wyrmcult_necromancer.manaBurn!;
    const old = burn.chance;
    burn.chance = 1;
    try {
      for (let i = 0; i < 50; i++) { player.maxHp = KEEP_ALIVE; player.hp = KEEP_ALIVE; (sim as any).mobSwing(mob, player); }
    } finally {
      burn.chance = old;
    }
    expect(player.resource).toBe(player.maxResource);
  });
});
