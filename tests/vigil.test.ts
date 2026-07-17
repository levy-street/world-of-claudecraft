import { describe, expect, it } from 'vitest';
import { onCastCompleted, onMeleeSwing } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function vigilSim(spec: 'holy' | 'protection' | 'retribution' = 'protection', seed = 178_421): Sim {
  const sim = new Sim({ seed, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  sim.player.spellPower = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_841, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
  });
  target.hostile = true;
  target.stats = { ...target.stats, armor: 0 };
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  sim.targetEntity(target.id);
  sim.player.facing = 0;
  return target;
}

function activateBurningOath(sim: Sim): void {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('righteous_fury');
  sim.player.gcdRemaining = 0;
  expect(sim.player.auras.some((aura) => aura.kind === 'righteous_fury')).toBe(true);
}

function oathward(sim: Sim) {
  return sim.player.auras.find((aura) => aura.id === 'pal_oathward');
}

function oathwardGuard(sim: Sim) {
  return sim.player.auras.find((aura) => aura.id === 'pal_oathward_guard');
}

describe('Vigil Oathward', () => {
  it('authors a valid mana-driven active-mitigation and threat loop', () => {
    const protection = TALENTS.paladin.specs.find((spec) => spec.id === 'protection');

    expect(validateTalentTree(TALENTS.paladin)).toEqual([]);
    expect(protection?.signature).toBe('holy_shield');
    expect(protection?.mastery.name).toBe('Oathward');
    expect(protection?.mastery.description).toContain('Burning Oath');
    expect(protection?.mastery.description).toContain('Hallowed Wall');
    expect(protection?.mastery.effect).toEqual({
      global: { threatPct: 0.5 },
      stats: { armorPct: 0.2 },
      procs: [
        {
          id: 'pal_oathward_guard',
          name: 'Oathward',
          spec: 'protection',
          requiresKnownAbility: 'holy_shield',
          school: 'holy',
          trigger: { on: 'castNth', n: 1, abilities: ['holy_shield'] },
          responses: [
            { kind: 'absorb', amount: 90, duration: 6, name: 'Oathward', applyTo: 'self' },
          ],
        },
        {
          id: 'pal_oathward',
          name: 'Oathward',
          spec: 'protection',
          requiresKnownAbility: 'holy_shield',
          school: 'holy',
          trigger: { on: 'meleeSwingWhile', auraKind: 'righteous_fury', n: 3 },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_free',
              abilities: ['holy_shield'],
              duration: 10,
            },
          ],
        },
      ],
    });
    expect(vigilSim().player.resourceType).toBe('mana');
  });

  it('banks one free Hallowed Wall on every third landed Burning Oath swing without RNG', () => {
    const run = () => {
      const sim = vigilSim('protection', 178_422);
      activateBurningOath(sim);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
      onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
      const beforeThird = oathward(sim);
      onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
      sim.ctx.rng.setObserver(null);
      const window = oathward(sim);
      return {
        draws,
        beforeThird: beforeThird ?? null,
        window: window
          ? [window.kind, window.remaining, window.duration, window.empowerAbilities]
          : null,
      };
    };

    expect(run()).toEqual({
      draws: [],
      beforeThird: null,
      window: ['next_cast_free', 10, 10, ['holy_shield']],
    });
    expect(run()).toEqual(run());
  });

  it('spends the free Wall into a short ward while the Wall keeps creating Holy threat', () => {
    const sim = vigilSim();
    const target = targetFor(sim);
    activateBurningOath(sim);
    onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    const hpBeforeWall = target.hp;

    sim.castAbility('holy_shield');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.cooldowns.get('holy_shield')).toBe(8);
    expect(oathward(sim)).toBeUndefined();
    expect(oathwardGuard(sim)).toMatchObject({
      name: 'Oathward',
      kind: 'absorb',
      remaining: 6,
      duration: 6,
      value: 90,
      sourceId: sim.player.id,
      school: 'holy',
    });

    for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
      advancePendingProjectiles(sim.ctx);
    }

    expect(target.hp).toBeLessThan(hpBeforeWall);
    expect(target.threat.get(sim.player.id) ?? 0).toBeGreaterThan(0);

    const hpBeforeHit = sim.player.hp;
    (
      sim as unknown as {
        dealDamage(
          source: Entity | null,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string | null,
          kind: 'hit' | 'miss' | 'dodge',
        ): void;
      }
    ).dealDamage(target, sim.player, 60, false, 'physical', 'test', 'hit');

    expect(sim.player.hp).toBe(hpBeforeHit);
    expect(oathwardGuard(sim)?.value).toBe(30);
  });

  it('requires Vigil, a known Hallowed Wall, Burning Oath, and a landed production swing', () => {
    const withoutSignature = vigilSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Paladin metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'holy_shield');

    for (const sim of [vigilSim('holy'), vigilSim('retribution'), withoutSignature]) {
      activateBurningOath(sim);
      for (let hit = 0; hit < 3; hit++) onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
      expect(oathward(sim)).toBeUndefined();
    }

    const withoutOath = vigilSim();
    for (let hit = 0; hit < 3; hit++)
      onMeleeSwing(withoutOath.ctx, withoutOath.player, 'auto_attack');
    expect(oathward(withoutOath)).toBeUndefined();

    const missed = vigilSim();
    const target = targetFor(missed);
    activateBurningOath(missed);
    const rng = missed.ctx.rng as typeof missed.ctx.rng & { next(): number };
    rng.next = () => 0;
    expect(
      missed.ctx.meleeSwing(missed.player, target, 0, null, { abilityId: 'auto_attack' }),
    ).toBe(false);
    expect(oathward(missed)).toBeUndefined();

    rng.next = () => 0.99;
    expect(
      missed.ctx.meleeSwing(missed.player, target, 0, null, { abilityId: 'auto_attack' }),
    ).toBe(true);
    expect(
      missed.ctx.meleeSwing(missed.player, target, 0, null, { abilityId: 'auto_attack' }),
    ).toBe(true);
    expect(oathward(missed)).toBeUndefined();
    expect(
      missed.ctx.meleeSwing(missed.player, target, 0, null, { abilityId: 'auto_attack' }),
    ).toBe(true);
    expect(oathward(missed)).toBeDefined();
  });

  it('clears the Vigil-only free Wall and ward when leaving the spec', () => {
    const sim = vigilSim();
    activateBurningOath(sim);
    for (let hit = 0; hit < 3; hit++) onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    onCastCompleted(sim.ctx, sim.player, 'holy_shield', sim.player);
    expect(oathward(sim)).toBeDefined();
    expect(oathwardGuard(sim)).toBeDefined();

    expect(sim.applyTalents({ spec: 'holy', rows: {} })).toBe(true);

    expect(oathward(sim)).toBeUndefined();
    expect(oathwardGuard(sim)).toBeUndefined();
  });
});
