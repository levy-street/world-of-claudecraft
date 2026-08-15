// Restored from the pre-revert payload (f274835b1^) and adapted to the current
// model: block rides the same one-roll hit table as parry (warriorMeleeDefense),
// gated to Warriors or Paladins holding a shield, front-arc only.
// blockChance/blockValue live on the entity (entity.ts recalc: SHIELD_BLOCK_BASE
// with a shield); there is no entity.parryChance to zero anymore, so these tests
// pin the rng roll into the block window instead.
import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import {
  blockedMeleeDamage,
  PROTECTION_PALADIN_BLOCK_DAMAGE_REDUCTION,
} from '../src/sim/combat/shield_block';
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
    expect(SHIELD_BLOCK_BASE).toBe(0.05);
    expect(sim.player.blockChance).toBe(SHIELD_BLOCK_BASE);
    expect(sim.player.blockChance).toBeGreaterThan(0);
    expect(sim.player.blockValue).toBe(6);
  });

  it('a Protection Paladin gains block stats by equipping a shield', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('protection')).toBe(true);
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');

    expect(sim.player.offhandItemId).toBe('eastbrook_buckler');
    expect(sim.player.blockChance).toBe(SHIELD_BLOCK_BASE);
    expect(sim.player.blockValue).toBe(6);
  });

  it('unrelated classes do not gain block stats without an eligible shield', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    expect(sim.player.blockChance).toBe(0);
    expect(sim.player.blockValue).toBe(0);
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
    const front = damageEvents(sim.drainEvents()).find((e) => e.kind === 'block');
    expect(front?.amount).toBe(14); // 20 - blockValue 6

    player.facing = Math.PI; // mob behind: warriorMeleeDefense zeroes the block
    player.hp = player.maxHp;
    sim.drainEvents();
    sim.mobSwing(mob, player);
    const back = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(back?.amount).toBe(20); // unmitigated
  });

  it('Protection Paladin mob blocks reduce 20% of the physical hit plus blockValue', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'paladin',
      autoEquip: true,
    }) as AnySim;
    sim.setPlayerLevel(20);
    expect(sim.setSpec('protection')).toBe(true);
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const player = sim.player;
    const mob = spawnMobInFront(sim, player);
    player.dodgeChance = 0;
    player.blockChance = 1;
    player.blockValue = 6;
    player.stats.armor = 0;
    mob.weapon = { min: 100, max: 100, speed: 2 };
    mob.attackPower = 0;
    sim.rng.next = () => 0.9;

    player.facing = 0;
    sim.drainEvents();
    sim.mobSwing(mob, player);

    const blocked = damageEvents(sim.drainEvents()).find((e) => e.kind === 'block');
    expect(blocked?.amount).toBe(74); // 100 * 80% - blockValue 6

    player.hp = player.maxHp;
    player.facing = Math.PI;
    sim.drainEvents();
    sim.mobSwing(mob, player);
    const fromBehind = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(fromBehind?.amount).toBe(100);
  });

  it('non-Protection Paladin mob blocks retain the flat blockValue behavior', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'paladin',
      autoEquip: true,
    }) as AnySim;
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const player = sim.player;
    const mob = spawnMobInFront(sim, player);
    player.dodgeChance = 0;
    player.blockChance = 1;
    player.blockValue = 6;
    player.stats.armor = 0;
    mob.weapon = { min: 100, max: 100, speed: 2 };
    mob.attackPower = 0;
    sim.rng.next = () => 0.9;

    player.facing = 0;
    sim.drainEvents();
    sim.mobSwing(mob, player);

    const blocked = damageEvents(sim.drainEvents()).find((e) => e.kind === 'block');
    expect(blocked?.amount).toBe(94); // 100 - blockValue 6
  });

  it('player melee into a shielded target is reduced only from the front', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as AnySim;
    const attacker = sim.player;
    const defenderId = sim.addPlayer('warrior', 'Shielded');
    const defender = sim.entities.get(defenderId);
    if (defender?.kind !== 'player') throw new Error('missing defender');
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
    const front = damageEvents(sim.drainEvents()).find((e) => e.kind === 'block');
    expect(front?.amount).toBe(14);

    defender.hp = defender.maxHp;
    defender.facing = 0; // struck from behind: no block
    sim.drainEvents();
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);
    const back = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(back?.amount).toBe(20);
  });

  it('Protection Paladin blocks use the same 20% reduction against player melee', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
    }) as AnySim;
    const attackerId = sim.addPlayer('warrior', 'Attacker');
    const defenderId = sim.addPlayer('paladin', 'Defender');
    sim.setPlayerLevel(20, attackerId);
    sim.setPlayerLevel(20, defenderId);
    expect(sim.setSpec('protection', defenderId)).toBe(true);
    sim.addItem('eastbrook_buckler', 1, defenderId);
    sim.equipItem('eastbrook_buckler', defenderId);
    const attacker = sim.entities.get(attackerId);
    const defender = sim.entities.get(defenderId);
    if (!attacker || !defender) throw new Error('missing combatant');
    attacker.weapon = { min: 100, max: 100, speed: 2 };
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
    sim.rng.next = () => 0.9;

    sim.drainEvents();
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);

    const blocked = damageEvents(sim.drainEvents()).find((e) => e.kind === 'block');
    expect(blocked?.amount).toBe(74); // 100 * 80% - blockValue 6

    defender.hp = defender.maxHp;
    defender.facing = 0;
    sim.drainEvents();
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);
    const fromBehind = damageEvents(sim.drainEvents()).find((e) => e.kind === 'hit');
    expect(fromBehind?.amount).toBe(100);
  });

  it('non-Protection Paladin blocks retain flat blockValue against player melee', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
    }) as AnySim;
    const attackerId = sim.addPlayer('warrior', 'Attacker');
    const defenderId = sim.addPlayer('paladin', 'Defender');
    sim.setPlayerLevel(20, attackerId);
    sim.setPlayerLevel(20, defenderId);
    expect(sim.setSpec('holy', defenderId)).toBe(true);
    sim.addItem('eastbrook_buckler', 1, defenderId);
    sim.equipItem('eastbrook_buckler', defenderId);
    const attacker = sim.entities.get(attackerId);
    const defender = sim.entities.get(defenderId);
    if (!attacker || !defender) throw new Error('missing combatant');
    attacker.weapon = { min: 100, max: 100, speed: 2 };
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
    sim.rng.next = () => 0.9;

    sim.drainEvents();
    expect(meleeSwing(sim.ctx, attacker, defender, 0, null, { cannotBeDodged: true })).toBe(true);

    const blocked = damageEvents(sim.drainEvents()).find((e) => e.kind === 'block');
    expect(blocked?.amount).toBe(94); // 100 - blockValue 6
  });

  it('Paladin without a shield and shield-ineligible classes do not block mob swings', () => {
    const unshielded = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true }) as AnySim;
    const paladin = unshielded.player;
    const paladinMob = spawnMobInFront(unshielded, paladin);
    paladin.dodgeChance = 0;
    paladin.blockChance = 1;
    paladin.blockValue = 0;
    paladin.stats.armor = 0;
    paladinMob.weapon = { min: 20, max: 20, speed: 2 };
    paladinMob.attackPower = 0;
    unshielded.rng.next = () => 0.9;

    paladin.facing = 0;
    unshielded.drainEvents();
    unshielded.mobSwing(paladinMob, paladin);
    const unshieldedHit = damageEvents(unshielded.drainEvents()).find(
      (e) => e.sourceId === paladinMob.id,
    );
    expect(unshieldedHit?.kind).toBe('hit');
    expect(unshieldedHit?.amount).toBe(20);

    const rogueSim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true }) as AnySim;
    const rogue = rogueSim.player;
    const rogueMob = spawnMobInFront(rogueSim, rogue);
    rogue.dodgeChance = 0;
    rogue.blockChance = 1;
    rogue.blockValue = 6;
    rogue.stats.armor = 0;
    rogueMob.weapon = { min: 20, max: 20, speed: 2 };
    rogueMob.attackPower = 0;
    rogueSim.rng.next = () => 0.9;

    rogue.facing = 0;
    rogueSim.drainEvents();
    rogueSim.mobSwing(rogueMob, rogue);
    const rogueHit = damageEvents(rogueSim.drainEvents()).find((e) => e.sourceId === rogueMob.id);
    expect(rogueHit?.kind).toBe('hit');
    expect(rogueHit?.amount).toBe(20);
  });
  it('a Paladin shield aimed at offhand keeps block stats after stat recalculation', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
    sim.addItem('eastbrook_buckler', 1);

    sim.equipItemToSlot('eastbrook_buckler', 'offhand');

    expect(sim.player.offhandItemId).toBe('eastbrook_buckler');
    expect(sim.player.equippedItems.offhand).toBe('eastbrook_buckler');
    expect(sim.player.stats.armor).toBeGreaterThan(0);
    expect(sim.player.stats.sta).toBeGreaterThan(0);
    expect(sim.player.blockChance).toBe(SHIELD_BLOCK_BASE);
    expect(sim.player.blockValue).toBe(6);
    sim.tick();
    expect(sim.player.blockChance).toBe(SHIELD_BLOCK_BASE);
    expect(sim.player.blockValue).toBe(6);
  });

  it('Paladin with a shield blocks a frontal mob swing without gaining Warrior parry', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true }) as AnySim;
    const player = sim.player;
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const mob = spawnMobInFront(sim, player);
    player.dodgeChance = 0;
    player.stats.armor = 0;
    expect(player.blockChance).toBe(SHIELD_BLOCK_BASE);
    expect(player.blockValue).toBe(6);
    mob.weapon = { min: 20, max: 20, speed: 2 };
    mob.attackPower = 0;
    // Paladin has no Warrior parry band. This roll is above miss and dodge,
    // then inside the Paladin shield block window.
    sim.rng.next = () => 0.08;

    player.facing = 0;
    sim.drainEvents();
    sim.mobSwing(mob, player);

    const block = damageEvents(sim.drainEvents()).find((e) => e.sourceId === mob.id);
    expect(block?.kind).toBe('block');
    expect(block?.amount).toBe(14);
  });
});

// Direct pins for the pure leaf itself (review 3050): the scenarios above
// exercise blockedMeleeDamage only through the full swing pipeline.
describe('blockedMeleeDamage', () => {
  it('subtracts flat block value from a non-paladin block', () => {
    expect(blockedMeleeDamage(100, 30, false)).toBe(70);
  });

  it('applies the Protection paladin 20% reduction before the flat block value', () => {
    // 100 * (1 - 0.2) - 30 = 50. The order matters: subtracting first would
    // give (100 - 30) * 0.8 = 56, so this value pins percentage-then-flat.
    expect(blockedMeleeDamage(100, 30, true)).toBe(50);
  });

  it('never reduces a blocked hit below 1 damage', () => {
    expect(blockedMeleeDamage(10, 50, false)).toBe(1);
    expect(blockedMeleeDamage(10, 50, true)).toBe(1);
  });

  it('pins the Protection paladin reduction constant', () => {
    expect(PROTECTION_PALADIN_BLOCK_DAMAGE_REDUCTION).toBe(0.2);
  });
});
