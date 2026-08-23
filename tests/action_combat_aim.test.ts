import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;

function makeMage(): { sim: Sim; player: Entity } {
  const sim = new Sim({ seed: 11, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(60);
  sim.setSpec('fire');
  placePlayerInOpenField(sim);
  sim.player.resource = sim.player.maxResource;
  sim.tick();
  return { sim, player: sim.player };
}

function spawnWolf(sim: Sim, player: Entity, dx: number, dz: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: player.pos.x + dx,
    y: player.pos.y,
    z: player.pos.z + dz,
  });
  mob.maxHp = 500_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

const damageEvents = (events: SimEvent[]): DamageEvent[] =>
  events.filter((event): event is DamageEvent => event.type === 'damage');

describe('server-authoritative action combat aim', () => {
  it('hits and adopts a hostile in the aim cone without a selected target', () => {
    const { sim, player } = makeMage();
    const wolf = spawnWolf(sim, player, 0, 3);
    player.targetId = null;
    player.facing = Math.PI;

    sim.castAbilityToward('fire_blast', { x: player.pos.x, z: player.pos.z + 4 });
    const events = damageEvents(sim.tick());

    expect(events.some((event) => event.targetId === wolf.id && event.kind !== 'miss')).toBe(true);
    expect(player.targetId).toBe(wolf.id);
    expect(player.facing).toBeCloseTo(0, 5);
  });

  it('refuses an empty cone without spending resources or hitting the selected enemy', () => {
    const { sim, player } = makeMage();
    const wolf = spawnWolf(sim, player, 0, 3);
    const hpBefore = wolf.hp;
    const resourceBefore = player.resource;
    player.targetId = wolf.id;

    sim.castAbilityToward('fire_blast', { x: player.pos.x, z: player.pos.z - 4 });
    const events = sim.tick();

    expect(damageEvents(events)).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You have no target.' }),
    );
    expect(wolf.hp).toBe(hpBefore);
    expect(player.resource).toBe(resourceBefore);
    expect(player.targetId).toBe(wolf.id);
  });

  it('does not vacuum an in-range enemy that is beside the aim ray', () => {
    const { sim, player } = makeMage();
    const wolf = spawnWolf(sim, player, 3, 0);
    const hpBefore = wolf.hp;
    player.targetId = null;

    sim.castAbilityToward('fire_blast', { x: player.pos.x, z: player.pos.z + 4 });
    const events = sim.tick();

    expect(wolf.hp).toBe(hpBefore);
    expect(damageEvents(events)).toHaveLength(0);
  });
});
