// Practice dummies are planted on their markers: no knockback may shove them.
//
// The pull paths (pullToCenter, the paladin chain, the warlock pet's grip)
// already skip a `dummy: true` target through isPullEligible, but the shared
// knockback primitive did not, so Typhoon could blow a training dummy yards off
// its spot. The guard now lives inside applyKnockback itself, so every current
// and future knockback caller inherits it.

import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const DUMMY_IDS = Object.values(MOBS)
  .filter((template) => template.dummy === true)
  .map((template) => template.id);

function addMob(sim: Sim, templateId: string, distance = 3): Entity {
  const player = sim.player;
  const template = MOBS[templateId];
  const mob = createMob(9000 + sim.entities.size, template, template.maxLevel, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  mob.hostile = template.friendlyPracticeTarget !== true;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function castTyphoon(sim: Sim): void {
  const def = ABILITIES.typhoon;
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  const resolved: ResolvedAbility = {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
  };
  sim.ctx.runEffects(sim.player, meta, null, resolved);
}

describe('practice dummies cannot be knocked back', () => {
  it('covers every dummy template', () => {
    expect(DUMMY_IDS).toEqual(
      expect.arrayContaining([
        'training_dummy',
        'hub_training_dummy',
        'friendly_player_dummy',
        'normal_boss_dummy',
        'heroic_boss_dummy',
      ]),
    );
  });

  it.each(DUMMY_IDS)('applyKnockback leaves %s on its marker', (dummyId) => {
    const sim = new Sim({ seed: 7, playerClass: 'druid', world: EMPTY_TEST_WORLD });
    const dummy = addMob(sim, dummyId);
    const before = { ...dummy.pos };

    expect(sim.ctx.applyKnockback(sim.player, dummy, 10)).toBe(0);
    expect(dummy.pos).toEqual(before);
  });

  it('Typhoon blows back a real mob but not the training dummy beside it', () => {
    const sim = new Sim({ seed: 7, playerClass: 'druid', world: EMPTY_TEST_WORLD });
    const dummy = addMob(sim, 'training_dummy', 3);
    const wolf = addMob(sim, 'forest_wolf', -3);
    const dummyBefore = { ...dummy.pos };
    const wolfBefore = { ...wolf.pos };

    castTyphoon(sim);

    expect(dummy.pos).toEqual(dummyBefore);
    expect(Math.hypot(wolf.pos.x - wolfBefore.x, wolf.pos.z - wolfBefore.z)).toBeGreaterThan(1);
  });

  it('still knocks back a real boss (only dummies are planted)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'druid', world: EMPTY_TEST_WORLD });
    const bossId = Object.values(MOBS).find(
      (template) => template.boss === true && template.dummy !== true,
    )?.id;
    if (!bossId) throw new Error('no non-dummy boss template');
    const boss = addMob(sim, bossId);

    expect(sim.ctx.applyKnockback(sim.player, boss, 6)).toBeGreaterThan(0);
  });
});
