// Debt of Light (Dawnreaver, ability id `faithforged_guard`): arms for 8 sec and
// answers exactly ONE incoming hit, denying up to its cap and returning what it
// denied to the attacker as Holy damage, plus 1 Devotion.
//
// Two layers are pinned: the leaf arithmetic (combat/paladin_debt_of_light.ts) and
// the live path through dealDamage, because the interesting rules (one hit only,
// return equals what was SOAKED rather than the cap or the raw blow, no charge
// burned without an attacker) only hold if both agree.

import { describe, expect, it } from 'vitest';
import { answerDebtOfLight, DEBT_OF_LIGHT_KIND } from '../src/sim/combat/paladin_debt_of_light';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & { nextId: number; addEntity(entity: Entity): void };

const CAP = 140;

function makeRetribution(): TestSim {
  const sim = new Sim({ seed: 909, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('retribution')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function attacker(sim: TestSim): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

function arm(sim: TestSim): void {
  sim.castAbility('faithforged_guard');
  expect(sim.player.auras.some((a) => a.kind === DEBT_OF_LIGHT_KIND)).toBe(true);
}

function hit(sim: TestSim, from: Entity, amount: number): void {
  (sim as unknown as { ctx: { dealDamage(...args: unknown[]): void } }).ctx.dealDamage(
    from,
    sim.player,
    amount,
    false,
    'physical',
    'Test Blow',
    'hit',
  );
}

describe('Debt of Light: the arithmetic', () => {
  it('denies up to the cap and owes back exactly what it denied', () => {
    expect(answerDebtOfLight(CAP, 90, true)).toEqual({ soaked: 90 });
    expect(answerDebtOfLight(CAP, 400, true)).toEqual({ soaked: CAP });
  });

  it('answers nothing without an attacker, without damage, or without a cap', () => {
    expect(answerDebtOfLight(CAP, 90, false)).toBeNull();
    expect(answerDebtOfLight(CAP, 0, true)).toBeNull();
    expect(answerDebtOfLight(0, 90, true)).toBeNull();
  });
});

describe('Debt of Light: the live path', () => {
  it('denies the blow, returns it to the attacker, and banks 1 Devotion', () => {
    const sim = makeRetribution();
    const wolf = attacker(sim);
    sim.player.hp = sim.player.maxHp;
    const devotionBefore = sim.player.paladinDevotion?.value ?? 0;
    const wolfHpBefore = wolf.hp;
    arm(sim);

    hit(sim, wolf, 90);

    // The whole 90 was under the cap, so none of it reached the paladin...
    expect(sim.player.hp).toBe(sim.player.maxHp);
    // ...and the same 90 went back to the wolf.
    expect(wolfHpBefore - wolf.hp).toBe(90);
    expect(sim.player.paladinDevotion?.value).toBe(devotionBefore + 1);
    expect(sim.player.auras.some((a) => a.kind === DEBT_OF_LIGHT_KIND)).toBe(false);
  });

  it('caps what it denies, so an oversized blow still lands the remainder', () => {
    const sim = makeRetribution();
    const wolf = attacker(sim);
    sim.player.hp = sim.player.maxHp;
    const wolfHpBefore = wolf.hp;
    arm(sim);

    hit(sim, wolf, 200);

    expect(sim.player.maxHp - sim.player.hp).toBe(200 - CAP);
    // Returns what it SOAKED (the cap), never the raw 200.
    expect(wolfHpBefore - wolf.hp).toBe(CAP);
  });

  it('answers one blow only: the second lands in full and returns nothing', () => {
    const sim = makeRetribution();
    const wolf = attacker(sim);
    sim.player.hp = sim.player.maxHp;
    arm(sim);

    hit(sim, wolf, 50);
    const hpAfterFirst = sim.player.hp;
    const wolfAfterFirst = wolf.hp;
    const devotionAfterFirst = sim.player.paladinDevotion?.value ?? 0;

    hit(sim, wolf, 50);

    expect(hpAfterFirst - sim.player.hp).toBe(50);
    expect(wolf.hp).toBe(wolfAfterFirst);
    expect(sim.player.paladinDevotion?.value).toBe(devotionAfterFirst);
  });

  it('does not spend the charge on damage with no attacker to answer', () => {
    const sim = makeRetribution();
    sim.player.hp = sim.player.maxHp;
    arm(sim);

    (sim as unknown as { ctx: { dealDamage(...args: unknown[]): void } }).ctx.dealDamage(
      null,
      sim.player,
      40,
      false,
      'physical',
      'Falling',
      'hit',
    );

    expect(sim.player.maxHp - sim.player.hp).toBe(40);
    expect(sim.player.auras.some((a) => a.kind === DEBT_OF_LIGHT_KIND)).toBe(true);
  });
});
