import { describe, expect, it } from 'vitest';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { onMeleeSwing } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function warspiritSim(): Sim {
  const sim = new Sim({ seed: 170726, playerClass: 'shaman', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'enhancement', rows: {} })).toBe(true);
  sim.player.spellPower = 0;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_001, MOBS.forest_wolf, 20, {
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
  return target;
}

function fixedDamageRng(sim: Sim): void {
  const rng = sim.ctx.rng as typeof sim.ctx.rng & {
    range(min: number, max: number): number;
    chance(probability: number): boolean;
  };
  rng.range = (min) => min;
  rng.chance = (probability) => probability > 0.5;
}

function buildSkyrend(sim: Sim, count: number): void {
  for (let index = 0; index < count; index++) {
    onMeleeSwing(sim.ctx, sim.player, index % 2 === 0 ? 'auto_attack' : 'stormstrike');
  }
}

function castAndLandArcBolt(
  sim: Sim,
  target: Entity,
  expireBankAfterCastStarts = false,
): { castTime: number; damage: number; remainingStacks: number } {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  // Applying the visible stack aura recalculates derived stats. Hold Spell Power at
  // zero here so these assertions isolate only Skyrend's authored multiplier.
  sim.player.spellPower = 0;
  fixedDamageRng(sim);
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
  sim.player.resource = sim.player.maxResource;
  sim.player.gcdRemaining = 0;
  const before = target.hp;

  sim.castAbility('lightning_bolt');
  const castTime = sim.player.castTotal;
  if (expireBankAfterCastStarts) {
    sim.player.auras = sim.player.auras.filter((aura) => aura.id !== 'sha_skyrend');
  }
  for (let tick = 0; tick < 200 && sim.player.castingAbility; tick++) {
    updateCasting(sim.ctx, sim.player, meta);
  }
  for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
    advancePendingProjectiles(sim.ctx);
  }

  return {
    castTime,
    damage: before - target.hp,
    remainingStacks: sim.player.auras.find((aura) => aura.id === 'sha_skyrend')?.stacks ?? 0,
  };
}

