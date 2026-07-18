import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function addHostile(sim: Sim, distance = 2): Entity {
  const player = sim.player;
  const mob = createMob(9000 + sim.entities.size, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  mob.hostile = true;
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function runAbilityEffect(sim: Sim, target: Entity | null, abilityId: string): void {
  const def = ABILITIES[abilityId];
  if (!def) throw new Error(`missing ability ${abilityId}`);
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  const resolved: ResolvedAbility = {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
  };
  sim.ctx.runEffects(sim.player, meta, target, resolved);
}

function aura(
  owner: Entity,
  id: string,
  kind: Aura['kind'],
  value: number,
  school: Aura['school'],
): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 30,
    duration: 30,
    value,
    sourceId: owner.id,
    school,
  };
}

function step(sim: Sim, ticks: number): void {
  for (let index = 0; index < ticks; index++) sim.tick();
}

describe('Talents V2 dispel and steal primitives', () => {
  it('removes only a friendly magic debuff and recalculates stats after removal', () => {
    const sim = new Sim({ seed: 1, playerClass: 'paladin', noPlayer: true });
    const casterId = sim.addPlayer('paladin', 'Caster');
    const allyId = sim.addPlayer('mage', 'Ally');
    sim.setPlayerLevel(20, casterId);
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    const baseInt = ally.stats.int;

    sim.ctx.applyAura(ally, aura(sim.player, 'magic_int_drain', 'buff_int', -5, 'shadow'));
    sim.ctx.applyAura(ally, aura(sim.player, 'physical_bleed', 'dot', 4, 'physical'));
    expect(ally.stats.int).toBe(baseInt - 5);

    runAbilityEffect(sim, ally, 'cleansing_verdict');

    expect(ally.auras.some((entry) => entry.id === 'magic_int_drain')).toBe(false);
    expect(ally.auras.some((entry) => entry.id === 'physical_bleed')).toBe(true);
    expect(ally.stats.int).toBe(baseInt);
  });

  it('steals an enemy magic benefit but leaves enemy physical and harmful auras alone', () => {
    const sim = new Sim({ seed: 2, playerClass: 'mage', autoEquip: true });
    const enemy = addHostile(sim);
    enemy.auras.push(aura(enemy, 'magic_blessing', 'buff_spellpower', 40, 'holy'));
    enemy.auras.push(aura(enemy, 'physical_guard', 'buff_armor', 50, 'physical'));
    enemy.auras.push(aura(sim.player, 'magic_curse', 'slow', 0.5, 'shadow'));

    runAbilityEffect(sim, enemy, 'spellsteal');

    expect(enemy.auras.some((entry) => entry.id === 'magic_blessing')).toBe(false);
    expect(enemy.auras.some((entry) => entry.id === 'physical_guard')).toBe(true);
    expect(enemy.auras.some((entry) => entry.id === 'magic_curse')).toBe(true);
    const stolen = sim.player.auras.find((entry) => entry.id === 'magic_blessing');
    expect(stolen?.sourceId).toBe(sim.player.id);
  });

  it.each([
    ['buff_sta', 10],
    ['buff_sta_pct', 20],
  ] as const)('reverses non-player %s stat folds when Spellsteal removes them', (kind, value) => {
    const sim = new Sim({ seed: 22, playerClass: 'mage', autoEquip: true });
    const enemy = addHostile(sim);
    const baseMaxHp = enemy.maxHp;
    enemy.hp = Math.round(baseMaxHp * 0.5);
    sim.ctx.applyAura(enemy, aura(enemy, `magic_${kind}`, kind, value, 'holy'));
    expect(enemy.maxHp).toBeGreaterThan(baseMaxHp);

    runAbilityEffect(sim, enemy, 'spellsteal');

    expect(enemy.auras.some((entry) => entry.id === `magic_${kind}`)).toBe(false);
    expect(enemy.maxHp).toBe(baseMaxHp);
    expect(enemy.hp).toBe(Math.round(baseMaxHp * 0.5));
  });

  it('lets Voidfeast devour the correctly directed magic aura and heal its caster', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warlock', autoEquip: true });
    const enemy = addHostile(sim);
    enemy.auras.push(aura(enemy, 'magic_blessing', 'buff_spellpower', 40, 'holy'));
    sim.player.hp = Math.floor(sim.player.maxHp / 2);
    const before = sim.player.hp;

    runAbilityEffect(sim, enemy, 'voidfeast');

    expect(enemy.auras.some((entry) => entry.id === 'magic_blessing')).toBe(false);
    expect(sim.player.hp).toBeGreaterThan(before);
  });
});

