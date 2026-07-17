import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { onMeleeSwing } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function druidSim(spec: 'balance' | 'feral' | 'restoration' = 'feral', seed = 178_201): Sim {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.maxHp = 1_000;
  sim.player.hp = 1_000;
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetFor(sim: Sim, id = 97_821): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
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

function enterForm(sim: Sim, abilityId: 'bear_form' | 'cat_form'): void {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(abilityId);
  sim.player.gcdRemaining = 0;
}

describe('Wildfang Primal Heart', () => {
  it('authors a valid threat bank and Bruin-only mitigation conversion', () => {
    const feral = TALENTS.druid.specs.find((spec) => spec.id === 'feral');

    expect(validateTalentTree(TALENTS.druid)).toEqual([]);
    expect(feral?.signature).toBe('feral_charge');
    expect(feral?.mastery.name).toBe('Primal Heart');
    expect(feral?.mastery.description).toContain('landed Bonecrush');
    expect(feral?.mastery.description).toContain('consume that bleed');
    expect(feral?.mastery.effect.procs).toHaveLength(2);
    for (const proc of feral?.mastery.effect.procs ?? []) {
      expect(proc.spec).toBe('feral');
      expect(proc.requiresKnownAbility).toBe('feral_charge');
    }
  });

  it('banks a landed Bonecrush into one rolling bleed and advances Primal Surge', () => {
    const sim = druidSim();
    const target = targetFor(sim);
    sim.player.cooldowns.set('feral_charge', 60);

    onMeleeSwing(sim.ctx, sim.player, 'maul', undefined, target, 120);

    expect(sim.player.cooldowns.get('feral_charge')).toBe(48);
    expect(target.auras.find((aura) => aura.id === 'dru_primal_heart_bleed')).toMatchObject({
      name: 'Primal Heart',
      kind: 'dot',
      remaining: 6,
      duration: 6,
      value: 10,
      tickInterval: 2,
      tickTimer: 2,
      sourceId: sim.player.id,
      school: 'physical',
    });

    onMeleeSwing(sim.ctx, sim.player, 'maul', undefined, target, 120);
    expect(target.auras.filter((aura) => aura.id === 'dru_primal_heart_bleed')).toHaveLength(1);
    expect(target.auras.find((aura) => aura.id === 'dru_primal_heart_bleed')?.value).toBe(20);
  });

  it('converts the owned bleed into a capped guard while retaining the 50 Rage burst', () => {
    const sim = druidSim();
    const target = targetFor(sim);
    enterForm(sim, 'bear_form');
    const guardCap = Math.round(sim.player.maxHp * 0.2);
    onMeleeSwing(sim.ctx, sim.player, 'maul', undefined, target, 300);
    sim.player.resource = 0;

    sim.castAbility('feral_charge');

    expect(sim.player.resource).toBe(50);
    expect(target.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(false);
    expect(sim.player.auras.find((aura) => aura.id === 'dru_primal_heart_guard')).toMatchObject({
      name: 'Primal Heart',
      kind: 'absorb',
      remaining: 6,
      duration: 6,
      value: guardCap,
      sourceId: sim.player.id,
      school: 'physical',
    });
  });

  it('preserves foreign bleeds and the Wolf-form Energy surge', () => {
    const sim = druidSim();
    const target = targetFor(sim);
    target.auras.push({
      id: 'dru_primal_heart_bleed',
      name: 'Primal Heart',
      kind: 'dot',
      remaining: 6,
      duration: 6,
      value: 10,
      tickInterval: 2,
      tickTimer: 2,
      sourceId: 999,
      school: 'physical',
    });
    enterForm(sim, 'cat_form');
    sim.player.resource = 0;

    sim.castAbility('feral_charge');

    expect(target.auras.some((aura) => aura.sourceId === 999)).toBe(true);
    expect(sim.player.auras.some((aura) => aura.id === 'dru_primal_heart_guard')).toBe(false);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'feral_instinct_energy', kind: 'buff_energyregen', value: 1 }),
    );
  });

  it('does not bank from a miss or a fully absorbed production-path hit', () => {
    for (const absorbed of [false, true]) {
      const sim = druidSim();
      const target = targetFor(sim, absorbed ? 97_823 : 97_822);
      sim.player.cooldowns.set('feral_charge', 60);
      if (absorbed) {
        target.auras.push({
          id: 'test_absorb',
          name: 'Test Absorb',
          kind: 'absorb',
          remaining: 10,
          duration: 10,
          value: 100_000,
          sourceId: target.id,
          school: 'physical',
        });
      }
      const rng = sim.ctx.rng as typeof sim.ctx.rng & { next(): number };
      rng.next = () => (absorbed ? 0.99 : 0);

      meleeSwing(sim.ctx, sim.player, target, 0, 'Bonecrush', { abilityId: 'maul' });

      expect(target.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(false);
      expect(sim.player.cooldowns.get('feral_charge')).toBe(60);
    }
  });

  it('requires Wildfang, known Primal Surge, positive damage, and Bonecrush', () => {
    const withoutSignature = druidSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Druid metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'feral_charge');

    for (const sim of [druidSim('balance'), druidSim('restoration'), withoutSignature]) {
      const target = targetFor(sim);
      onMeleeSwing(sim.ctx, sim.player, 'maul', undefined, target, 120);
      expect(target.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(false);
    }

    const wrongAttack = druidSim();
    const wrongTarget = targetFor(wrongAttack);
    onMeleeSwing(wrongAttack.ctx, wrongAttack.player, 'swipe', undefined, wrongTarget, 120);
    onMeleeSwing(wrongAttack.ctx, wrongAttack.player, 'maul', undefined, wrongTarget, 0);
    expect(wrongTarget.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(false);
  });

  it('clears the owned threat bank and guard when Wildfang is left', () => {
    const sim = druidSim();
    const target = targetFor(sim);
    enterForm(sim, 'bear_form');
    onMeleeSwing(sim.ctx, sim.player, 'maul', undefined, target, 120);
    sim.player.resource = 0;
    sim.castAbility('feral_charge');
    onMeleeSwing(sim.ctx, sim.player, 'maul', undefined, target, 120);
    expect(target.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(true);
    expect(sim.player.auras.some((aura) => aura.id === 'dru_primal_heart_guard')).toBe(true);

    expect(sim.applyTalents({ spec: 'balance', rows: {} })).toBe(true);

    expect(target.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === 'dru_primal_heart_guard')).toBe(false);
  });

  it('adds no proc draws and replays the threat-to-guard conversion exactly', () => {
    const run = () => {
      const sim = druidSim('feral', 178_202);
      const target = targetFor(sim);
      enterForm(sim, 'bear_form');
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onMeleeSwing(sim.ctx, sim.player, 'maul', undefined, target, 120);
      sim.player.resource = 0;
      sim.castAbility('feral_charge');
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        rage: sim.player.resource,
        guard: sim.player.auras.find((aura) => aura.id === 'dru_primal_heart_guard')?.value ?? 0,
      };
    };

    expect(run()).toEqual({ draws: [], rage: 50, guard: 120 });
    expect(run()).toEqual(run());
  });

  it('localizes Primal Heart in every required non-Latin locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Primal Heart', language)).not.toBe('Primal Heart');
    }
  });
});
