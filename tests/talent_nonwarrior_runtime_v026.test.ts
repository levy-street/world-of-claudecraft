import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { onCastCompleted, onMeleeSwing } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function harness(sim: Sim): TestSim {
  return sim as TestSim;
}

function simWithRows(cls: PlayerClass, rows: Record<number, string>): TestSim {
  const sim = harness(new Sim({ seed: 1756, playerClass: cls, autoEquip: false }));
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows })).toBe(true);
  return sim;
}

function addTarget(sim: TestSim, distance = 3, hostile = true): Entity {
  const player = sim.player;
  const target = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  target.hostile = hostile;
  target.moveSpeed = 0;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.addEntity(target);
  player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
  sim.targetEntity(target.id);
  return target;
}

function resolved(sim: Sim, abilityId: string): ResolvedAbility {
  const ability = sim.resolvedAbility(abilityId);
  if (!ability) throw new Error(`missing resolved ability ${abilityId}`);
  return ability;
}

function runResolved(sim: Sim, target: Entity | null, ability: ResolvedAbility): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  runEffects(sim.ctx, sim.player, meta, target, ability);
}

function aura(
  id: string,
  kind: Aura['kind'],
  sourceId: number,
  school: Aura['school'],
  value = 1,
): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 30,
    duration: 30,
    value,
    sourceId,
    school,
  };
}

function settle(sim: Sim): void {
  for (let tick = 0; tick < 40; tick++) sim.tick();
}

