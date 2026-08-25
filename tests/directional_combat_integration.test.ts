import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

function addHostile(sim: Sim, p: Entity, idOffset: number, dx: number, dz: number): Entity {
  const mob = createMob(sim.nextId++ + idOffset, MOBS.forest_wolf, p.level, {
    x: p.pos.x + dx,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.hp = mob.maxHp = 100_000;
  sim.addEntity(mob);
  return mob;
}

describe('player directional melee integration', () => {
  it('hits the primary plus two cone targets, pays once, and leaves the fourth untouched', () => {
    const sim = new Sim({
      seed: 91,
      playerClass: 'rogue',
      autoEquip: true,
      playerDirectionalCombat: true,
    });
    sim.setPlayerLevel(30);
    placePlayerInOpenField(sim);
    const p = sim.player;
    p.resource = p.maxResource;
    p.facing = 0;
    sim.tick();

    const primary = addHostile(sim, p, 0, 0, 2.2);
    const sideA = addHostile(sim, p, 10, -1, 2.2);
    const sideB = addHostile(sim, p, 20, 1, 2.2);
    const fourth = addHostile(sim, p, 30, 1.8, 1.8);
    // A legacy cleave aura must not fan this directional attack out a second
    // time or bypass the global cap of three targets.
    p.auras.push({
      id: 'directional-cleave-regression',
      name: 'Widening Arc',
      kind: 'sweeping_strikes',
      remaining: 12,
      duration: 12,
      value: 1,
      sourceId: p.id,
      school: 'physical',
    });
    const resourceBefore = p.resource;
    const ability = sim.known.find((entry) => entry.def.id === 'sinister_strike');
    expect(ability).toBeTruthy();

    sim.castAbilityToward('sinister_strike', { x: p.pos.x, z: p.pos.z - 100 });
    const events = sim.tick();
    const hitIds = new Set(
      events
        .filter(
          (event): event is Extract<SimEvent, { type: 'damage' }> =>
            event.type === 'damage' && event.sourceId === p.id,
        )
        .map((event) => event.targetId),
    );

    expect(hitIds).toEqual(new Set([primary.id, sideA.id, sideB.id]));
    expect(fourth.hp).toBe(fourth.maxHp);
    expect(p.targetId).toBe(primary.id);
    expect(p.resource).toBe(resourceBefore - (ability?.cost ?? 0));
  });

  it('applies target resource gains once per cone victim while billing the cast once', () => {
    const sim = new Sim({
      seed: 92,
      playerClass: 'warrior',
      autoEquip: true,
      playerDirectionalCombat: true,
    });
    sim.setPlayerLevel(30);
    expect(sim.setSpec('arms')).toBe(true);
    placePlayerInOpenField(sim);
    const p = sim.player;
    p.facing = 0;
    p.resource = 0;
    sim.tick();

    addHostile(sim, p, 0, 0, 2.2);
    addHostile(sim, p, 10, -0.8, 2.4);
    addHostile(sim, p, 20, 0.8, 2.4);
    sim.castAbilityToward('slam', { x: p.pos.x, z: p.pos.z - 100 });

    // Arms' Battle Stance multiplies each 8-rage target gain by 1.1.
    expect(p.resource).toBeCloseTo(26.4, 8);
  });

  it('applies authored damage and debuffs to each cone victim', () => {
    const sim = new Sim({
      seed: 94,
      playerClass: 'warrior',
      autoEquip: true,
      playerDirectionalCombat: true,
    });
    sim.setPlayerLevel(16);
    placePlayerInOpenField(sim);
    const p = sim.player;
    p.facing = 0;
    p.resource = p.maxResource;
    sim.tick();

    const targets = [
      addHostile(sim, p, 0, 0, 2.2),
      addHostile(sim, p, 10, -0.8, 2.4),
      addHostile(sim, p, 20, 0.8, 2.4),
    ];
    const fourth = addHostile(sim, p, 30, 1.8, 1.8);

    sim.castAbilityToward('hamstring', { x: p.pos.x, z: p.pos.z - 100 });

    for (const target of targets) {
      expect(target.hp).toBeLessThan(target.maxHp);
      expect(target.auras.some((aura) => aura.id === 'hamstring_slow')).toBe(true);
    }
    expect(fourth.hp).toBe(fourth.maxHp);
    expect(fourth.auras.some((aura) => aura.id === 'hamstring_slow')).toBe(false);
  });

  it('keeps authored self AoE targetless instead of routing it through the melee cone', () => {
    const sim = new Sim({
      seed: 93,
      playerClass: 'warrior',
      autoEquip: true,
      playerDirectionalCombat: true,
    });
    sim.setPlayerLevel(30);
    expect(sim.setSpec('fury')).toBe(true);
    placePlayerInOpenField(sim);
    const p = sim.player;
    p.targetId = null;
    p.resource = p.maxResource;
    sim.drainEvents();

    sim.castAbility('whirlwind');

    expect(p.auras.some((aura) => aura.kind === 'aoe_echo')).toBe(true);
    expect(sim.drainEvents().some((event) => event.type === 'error')).toBe(false);
  });
});
