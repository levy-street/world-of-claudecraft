import { describe, expect, it } from 'vitest';
import { warriorMeleeDefense } from '../src/sim/combat/warrior_hit_table';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion } from '../src/sim/paladin_devotion';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function hostileNear(sim: Sim): Entity {
  const player = sim.player;
  const mob = createMob(9001, MOBS.ridge_stalker, 20, {
    x: player.pos.x + 2,
    y: player.pos.y,
    z: player.pos.z,
  });
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function resolve(sim: Sim, id: string): ResolvedAbility {
  const ability = sim.resolvedAbility(id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

function run(sim: Sim, target: Entity | null, resolved: ResolvedAbility): void {
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(sim.playerId);
  (
    sim as unknown as {
      ctx: {
        runEffects(
          player: Entity,
          meta: unknown,
          target: Entity | null,
          ability: ResolvedAbility,
        ): void;
      };
    }
  ).ctx.runEffects(sim.player, meta, target, resolved);
}

describe('Paladin core abilities', () => {
  it('keeps Hammer of Grace on a seven-second cooldown', () => {
    expect(ABILITIES.hammer_of_grace.cooldown).toBe(7);
  });

  it('exposes Ward of Faith to every Paladin specialization', () => {
    expect(ABILITIES.divine_protection.hiddenFromPlayer).not.toBe(true);
    expect(ABILITIES.divine_protection.cooldown).toBe(30);
    expect(ABILITIES.divine_protection.ranks).toBeUndefined();

    for (const spec of [null, 'holy', 'protection', 'retribution'] as const) {
      const sim = new Sim({ seed: 37, playerClass: 'paladin', autoEquip: true });
      sim.setPlayerLevel(20);
      if (spec) expect(sim.setSpec(spec)).toBe(true);
      const ward = resolve(sim, 'divine_protection');
      expect(ward.def.name).toBe('Ward of Faith');
      expect(ward.effects).toEqual([
        { type: 'absorb', amount: 0, casterMaxHpPct: 0.25, duration: 10 },
      ]);

      run(sim, null, ward);
      expect(sim.player.auras).toContainEqual(
        expect.objectContaining({
          id: 'divine_protection',
          kind: 'absorb',
          value: Math.round(sim.player.maxHp * 0.25),
          duration: 10,
        }),
      );
    }
  });

  it('uses the requested Paladin caster timings and offensive Mercy Lance contract', () => {
    expect(ABILITIES.holy_light.castTime).toBe(1.5);
    expect(ABILITIES.mercy_lance).toMatchObject({
      learnLevel: 8,
      castTime: 1.75,
      cooldown: 0,
      targetType: 'enemy',
      effects: [{ type: 'directDamage', min: 80, max: 100 }],
    });
    expect(ABILITIES.dawns_embrace.castTime).toBe(2.5);

    const sim = new Sim({ seed: 38, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');
    const enemy = hostileNear(sim);
    enemy.swingTimer = 999;
    sim.rng.chance = () => false;
    sim.targetEntity(enemy.id);
    sim.castAbility('mercy_lance');

    const events = [...sim.drainEvents()];
    for (let tick = 0; tick < 34; tick++) events.push(...sim.tick());
    expect(sim.player.castingAbility).toBe('mercy_lance');
    expect(enemy.hp).toBe(enemy.maxHp);
    events.push(...sim.tick());

    expect(sim.player.castingAbility).toBeNull();
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'damage', targetId: enemy.id, crit: false }),
    );
    expect(sim.player.paladinDevotion?.value).toBe(1);
    expect(sim.player.cooldowns.has('mercy_lance')).toBe(false);
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(0);
  });

  it('exposes the compact replacement kit while retaining old actions only as hidden data', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('retribution')).toBe(true);

    expect(resolve(sim, 'divine_ascension').def.hiddenFromPlayer).not.toBe(true);
    expect(resolve(sim, 'final_edict').def.specs).toEqual(['retribution']);
    expect(sim.resolvedAbility('mercy_lance')).toBeNull();
    expect(sim.resolvedAbility('sunward_disc')).toBeNull();
  });

  it('generates Devotion, empowers Dawnfall, blocks generation, and spends one charge', () => {
    const sim = new Sim({ seed: 11, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('retribution');
    hostileNear(sim);

    const normal = resolve(sim, 'dawnfall');
    const normalAoe = normal.effects.find((effect) => effect.type === 'aoeDamage');
    expect(normalAoe).toMatchObject({ min: 66, max: 84, radius: 6 });
    run(sim, null, normal);
    expect(sim.player.paladinDevotion?.value).toBe(1);
    const normalEvents = sim.drainEvents();
    expect(normalEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinDawnfall',
        sourceId: sim.player.id,
        targetId: sim.player.id,
        ability: 'dawnfall',
        range: 6,
      }),
    );
    expect(normalEvents).not.toContainEqual(
      expect.objectContaining({ type: 'spellfx', fx: 'paladinAscensionImpact' }),
    );

    grantDevotion(sim.player, 19);
    expect(activateDivineAscension(sim.player)).toBe(true);
    const empowered = resolve(sim, 'dawnfall');
    const empoweredAoe = empowered.effects.find((effect) => effect.type === 'aoeDamage');
    expect(empoweredAoe).toMatchObject({ min: 99, max: 126, radius: 10 });

    run(sim, null, empowered);
    expect(sim.player.paladinDevotion).toMatchObject({
      value: 0,
      ascensionCharges: 4,
    });
    const empoweredEvents = sim.drainEvents();
    expect(empoweredEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinDawnfall',
        ability: 'dawnfall',
        range: 10,
      }),
    );
    expect(empoweredEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinAscensionImpact',
        sourceId: sim.player.id,
        targetId: sim.player.id,
        ability: 'dawnfall',
        impact: 'area',
      }),
    );
  });

  it('keeps Mercy Lance casted and guarantees its critical hit when Ascension spends a charge', () => {
    const sim = new Sim({ seed: 37, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');
    const enemy = hostileNear(sim);
    enemy.swingTimer = 999;
    sim.rng.chance = () => false;
    grantDevotion(sim.player, 20);
    activateDivineAscension(sim.player);

    const mercyLance = resolve(sim, 'mercy_lance');
    expect(mercyLance.castTime).toBe(1.75);
    expect(mercyLance.effects).toEqual([
      { type: 'directDamage', min: 80, max: 100, guaranteedCrit: true },
    ]);
    sim.targetEntity(enemy.id);
    sim.castAbility('mercy_lance');
    expect(sim.player.castingAbility).toBe('mercy_lance');
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(5);
    const enemyEvents = [...sim.drainEvents()];
    for (let tick = 0; tick < 34; tick++) {
      enemyEvents.push(...sim.tick());
    }
    expect(sim.player.castingAbility).toBe('mercy_lance');
    expect(enemy.hp).toBe(enemy.maxHp);
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(5);
    enemyEvents.push(...sim.tick());
    expect(sim.player.castingAbility).toBeNull();
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(enemyEvents).toContainEqual(
      expect.objectContaining({ type: 'damage', targetId: enemy.id, crit: true }),
    );
    expect(sim.player.paladinDevotion?.value).toBe(0);
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(4);
    expect(enemyEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinAscensionImpact',
        targetId: enemy.id,
        impact: 'offensive',
      }),
    );
  });

  it('refuses Divine Ascension before 20 Devotion and activates it when ready', () => {
    const sim = new Sim({ seed: 13, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');

    sim.castAbility('divine_ascension');
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(0);
    expect(sim.drainEvents()).not.toContainEqual(
      expect.objectContaining({ type: 'spellfx', fx: 'paladinAscensionStart' }),
    );

    grantDevotion(sim.player, 20);
    sim.castAbility('divine_ascension');
    expect(sim.player.paladinDevotion).toMatchObject({
      value: 0,
      ascensionCharges: 5,
      ascensionRemaining: 45,
    });
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'divine_ascension',
        kind: 'internal_cd',
        remaining: 45,
        duration: 45,
        charges: 5,
        sourceId: sim.player.id,
      }),
    );
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinAscensionStart',
        sourceId: sim.player.id,
      }),
    );
  });

  it('ends Divine Ascension when its visible buff is canceled', () => {
    const sim = new Sim({ seed: 41, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    grantDevotion(sim.player, 20);
    sim.castAbility('divine_ascension');

    sim.cancelAura('divine_ascension');

    expect(sim.player.auras.some((aura) => aura.id === 'divine_ascension')).toBe(false);
    expect(sim.player.paladinDevotion).toMatchObject({
      ascensionCharges: 0,
      ascensionRemaining: 0,
    });
  });

  it('lets Bastion Rite add block without giving Paladins warrior parry', () => {
    const sim = new Sim({ seed: 17, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('protection');
    const mob = hostileNear(sim);
    mob.pos = { x: sim.player.pos.x, y: sim.player.pos.y, z: sim.player.pos.z + 2 };
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    sim.player.facing = 0;

    const before = warriorMeleeDefense(sim.player, mob);
    expect(before).toEqual({ parryChance: 0, blockChance: 0.05 });

    run(sim, null, resolve(sim, 'bastion_rite'));
    const during = warriorMeleeDefense(sim.player, mob);
    expect(during).toEqual({ parryChance: 0, blockChance: 0.25 });
    expect(sim.player.paladinDevotion?.value).toBe(0);
  });

  it('generates Protection Devotion from actual blocks with an internal cooldown', () => {
    const sim = new Sim({ seed: 29, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('protection');
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const mob = hostileNear(sim);
    mob.pos = { x: sim.player.pos.x, y: sim.player.pos.y, z: sim.player.pos.z + 2 };
    mob.weapon = { min: 20, max: 20, speed: 2 };
    mob.attackPower = 0;
    sim.player.facing = 0;
    sim.player.dodgeChance = 0;
    sim.player.blockChance = 1;
    sim.player.stats.armor = 0;
    sim.rng.next = () => 0.9;

    const mobSwing = (sim as unknown as { mobSwing(attacker: Entity, target: Entity): void })
      .mobSwing;
    mobSwing.call(sim, mob, sim.player);
    expect(sim.player.paladinDevotion).toMatchObject({ value: 1, blockIcdRemaining: 6 });

    sim.player.hp = sim.player.maxHp;
    mobSwing.call(sim, mob, sim.player);
    expect(sim.player.paladinDevotion?.value).toBe(1);
  });

  it('generates Devotion without a spec only for effective direct healing', () => {
    const sim = new Sim({ seed: 31, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);

    sim.player.hp = 1;
    run(sim, sim.player, resolve(sim, 'holy_light'));
    expect(sim.player.hp).toBeGreaterThan(1);
    expect(sim.player.paladinDevotion?.value).toBe(1);

    sim.player.hp = sim.player.maxHp;
    run(sim, sim.player, resolve(sim, 'holy_light'));
    expect(sim.player.paladinDevotion?.value).toBe(1);
  });

  it('generates one Devotion from other effective direct abilities without a spec', () => {
    const healing = new Sim({ seed: 34, playerClass: 'paladin', autoEquip: true });
    healing.setPlayerLevel(20);
    healing.player.hp = 1;
    run(healing, healing.player, resolve(healing, 'lay_on_hands'));
    expect(healing.player.paladinDevotion?.value).toBe(1);

    const damage = new Sim({ seed: 35, playerClass: 'paladin', autoEquip: true });
    damage.setPlayerLevel(20);
    const enemy = hostileNear(damage);
    run(damage, enemy, resolve(damage, 'hammer_of_grace'));
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(damage.player.paladinDevotion?.value).toBe(1);
  });

  it('doubles Holy healing generation while Avenging Wrath is active', () => {
    const sim = new Sim({ seed: 32, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');

    sim.castAbility('avenging_wrath');
    expect(sim.player.paladinDevotion?.value).toBe(10);
    sim.player.hp = 1;
    run(sim, sim.player, resolve(sim, 'holy_light'));
    sim.player.hp = 1;
    run(sim, sim.player, resolve(sim, 'holy_light'));

    expect(sim.player.paladinDevotion?.value).toBe(14);
  });

  it('doubles Protection damage generation while Avenging Wrath is active', () => {
    const sim = new Sim({ seed: 33, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('protection');

    sim.castAbility('avenging_wrath');
    run(sim, hostileNear(sim), resolve(sim, 'vowkeeper_strike'));

    expect(sim.player.paladinDevotion?.value).toBe(12);
  });

  it('improves rescue tools during Ascension without marking them as charge spenders', () => {
    const holy = new Sim({ seed: 19, playerClass: 'paladin', autoEquip: true });
    holy.setPlayerLevel(20);
    holy.setSpec('holy');
    grantDevotion(holy.player, 20);
    activateDivineAscension(holy.player);
    const lifeCovenant = resolve(holy, 'life_covenant');
    expect(lifeCovenant.effects).toContainEqual({ type: 'absorb', amount: 120, duration: 6 });

    const protection = new Sim({ seed: 23, playerClass: 'paladin', autoEquip: true });
    protection.setPlayerLevel(20);
    protection.setSpec('protection');
    grantDevotion(protection.player, 20);
    activateDivineAscension(protection.player);
    const sacredChallenge = resolve(protection, 'sacred_challenge');
    expect(sacredChallenge.effects).toContainEqual({
      type: 'selfBuff',
      kind: 'buff_dr',
      value: 0.15,
      duration: 4,
    });

    run(protection, hostileNear(protection), sacredChallenge);
    expect(protection.player.paladinDevotion?.ascensionCharges).toBe(5);
  });

  it('transforms every marked core ability during Ascension', () => {
    const holy = new Sim({ seed: 41, playerClass: 'paladin', autoEquip: true });
    holy.setPlayerLevel(20);
    holy.setSpec('holy');
    grantDevotion(holy.player, 20);
    activateDivineAscension(holy.player);
    expect(resolve(holy, 'mercy_lance')).toMatchObject({
      castTime: 1.75,
      effects: [{ type: 'directDamage', min: 80, max: 100, guaranteedCrit: true }],
    });
    expect(resolve(holy, 'dawns_embrace')).toMatchObject({
      castTime: 0,
      effects: [{ type: 'heal', min: 351, max: 419 }],
    });
    expect(resolve(holy, 'radiant_chorus').effects).toEqual([
      { type: 'aoeHeal', min: 108, max: 132, radius: 40 },
    ]);
    expect(resolve(holy, 'solar_invocation').effects).toEqual([
      { type: 'heal', min: 180, max: 220 },
      { type: 'directDamage', min: 120, max: 150 },
      {
        type: 'aoeHeal',
        min: 90,
        max: 110,
        radius: 10,
        playersOnly: true,
        centerOnTarget: true,
        friendlyTargetOnly: true,
      },
    ]);
    const protection = new Sim({ seed: 43, playerClass: 'paladin', autoEquip: true });
    protection.setPlayerLevel(20);
    protection.setSpec('protection');
    grantDevotion(protection.player, 20);
    activateDivineAscension(protection.player);
    expect(resolve(protection, 'vowkeeper_strike').effects).toEqual([
      { type: 'weaponStrike', bonus: 21, weaponMult: 1 },
      {
        type: 'selfBuff',
        kind: 'absorb',
        value: Math.round(protection.player.maxHp * 0.06),
        duration: 6,
        auraId: 'vowkeeper_strike_absorb',
      },
    ]);
    expect(resolve(protection, 'bastion_rite').effects).toEqual([
      { type: 'selfBuff', kind: 'buff_dr_phys', value: 0.2, duration: 10 },
      { type: 'selfBuff', kind: 'buff_block', value: 0.2, duration: 10 },
    ]);
    expect(resolve(protection, 'sunward_disc').effects).toEqual([
      { type: 'directDamage', min: 117, max: 143 },
      { type: 'chainDamage', min: 78, max: 98, jumps: 5, falloff: 1, radius: 10 },
    ]);
    expect(resolve(protection, 'bastion_sweep').effects).toEqual([
      {
        type: 'aoeDamage',
        min: 94,
        max: 114,
        radius: 8,
        frontal: true,
        frontalHalfAngle: Math.PI / 2,
        softCap: 5,
      },
    ]);
    expect(resolve(protection, 'holy_shield').effects).toEqual([
      { type: 'selfBuff', kind: 'buff_block', value: 0.4, duration: 10 },
      {
        type: 'absorb',
        amount: 0,
        casterMaxHpPct: 0.15,
        duration: 10,
        auraId: 'holy_shield_absorb',
      },
      { type: 'threatPulse', amount: 150, radius: 8 },
    ]);
    expect(resolve(protection, 'consecration').effects).toEqual([
      {
        type: 'groundAoE',
        min: 29,
        max: 36,
        radius: 6,
        duration: 9,
        interval: 1,
        devotionOnFirstHit: 1,
      },
    ]);
    expect(resolve(protection, 'oath_chain').effects).toEqual([
      {
        type: 'pullTarget',
        stopDistance: 3,
        travelSpeed: 18,
        slowMult: 0.5,
        slowDuration: 4,
        maxTargets: 2,
      },
    ]);

    const retribution = new Sim({ seed: 47, playerClass: 'paladin', autoEquip: true });
    retribution.setPlayerLevel(20);
    retribution.setSpec('retribution');
    grantDevotion(retribution.player, 20);
    activateDivineAscension(retribution.player);
    expect(resolve(retribution, 'final_edict').effects).toEqual([
      { type: 'weaponStrike', bonus: 62, weaponMult: 1.68 },
      { type: 'aoeDamage', min: 55, max: 70, radius: 6, softCap: 5 },
    ]);
    expect(resolve(retribution, 'dawnfall').effects).toEqual([
      { type: 'aoeDamage', min: 99, max: 126, radius: 10, softCap: 5 },
    ]);
    expect(resolve(retribution, 'faithforged_guard').effects).toEqual([
      { type: 'selfBuff', kind: 'paladin_debt_of_light', value: 210, duration: 8 },
    ]);
    expect(resolve(retribution, 'hammer_of_wrath').effects).toEqual([
      { type: 'directDamage', min: 234, max: 281 },
    ]);
    expect(resolve(retribution, 'guardian_covenant').effects).toEqual([
      { type: 'buffTarget', kind: 'buff_dr', value: 0.3, duration: 8 },
      { type: 'selfBuff', kind: 'buff_dr', value: 0.3, duration: 8 },
    ]);
  });

  it('labels defensive Ascension impacts independently from damage and healing', () => {
    const sim = new Sim({ seed: 43, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('retribution');
    grantDevotion(sim.player, 20);
    activateDivineAscension(sim.player);

    run(sim, null, resolve(sim, 'faithforged_guard'));
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinAscensionImpact',
        ability: 'faithforged_guard',
        impact: 'defensive',
      }),
    );
  });

  it('anchors Final Edict empowered nova on the Paladin', () => {
    const sim = new Sim({ seed: 59, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('retribution');
    const enemy = hostileNear(sim);
    grantDevotion(sim.player, 20);
    activateDivineAscension(sim.player);

    run(sim, enemy, resolve(sim, 'final_edict'));
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinAscensionImpact',
        sourceId: sim.player.id,
        targetId: sim.player.id,
        ability: 'final_edict',
        impact: 'area',
      }),
    );
  });

  it('emits the focused Final Edict weapon impact on a successful strike', () => {
    const sim = new Sim({ seed: 61, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('retribution');
    const enemy = hostileNear(sim);

    run(sim, enemy, resolve(sim, 'final_edict'));
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinFinalEdict',
        sourceId: sim.player.id,
        targetId: enemy.id,
        ability: 'final_edict',
      }),
    );
  });
});