describe('retained v0.26 non-Warrior row runtime contracts', () => {
  it('banks a second Sundering Gavel or roots enemies in Holy Ground', () => {
    const charges = simWithRows('paladin', { 8: 'pal_r8_fist_of_justice' });
    expect(resolved(charges, 'hammer_of_justice')).toMatchObject({
      charges: 2,
      bonusCharges: 1,
    });

    const snare = simWithRows('paladin', { 8: 'pal_r8_consecrated_ground' });
    const target = addTarget(snare);
    snare.player.resource = snare.player.maxResource;
    snare.castAbility('consecration');
    expect(target.auras).toContainEqual(
      expect.objectContaining({ kind: 'root', sourceId: snare.playerId, remaining: 2 }),
    );
  });

  it('lands Splitshot at the selected point and keeps Twin Fletching talent charges explicit', () => {
    const baseline = simWithRows('hunter', {});
    expect(resolved(baseline, 'arcane_shot')).toMatchObject({ bonusCharges: 0 });
    expect(resolved(baseline, 'arcane_shot').charges).toBeUndefined();

    const sim = simWithRows('hunter', {
      5: 'hun_r5_quick_shots',
      14: 'hun_r14_multi_shot',
    });
    expect(resolved(sim, 'arcane_shot')).toMatchObject({ charges: 2, bonusCharges: 1 });
    const distant = addTarget(sim, 20);
    const nearCaster = addTarget(sim, 3);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('multi_shot', undefined, { x: distant.pos.x, z: distant.pos.z });

    expect(distant.hp).toBeLessThan(distant.maxHp);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
  });

  it('restores energy on every third Wicked Slash with Ceaseless Cuts', () => {
    const sim = simWithRows('rogue', { 5: 'rog_r5_relentless_strikes' });
    const target = addTarget(sim);
    sim.player.resource = 0;

    onCastCompleted(sim.ctx, sim.player, 'sinister_strike', target);
    onCastCompleted(sim.ctx, sim.player, 'sinister_strike', target);
    expect(sim.player.resource).toBe(0);
    onCastCompleted(sim.ctx, sim.player, 'sinister_strike', target);

    expect(sim.player.resource).toBe(30);
  });

  it('adds one talent charge for Twin Fracture and Twin Icebind', () => {
    const priest = simWithRows('priest', { 14: 'pri_r14_mind_melt' });
    // The mage rework replaced Twin Embers (mag_r5_impulse, fire_blast) with
    // Twin Icebind (mag_r11_twin_nova, frost_nova) as the charge-model row.
    const mage = simWithRows('mage', { 11: 'mag_r11_twin_nova' });

    expect(resolved(priest, 'mind_blast')).toMatchObject({ charges: 2, bonusCharges: 1 });
    expect(resolved(mage, 'frost_nova')).toMatchObject({ charges: 2, bonusCharges: 1 });
  });

  it('heals from Imbued Lifeblood only while a weapon imbue is active', () => {
    const sim = simWithRows('shaman', { 5: 'sha_r5_imbue_mastery' });
    const rng = sim.ctx.rng as typeof sim.ctx.rng & { chance(probability: number): boolean };
    rng.chance = () => false;
    sim.player.hp = sim.player.maxHp - 20;

    onMeleeSwing(sim.ctx, sim.player);
    expect(sim.player.hp).toBe(sim.player.maxHp - 20);

    sim.player.auras.push(aura('test_imbue', 'imbue', sim.playerId, 'nature'));
    onMeleeSwing(sim.ctx, sim.player);
    expect(sim.player.hp).toBe(sim.player.maxHp - 12);
  });

  it('makes Consume mobile with Walking Hunger', () => {
    const sim = simWithRows('warlock', { 11: 'wlk_r11_fel_concentration' });
    expect(resolved(sim, 'drain_life').castWhileMoving).toBe(true);
  });

  it('Blood Credit pays 20% more mana per tap and arms nothing', () => {
    // Balance pass: the instant-bolt relay is gone; the option is the classic
    // Improved Life Tap (rank 3 at 20: 85 hp -> 102 mana).
    const sim = simWithRows('warlock', { 11: 'wlk_r11_improved_life_tap' });
    sim.player.hp = 1;
    sim.player.resource = 0;

    sim.castAbility('life_tap');

    expect(sim.player.hp).toBe(1);
    expect(sim.player.resource).toBe(0);
    expect(sim.player.gcdRemaining).toBe(0);

    sim.player.hp = 100;
    sim.castAbility('life_tap');
    expect(sim.player.hp).toBe(15);
    expect(sim.player.resource).toBe(102);
    expect(sim.player.auras.some((entry) => entry.id === 'wlk_blood_credit')).toBe(false);
  });

  it('casts Typhoon in caster form and Red Haze after shifting', () => {
    const sim = simWithRows('druid', {
      8: 'dru_r8_typhoon',
      20: 'dru_r20_berserk',
    });
    const target = addTarget(sim);
    const distanceBefore = Math.hypot(
      target.pos.x - sim.player.pos.x,
      target.pos.z - sim.player.pos.z,
    );
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('typhoon');

    expect(
      Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z),
    ).toBeGreaterThan(distanceBefore);
    expect(target.auras).toContainEqual(
      expect.objectContaining({ kind: 'slow', value: 0.5, remaining: 4 }),
    );

    settle(sim);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('cat_form');
    settle(sim);
    expect(sim.player.auras.some((entry) => entry.kind === 'form_cat')).toBe(true);
    sim.castAbility('berserk');
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'berserk', kind: 'buff_ap', value: 70 }),
    );
  });

  it('requires the caster-owned Dirge of Decay for Twisted Faith', () => {
    const damage = (dotId: string | null, sourceId: number): number => {
      const sim = simWithRows('priest', { 5: 'pri_r5_twisted_faith' });
      const target = addTarget(sim);
      if (dotId) {
        target.auras.push(aura(dotId, 'dot', sourceId || sim.playerId, 'shadow'));
      }
      const ability = resolved(sim, 'mind_blast');
      sim.player.spellPower = 0;
      sim.player.critChance = 0;
      const rng = sim.ctx.rng as typeof sim.ctx.rng & {
        chance(probability: number): boolean;
        range(min: number, max: number): number;
      };
      rng.chance = () => false;
      rng.range = (min) => min;
      const before = target.hp;
      runResolved(sim, target, ability);
      return before - target.hp;
    };

    const noDot = damage(null, 0);
    expect(damage('corruption', 0)).toBe(noDot);
    expect(damage('shadow_word_pain', 999_999)).toBe(noDot);
    expect(damage('shadow_word_pain', 0)).toBeGreaterThan(noDot * 1.2);
  });

  it('extends only the caster-owned Dirge of Decay and caps extension at six seconds', () => {
    const sim = simWithRows('priest', { 14: 'pri_r14_pain_and_suffering' });
    const target = addTarget(sim);
    const own = {
      ...aura('shadow_word_pain', 'dot', sim.playerId, 'shadow'),
      remaining: 8,
      duration: 8,
      tickInterval: 2,
      tickTimer: 2,
    };
    const foreign = {
      ...own,
      sourceId: 999_999,
    };
    target.auras.push(foreign, own);
    const ability = resolved(sim, 'mind_flay');
    const extend = ability.effects.find((effect) => effect.type === 'extendDot');
    if (!extend) throw new Error('missing Endless Dirge effect');
    const extensionOnly = { ...ability, effects: [extend] };
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      chance(probability: number): boolean;
      range(min: number, max: number): number;
    };
    let rngDraws = 0;
    rng.chance = () => {
      rngDraws++;
      return false;
    };
    rng.range = (min) => {
      rngDraws++;
      return min;
    };

    for (let tick = 0; tick < 8; tick++) runResolved(sim, target, extensionOnly);

    expect(own).toMatchObject({ remaining: 14, duration: 14, extendedBy: 6 });
    expect(foreign).toMatchObject({ remaining: 8, duration: 8 });
    expect(foreign.extendedBy).toBeUndefined();
    expect(rngDraws).toBe(0);
  });

  it('applies Endless Dirge through each real Litany of Woe channel tick', () => {
    const sim = simWithRows('priest', { 14: 'pri_r14_pain_and_suffering' });
    const target = addTarget(sim, 18);
    const own = {
      ...aura('shadow_word_pain', 'dot', sim.playerId, 'shadow'),
      remaining: 8,
      duration: 8,
      tickInterval: 2,
      tickTimer: 2,
    };
    const foreign = { ...own, sourceId: 999_999 };
    target.auras.push(foreign, own);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('mind_flay');
    for (let tick = 0; tick < 80; tick++) sim.tick();

    expect(own.duration).toBe(11);
    expect(own.extendedBy).toBe(3);
    expect(foreign.duration).toBe(8);
    expect(foreign.extendedBy).toBeUndefined();
  });

  it('detonates the pending next Cinder Jolt tick and preserves another caster DoT', () => {
    const detonation = (tickTimer: number): { damage: number; foreignRemains: boolean } => {
      const sim = simWithRows('shaman', { 14: 'sha_r14_improved_flame_shock' });
      const target = addTarget(sim);
      const own = {
        ...aura('flame_shock', 'dot', sim.playerId, 'fire', 10),
        remaining: 5,
        duration: 12,
        tickInterval: 3,
        tickTimer,
      };
      const foreign = { ...own, sourceId: 999_999 };
      target.auras.push(foreign, own);
      const ability = resolved(sim, 'earth_shock');
      const consume = ability.effects.find((effect) => effect.type === 'consumeDot');
      if (!consume) throw new Error('missing Cinder Rupture effect');
      const detonationOnly = { ...ability, effects: [consume] };
      const rng = sim.ctx.rng as typeof sim.ctx.rng & {
        chance(probability: number): boolean;
        range(min: number, max: number): number;
      };
      let rngDraws = 0;
      rng.chance = () => {
        rngDraws++;
        return false;
      };
      rng.range = (min) => {
        rngDraws++;
        return min;
      };
      const before = target.hp;

      runResolved(sim, target, detonationOnly);

      expect(target.auras).not.toContain(own);
      expect(rngDraws).toBe(0);
      return {
        damage: before - target.hp,
        foreignRemains: target.auras.includes(foreign),
      };
    };

    expect(detonation(1)).toEqual({ damage: 20, foreignRemains: true });
    expect(detonation(3)).toEqual({ damage: 10, foreignRemains: true });
  });

  it('pins exact Cleansing Verdict and Voidfeast healing with correct dispel direction', () => {
    const paladin = simWithRows('paladin', { 8: 'pal_r8_cleansing_verdict' });
    const ally = addTarget(paladin, 2, false);
    ally.maxHp = 1_000;
    ally.hp = 500;
    ally.auras.push(aura('magic_debuff', 'slow', 999_999, 'shadow', 0.5));
    ally.auras.push(aura('magic_benefit', 'buff_ap', ally.id, 'holy', 10));
    paladin.player.spellPower = 0;
    const paladinRng = paladin.ctx.rng as typeof paladin.ctx.rng & {
      chance(probability: number): boolean;
      range(min: number, max: number): number;
    };
    paladinRng.chance = () => false;
    paladinRng.range = (min) => min;

    runResolved(paladin, ally, resolved(paladin, 'cleansing_verdict'));

    expect(ally.hp).toBe(540);
    expect(ally.auras.some((entry) => entry.id === 'magic_debuff')).toBe(false);
    expect(ally.auras.some((entry) => entry.id === 'magic_benefit')).toBe(true);

    const warlock = simWithRows('warlock', { 8: 'wlk_r8_voidfeast' });
    const enemy = addTarget(warlock);
    enemy.auras.push(aura('magic_benefit', 'buff_ap', enemy.id, 'holy', 10));
    enemy.auras.push(aura('magic_debuff', 'slow', warlock.playerId, 'shadow', 0.5));
    warlock.player.hp = 1;
    const expectedHeal = Math.round(warlock.player.maxHp * 0.06);
    const warlockRng = warlock.ctx.rng as typeof warlock.ctx.rng & {
      chance(probability: number): boolean;
    };
    warlockRng.chance = () => false;

    runResolved(warlock, enemy, resolved(warlock, 'voidfeast'));

    expect(warlock.player.hp).toBe(1 + expectedHeal);
    expect(enemy.auras.some((entry) => entry.id === 'magic_benefit')).toBe(false);
    expect(enemy.auras.some((entry) => entry.id === 'magic_debuff')).toBe(true);
  });
});
