// Pure damage-over-time spells have no travel time: the DoT lands the moment the
// cast finishes, with the same resist roll a bolt makes on impact.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { EMPTY_TEST_WORLD } from './sim_shared';

const INSTANT_DOTS = [
  'corruption',
  'curse_of_agony',
  'siphon_life',
  'shadow_word_pain',
  'insect_swarm',
  'serpent_sting',
] as const;

describe('instant DoTs', () => {
  it('marks every pure DoT spell as landing without a projectile', () => {
    for (const id of INSTANT_DOTS) {
      expect(ABILITIES[id]?.projectile, id).toBe(false);
      expect(
        ABILITIES[id]?.effects.every((effect) => effect.type === 'dot'),
        id,
      ).toBe(true);
    }
  });

  it('puts Dirge of Decay on the target in the same tick it is cast', () => {
    const sim = new Sim({
      seed: 11,
      playerClass: 'priest',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    const p = sim.player;
    p.resource = p.maxResource;
    p.hitBonus = 1;
    const mob = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.forest_wolf, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 10,
    });
    mob.hostile = true;
    mob.maxHp = mob.hp = 10_000;
    mob.moveSpeed = 0;
    sim.addEntity(mob);
    sim.targetEntity(mob.id);
    p.facing = 0;

    sim.castAbility('shadow_word_pain');

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    expect(ctx.pendingProjectiles).toHaveLength(0);
    expect(mob.auras.some((aura) => aura.id === 'shadow_word_pain' && aura.sourceId === p.id)).toBe(
      true,
    );
  });
});
