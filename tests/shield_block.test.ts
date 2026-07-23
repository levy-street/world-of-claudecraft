// Restored from the pre-revert payload (f274835b1^) and adapted to the current
// model: block rides the same one-roll hit table as parry (warriorMeleeDefense),
// gated to warriors holding a shield, front-arc only. blockChance/blockValue
// live on the entity (entity.ts recalc: SHIELD_BLOCK_BASE with a shield); there
// is no entity.parryChance to zero anymore, so these tests pin the rng roll
// into the block window instead.
import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { SHIELD_BLOCK_BASE } from '../src/sim/types';

type AnySim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
  mobSwing(mob: Entity, target: Entity): void;
};

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;

function damageEvents(events: SimEvent[]): DamageEvent[] {
  return events.filter((e): e is DamageEvent => e.type === 'damage');
}

function spawnMobInFront(sim: AnySim, player: Entity): Entity {
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
  it('the starting shield equips block stats', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    // A fresh warrior now spawns with the buckler already in the offhand.
    expect(sim.player.offhandItemId).toBe('eastbrook_buckler');
    expect(sim.player.blockChance).toBe(SHIELD_BLOCK_BASE);
    expect(sim.player.blockChance).toBeGreaterThan(0);
    expect(sim.player.blockValue).toBe(6);
  });

  it('mob melee from the front is reduced by blockValue; from behind it is not', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as AnySim;
    const player = sim.player;
    const mob = spawnMobInFront(sim, player);
    player.dodgeChance = 0;
    player.blockChance = 1;
    player.blockValue = 6;
    player.stats.armor = 0;
    mob.weapon = { min: 20, max: 20, speed: 2 };
    mob.attackPower = 0;
    // One-roll table: 0.9 clears miss (~5%) and the warrior parry band (~5.5%),
    // and with blockChance 1 always lands inside the block window. The same
    // stubbed draw keeps the damage roll (min = max) and crit (0.9 >= 0.05)
    // deterministic.
    sim.rng.next = () => 0.9;

    player.facing = 0; // facing the mob: block applies
    sim.drainEvents();
    sim.mobSwing(mob, player);
    const front = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(front?.amount).toBe(14); // 20 - blockValue 6

    player.facing = Math.PI; // mob behind: warriorMeleeDefense zeroes the block
    player.hp = player.maxHp;
    sim.drainEvents();
    sim.mobSwing(mob, player);
    const back = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(back?.amount).toBe(20); // unmitigated
  });

  it('player melee into a shielded target is reduced only from the front', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as AnySim;
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
    defender.facing = Math.PI; // facing the attacker
    sim.rng.next = () => 0.9; // same one-roll placement as the mob-swing case

    sim.drainEvents();
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);
    const front = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(front?.amount).toBe(14);

    defender.hp = defender.maxHp;
    defender.facing = 0; // struck from behind: no block
    sim.drainEvents();
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);
    const back = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(back?.amount).toBe(20);
  });
});
