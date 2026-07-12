import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
  mobSwing(mob: Entity, target: Entity): void;
  emit(event: SimEvent): void;
};

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;

function capture(sim: TestSim): DamageEvent[] {
  const events: DamageEvent[] = [];
  const orig = sim.emit.bind(sim);
  sim.emit = (event: SimEvent) => {
    if (event.type === 'damage') events.push(event);
    orig(event);
  };
  return events;
}

function spawnMobInFront(sim: TestSim, player: Entity): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 2,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

describe('shield block', () => {
  it('a shield equips block stats', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    expect(sim.player.offhandItemId).toBe('eastbrook_buckler');
    expect(sim.player.blockChance).toBeGreaterThan(0);
    expect(sim.player.blockValue).toBe(6);
  });

  it('mob melee from the front is reduced by shield block', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as TestSim;
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const player = sim.player;
    const mob = spawnMobInFront(sim, player);
    player.facing = 0;
    player.dodgeChance = 0;
    player.parryChance = 0;
    player.blockChance = 1;
    player.blockValue = 6;
    player.stats.armor = 0;
    mob.weapon = { min: 20, max: 20, speed: 2 };
    const events = capture(sim);
    sim.mobSwing(mob, player);
    const hit = events.find((event) => event.kind === 'hit');
    expect(hit?.amount).toBe(14);
  });

  it('player melee into a shielded target is reduced only from the front', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as TestSim;
    const attacker = sim.player;
    const defenderId = sim.addPlayer('warrior', 'Shielded');
    const defender = sim.entities.get(defenderId);
    if (!defender || defender.kind !== 'player') throw new Error('missing defender');
    attacker.weapon = { min: 20, max: 20, speed: 2 };
    attacker.attackPower = 0;
    attacker.critChance = 0;
    defender.stats.armor = 0;
    defender.dodgeChance = 0;
    defender.blockChance = 1;
    defender.blockValue = 6;
    attacker.pos = { x: 0, y: 0, z: 0 };
    defender.pos = { x: 0, y: 0, z: 2 };
    attacker.facing = 0;
    defender.facing = Math.PI;

    const frontEvents = capture(sim);
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);
    expect(frontEvents.find((event) => event.kind === 'hit')?.amount).toBe(14);

    defender.hp = defender.maxHp;
    defender.facing = 0;
    const backEvents = capture(sim);
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);
    expect(backEvents.find((event) => event.kind === 'hit')?.amount).toBe(20);
  });
});
