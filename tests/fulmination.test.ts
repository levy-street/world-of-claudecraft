import { describe, expect, it } from 'vitest';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { encodeObs } from '../src/sim/obs';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function fulminationSim(): Sim {
  const sim = new Sim({ seed: 1729, playerClass: 'shaman', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows: { 11: 'sha_r11_fulmination' } })).toBe(true);
  sim.player.spellPower = 0;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 90_001, xOffset = 0, zOffset = 3): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + xOffset,
    y: sim.player.pos.y,
    z: sim.player.pos.z + zOffset,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

function resolved(sim: Sim, abilityId: string): ResolvedAbility {
  const ability = sim.resolvedAbility(abilityId);
  if (!ability) throw new Error(`missing resolved ability ${abilityId}`);
  return ability;
}

function run(sim: Sim, target: Entity | null, ability: ResolvedAbility): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  sim.ctx.runEffects(sim.player, meta, target, ability);
}

function castAndLand(sim: Sim, target: Entity, abilityId: string): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
  sim.player.resource = sim.player.maxResource;
  sim.player.gcdRemaining = 0;
  sim.castAbility(abilityId);
  for (let tick = 0; tick < 200 && sim.player.castingAbility; tick++) {
    updateCasting(sim.ctx, sim.player, meta);
  }
  expect(sim.player.castingAbility).toBeNull();
  for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
    advancePendingProjectiles(sim.ctx);
  }
  expect(sim.ctx.pendingProjectiles).toHaveLength(0);
}

function fixedDamageRng(
  sim: Sim,
  chanceResult: (probability: number) => boolean = () => false,
): { draws: () => number; chanceDraws: () => number[] } {
  const rng = sim.ctx.rng as typeof sim.ctx.rng & {
    range(min: number, max: number): number;
    chance(probability: number): boolean;
  };
  let ranges = 0;
  const chances: number[] = [];
  rng.range = (min) => {
    ranges++;
    return min;
  };
  rng.chance = (probability) => {
    chances.push(probability);
    return chanceResult(probability);
  };
  return { draws: () => ranges + chances.length, chanceDraws: () => chances };
}

