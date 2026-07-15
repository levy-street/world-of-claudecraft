import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type MobilitySim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function setup(spec?: 'azure_blade'): MobilitySim {
  const sim = new Sim({ seed: 8080, playerClass: 'swordmaster' }) as MobilitySim;
  sim.setPlayerLevel(20);
  if (spec) sim.setSpec(spec);
  for (const entity of sim.entities.values()) {
    if (entity.kind === 'mob') entity.dead = true;
  }
  const player = sim.player;
  player.pos = { x: 0, y: terrainHeight(0, -40, sim.cfg.seed), z: -40 };
  player.prevPos = { ...player.pos };
  player.facing = 0;
  player.prevFacing = 0;
  player.onGround = true;
  player.fallStartY = player.pos.y;
  return sim;
}

function root(): Aura {
  return {
    id: 'test_root',
    name: 'Test Root',
    kind: 'root',
    remaining: 10,
    duration: 10,
    value: 1,
    sourceId: 999,
    school: 'frost',
  };
}

function spawn(sim: MobilitySim, x: number, z: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x,
    y: terrainHeight(x, z, sim.cfg.seed),
    z,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.maxHp = 10_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

describe('SwordMaster authored mobility', () => {
  it('Wind Lunge breaks roots and moves eight yards through the collision sweep', () => {
    const sim = setup();
    const player = sim.player;
    player.auras.push(root());
    const before = { ...player.pos };

    sim.castAbility('wind_lunge');

    expect(player.auras.some((aura) => aura.kind === 'root')).toBe(false);
    expect(Math.hypot(player.pos.x - before.x, player.pos.z - before.z)).toBeCloseTo(8, 6);
  });

  it('Azure Rush breaks roots, moves twelve yards, and slows only around its landing point', () => {
    const sim = setup('azure_blade');
    const player = sim.player;
    player.auras.push(root());
    const outsideLanding = spawn(sim, 2, -40);
    const insideLanding = spawn(sim, 2, -28);
    const before = { ...player.pos };

    sim.castAbility('azure_rush');

    expect(player.auras.some((aura) => aura.kind === 'root')).toBe(false);
    expect(Math.hypot(player.pos.x - before.x, player.pos.z - before.z)).toBeCloseTo(12, 6);
    expect(outsideLanding.auras.some((aura) => aura.id === 'azure_rush_slow')).toBe(false);
    expect(insideLanding.auras).toContainEqual(
      expect.objectContaining({
        id: 'azure_rush_slow',
        kind: 'slow',
        value: 0.5,
        duration: 3,
        remaining: 3,
      }),
    );
  });
});
