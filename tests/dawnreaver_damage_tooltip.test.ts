import { describe, expect, it } from 'vitest';
import { grantDawnsWrath } from '../src/sim/combat/paladin_dawns_wrath';
import {
  advanceSunGodVerdict,
  applySunGodVerdict,
  sunVerdictMarkForHit,
} from '../src/sim/combat/paladin_sun_verdict';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion, MAX_DEVOTION } from '../src/sim/paladin_devotion';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { abilityScalingOf } from '../src/ui/ability_damage';
import {
  abilityDisplayDescription,
  abilityEffectText,
  formatAbilityNumber,
} from '../src/ui/ability_description';
import {
  dawnreaverTooltipValues,
  primaryDamageTooltipRange,
} from '../src/ui/dawnreaver_damage_tooltip_core';

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing required test value');
  return value;
}

function setup(power: number, maximum: boolean, ascended = false, level = 20) {
  const sim = new Sim({ seed: 99181, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(level);
  sim.setSpec('retribution');
  if (ascended) {
    grantDevotion(sim.player, MAX_DEVOTION);
    expect(activateDivineAscension(sim.player)).toBe(true);
  }
  sim.player.attackPower = power;
  sim.player.spellPower = power;
  sim.player.weapon = { ...sim.player.weapon, min: 80, max: 100, speed: 2 };
  sim.player.resource = sim.player.maxResource;
  sim.rng.range = (min, max) => (maximum ? max : min);
  sim.rng.next = () => 0.99;
  sim.rng.chance = () => false;
  const target = createMob(99712, MOBS.forest_wolf, 20, {
    ...sim.player.pos,
    z: sim.player.pos.z + 2,
  });
  target.maxHp = target.hp = 1_000_000;
  target.stats.armor = 0;
  target.hostile = true;
  target.swingTimer = 999;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
  return { sim, target };
}

function resolve(sim: Sim, id: string): ResolvedAbility {
  const res = sim.resolvedAbility(id);
  if (!res) throw new Error(`Missing ${id}`);
  return res;
}

function text(res: ResolvedAbility, sim: Sim) {
  const power = abilityScalingOf(sim.player);
  return abilityDisplayDescription(res, abilityEffectText(res, power), power);
}

describe('Dawnreaver resolved damage tooltip accuracy', () => {
  for (const power of [70, 210]) {
    for (const maximum of [false, true]) {
      for (const ascended of [false, true]) {
        it.each(['dawnfall', 'hammer_of_wrath'])(
          `%s matches the combat ${maximum ? 'maximum' : 'minimum'} at power ${power}, Ascension ${ascended}`,
          (id) => {
            const { sim, target } = setup(power, maximum, ascended);
            if (id === 'hammer_of_wrath') grantDawnsWrath(sim.ctx, sim.player);
            const res = resolve(sim, id);
            const effect = res.effects[0];
            const range = primaryDamageTooltipRange(res, effect, abilityScalingOf(sim.player));
            expect(range).not.toBeNull();
            const expected = maximum ? required(range).max : required(range).min;
            const before = target.hp;
            sim.ctx.runEffects(
              sim.player,
              required(sim.ctx.players.get(sim.player.id)),
              target,
              res,
            );
            expect(before - target.hp).toBe(expected);
            expect(text(res, sim)).toContain(formatAbilityNumber(expected));
          },
        );

        it(`Final Edict weapon and Ascension explosion match combat at power ${power}, maximum ${maximum}, Ascension ${ascended}`, () => {
          const { sim, target } = setup(power, maximum, ascended);
          const res = resolve(sim, 'final_edict');
          const values = dawnreaverTooltipValues(res, abilityScalingOf(sim.player));
          const flat = Number(abilityEffectText(res, abilityScalingOf(sim.player)));
          const weaponRoll = maximum ? sim.player.weapon.max : sim.player.weapon.min;
          const strike = Math.round(
            ((weaponRoll + (power / 14) * sim.player.weapon.speed) *
              required(values.weaponPercent)) /
              100 +
              flat,
          );
          const explosion = values.explosion
            ? maximum
              ? values.explosion.max
              : values.explosion.min
            : 0;
          const before = target.hp;
          sim.ctx.runEffects(sim.player, required(sim.ctx.players.get(sim.player.id)), target, res);
          expect(before - target.hp).toBe(strike + explosion);
          expect(text(res, sim)).toContain(
            `${formatAbilityNumber(required(values.weaponPercent))}% weapon damage`,
          );
          if (ascended) expect(text(res, sim)).toContain(formatAbilityNumber(explosion));
          expect(text(res, sim)).not.toMatch(/\{\w+\}|\$d/);
        });
      }

      it.each(['final_edict', 'dawnfall'])(
        `Verdict triggered by %s matches combat at power ${power}, maximum ${maximum}`,
        (trigger) => {
          const { sim, target } = setup(power, maximum);
          const res = resolve(sim, 'sun_gods_verdict');
          const effect = res.effects.find((item) => item.type === 'sunGodVerdict');
          if (!effect) throw new Error('Missing Verdict effect');
          applySunGodVerdict(sim.ctx, sim.player, target, effect, res.def.name);
          const mark = required(sunVerdictMarkForHit(target, sim.player.id));
          mark.value = effect.charges - 1;
          const before = target.hp;
          advanceSunGodVerdict(sim.ctx, sim.player, target, trigger, mark, effect, res.def.name);
          const values = required(dawnreaverTooltipValues(res).verdict);
          const range =
            trigger === 'final_edict'
              ? [values.singleMin, values.singleMax]
              : [values.areaMin, values.areaMax];
          expect(before - target.hp).toBe(range[maximum ? 1 : 0]);
          expect(text(res, sim)).toContain(
            `${formatAbilityNumber(range[0])} to ${formatAbilityNumber(range[1])}`,
          );
          expect(text(res, sim)).not.toMatch(/\{\w+\}/);
        },
      );
    }
  }

  it('preserves the existing tooltip presentation when primaryDamage is absent', () => {
    const { sim } = setup(70, false);
    const res = resolve(sim, 'hammer_of_wrath');
    const scaling = abilityScalingOf(sim.player);
    const absent = {
      ...res,
      outputScaling: { ...required(res.outputScaling), primaryDamage: undefined },
    };
    const neutral = { ...res, outputScaling: { ...required(res.outputScaling), primaryDamage: 1 } };
    expect(abilityEffectText(absent, scaling)).toBe(abilityEffectText(neutral, scaling));
    expect(abilityEffectText(absent, scaling)).not.toBe(abilityEffectText(res, scaling));
  });

  it.each([2, 3.6])('rank-one Final Edict matches the tooltip with a %s-second weapon', (speed) => {
    const { sim, target } = setup(70, false, false, 8);
    sim.player.weapon.speed = speed;
    const res = resolve(sim, 'final_edict');
    expect(res.rank).toBe(1);
    const values = dawnreaverTooltipValues(res, abilityScalingOf(sim.player));
    const flat = Number(abilityEffectText(res, abilityScalingOf(sim.player)));
    const expected = Math.round(
      ((sim.player.weapon.min + (sim.player.attackPower / 14) * speed) *
        required(values.weaponPercent)) /
        100 +
        flat,
    );
    const before = target.hp;
    sim.ctx.runEffects(sim.player, required(sim.ctx.players.get(sim.player.id)), target, res);
    expect(before - target.hp).toBe(expected);
    expect(text(res, sim)).toContain(`${formatAbilityNumber(flat)} Physical damage`);
  });

  it('Ascension explosion scales with Attack Power independently of Spell Power', () => {
    const observations = [
      [70, 0],
      [70, 400],
      [210, 0],
    ].map(([attackPower, spellPower]) => {
      const { sim, target } = setup(attackPower, false, true);
      sim.player.spellPower = spellPower;
      const res = resolve(sim, 'final_edict');
      const explosion = required(res.effects.find((effect) => effect.type === 'aoeDamage'));
      expect(text(res, sim)).toContain('Physical damage');
      expect(text(res, sim)).not.toContain('Holy damage');
      const expected = required(
        dawnreaverTooltipValues(res, abilityScalingOf(sim.player)).explosion,
      ).min;
      const before = target.hp;
      sim.ctx.runEffects(sim.player, required(sim.ctx.players.get(sim.player.id)), target, {
        ...res,
        effects: [explosion],
      });
      expect(before - target.hp).toBe(expected);
      return expected;
    });
    expect(observations[1]).toBe(observations[0]);
    expect(observations[2]).toBeGreaterThan(observations[0]);
  });
});
