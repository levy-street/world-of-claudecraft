import { describe, expect, it } from 'vitest';
import { lineOfSightClear } from '../src/sim/colliders';
import { MOBS, PROPS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function place(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  entity.prevPos = { ...entity.pos };
  entity.spawnPos = { ...entity.pos };
}

function player(sim: Sim, id: number): Entity {
  const entity = sim.entities.get(id);
  if (!entity) throw new Error(`missing player ${id}`);
  return entity;
}

describe('Gladesong channel healing', () => {
  it('pulses four times on the caster and nearby visible allies only', () => {
    const sim = new Sim({ seed: 260_1756, playerClass: 'druid', autoEquip: false }) as TestSim;
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 20: 'dru_r20_tranquility' } })).toBe(true);

    const nearbyId = sim.addPlayer('priest', 'Nearby');
    const blockedId = sim.addPlayer('shaman', 'Blocked');
    const farId = sim.addPlayer('paladin', 'Far');
    for (const id of [nearbyId, blockedId, farId]) sim.setPlayerLevel(20, id);

    const caster = sim.player;
    const nearby = player(sim, nearbyId);
    const blocked = player(sim, blockedId);
    const far = player(sim, farId);
    const building = PROPS.buildings[0];
    const span = building.w + building.d;
    place(sim, caster, building.x - span, building.z);
    place(sim, nearby, caster.pos.x, caster.pos.z - 3);
    place(sim, blocked, building.x + span, building.z);
    place(sim, far, caster.pos.x - 35, caster.pos.z);

    const hostile = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
      x: caster.pos.x,
      y: caster.pos.y,
      z: caster.pos.z - 25,
    });
    hostile.moveSpeed = 0;
    hostile.swingTimer = 999;
    sim.addEntity(hostile);

    expect(lineOfSightClear(sim.cfg.seed, caster.pos, nearby.pos)).toBe(true);
    expect(dist2d(caster.pos, blocked.pos)).toBeLessThan(30);
    expect(lineOfSightClear(sim.cfg.seed, caster.pos, blocked.pos)).toBe(false);
    expect(dist2d(caster.pos, far.pos)).toBeGreaterThan(30);
    expect(sim.isHostileTo(caster, hostile)).toBe(true);

    for (const entity of [caster, nearby, blocked, far, hostile]) entity.hp = 1;
    caster.resource = caster.maxResource;
    sim.castAbility('tranquility');

    const healedTargets: number[] = [];
    for (let tick = 0; tick < 20 * 5; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'heal2' && event.ability === 'Gladesong') {
          healedTargets.push(event.targetId);
        }
      }
    }

    expect(healedTargets).toHaveLength(8);
    expect(healedTargets.filter((id) => id === caster.id)).toHaveLength(4);
    expect(healedTargets.filter((id) => id === nearby.id)).toHaveLength(4);
    expect(healedTargets).not.toContain(blocked.id);
    expect(healedTargets).not.toContain(far.id);
    expect(healedTargets).not.toContain(hostile.id);
  });
});
