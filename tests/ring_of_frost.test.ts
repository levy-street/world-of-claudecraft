import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function rig(): { sim: Sim; caster: Entity } {
  const sim = new Sim({ seed: 73, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'frost', rows: { 11: 'mag_r11_rings_of_frost' } })).toBe(true);
  const caster = sim.player;
  caster.resource = caster.maxResource;
  return { sim, caster };
}

function addDummy(sim: Sim, id: number, x: number, z: number): Entity {
  const mob = createMob(id, MOBS.training_dummy, 20, {
    x,
    y: sim.player.pos.y,
    z,
  });
  mob.hostile = true;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds * 20); i++) events.push(...sim.tick());
  return events;
}

const isFrozen = (entity: Entity): boolean =>
  entity.auras.some((aura) => aura.id === 'rings_of_frost_root' && aura.kind === 'root');

describe('Ring of Frost persistent trap', () => {
  it('leaves the center safe and freezes an enemy only when it reaches the perimeter', () => {
    const { sim, caster } = rig();
    const center = { x: caster.pos.x, z: caster.pos.z + 15 };
    const enemy = addDummy(sim, 9401, center.x, center.z);

    sim.castAbilityAt('rings_of_frost', center);
    advance(sim, 1.6);

    expect(isFrozen(enemy)).toBe(false);
    expect(sim.activeFrostRings).toContainEqual(
      expect.objectContaining({
        x: center.x,
        z: center.z,
        radius: 6,
        innerRadius: 4.5,
        duration: 10,
      }),
    );

    enemy.pos.x = center.x + 5.3;
    enemy.prevPos = { ...enemy.pos };
    sim.tick();
    expect(isFrozen(enemy)).toBe(true);
    expect(caster.inCombat).toBe(true);
    expect(enemy.inCombat).toBe(true);
  });

  it('detects a swept crossing even when both endpoints are outside the ice band', () => {
    const { sim, caster } = rig();
    const center = { x: caster.pos.x, z: caster.pos.z + 15 };
    const enemy = addDummy(sim, 9405, center.x - 7, center.z);

    sim.castAbilityAt('rings_of_frost', center);
    advance(sim, 1.6);
    enemy.prevPos = { ...enemy.pos };
    enemy.pos.x = center.x + 7;
    sim.tick();

    expect(isFrozen(enemy)).toBe(true);
  });

  it('can catch later enemies but never freezes the same enemy twice per ring', () => {
    const { sim, caster } = rig();
    const center = { x: caster.pos.x, z: caster.pos.z + 15 };
    const first = addDummy(sim, 9402, center.x, center.z);
    const second = addDummy(sim, 9403, center.x, center.z);

    sim.castAbilityAt('rings_of_frost', center);
    advance(sim, 1.6);
    first.pos.x = center.x + 5.3;
    first.prevPos = { ...first.pos };
    sim.tick();
    expect(isFrozen(first)).toBe(true);
    expect(isFrozen(second)).toBe(false);

    advance(sim, 4.1);
    expect(isFrozen(first)).toBe(false);
    first.pos.x = center.x;
    first.prevPos = { ...first.pos };
    sim.tick();
    first.pos.x = center.x + 5.3;
    first.prevPos = { ...first.pos };
    sim.tick();
    expect(isFrozen(first)).toBe(false);

    second.pos.x = center.x + 5.3;
    second.prevPos = { ...second.pos };
    sim.tick();
    expect(isFrozen(second)).toBe(true);
  });

  it('stops catching enemies when its ten-second lifetime expires', () => {
    const { sim, caster } = rig();
    const center = { x: caster.pos.x, z: caster.pos.z + 15 };
    const enemy = addDummy(sim, 9404, center.x, center.z);

    sim.castAbilityAt('rings_of_frost', center);
    advance(sim, 11.7);
    enemy.pos.x = center.x + 5.3;
    enemy.prevPos = { ...enemy.pos };
    sim.tick();

    expect(isFrozen(enemy)).toBe(false);
  });

  it('removes the trap immediately if its caster leaves the world', () => {
    const { sim, caster } = rig();
    const center = { x: caster.pos.x, z: caster.pos.z + 15 };
    sim.castAbilityAt('rings_of_frost', center);
    advance(sim, 1.6);
    expect(sim.activeFrostRings).toHaveLength(1);

    sim.entities.delete(caster.id);
    sim.tick();

    expect(sim.activeFrostRings).toHaveLength(0);
  });
});