describe('Warspirit Skyrend', () => {
  it('authors a valid Enhancement mastery with the complete melee-to-cast loop', () => {
    const spec = TALENTS.shaman.specs.find((candidate) => candidate.id === 'enhancement');

    expect(validateTalentTree(TALENTS.shaman)).toEqual([]);
    expect(spec?.mastery.name).toBe('Skyrend');
    expect(spec?.mastery.description).toContain('landed melee auto-attack');
    expect(spec?.mastery.description).toContain('Ancestral Strike');
    expect(spec?.mastery.description).toContain('up to 5');
    expect(spec?.mastery.description).toContain('20%');
    expect(spec?.mastery.effect.proc).toMatchObject({
      id: 'sha_skyrend',
      trigger: { on: 'meleeHit', abilities: ['auto_attack', 'stormstrike'] },
      responses: [{ kind: 'stackAura', aura: 'stormcharge', maxStacks: 5 }],
    });
  });

  it('builds only from landed auto-attacks and Ancestral Strike, caps at five, and draws no RNG', () => {
    const sequence = (): { stacks: number; draws: number } => {
      const sim = warspiritSim();
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      onMeleeSwing(sim.ctx, sim.player, 'crusader_strike');
      buildSkyrend(sim, 7);
      sim.ctx.rng.setObserver(null);

      return {
        stacks: sim.player.auras.find((aura) => aura.id === 'sha_skyrend')?.stacks ?? 0,
        draws,
      };
    };

    expect(sequence()).toEqual({ stacks: 5, draws: 0 });
    expect(sequence()).toEqual(sequence());
  });

  it('carries stable auto and Ancestral Strike ids through the landed melee shell', () => {
    const sim = warspiritSim();
    const target = targetFor(sim);
    const meta = sim.meta(sim.playerId);
    const ancestralStrike = sim.resolvedAbility('stormstrike');
    if (!meta || !ancestralStrike) throw new Error('missing Warspirit combat data');
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      next(): number;
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    rng.next = () => 0.9;
    rng.range = (min) => min;
    rng.chance = () => false;

    expect(sim.ctx.meleeSwing(sim.player, target, 0, null, {})).toBe(true);
    sim.ctx.runEffects(sim.player, meta, target, ancestralStrike);

    expect(sim.player.auras.find((aura) => aura.id === 'sha_skyrend')?.stacks).toBe(2);
  });

  it('does not build or roll from production-path misses and dodges', () => {
    const sim = warspiritSim();
    const missTarget = targetFor(sim);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      next(): number;
      chance(probability: number): boolean;
    };
    let chanceCalls = 0;
    rng.chance = () => {
      chanceCalls++;
      return true;
    };

    rng.next = () => 0;
    expect(sim.ctx.meleeSwing(sim.player, missTarget, 0, null, { abilityId: 'auto_attack' })).toBe(
      false,
    );

    const dodgerId = sim.addPlayer('rogue', 'Skyrend Dodger');
    sim.setPlayerLevel(1, dodgerId);
    const dodgeTarget = sim.entities.get(dodgerId);
    if (!dodgeTarget) throw new Error('missing dodge target');
    dodgeTarget.dodgeChance = 1;
    rng.next = () => 0.5;
    expect(sim.ctx.meleeSwing(sim.player, dodgeTarget, 0, null, { abilityId: 'auto_attack' })).toBe(
      false,
    );

    expect(chanceCalls).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'sha_skyrend')).toBe(false);
  });

  it('shortens Arc Bolt by 20% per stack, becomes instant at five, boosts damage, and clears', () => {
    const baseline = warspiritSim();
    const baselineResult = castAndLandArcBolt(baseline, targetFor(baseline));

    const partial = warspiritSim();
    buildSkyrend(partial, 2);
    const partialResult = castAndLandArcBolt(partial, targetFor(partial));

    const capped = warspiritSim();
    buildSkyrend(capped, 5);
    const cappedResult = castAndLandArcBolt(capped, targetFor(capped));

    expect(partialResult.castTime).toBeCloseTo(baselineResult.castTime * 0.6, 5);
    expect(cappedResult.castTime).toBe(0);
    expect(partialResult.damage).toBe(Math.round(baselineResult.damage * 1.2));
    expect(cappedResult.damage).toBe(Math.round(baselineResult.damage * 1.5));
    expect(partialResult.remainingStacks).toBe(0);
    expect(cappedResult.remainingStacks).toBe(0);
  });

  it('snapshots the same Skyrend bank for cast time and damage if the aura expires mid-cast', () => {
    const baseline = warspiritSim();
    const baselineResult = castAndLandArcBolt(baseline, targetFor(baseline));
    const sim = warspiritSim();
    buildSkyrend(sim, 2);

    const result = castAndLandArcBolt(sim, targetFor(sim), true);

    expect(result.castTime).toBeCloseTo(baselineResult.castTime * 0.6, 5);
    expect(result.damage).toBe(Math.round(baselineResult.damage * 1.2));
    expect(result.remainingStacks).toBe(0);
  });

  it('does not grant Skyrend to the other Shaman specializations', () => {
    for (const spec of ['elemental', 'restoration'] as const) {
      const sim = new Sim({ seed: 170726, playerClass: 'shaman', autoEquip: false });
      sim.setPlayerLevel(20);
      expect(sim.applyTalents({ spec, rows: {} })).toBe(true);

      onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
      onMeleeSwing(sim.ctx, sim.player, 'stormstrike');

      expect(sim.player.auras.some((aura) => aura.id === 'sha_skyrend')).toBe(false);
    }
  });

  it('clears the spec-owned stack bank when Warspirit is left', () => {
    const sim = warspiritSim();
    buildSkyrend(sim, 3);
    expect(sim.player.auras.find((aura) => aura.id === 'sha_skyrend')?.stacks).toBe(3);

    expect(sim.applyTalents({ spec: 'elemental', rows: {} })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id === 'sha_skyrend')).toBe(false);
  });

  it('localizes the visible Skyrend stack name in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Skyrend', language)).not.toBe('Skyrend');
    }
  });
});