describe('Elemental Fulmination', () => {
  it('adds one Thunder Ward charge per completed Arc Bolt and caps at nine', () => {
    const sim = fulminationSim();
    const target = targetFor(sim);
    const rng = fixedDamageRng(sim);
    run(sim, null, resolved(sim, 'lightning_shield'));

    for (let index = 0; index < 8; index++) {
      onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', target);
    }

    const ward = sim.player.auras.find((aura) => aura.id === 'lightning_shield');
    expect(ward?.charges).toBe(9);
    expect(encodeObs(sim)[17]).toBe(1);
    expect(rng.draws()).toBe(0);
  });

  it('uses the post-completion ward bank at impact and adds no draw for other builds', () => {
    const chancesAtImpact = (chargeAddsBeforeCast: number): number[] => {
      const sim = fulminationSim();
      const target = targetFor(sim);
      run(sim, null, resolved(sim, 'lightning_shield'));
      for (let index = 0; index < chargeAddsBeforeCast; index++) {
        onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', target);
      }
      sim.player.spellPower = 0;
      const rng = fixedDamageRng(sim, (probability) => probability > 0.9);

      castAndLand(sim, target, 'lightning_bolt');

      return rng.chanceDraws();
    };

    const freshWardImpact = chancesAtImpact(0);
    const cappedWardImpact = chancesAtImpact(5);
    expect(freshWardImpact).toHaveLength(3);
    expect(freshWardImpact.at(-1)).toBeCloseTo(0.2);
    expect(cappedWardImpact).toHaveLength(3);
    expect(cappedWardImpact.at(-1)).toBeCloseTo(0.45);

    const baseline = new Sim({ seed: 1729, playerClass: 'shaman', autoEquip: false });
    baseline.setPlayerLevel(20);
    expect(baseline.applyTalents({ spec: null, rows: {} })).toBe(true);
    run(baseline, null, resolved(baseline, 'lightning_shield'));
    baseline.player.spellPower = 0;
    const baselineTarget = targetFor(baseline);
    const baselineRng = fixedDamageRng(baseline, (probability) => probability > 0.9);

    castAndLand(baseline, baselineTarget, 'lightning_bolt');

    expect(baselineRng.chanceDraws()).toHaveLength(2);
  });

  it('fires a free half-damage Overload and chains it to the nearest enemy', () => {
    const sim = fulminationSim();
    const primary = targetFor(sim);
    const fartherInRange = targetFor(sim, 90_003, 6, 3);
    const nearest = targetFor(sim, 90_002, 2, 3);
    const far = targetFor(sim, 90_004, 0, 13);
    run(sim, null, resolved(sim, 'lightning_shield'));
    for (let index = 0; index < 6; index++) {
      onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', primary);
    }
    sim.player.spellPower = 0;
    const rng = fixedDamageRng(sim, (probability) => probability === 0.45);
    const resourceBefore = sim.player.resource;
    const gcdBefore = sim.player.gcdRemaining;
    const primaryBefore = primary.hp;
    const nearestBefore = nearest.hp;
    const fartherBefore = fartherInRange.hp;
    const farBefore = far.hp;

    run(sim, primary, resolved(sim, 'lightning_bolt'));

    expect(primaryBefore - primary.hp).toBe(75 + 38);
    expect(nearestBefore - nearest.hp).toBe(38);
    expect(fartherInRange.hp).toBe(fartherBefore);
    expect(far.hp).toBe(farBefore);
    expect(sim.player.resource).toBe(resourceBefore);
    expect(sim.player.gcdRemaining).toBe(gcdBefore);
    expect(rng.draws()).toBe(3);
    expect(rng.chanceDraws()).toHaveLength(2);
    expect(sim.events).toContainEqual({
      type: 'spellfx',
      sourceId: primary.id,
      targetId: nearest.id,
      school: 'nature',
      fx: 'projectile',
    });
  });

  it('drops a preselected Overload chain if combat ends on the primary repeat', () => {
    const sim = fulminationSim();
    const primary = targetFor(sim);
    const chained = targetFor(sim, 90_002, 2, 3);
    run(sim, null, resolved(sim, 'lightning_shield'));
    for (let index = 0; index < 6; index++) {
      onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', primary);
    }
    sim.player.spellPower = 0;
    fixedDamageRng(sim, (probability) => probability === 0.45);
    const dealDamage = sim.ctx.dealDamage;
    let primaryDamageCalls = 0;
    sim.ctx.dealDamage = (...args: Parameters<typeof dealDamage>) => {
      dealDamage(...args);
      if (args[1].id === primary.id && ++primaryDamageCalls === 2) chained.hostile = false;
    };
    const chainedBefore = chained.hp;

    run(sim, primary, resolved(sim, 'lightning_bolt'));

    expect(chained.hp).toBe(chainedBefore);
    expect(
      sim.events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.sourceId === primary.id &&
          event.targetId === chained.id,
      ),
    ).toBe(false);
  });

  it('vents every Thunder Ward charge across nearby enemies and resets the ramp', () => {
    const sim = fulminationSim();
    const primary = targetFor(sim);
    const nearbyA = targetFor(sim, 90_002, 4, 3);
    const nearbyB = targetFor(sim, 90_003, 6, 3);
    const far = targetFor(sim, 90_004, 0, 13);
    const rng = fixedDamageRng(sim);
    run(sim, null, resolved(sim, 'lightning_shield'));
    for (let index = 0; index < 6; index++) {
      onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', primary);
    }
    const jolt = resolved(sim, 'earth_shock');
    const dump = jolt.effects.find((effect) => effect.type === 'consumeAuraChargesDamage');
    if (!dump) throw new Error('missing Fulmination dump effect');
    const primaryBefore = primary.hp;
    const nearbyABefore = nearbyA.hp;
    const nearbyBBefore = nearbyB.hp;
    const farBefore = far.hp;

    run(sim, primary, { ...jolt, effects: [dump] });

    expect(dump.radius).toBe(8);
    expect(primaryBefore - primary.hp).toBe(9 * 8);
    expect(nearbyABefore - nearbyA.hp).toBe(9 * 8);
    expect(nearbyBBefore - nearbyB.hp).toBe(9 * 8);
    expect(far.hp).toBe(farBefore);
    expect(sim.player.auras.some((aura) => aura.id === 'lightning_shield')).toBe(false);
    expect(encodeObs(sim)[17]).toBe(0);
    expect(rng.draws()).toBe(0);
  });

  it('stops a materialized vent if combat ends on the primary discharge', () => {
    const sim = fulminationSim();
    const primary = targetFor(sim);
    const nearbyA = targetFor(sim, 90_002, 4, 3);
    const nearbyB = targetFor(sim, 90_003, -4, 3);
    run(sim, null, resolved(sim, 'lightning_shield'));
    const jolt = resolved(sim, 'earth_shock');
    const dump = jolt.effects.find((effect) => effect.type === 'consumeAuraChargesDamage');
    if (!dump) throw new Error('missing Fulmination dump effect');
    const dealDamage = sim.ctx.dealDamage;
    sim.ctx.dealDamage = (...args: Parameters<typeof dealDamage>) => {
      dealDamage(...args);
      if (args[1].id === primary.id) {
        nearbyA.hostile = false;
        nearbyB.hostile = false;
      }
    };
    const nearbyABefore = nearbyA.hp;
    const nearbyBBefore = nearbyB.hp;

    run(sim, primary, { ...jolt, effects: [dump] });

    expect(nearbyA.hp).toBe(nearbyABefore);
    expect(nearbyB.hp).toBe(nearbyBBefore);
  });

  it('replays the escalating storm deterministically for a fixed seed', () => {
    const scenario = () => {
      const sim = fulminationSim();
      const primary = targetFor(sim);
      const nearby = targetFor(sim, 90_002, 4, 3);
      run(sim, null, resolved(sim, 'lightning_shield'));
      for (let index = 0; index < 6; index++) {
        onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', primary);
      }
      sim.player.spellPower = 0;
      sim.events.length = 0;

      for (let index = 0; index < 12; index++) {
        run(sim, primary, resolved(sim, 'lightning_bolt'));
      }

      return {
        primaryHp: primary.hp,
        nearbyHp: nearby.hp,
        overloads: sim.events.filter(
          (event) => event.type === 'spellfx' && event.fx === 'procSurge',
        ).length,
        damage: sim.events.filter((event) => event.type === 'damage'),
      };
    };

    const first = scenario();
    expect(first.overloads).toBeGreaterThan(0);
    expect(scenario()).toEqual(first);
  });

  it('gates Overload draws on an active ward, the right spell, and landed damage', () => {
    const talented = fulminationSim();
    const target = targetFor(talented);
    const talentedRng = fixedDamageRng(talented);

    run(talented, target, resolved(talented, 'lightning_bolt'));

    expect(talented.player.auras.some((aura) => aura.id === 'lightning_shield')).toBe(false);
    expect(talentedRng.chanceDraws()).toHaveLength(1);

    run(talented, null, resolved(talented, 'lightning_shield'));
    const wrongAbilityRng = fixedDamageRng(talented);
    run(talented, target, resolved(talented, 'earth_shock'));
    expect(wrongAbilityRng.chanceDraws()).toHaveLength(1);

    const resisted = fulminationSim();
    const resistedTarget = targetFor(resisted);
    run(resisted, null, resolved(resisted, 'lightning_shield'));
    const resistedRng = fixedDamageRng(resisted, () => false);
    const resistedHp = resistedTarget.hp;
    castAndLand(resisted, resistedTarget, 'lightning_bolt');
    expect(resistedTarget.hp).toBe(resistedHp);
    expect(resistedRng.chanceDraws()).toHaveLength(1);
  });

  it('keeps Fulmination charge and vent state unavailable without the talent', () => {
    const baseline = new Sim({ seed: 1729, playerClass: 'shaman', autoEquip: false });
    baseline.setPlayerLevel(20);
    expect(baseline.applyTalents({ spec: null, rows: {} })).toBe(true);
    run(baseline, null, resolved(baseline, 'lightning_shield'));
    const baselineTarget = targetFor(baseline);
    onCastCompleted(baseline.ctx, baseline.player, 'lightning_bolt', baselineTarget);

    expect(baseline.player.auras.find((aura) => aura.id === 'lightning_shield')?.charges).toBe(3);
    expect(
      resolved(baseline, 'earth_shock').effects.some(
        (effect) => effect.type === 'consumeAuraChargesDamage',
      ),
    ).toBe(false);
  });

  it('does not Overload after a duel-ending Arc Bolt removes hostility', () => {
    const sim = fulminationSim();
    const opponentId = sim.addPlayer('mage', 'Duelist', { autoEquip: false });
    const opponent = sim.entities.get(opponentId);
    if (!opponent) throw new Error('missing duel opponent');
    const duel = { a: sim.player.id, b: opponent.id, state: 'active' as const, timer: 0 };
    sim.duels.set(duel.a, duel);
    sim.duels.set(duel.b, duel);
    run(sim, null, resolved(sim, 'lightning_shield'));
    for (let index = 0; index < 6; index++) {
      onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', opponent);
    }
    sim.player.spellPower = 0;
    opponent.hp = 50;
    const rng = fixedDamageRng(sim, (probability) => probability === 0.45);
    sim.events.length = 0;

    run(sim, opponent, resolved(sim, 'lightning_bolt'));

    expect(opponent.hp).toBe(1);
    expect(opponent.dead).toBe(false);
    expect(sim.duels.has(opponent.id)).toBe(false);
    expect(rng.chanceDraws()).toHaveLength(1);
    expect(sim.events.some((event) => event.type === 'spellfx' && event.fx === 'procSurge')).toBe(
      false,
    );
  });
});
