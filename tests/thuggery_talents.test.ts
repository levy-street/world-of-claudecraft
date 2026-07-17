import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const REDLINE_HABIT_ID = 'rog_r20_adrenaline_junkie';
const WEAPON_STRIKES = ['sinister_strike', 'backstab', 'ambush', 'hemorrhage', 'ghostly_strike'];

function rogueSim(
  options: { selected?: boolean; spec?: 'assassination' | 'combat' | 'subtlety' } = {},
): Sim {
  const sim = new Sim({ seed: 170740, playerClass: 'rogue', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'combat',
      rows: options.selected === false ? {} : { 20: REDLINE_HABIT_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_404, MOBS.forest_wolf, 20, {
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
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
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

function weaponHit(sim: Sim, target: Entity, abilityId: string): number {
  fixedMeleeRolls(sim);
  sim.player.weapon = { ...sim.player.weapon, min: 100, max: 100 };
  const before = target.hp;
  expect(
    sim.ctx.meleeSwing(sim.player, target, 0, 'Test Strike', {
      abilityId,
      cannotBeDodged: true,
    }),
  ).toBe(true);
  return before - target.hp;
}

describe('Thuggery talent: Redline Habit', () => {
  it('keeps the Rogue tree valid and replaces the stable cooldown filler without moving siblings', () => {
    const row = ROW_TREES.rogue.find((candidate) => candidate.level === 20);
    const redline = row?.options.find((option) => option.id === REDLINE_HABIT_ID);

    expect(validateTalentTree(TALENTS.rogue)).toEqual([]);
    expect(validateRowTree(ROW_TREES.rogue)).toEqual([]);
    expect(row?.options.map((option) => [option.id, option.name])).toEqual([
      ['rog_r20_shadowstep', 'Shadeslip'],
      [REDLINE_HABIT_ID, 'Redline Habit'],
      ['rog_r20_master_assassin', 'First Cut, Last Word'],
    ]);
    expect(redline?.effect.proc).toEqual({
      id: 'rog_adrenaline_junkie',
      name: 'Redline Habit',
      school: 'physical',
      trigger: { on: 'castNth', n: 1, abilities: ['adrenaline_rush'] },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_ability_damage',
          abilities: WEAPON_STRIKES,
          duration: 8,
          dmgPct: 0.5,
        },
      ],
    });
  });

  it('turns a real Quickened Blood cast into energy plus one visible weapon payoff', () => {
    const sim = rogueSim();
    sim.player.resource = 0;
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);

    sim.castAbility('adrenaline_rush');

    sim.ctx.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(sim.player.resource).toBe(60);
    expect(sim.player.cooldowns.get('adrenaline_rush')).toBe(180);
    expect(sim.player.auras.find((aura) => aura.id === 'rog_adrenaline_junkie')).toMatchObject({
      kind: 'next_ability_damage',
      remaining: 8,
      duration: 8,
      value: 0.5,
      empowerAbilities: WEAPON_STRIKES,
    });
  });

  it('makes one eligible landed weapon strike 50% stronger', () => {
    const baseline = rogueSim({ spec: 'assassination' });
    const baselineDamage = weaponHit(baseline, targetFor(baseline), 'sinister_strike');

    const sim = rogueSim({ spec: 'assassination' });
    const target = targetFor(sim);
    onCastCompleted(sim.ctx, sim.player, 'adrenaline_rush', sim.player);
    const empoweredDamage = weaponHit(sim, target, 'sinister_strike');

    expect(empoweredDamage).toBeGreaterThanOrEqual(Math.floor(baselineDamage * 1.5));
    expect(empoweredDamage).toBeLessThanOrEqual(Math.ceil(baselineDamage * 1.5));
    expect(sim.player.auras.some((aura) => aura.id === 'rog_adrenaline_junkie')).toBe(false);
  });

  it('does not arm from the old finisher trigger or spend on auto-attacks and finishers', () => {
    const oldTrigger = rogueSim();
    onCastCompleted(oldTrigger.ctx, oldTrigger.player, 'eviscerate', oldTrigger.player);
    expect(oldTrigger.player.auras.some((aura) => aura.id === 'rog_adrenaline_junkie')).toBe(false);

    for (const abilityId of ['auto_attack', 'eviscerate']) {
      const sim = rogueSim({ spec: 'assassination' });
      const target = targetFor(sim);
      onCastCompleted(sim.ctx, sim.player, 'adrenaline_rush', sim.player);
      weaponHit(sim, target, abilityId);
      expect(sim.player.auras.some((aura) => aura.id === 'rog_adrenaline_junkie')).toBe(true);
    }
  });

  it('keeps the shared capstone useful for Knifework and Skulduggery', () => {
    for (const spec of ['assassination', 'subtlety'] as const) {
      const sim = rogueSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'adrenaline_rush', sim.player);

      expect(sim.player.auras.find((aura) => aura.id === 'rog_adrenaline_junkie')).toMatchObject({
        kind: 'next_ability_damage',
        empowerAbilities: WEAPON_STRIKES,
      });
    }
  });

  it('requires the stable option and clears its visible window when deselected', () => {
    const unselected = rogueSim({ selected: false });
    onCastCompleted(unselected.ctx, unselected.player, 'adrenaline_rush', unselected.player);
    expect(unselected.player.auras.some((aura) => aura.id === 'rog_adrenaline_junkie')).toBe(false);

    const selected = rogueSim();
    onCastCompleted(selected.ctx, selected.player, 'adrenaline_rush', selected.player);
    expect(selected.applyTalents({ spec: 'combat', rows: {} })).toBe(true);
    expect(selected.player.auras.some((aura) => aura.id === 'rog_adrenaline_junkie')).toBe(false);
  });

  it('ships Quickened Blood and Redline Habit in all five non-Latin fills', async () => {
    try {
      for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
        await ensureLocaleLoaded(language);
        setLanguage(language);
        expect(tEntity({ kind: 'ability', id: 'adrenaline_rush', field: 'name' })).not.toBe(
          'Quickened Blood',
        );
        expect(localizeTalentTitle('Redline Habit', language)).not.toBe('Redline Habit');
      }
    } finally {
      setLanguage('en');
    }
  });
});
