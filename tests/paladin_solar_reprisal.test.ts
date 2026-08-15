import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import {
  applySolarReprisalOverride,
  grantSolarReprisal,
  SOLAR_REPRISAL_BLOCK_CHANCE,
  SOLAR_REPRISAL_DURATION,
  SOLAR_REPRISAL_KIND,
  SOLAR_REPRISAL_VOWKEEPER_CHANCE,
} from '../src/sim/combat/paladin_solar_reprisal';
import { warriorMeleeDefense } from '../src/sim/combat/warrior_hit_table';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { DT, type Entity, swingMissChance } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
  mobSwing(mob: Entity, target: Entity): void;
};

function makeProtection(): TestSim {
  const sim = new Sim({ seed: 8231, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('protection')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetAt(sim: TestSim, distance: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.swingTimer = 999;
  mob.auras.push({
    id: 'test_root',
    name: 'Test Root',
    kind: 'root',
    remaining: 60,
    duration: 60,
    value: 0,
    sourceId: -1,
    school: 'holy',
  });
  sim.addEntity(mob);
  return mob;
}

function proc(player: Entity) {
  return player.auras.find((aura) => aura.kind === SOLAR_REPRISAL_KIND);
}

function resolved(sim: Sim, id: string): ResolvedAbility {
  const ability = sim.resolvedAbility(id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

describe('Protection Paladin Solar Reprisal', () => {
  it('documents Bastion Rite block chance and the two proc sources', () => {
    expect(SOLAR_REPRISAL_VOWKEEPER_CHANCE).toBe(0.2);
    expect(SOLAR_REPRISAL_BLOCK_CHANCE).toBe(0.25);
    expect(SOLAR_REPRISAL_DURATION).toBe(8);
    expect(ABILITIES.bastion_rite.description).toContain('increase block chance by 20%');
    expect(ABILITIES.vowkeeper_strike.description).toContain('20% chance');
    expect(ABILITIES.vowkeeper_strike.description).toContain('25% chance');
    expect(ABILITIES.sunward_disc.description).toContain('deal 20% more damage');
    expect(ABILITIES.hammer_of_grace.description).toContain('heal you for 100% of damage dealt');
    expect(ABILITIES.holy_light.description).toContain(
      'Radiant Resonance or Solar Reprisal makes it instant',
    );
  });

  it('grants an eight-second proc from a successful Vowkeeper Strike roll', () => {
    const sim = makeProtection();
    const target = targetAt(sim, 2);
    sim.targetEntity(target.id);
    sim.rng.next = () => 0.99;
    const chances: number[] = [];
    sim.rng.chance = (chance) => {
      chances.push(chance);
      return chance === SOLAR_REPRISAL_VOWKEEPER_CHANCE;
    };

    sim.castAbility('vowkeeper_strike');

    expect(target.hp).toBeLessThan(target.maxHp);
    expect(chances).toContain(SOLAR_REPRISAL_VOWKEEPER_CHANCE);
    expect(proc(sim.player)).toMatchObject({
      name: 'Solar Reprisal',
      remaining: 8,
      duration: 8,
      sourceId: sim.player.id,
    });
  });

  it('does not grant the proc when a successful Vowkeeper Strike loses its proc roll', () => {
    const sim = makeProtection();
    const target = targetAt(sim, 2);
    sim.targetEntity(target.id);
    sim.rng.next = () => 0.99;
    const chances: number[] = [];
    sim.rng.chance = (chance) => {
      chances.push(chance);
      return false;
    };

    sim.castAbility('vowkeeper_strike');

    expect(target.hp).toBeLessThan(target.maxHp);
    expect(chances).toContain(SOLAR_REPRISAL_VOWKEEPER_CHANCE);
    expect(proc(sim.player)).toBeUndefined();
  });

  it('rolls Solar Reprisal after an actual mob attack is blocked', () => {
    const sim = makeProtection();
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const attacker = targetAt(sim, 2);
    const defense = warriorMeleeDefense(sim.player, attacker);
    expect(defense.blockChance).toBeGreaterThan(0);
    const blockRoll =
      swingMissChance(attacker, sim.player) +
      sim.player.dodgeChance +
      defense.parryChance +
      defense.blockChance / 2;
    const draws = [blockRoll, 0.5, 0.99, 0];
    sim.rng.next = () => draws.shift() ?? 0.99;

    sim.mobSwing(attacker, sim.player);

    expect(proc(sim.player)).toMatchObject({
      kind: SOLAR_REPRISAL_KIND,
      remaining: 8,
    });
  });

  it('rolls the same block proc through the shared melee hit table', () => {
    const sim = makeProtection();
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const attacker = targetAt(sim, 2);
    const defense = warriorMeleeDefense(sim.player, attacker);
    const blockRoll =
      swingMissChance(attacker, sim.player) +
      sim.player.dodgeChance +
      defense.parryChance +
      defense.blockChance / 2;
    sim.rng.next = () => blockRoll;
    sim.rng.chance = (chance) => chance === 0.25;

    meleeSwing(sim.ctx, attacker, sim.player, 0, null, {});

    expect(proc(sim.player)).toMatchObject({
      kind: SOLAR_REPRISAL_KIND,
      remaining: 8,
    });
  });

  it('does not grant the proc when a real block loses its Solar Reprisal roll', () => {
    const sim = makeProtection();
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const attacker = targetAt(sim, 2);
    const defense = warriorMeleeDefense(sim.player, attacker);
    const blockRoll =
      swingMissChance(attacker, sim.player) +
      sim.player.dodgeChance +
      defense.parryChance +
      defense.blockChance / 2;
    const chances: number[] = [];
    sim.rng.next = () => blockRoll;
    sim.rng.chance = (chance) => {
      chances.push(chance);
      return false;
    };

    meleeSwing(sim.ctx, attacker, sim.player, 0, null, {});

    expect(chances).toContain(SOLAR_REPRISAL_BLOCK_CHANCE);
    expect(proc(sim.player)).toBeUndefined();
  });

  it('expires after eight seconds when no eligible ability consumes it', () => {
    const sim = makeProtection();
    grantSolarReprisal(sim.ctx, sim.player);

    for (let elapsed = 0; elapsed <= 8; elapsed += DT) sim.tick();

    expect(proc(sim.player)).toBeUndefined();
  });

  it('makes Sunward Disc free, 20% stronger, and able to bypass its running cooldown', () => {
    const sim = makeProtection();
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const target = targetAt(sim, 12);
    sim.targetEntity(target.id);
    grantSolarReprisal(sim.ctx, sim.player);

    const empowered = applySolarReprisalOverride(
      sim.ctx,
      sim.player,
      resolved(sim, 'sunward_disc'),
    );
    expect(empowered).toMatchObject({ cost: 0, cooldown: 0 });
    expect(empowered.effects).toEqual([
      expect.objectContaining({ type: 'directDamage', min: 90, max: 110, damageMult: 1.2 }),
      expect.objectContaining({ type: 'chainDamage', min: 60, max: 75, damageMult: 1.2 }),
    ]);

    grantSolarReprisal(sim.ctx, sim.player);
    sim.player.resource = 0;
    sim.player.cooldowns.set('sunward_disc', 5);
    sim.castAbility('sunward_disc');

    expect(proc(sim.player)).toBeUndefined();
    expect(sim.player.resource).toBe(0);
    expect(sim.player.cooldowns.get('sunward_disc')).toBe(5);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinSunwardDisc',
        targetId: target.id,
      }),
    );
  });

  it('increases the complete Sunward hit by 20%, including positive Spell Power', () => {
    function castWithSpellPower(empowered: boolean): [number, number] {
      const sim = makeProtection();
      sim.addItem('eastbrook_buckler', 1);
      sim.equipItem('eastbrook_buckler');
      const primary = targetAt(sim, 12);
      const bounce = targetAt(sim, 13);
      sim.targetEntity(primary.id);
      sim.rng.next = () => 0.5;
      const chanceDraws = [true, false];
      sim.rng.chance = () => chanceDraws.shift() ?? false;
      if (empowered) grantSolarReprisal(sim.ctx, sim.player);
      sim.player.spellPower = 70;

      sim.castAbility('sunward_disc');
      for (let tick = 0; tick < 200 && bounce.hp === bounce.maxHp; tick++) sim.tick();

      return [primary.maxHp - primary.hp, bounce.maxHp - bounce.hp];
    }

    expect(castWithSpellPower(false)).toEqual([130, 78]);
    expect(castWithSpellPower(true)).toEqual([156, 93]);
  });

  it('makes Hammer of Grace bypass its cooldown and heal for all effective damage', () => {
    const sim = makeProtection();
    const target = targetAt(sim, 10);
    sim.targetEntity(target.id);
    grantSolarReprisal(sim.ctx, sim.player);

    const empowered = applySolarReprisalOverride(
      sim.ctx,
      sim.player,
      resolved(sim, 'hammer_of_grace'),
    );
    expect(empowered.cooldown).toBe(0);
    expect(empowered.effects).toEqual([
      expect.objectContaining({ type: 'directDamage', selfHealDamageFrac: 1 }),
    ]);

    grantSolarReprisal(sim.ctx, sim.player);
    sim.player.hp = 1;
    sim.player.cooldowns.set('hammer_of_grace', 5);
    sim.rng.chance = () => true;
    sim.rng.next = () => 0.99;
    sim.castAbility('hammer_of_grace');
    expect(proc(sim.player)).toBeUndefined();
    expect(sim.player.cooldowns.get('hammer_of_grace')).toBe(5);

    for (let tick = 0; tick < 60 && target.hp === target.maxHp; tick++) sim.tick();
    const effectiveDamage = target.maxHp - target.hp;
    expect(effectiveDamage).toBeGreaterThan(0);
    expect(sim.player.hp - 1).toBe(effectiveDamage);
    expect(sim.player.cooldowns.get('hammer_of_grace') ?? 0).toBeLessThan(5);
  });

  it('makes Mending Light instant on an ally but keeps its full mana cost and GCD', () => {
    const sim = makeProtection();
    const allyId = sim.addPlayer('warrior', 'Aldren');
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    ally.maxHp = 1_000;
    ally.hp = 1;
    sim.targetEntity(ally.id);
    sim.player.resource = 100;
    grantSolarReprisal(sim.ctx, sim.player);

    sim.castAbility('holy_light');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(35);
    expect(sim.player.gcdRemaining).toBe(1.5);
    expect(ally.hp).toBeGreaterThan(1);
    expect(proc(sim.player)).toBeUndefined();
    expect(sim.player.paladinDevotion?.value).toBe(1);
  });

  it('preserves the proc when an eligible cast fails its normal gates', () => {
    const sim = makeProtection();
    const enemy = targetAt(sim, 10);
    sim.targetEntity(enemy.id);
    expect(sim.unequipItem('offhand')).toBe(true);
    sim.player.cooldowns.set('sunward_disc', 5);
    grantSolarReprisal(sim.ctx, sim.player);

    sim.castAbility('sunward_disc');

    expect(proc(sim.player)).toBeDefined();
    expect(sim.player.cooldowns.get('sunward_disc')).toBe(5);
    expect(
      sim
        .drainEvents()
        .some((event) => event.type === 'spellfx' && event.fx === 'paladinSunwardDisc'),
    ).toBe(false);

    sim.targetEntity(sim.player.id);
    sim.player.resource = 64;
    sim.castAbility('holy_light');

    expect(proc(sim.player)).toBeDefined();
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(64);
  });

  it('spends the shared proc on the first eligible choice only', () => {
    const sim = makeProtection();
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    sim.player.hp = 1;
    sim.targetEntity(sim.player.id);
    sim.player.resource = 65;
    grantSolarReprisal(sim.ctx, sim.player);

    sim.castAbility('holy_light');
    expect(sim.player.castingAbility).toBeNull();
    expect(proc(sim.player)).toBeUndefined();

    sim.player.gcdRemaining = 0;
    sim.player.resource = 100;
    sim.targetEntity(targetAt(sim, 10).id);
    sim.player.cooldowns.set('sunward_disc', 5);
    sim.castAbility('sunward_disc');
    expect(sim.player.cooldowns.get('sunward_disc')).toBe(5);
    expect(
      sim
        .drainEvents()
        .some((event) => event.type === 'spellfx' && event.fx === 'paladinSunwardDisc'),
    ).toBe(false);
  });
});
