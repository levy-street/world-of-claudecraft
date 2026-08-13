import { describe, expect, it, vi } from 'vitest';
import { hunterPetFerocityDamageMultiplier } from '../src/sim/combat/hunter_shared';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
};

function hunter(spec: string, seed: number): TestSim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function addMob(sim: TestSim, distance: number, hostile = true): Entity {
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.hostile = hostile;
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

function addPet(sim: TestSim): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + 1,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  pet.maxHp = 1_000;
  pet.hp = pet.maxHp;
  sim.addEntity(pet);
  return pet;
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < seconds * 20; tick++) events.push(...sim.tick());
  return events;
}

function ready(sim: Sim, abilityId: string): void {
  sim.player.gcdRemaining = 0;
  sim.player.cooldowns.delete(abilityId);
}

describe('Hunter v0.29 baseline specialization loops', () => {
  it('uses a 100 Focus pool with 5 Focus per second passive regeneration', () => {
    const sim = hunter('marksmanship', 2910);
    expect(sim.player.resourceType).toBe('focus');
    expect(sim.player.maxResource).toBe(100);
    sim.player.resource = 0;
    advance(sim, 2);
    expect(sim.player.resource).toBe(10);
  });

  it('Pack Command awards state only from a living pet hit and transforms at three stages', () => {
    const sim = hunter('beast_mastery', 2911);
    const target = addMob(sim, 3);
    addPet(sim);
    sim.targetEntity(target.id);
    sim.player.resource = 0;

    for (let stage = 1; stage <= 3; stage++) {
      ready(sim, 'pack_command');
      sim.castAbility('pack_command');
      advance(sim, 0.1);
      expect(sim.player.resource).toBe(stage * 20);
      expect(sim.player.auras.find((aura) => aura.id === 'pack_ferocity')?.stacks).toBe(stage);
    }
    expect(sim.resolvedAbility('pack_command')?.def.id).toBe('unleash_beast');
  });

  it('adds 10% pet damage per Ferocity stage and resolves Pack Command before its new stage', () => {
    function commandDamage(stacks: number): number {
      const sim = hunter('beast_mastery', 2914);
      const target = addMob(sim, 3);
      target.stats.armor = 0;
      const pet = addPet(sim);
      sim.targetEntity(target.id);
      if (stacks > 0) {
        sim.player.auras.push({
          id: 'pack_ferocity',
          name: 'Pack Ferocity',
          kind: 'hunter_ferocity',
          remaining: 30,
          duration: 30,
          value: stacks,
          stacks,
          sourceId: sim.playerId,
          school: 'physical',
        });
      }
      expect(hunterPetFerocityDamageMultiplier(sim.ctx, pet)).toBeCloseTo(1 + stacks * 0.1);
      sim.castAbility('pack_command');
      const event = advance(sim, 0.1).find(
        (candidate) => candidate.type === 'damage' && candidate.ability === 'Pack Command',
      );
      if (!event || event.type !== 'damage') throw new Error('missing Pack Command damage');
      return event.amount;
    }

    const calmDamage = commandDamage(0);
    const twoStageDamage = commandDamage(2);
    expect(twoStageDamage / calmDamage).toBeGreaterThan(1.15);
    expect(twoStageDamage / calmDamage).toBeLessThan(1.25);
  });

  it('grants no Focus or Ferocity when Pack Command cannot land', () => {
    for (const failure of ['missing-pet', 'dead-pet', 'missing-target', 'miss'] as const) {
      const sim = hunter('beast_mastery', 2915);
      const target = addMob(sim, 3);
      const pet = failure === 'missing-pet' ? null : addPet(sim);
      if (pet && failure === 'dead-pet') pet.dead = true;
      if (failure !== 'missing-target') sim.targetEntity(target.id);
      if (failure === 'miss') vi.spyOn(sim.ctx.rng, 'chance').mockReturnValueOnce(true);
      sim.player.resource = 0;

      sim.castAbility('pack_command');
      advance(sim, 0.1);

      expect(sim.player.resource, failure).toBe(0);
      expect(
        sim.player.auras.some((aura) => aura.id === 'pack_ferocity'),
        failure,
      ).toBe(false);
    }
  });

  it('Measured Shot grants Focus only when the shot completes, while Cold Focus accelerates it', () => {
    const sim = hunter('marksmanship', 2912);
    const target = addMob(sim, 20);
    sim.targetEntity(target.id);
    sim.player.resource = 0;

    sim.castAbility('measured_shot');
    advance(sim, 0.5);
    expect(sim.player.resource).toBe(0);
    advance(sim, 2);
    // The completed shot contributes 20, alongside one 2 sec passive regen tick.
    expect(sim.player.resource).toBe(30);

    ready(sim, 'cold_focus');
    sim.castAbility('cold_focus');
    advance(sim, 0.1);
    expect(sim.resolvedAbility('measured_shot')?.effects).toContainEqual({
      type: 'gainResource',
      amount: 30,
    });
    expect(sim.resolvedAbility('aimed_shot')?.castTime).toBeLessThan(2.5);
  });

  it('Fieldcraft opens a single wound, builds Momentum, and tears it with Woundrend', () => {
    const sim = hunter('survival', 2913);
    const target = addMob(sim, 12);
    sim.targetEntity(target.id);
    sim.player.resource = 0;
    const expectedBloodhookTick = Math.max(
      1,
      // 1.3 = the survival baseline meleeDmgPct (0.06 to 0.3 in the 2026-08-09
      // 120s band round; the rest of the raise rides the baseline agiPct).
      Math.round(((34 + sim.player.rangedPower * 0.26) * 1.3) / 4),
    );

    sim.castAbility('bloodhook');
    advance(sim, 2);
    expect(target.auras.filter((aura) => aura.id === 'bloodhook_bleed')).toHaveLength(1);
    expect(target.auras.find((aura) => aura.id === 'bloodhook_bleed')?.value).toBe(
      expectedBloodhookTick,
    );

    sim.player.pos.z = target.pos.z - 2;
    for (let stack = 1; stack <= 3; stack++) {
      ready(sim, 'raptor_strike');
      sim.castAbility('raptor_strike');
      advance(sim, 0.1);
      expect(sim.player.auras.find((aura) => aura.id === 'hunting_momentum')?.stacks).toBe(stack);
    }
    expect(sim.player.resource).toBeGreaterThanOrEqual(45);

    const wound = target.auras.find((aura) => aura.id === 'bloodhook_bleed');
    if (!wound) throw new Error('missing Fieldcraft wound');
    wound.remaining = 2;
    const before = target.hp;
    ready(sim, 'mongoose_bite');
    sim.castAbility('mongoose_bite');
    advance(sim, 0.1);
    expect(target.hp).toBeLessThan(before);
    expect(target.auras.filter((aura) => aura.id === 'bloodhook_bleed')).toHaveLength(1);
    expect(target.auras.find((aura) => aura.id === 'bloodhook_bleed')?.remaining).toBeGreaterThan(
      10,
    );
    expect(sim.player.auras.some((aura) => aura.id === 'hunting_momentum')).toBe(false);
  });
});
