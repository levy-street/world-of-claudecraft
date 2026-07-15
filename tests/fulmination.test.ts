import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { encodeObs } from '../src/sim/obs';
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

function targetFor(sim: Sim): Entity {
  const target = createMob(90_001, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
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

function fixedDamageRng(sim: Sim): { draws: () => number } {
  const rng = sim.ctx.rng as typeof sim.ctx.rng & {
    range(min: number, max: number): number;
    chance(probability: number): boolean;
  };
  let draws = 0;
  rng.range = (min) => {
    draws++;
    return min;
  };
  rng.chance = () => {
    draws++;
    return false;
  };
  return { draws: () => draws };
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

  it('consumes every Thunder Ward charge for fixed Nature damage through Earthen Jolt', () => {
    const sim = fulminationSim();
    const target = targetFor(sim);
    const rng = fixedDamageRng(sim);
    run(sim, null, resolved(sim, 'lightning_shield'));
    for (let index = 0; index < 6; index++) {
      onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', target);
    }
    const jolt = resolved(sim, 'earth_shock');
    const dump = jolt.effects.find((effect) => effect.type === 'consumeAuraChargesDamage');
    if (!dump) throw new Error('missing Fulmination dump effect');
    const before = target.hp;

    run(sim, target, { ...jolt, effects: [dump] });

    expect(before - target.hp).toBe(9 * 8);
    expect(sim.player.auras.some((aura) => aura.id === 'lightning_shield')).toBe(false);
    expect(rng.draws()).toBe(0);
  });

  it('does nothing without an active Thunder Ward or without the talent', () => {
    const talented = fulminationSim();
    const target = targetFor(talented);
    const talentedRng = fixedDamageRng(talented);

    onCastCompleted(talented.ctx, talented.player, 'lightning_bolt', target);

    expect(talented.player.auras.some((aura) => aura.id === 'lightning_shield')).toBe(false);
    expect(talentedRng.draws()).toBe(0);

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
});
