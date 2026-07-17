import { describe, expect, it } from 'vitest';
import { onSpellHit } from '../src/sim/combat/talent_procs';
import { TALENTS } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { encodeObs } from '../src/sim/obs';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { directHitBonus } from '../src/sim/spell_scaling';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function frostSim(): Sim {
  const sim = new Sim({ seed: 1729, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'frost', rows: {} })).toBe(true);
  sim.player.spellPower = 0;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(90_000, MOBS.forest_wolf, 20, {
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

function run(sim: Sim, target: Entity, abilityId: string): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  sim.ctx.runEffects(sim.player, meta, target, resolved(sim, abilityId));
}

function fixedDamageRng(sim: Sim): { rangeDraws: () => number; chanceDraws: () => number } {
  const rng = sim.ctx.rng as typeof sim.ctx.rng & {
    range(min: number, max: number): number;
    chance(probability: number): boolean;
  };
  let ranges = 0;
  let chances = 0;
  rng.range = (min) => {
    ranges++;
    return min;
  };
  rng.chance = () => {
    chances++;
    return false;
  };
  return { rangeDraws: () => ranges, chanceDraws: () => chances };
}

function buildIcicles(sim: Sim, target: Entity, count: number): void {
  for (let index = 0; index < count; index++) onSpellHit(sim.ctx, sim.player, 'frostbolt', target);
}

describe('Cryomancy Icicles', () => {
  it('explains the full Icicles loop in the authored mastery tooltip', () => {
    const frost = TALENTS.mage?.specs.find((spec) => spec.id === 'frost');
    expect(frost?.mastery.description).toContain('Rimelance hits store an Icicle, up to 5');
    expect(frost?.mastery.description).toContain('15% chance to grant Frostbite for 15 sec');
    expect(frost?.mastery.description).toContain('8 Frost damage each');
    expect(frost?.mastery.description).toContain(
      '20 each against a rooted or stunned target or while Frostbite is active',
    );
    expect(frost?.mastery.description).toContain('cannot critically strike');
  });

  it('localizes the Cryomancy aura names in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Icicles', language)).not.toBe('Icicles');
      expect(localizeTalentTitle('Frostbite', language)).not.toBe('Frostbite');
    }
  });

  it('draws once per Cryomancy Rimelance and deterministically procs on only some hits', () => {
    const procSequence = (): { draws: number; procs: boolean[]; otherSpellDraws: number } => {
      const sim = frostSim();
      const target = targetFor(sim);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      onSpellHit(sim.ctx, sim.player, 'fireball', target);
      const otherSpellDraws = draws;
      expect(sim.player.auras.some((aura) => aura.id === 'mag_frostbite')).toBe(false);
      const procs: boolean[] = [];
      for (let index = 0; index < 64; index++) {
        onSpellHit(sim.ctx, sim.player, 'frostbolt', target);
        const frostbiteIndex = sim.player.auras.findIndex((aura) => aura.id === 'mag_frostbite');
        procs.push(frostbiteIndex >= 0);
        if (frostbiteIndex >= 0) sim.player.auras.splice(frostbiteIndex, 1);
      }
      sim.ctx.rng.setObserver(null);
      return { draws, procs, otherSpellDraws };
    };

    const first = procSequence();
    const second = procSequence();
    expect(second).toEqual(first);
    expect(first.otherSpellDraws).toBe(0);
    expect(first.draws).toBe(64);
    expect(first.procs.some(Boolean)).toBe(true);
    expect(first.procs.every(Boolean)).toBe(false);
  });

  it('rolls Frostbite only after Rimelance deals damage through the production hit gate', () => {
    const sim = frostSim();
    const target = targetFor(sim);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    let frostbiteRolls = 0;
    rng.range = (min) => min;
    rng.chance = (probability) => {
      if (probability === 0.15) frostbiteRolls++;
      return probability === 0.15;
    };

    run(sim, target, 'frostbolt');

    expect(frostbiteRolls).toBe(1);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_frostbite')).toBe(true);
    sim.player.auras = sim.player.auras.filter(
      (aura) => aura.id !== 'mag_frostbite' && aura.kind !== 'icicles',
    );
    target.auras.push({
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      value: 100_000,
      remaining: 30,
      duration: 30,
      sourceId: target.id,
      school: 'arcane',
    });

    run(sim, target, 'frostbolt');

    expect(frostbiteRolls).toBe(1);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_frostbite')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.kind === 'icicles')).toBe(false);
  });

  it('grants Icefall and builds one visible, long-lived stack per landed Rimelance up to five', () => {
    const sim = frostSim();
    const target = targetFor(sim);
    fixedDamageRng(sim);

    expect(sim.known.some((known) => known.def.id === 'icefall')).toBe(true);
    for (let index = 0; index < 6; index++) run(sim, target, 'frostbolt');

    const aura = sim.player.auras.find((entry) => entry.kind === 'icicles');
    expect(aura).toMatchObject({ id: 'mag_icicles', stacks: 5, duration: 3600 });
    expect(encodeObs(sim)[16]).toBe(1);
  });

  it('consumes every stored stack and scales Icefall damage with the count', () => {
    const damageAt = (stacks: number): number => {
      const sim = frostSim();
      const target = targetFor(sim);
      fixedDamageRng(sim);
      buildIcicles(sim, target, stacks);
      const before = target.hp;

      run(sim, target, 'icefall');

      expect(sim.player.auras.some((entry) => entry.kind === 'icicles')).toBe(false);
      return before - target.hp;
    };

    const twoStacks = damageAt(2);
    const fiveStacks = damageAt(5);
    expect(fiveStacks).toBeGreaterThan(twoStacks);
    expect((fiveStacks - twoStacks) / 3).toBe(8);
  });

  it('does no damage and draws no RNG when Icefall has no stacks', () => {
    const sim = frostSim();
    const target = targetFor(sim);
    const draws = fixedDamageRng(sim);
    const before = target.hp;

    run(sim, target, 'icefall');

    expect(target.hp).toBe(before);
    expect(draws.rangeDraws()).toBe(0);
    expect(draws.chanceDraws()).toBe(0);
  });

  it('uses and consumes Frostbite to execute a non-frozen, CC-immune target', () => {
    const sim = frostSim();
    const target = targetFor(sim);
    target.ccImmune = true;
    target.slowImmune = true;
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    let rangeDraws = 0;
    let chanceDraws = 0;
    rng.range = (min) => {
      rangeDraws++;
      return min;
    };
    rng.chance = (probability) => {
      chanceDraws++;
      return probability === 0.15;
    };

    buildIcicles(sim, target, 3);
    // Applying the proc auras recalculates derived stats, so zero Spell Power
    // after setup to isolate the authored per-stack execute damage.
    sim.player.spellPower = 0;

    expect(target.auras.some((aura) => aura.kind === 'root' || aura.kind === 'stun')).toBe(false);
    expect(sim.player.auras.find((aura) => aura.id === 'mag_frostbite')).toMatchObject({
      name: 'Frostbite',
      kind: 'frostbite',
      remaining: 15,
      duration: 15,
      charges: 1,
    });
    expect(encodeObs(sim)[18]).toBe(1);
    const before = target.hp;
    const rangeDrawsBefore = rangeDraws;
    const chanceDrawsBefore = chanceDraws;

    run(sim, target, 'icefall');

    expect(before - target.hp).toBe(3 * 20);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_frostbite')).toBe(false);
    expect(encodeObs(sim)[18]).toBe(0);
    expect(rangeDraws).toBe(rangeDrawsBefore);
    expect(chanceDraws).toBe(chanceDrawsBefore);
  });

  it('keeps chilled damage low but executes targets frozen by Icebind or a stun', () => {
    const damage = (state: 'normal' | 'chilled' | 'icebind' | 'stunned'): number => {
      const sim = frostSim();
      const target = targetFor(sim);
      const draws = fixedDamageRng(sim);
      sim.rebucket(target);
      if (state === 'chilled') {
        for (let index = 0; index < 3; index++) run(sim, target, 'frostbolt');
        expect(target.auras.some((aura) => aura.kind === 'slow')).toBe(true);
        expect(sim.player.auras.some((aura) => aura.id === 'mag_frostbite')).toBe(false);
      } else {
        buildIcicles(sim, target, 3);
      }
      if (state === 'icebind') {
        run(sim, target, 'frost_nova');
        expect(target.auras.some((aura) => aura.kind === 'root')).toBe(true);
      }
      if (state === 'stunned') {
        sim.ctx.applyAura(target, {
          id: 'test_stun',
          name: 'Test Stun',
          kind: 'stun',
          remaining: 8,
          duration: 8,
          value: 0,
          sourceId: sim.player.id,
          school: 'frost',
        });
      }
      // Applying the first Icicles aura recalculates derived stats, so zero Spell Power
      // after setup to isolate the authored per-stack tuning below.
      sim.player.spellPower = 0;
      const before = target.hp;
      const rangeDrawsBefore = draws.rangeDraws();
      const chanceDrawsBefore = draws.chanceDraws();
      run(sim, target, 'icefall');
      expect(draws.rangeDraws()).toBe(rangeDrawsBefore);
      expect(draws.chanceDraws()).toBe(chanceDrawsBefore);
      return before - target.hp;
    };

    expect(damage('normal')).toBe(3 * 8);
    expect(damage('chilled')).toBe(3 * 8);
    expect(damage('icebind')).toBe(3 * 20);
    expect(damage('stunned')).toBe(3 * 20);
  });

  it('does not consume guaranteed-crit charges that Icefall cannot use', () => {
    const sim = frostSim();
    const target = targetFor(sim);
    const draws = fixedDamageRng(sim);
    buildIcicles(sim, target, 3);
    sim.ctx.applyAura(sim.player, {
      id: 'test_sure_crit',
      name: 'Test Sure Crit',
      kind: 'sure_crit',
      remaining: 10,
      duration: 10,
      value: 0,
      charges: 3,
      sourceId: sim.player.id,
      school: 'frost',
    });

    const rangeDrawsBefore = draws.rangeDraws();
    const chanceDrawsBefore = draws.chanceDraws();
    run(sim, target, 'icefall');

    expect(sim.player.auras.find((aura) => aura.id === 'test_sure_crit')?.charges).toBe(3);
    expect(draws.rangeDraws()).toBe(rangeDrawsBefore);
    expect(draws.chanceDraws()).toBe(chanceDrawsBefore);
  });

  it('leaves non-Cryomancy mages draw-neutral and without Icicles', () => {
    const sim = new Sim({ seed: 1729, playerClass: 'mage', autoEquip: false });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'fire', rows: {} })).toBe(true);
    const target = targetFor(sim);
    const draws = fixedDamageRng(sim);

    onSpellHit(sim.ctx, sim.player, 'frostbolt', target);

    expect(sim.player.auras.some((entry) => entry.kind === 'icicles')).toBe(false);
    expect(sim.player.auras.some((entry) => entry.id === 'mag_frostbite')).toBe(false);
    expect(draws.rangeDraws()).toBe(0);
    expect(draws.chanceDraws()).toBe(0);
  });

  it('keeps Icefall at the fixed 8 and 20 per icicle regardless of Spell Power', () => {
    const damageAt = (spellPower: number, stunned: boolean): number => {
      const sim = frostSim();
      const target = targetFor(sim);
      fixedDamageRng(sim);
      buildIcicles(sim, target, 3);
      if (stunned) {
        sim.ctx.applyAura(target, {
          id: 'test_stun',
          name: 'Test Stun',
          kind: 'stun',
          remaining: 8,
          duration: 8,
          value: 0,
          sourceId: sim.player.id,
          school: 'frost',
        });
      }
      // Applying the proc auras recalculates derived stats, so set Spell Power
      // after setup: fixedNoCrit must ignore it either way.
      sim.player.spellPower = spellPower;
      const before = target.hp;
      run(sim, target, 'icefall');
      return before - target.hp;
    };

    // The rider Icefall skips would be nonzero at this Spell Power, so equal
    // damage below proves the fixed path really excludes it.
    const sim = frostSim();
    const icefall = resolved(sim, 'icefall');
    expect(directHitBonus(150, icefall.def, icefall.castTime)).toBeGreaterThan(0);

    expect(damageAt(150, false)).toBe(3 * 8);
    expect(damageAt(150, false)).toBe(damageAt(0, false));
    expect(damageAt(150, true)).toBe(3 * 20);
    expect(damageAt(150, true)).toBe(damageAt(0, true));
  });
});
