import { describe, expect, it } from 'vitest';
import { onCastCompleted, onMeleeSwing } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function hunterSim(
  spec: 'beast_mastery' | 'marksmanship' | 'survival' = 'survival',
  rows: Record<number, string> = {},
): Sim {
  const sim = new Sim({ seed: 170735, playerClass: 'hunter', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, distance = 10, id = 97_301): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  target.hostile = true;
  target.stats = { ...target.stats, armor: 0 };
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

function fixedMeleeRolls(sim: Sim): void {
  const rng = sim.ctx.rng as typeof sim.ctx.rng & {
    next(): number;
    range(min: number, max: number): number;
    chance(probability: number): boolean;
  };
  rng.next = () => 0.9;
  rng.range = (min) => min;
  rng.chance = () => false;
}

function guttingHit(sim: Sim, target: Entity): number {
  fixedMeleeRolls(sim);
  sim.player.weapon = { ...sim.player.weapon, min: 100, max: 100 };
  const before = target.hp;
  expect(
    sim.ctx.meleeSwing(sim.player, target, 0, 'Gutting Strike', {
      abilityId: 'raptor_strike',
    }),
  ).toBe(true);
  return before - target.hp;
}

describe('Fieldcraft Quickblood', () => {
  it('authors a valid trap-to-melee field circuit with two gated proc arms', () => {
    const spec = TALENTS.hunter.specs.find((candidate) => candidate.id === 'survival');

    expect(validateTalentTree(TALENTS.hunter)).toEqual([]);
    expect(spec?.mastery.name).toBe('Quickblood');
    expect(spec?.mastery.description).toContain('Briar Trap and Rime Snare');
    expect(spec?.mastery.description).toContain('Gutting Strike');
    expect(spec?.mastery.description).toContain('restores 10 mana');
    expect(spec?.mastery.effect.procs).toEqual([
      {
        id: 'hun_quickblood_setup',
        name: 'Quickblood',
        spec: 'survival',
        requiresKnownAbility: 'wyvern_sting',
        school: 'nature',
        trigger: { on: 'castNth', n: 1, abilities: ['wyvern_sting', 'frost_trap'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_ability_damage',
            abilities: ['raptor_strike'],
            duration: 12,
            dmgPct: 0.5,
          },
        ],
      },
      {
        id: 'hun_quickblood_return',
        name: 'Quickblood',
        spec: 'survival',
        requiresKnownAbility: 'wyvern_sting',
        school: 'physical',
        trigger: { on: 'meleeHit', abilities: ['raptor_strike'] },
        responses: [
          { kind: 'resource', amount: 10 },
          { kind: 'cooldownRefund', ability: 'wyvern_sting', seconds: 8 },
        ],
      },
    ]);
  });

  it('casts Briar Trap at a point, roots without damage RNG, and opens Quickblood', () => {
    const sim = hunterSim();
    const target = targetFor(sim);
    const hpBefore = target.hp;
    const manaBefore = sim.player.resource;
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);

    sim.castAbility('wyvern_sting', sim.playerId, { x: target.pos.x, z: target.pos.z });

    sim.ctx.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(target.hp).toBe(hpBefore);
    expect(target.auras.find((aura) => aura.id === 'wyvern_sting_root')).toMatchObject({
      name: 'Briar Trap',
      kind: 'root',
      remaining: 4,
    });
    expect(sim.player.resource).toBe(manaBefore - 35);
    expect(sim.player.cooldowns.get('wyvern_sting')).toBe(45);
    expect(sim.player.auras.find((aura) => aura.id === 'hun_quickblood_setup')).toMatchObject({
      name: 'Quickblood',
      kind: 'next_ability_damage',
      remaining: 12,
      value: 0.5,
      empowerAbilities: ['raptor_strike'],
    });
  });

  it('lets the optional Rime Snare open the same twelve-second melee window', () => {
    const sim = hunterSim('survival', { 8: 'hun_r8_frost_trap' });
    const target = targetFor(sim);

    sim.castAbility('frost_trap', sim.playerId, { x: target.pos.x, z: target.pos.z });

    expect(target.auras.some((aura) => aura.id === 'frost_trap_freeze')).toBe(true);
    expect(sim.player.auras.find((aura) => aura.id === 'hun_quickblood_setup')).toMatchObject({
      kind: 'next_ability_damage',
      duration: 12,
      empowerAbilities: ['raptor_strike'],
    });
  });

  it('turns the trap setup into a stronger Gutting Strike that restores mana and trap time', () => {
    const baseline = hunterSim();
    const baselineTarget = targetFor(baseline, 3);
    baseline.player.resource = 10;
    baseline.player.cooldowns.set('wyvern_sting', 40);
    const baselineDamage = guttingHit(baseline, baselineTarget);

    const sim = hunterSim();
    const target = targetFor(sim, 3);
    sim.player.resource = 10;
    sim.player.cooldowns.set('wyvern_sting', 40);
    onCastCompleted(sim.ctx, sim.player, 'wyvern_sting', target);
    const empoweredDamage = guttingHit(sim, target);

    expect(empoweredDamage).toBeGreaterThanOrEqual(Math.floor(baselineDamage * 1.5));
    expect(empoweredDamage).toBeLessThanOrEqual(Math.ceil(baselineDamage * 1.5));
    expect(sim.player.resource).toBe(20);
    expect(sim.player.cooldowns.get('wyvern_sting')).toBe(32);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_quickblood_setup')).toBe(false);
  });

  it('does not build, spend, or draw outside Fieldcraft or without the signature learned', () => {
    const withoutSignature = hunterSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Fieldcraft metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'wyvern_sting');
    for (const sim of [hunterSim('beast_mastery'), hunterSim('marksmanship'), withoutSignature]) {
      sim.player.resource = 10;
      sim.player.cooldowns.set('wyvern_sting', 40);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      onCastCompleted(sim.ctx, sim.player, 'wyvern_sting', sim.player);
      onMeleeSwing(sim.ctx, sim.player, 'raptor_strike');

      sim.ctx.rng.setObserver(null);
      expect(draws).toBe(0);
      expect(sim.player.resource).toBe(10);
      expect(sim.player.cooldowns.get('wyvern_sting')).toBe(40);
      expect(sim.player.auras.some((aura) => aura.id === 'hun_quickblood_setup')).toBe(false);
    }
  });

  it('ignores unrelated casts and melee hits without changing the field circuit', () => {
    const sim = hunterSim();
    sim.player.resource = 10;
    sim.player.cooldowns.set('wyvern_sting', 40);

    onCastCompleted(sim.ctx, sim.player, 'arcane_shot', sim.player);
    onMeleeSwing(sim.ctx, sim.player, 'mongoose_bite');

    expect(sim.player.resource).toBe(10);
    expect(sim.player.cooldowns.get('wyvern_sting')).toBe(40);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_quickblood_setup')).toBe(false);
  });

  it('clears the trap setup window when Fieldcraft is left', () => {
    const sim = hunterSim();
    onCastCompleted(sim.ctx, sim.player, 'wyvern_sting', sim.player);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_quickblood_setup')).toBe(true);

    expect(sim.applyTalents({ spec: 'marksmanship', rows: {} })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id === 'hun_quickblood_setup')).toBe(false);
  });

  it('ships Briar Trap and Quickblood names in all five non-Latin fills', async () => {
    const expected = {
      zh_CN: '荆棘陷阱',
      zh_TW: '荊棘陷阱',
      ja_JP: '茨の罠',
      ko_KR: '가시덤불 덫',
      ru_RU: 'Терновая ловушка',
    } as const;
    try {
      for (const [language, name] of Object.entries(expected)) {
        await ensureLocaleLoaded(language as keyof typeof expected);
        setLanguage(language as keyof typeof expected);
        expect(tEntity({ kind: 'ability', id: 'wyvern_sting', field: 'name' })).toBe(name);
        expect(localizeTalentTitle('Quickblood', language as keyof typeof expected)).not.toBe(
          'Quickblood',
        );
      }
    } finally {
      setLanguage('en');
    }
  });
});