describe('Talents V2 movement and control primitives', () => {
  it('routes Typhoon through shared knockback resistance and applies its daze', () => {
    const sim = new Sim({ seed: 4, playerClass: 'druid', autoEquip: true });
    const enemy = addHostile(sim);
    enemy.knockbackResistance = 1;
    const before = { ...enemy.pos };
    const original = sim.ctx.applyKnockback;
    let calls = 0;
    (sim.ctx as { applyKnockback: typeof original }).applyKnockback = (
      source,
      target,
      distance,
    ) => {
      calls++;
      return original(source, target, distance);
    };

    runAbilityEffect(sim, null, 'typhoon');

    expect(calls).toBe(1);
    expect(enemy.pos).toEqual(before);
    const daze = enemy.auras.find((entry) => entry.id === 'typhoon_daze');
    expect(daze).toMatchObject({ kind: 'slow', value: 0.5, remaining: 4 });
  });

  it('uses Frost Trap armed stun control rather than a movable root', () => {
    // Balance pass (G6): Rime Snare is an armed trap at the hunter's feet
    // now; the freeze lands on first contact after the arm delay.
    const sim = new Sim({ seed: 5, playerClass: 'hunter', autoEquip: true });
    const enemy = addHostile(sim, 4);
    const beforeHp = enemy.hp;
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      range(min: number, max: number): number;
    };
    const originalRange = rng.range.bind(rng);
    let damageRolls = 0;
    rng.range = (min, max) => {
      damageRolls++;
      return originalRange(min, max);
    };

    runAbilityEffect(sim, null, 'frost_trap');
    expect(damageRolls).toBe(0); // placement draws no damage roll
    rng.range = originalRange; // ambient sim rng during the ticks is not ours
    expect(enemy.auras).toHaveLength(0); // placed, not an instant nova
    enemy.pos.x = sim.player.pos.x;
    enemy.pos.z = sim.player.pos.z;
    enemy.aiState = 'idle';
    for (let i = 0; i < 40; i++) sim.tick();

    expect(enemy.hp).toBe(beforeHp);
    expect(
      enemy.auras.some((entry) => entry.id === 'frost_trap_freeze' && entry.kind === 'stun'),
    ).toBe(true);
    expect(enemy.auras.some((entry) => entry.kind === 'root')).toBe(false);

    const mage = new Sim({ seed: 5, playerClass: 'mage', autoEquip: true });
    const frostNovaTarget = addHostile(mage, 4);
    const frostNovaHp = frostNovaTarget.hp;
    runAbilityEffect(mage, null, 'frost_nova');
    expect(frostNovaTarget.hp).toBeLessThan(frostNovaHp);
  });

  it('supports Silence, Preparation, and swept root-breaking Blink', () => {
    const priest = new Sim({ seed: 6, playerClass: 'priest', autoEquip: true });
    const enemy = addHostile(priest);
    runAbilityEffect(priest, enemy, 'silence');
    expect(
      enemy.auras.some((entry) => entry.id === 'silence_silence' && entry.kind === 'silence'),
    ).toBe(true);

    const rogue = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    rogue.player.cooldowns.set('sprint', 30);
    rogue.player.cooldowns.set('evasion', 40);
    rogue.player.cooldowns.set('vanish', 50);
    rogue.player.cooldowns.set('kick', 10);
    rogue.player.abilityCharges = {
      sprint: { charges: 1, maxCharges: 3, recharge: 30, rechargeLength: 30 },
    };
    runAbilityEffect(rogue, null, 'preparation');
    expect([...rogue.player.cooldowns.keys()]).toEqual(['kick']);
    // Preparation resets the charge pool to full alongside the plain cooldowns.
    expect(rogue.player.abilityCharges.sprint).toEqual({
      charges: 3,
      maxCharges: 3,
      recharge: 0,
      rechargeLength: 30,
    });

    const mage = new Sim({ seed: 8, playerClass: 'mage', autoEquip: true });
    mage.ctx.applyAura(mage.player, aura(mage.player, 'test_root', 'root', 0, 'nature'));
    const originalResolve = mage.ctx.resolveMovePoint;
    let resolvedSteps = 0;
    (mage.ctx as { resolveMovePoint: typeof originalResolve }).resolveMovePoint = (
      x,
      z,
      radius,
      mover,
    ) => {
      resolvedSteps++;
      return originalResolve(x, z, radius, mover);
    };
    runAbilityEffect(mage, null, 'blink');
    expect(mage.player.auras.some((entry) => entry.kind === 'root')).toBe(false);
    expect(resolvedSteps).toBeGreaterThan(0);
  });
});

describe('Talents V2 stasis and resource-sap primitives', () => {
  it('Ice Block stops actions and auto attacks, and recasts to cancel the stasis', () => {
    // Cold Coffin is mage base kit now (learnLevel 12, stasis + cleanseSelf; the
    // old row-granted absorb shield died with the mage rework).
    const sim = new Sim({ seed: 9, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    const enemy = addHostile(sim);
    sim.targetEntity(enemy.id);
    sim.startAutoAttack();
    expect(sim.player.autoAttack).toBe(true);

    sim.castAbility('ice_block');
    expect(
      sim.player.auras.some((entry) => entry.id === 'ice_block' && entry.kind === 'stasis'),
    ).toBe(true);
    expect(sim.player.autoAttack).toBe(false);

    sim.player.gcdRemaining = 0;
    sim.castAbility('fireball');
    expect(sim.player.castingAbility).toBeNull();

    sim.player.gcdRemaining = 0;
    sim.castAbility('ice_block');
    expect(sim.player.auras.some((entry) => entry.id === 'ice_block')).toBe(false);
  });

  it('Lifesap ticks the current resource every two seconds and is stilled by hard control', () => {
    const sim = new Sim({ seed: 10, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 11: 'dru_r11_innervate' } })).toBe(true);
    sim.player.inCombat = true;
    sim.player.fiveSecondRule = 0;
    sim.castAbility('innervate');
    sim.player.resource = 0;
    step(sim, 40);
    expect(sim.player.resource).toBe(20);

    sim.player.resource = 0;
    sim.ctx.applyAura(sim.player, aura(sim.player, 'test_stun', 'stun', 0, 'physical'));
    step(sim, 40);
    expect(sim.player.resource).toBe(0);
  });
});
