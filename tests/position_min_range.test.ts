import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function makeHunter(): TestSim {
  const sim = new Sim({
    seed: 14404,
    playerClass: 'hunter',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  }) as TestSim;
  sim.setPlayerLevel(20);
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing hunter metadata');
  const mods = emptyModifiers();
  mods.grants.push({ ability: 'multi_shot', rank: 1 });
  meta.talentMods = mods;
  meta.known = abilitiesKnownAt('hunter', 20, mods) as typeof meta.known;
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function addTargetAt(sim: TestSim, distance: number): Entity {
  const player = sim.player;
  const target = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  target.hostile = true;
  target.maxHp = target.hp = 500_000;
  sim.addEntity(target);
  return target;
}

function damageEvents(events: SimEvent[], ability: string) {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'damage' }> =>
      event.type === 'damage' && event.ability === ability,
  );
}

describe('position ability minimum range', () => {
  it('refuses Splitshot inside its minimum range without dealing area damage', () => {
    const sim = makeHunter();
    const target = addTargetAt(sim, 3);
    const resourceBefore = sim.player.resource;
    sim.drainEvents();

    sim.castAbility('multi_shot', sim.playerId, { x: target.pos.x, z: target.pos.z });
    const events = sim.tick();

    expect(events).toContainEqual({
      type: 'error',
      pid: sim.playerId,
      text: 'Too close!',
    });
    expect(damageEvents(events, 'Splitshot')).toHaveLength(0);
    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.resource).toBe(resourceBefore);
    expect(sim.player.cooldowns.has('multi_shot')).toBe(false);
  });

  it('allows Splitshot beyond its minimum range', () => {
    const sim = makeHunter();
    const target = addTargetAt(sim, 15);
    sim.drainEvents();

    sim.castAbility('multi_shot', sim.playerId, { x: target.pos.x, z: target.pos.z });
    const events = sim.tick();

    expect(damageEvents(events, 'Splitshot')).toHaveLength(1);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('allows Splitshot exactly at its minimum range', () => {
    const sim = makeHunter();
    const target = addTargetAt(sim, 8);
    sim.drainEvents();

    sim.castAbility('multi_shot', sim.playerId, { x: target.pos.x, z: target.pos.z });
    const events = sim.tick();

    expect(damageEvents(events, 'Splitshot')).toHaveLength(1);
  });

  it('pushes the no-aim fallback out to the minimum range along facing', () => {
    const sim = makeHunter();
    sim.player.facing = 0;
    addTargetAt(sim, 8);
    sim.drainEvents();

    sim.castAbility('multi_shot', sim.playerId);
    const events = sim.tick();

    expect(events).not.toContainEqual({ type: 'error', pid: sim.playerId, text: 'Too close!' });
    expect(damageEvents(events, 'Splitshot')).toHaveLength(1);
  });

  // Non-axis facings at a non-integer position: the sin/cos round trip lands
  // one ulp short of the minimum on a third of headings, which the old
  // push-then-re-measure guard refused (review finding on PR 3676).
  it.each([0.7, Math.PI / 3, -2.1, 2.9, -0.4])(
    'never refuses a bare no-aim cast at facing %f',
    (facing) => {
      const sim = makeHunter();
      sim.player.pos.x = 123.75;
      sim.player.pos.z = -410.5;
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.facing = facing;
      sim.drainEvents();

      sim.castAbility('multi_shot', sim.playerId);
      const events = sim.tick();

      expect(events).not.toContainEqual({ type: 'error', pid: sim.playerId, text: 'Too close!' });
      expect(sim.player.cooldowns.has('multi_shot')).toBe(true);
    },
  );

  it('authors every position minRange at or under the ability range', () => {
    for (const def of Object.values(ABILITIES)) {
      if (def.targetMode !== 'position' || !def.minRange) continue;
      expect(def.minRange, def.id).toBeLessThanOrEqual(def.range);
    }
  });

  it('allows Blizzard near the caster when no minimum range is authored', () => {
    const sim = new Sim({
      seed: 14404,
      playerClass: 'mage',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('frost')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    const aim = { x: sim.player.pos.x, z: sim.player.pos.z + 1 };

    sim.castAbility('blizzard', sim.playerId, aim);

    expect(sim.player.castingAbility).toBe('blizzard');
    expect(sim.events).not.toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Too close!' }),
    );
  });
});
