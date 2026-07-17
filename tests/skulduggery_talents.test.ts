import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const DUSK_DIVIDEND_ID = 'rog_r5_opportunist';
const OPENERS = ['ambush', 'garrote', 'cheap_shot'];
const BUILDERS = [
  'sinister_strike',
  'backstab',
  'gouge',
  'ambush',
  'garrote',
  'cheap_shot',
  'hemorrhage',
  'ghostly_strike',
];

function rogueSim(
  options: { selected?: boolean; spec?: 'assassination' | 'combat' | 'subtlety' } = {},
): Sim {
  const sim = new Sim({ seed: 170742, playerClass: 'rogue', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'subtlety',
      rows: options.selected === false ? {} : { 5: DUSK_DIVIDEND_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_406, MOBS.forest_wolf, 20, {
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

describe('Skulduggery talent: Dusk Dividend', () => {
  it('keeps the Rogue tree valid and replaces the stable refund filler without moving siblings', () => {
    const row = ROW_TREES.rogue.find((candidate) => candidate.level === 5);
    const dividend = row?.options.find((option) => option.id === DUSK_DIVIDEND_ID);

    expect(validateTalentTree(TALENTS.rogue)).toEqual([]);
    expect(validateRowTree(ROW_TREES.rogue)).toEqual([]);
    expect(row?.options.map((option) => [option.id, option.name])).toEqual([
      ['rog_r5_relentless_strikes', 'Ceaseless Cuts'],
      ['rog_r5_improved_backstab', "Knife's Dividend"],
      [DUSK_DIVIDEND_ID, 'Dusk Dividend'],
    ]);
    expect(dividend?.effect.proc).toEqual({
      id: 'rog_dusk_dividend',
      name: 'Dusk Dividend',
      school: 'shadow',
      trigger: { on: 'castNth', n: 1, abilities: OPENERS },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_cast_cheap',
          abilities: BUILDERS,
          duration: 8,
          costPct: 0.5,
        },
      ],
    });
  });

  it('replaces the opener refund with a visible half-cost builder decision and zero proc draws', () => {
    const run = (abilityId: string) => {
      const sim = rogueSim({ spec: 'assassination' });
      sim.player.resource = 10;
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onCastCompleted(sim.ctx, sim.player, abilityId, sim.player);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        resource: sim.player.resource,
        aura: sim.player.auras.find((candidate) => candidate.id === 'rog_dusk_dividend'),
      };
    };

    for (const abilityId of OPENERS) {
      const result = run(abilityId);
      expect(result.draws, abilityId).toBe(0);
      expect(result.resource, abilityId).toBe(10);
      expect(result.aura, abilityId).toMatchObject({
        kind: 'next_cast_cheap',
        remaining: 8,
        duration: 8,
        value: 0.5,
        empowerAbilities: BUILDERS,
      });
      expect(run(abilityId)).toEqual(run(abilityId));
    }
  });

  it('plays a real full-cost Duskveil opener into discounted Maskfall', () => {
    const sim = rogueSim();
    const target = targetFor(sim);
    fixedMeleeRolls(sim);

    sim.castAbility('stealth');
    sim.castAbility('cheap_shot');

    expect(sim.player.resource).toBe(40);
    expect(sim.player.comboPoints).toBe(2);
    expect(sim.player.auras.find((aura) => aura.id === 'rog_dusk_dividend')).toMatchObject({
      kind: 'next_cast_cheap',
      value: 0.5,
    });

    sim.player.gcdRemaining = 0;
    const hpBefore = target.hp;
    sim.castAbility('hemorrhage');

    expect(target.hp).toBeLessThan(hpBefore);
    expect(sim.player.resource).toBe(22);
    expect(sim.player.comboPoints).toBe(3);
    expect(sim.player.auras.some((aura) => aura.id === 'rog_dusk_dividend')).toBe(false);
  });

  it('leaves finishers and utility outside the discounted builder scope', () => {
    const sim = rogueSim({ spec: 'assassination' });
    const target = targetFor(sim);
    onCastCompleted(sim.ctx, sim.player, 'ambush', sim.player);
    sim.player.comboPoints = 5;
    sim.player.resource = 35;

    sim.castAbility('eviscerate');

    expect(target.hp).toBeLessThanOrEqual(target.maxHp);
    expect(sim.player.resource).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'rog_dusk_dividend')).toBe(true);
    expect(
      sim.player.auras.find((aura) => aura.id === 'rog_dusk_dividend')?.empowerAbilities,
    ).not.toContain('vanish');
  });

  it('keeps the shared opener choice useful for Knifework and Thuggery', () => {
    for (const spec of ['assassination', 'combat'] as const) {
      const sim = rogueSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'garrote', sim.player);

      expect(sim.player.auras.find((aura) => aura.id === 'rog_dusk_dividend')).toMatchObject({
        kind: 'next_cast_cheap',
        empowerAbilities: BUILDERS,
      });
    }
  });

  it('requires the stable option and clears its window when deselected', () => {
    const unselected = rogueSim({ selected: false });
    onCastCompleted(unselected.ctx, unselected.player, 'ambush', unselected.player);
    expect(unselected.player.auras.some((aura) => aura.id === 'rog_dusk_dividend')).toBe(false);

    const selected = rogueSim();
    onCastCompleted(selected.ctx, selected.player, 'ambush', selected.player);
    expect(selected.applyTalents({ spec: 'subtlety', rows: {} })).toBe(true);
    expect(selected.player.auras.some((aura) => aura.id === 'rog_dusk_dividend')).toBe(false);
  });

  it('localizes Dusk Dividend in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Dusk Dividend', language)).not.toBe('Dusk Dividend');
    }
  });
});
