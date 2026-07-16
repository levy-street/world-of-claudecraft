import { describe, expect, it } from 'vitest';
import { onSpellHit } from '../src/sim/combat/talent_procs';
import { TALENTS } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { encodeObs } from '../src/sim/obs';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
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
    expect(frost?.mastery.description).toContain('8 Frost damage each');
    expect(frost?.mastery.description).toContain('20 each against a rooted or stunned target');
    expect(frost?.mastery.description).toContain('cannot critically strike');
  });

  it('localizes the Icicles aura name in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Icicles', language)).not.toBe('Icicles');
    }
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

  it('keeps chilled damage low but executes targets frozen by Icebind or a stun', () => {
    const damage = (state: 'normal' | 'chilled' | 'icebind' | 'stunned'): number => {
      const sim = frostSim();
      const target = targetFor(sim);
      const draws = fixedDamageRng(sim);
      sim.rebucket(target);
      if (state === 'chilled') {
        for (let index = 0; index < 3; index++) run(sim, target, 'frostbolt');
        expect(target.auras.some((aura) => aura.kind === 'slow')).toBe(true);
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

    run(sim, target, 'icefall');

    expect(sim.player.auras.find((aura) => aura.id === 'test_sure_crit')?.charges).toBe(3);
    expect(draws.rangeDraws()).toBe(0);
    expect(draws.chanceDraws()).toBe(0);
  });

  it('leaves non-Cryomancy mages draw-neutral and without Icicles', () => {
    const sim = new Sim({ seed: 1729, playerClass: 'mage', autoEquip: false });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'fire', rows: {} })).toBe(true);
    const target = targetFor(sim);
    const draws = fixedDamageRng(sim);

    onSpellHit(sim.ctx, sim.player, 'frostbolt', target);

    expect(sim.player.auras.some((entry) => entry.kind === 'icicles')).toBe(false);
    expect(draws.rangeDraws()).toBe(0);
    expect(draws.chanceDraws()).toBe(0);
  });
});
