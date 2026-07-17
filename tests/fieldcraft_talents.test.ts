import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const RAINBREAK_ID = 'hun_r20_improved_volley';

function hunterSim(
  options: { selected?: boolean; spec?: 'beast_mastery' | 'marksmanship' | 'survival' } = {},
): Sim {
  const sim = new Sim({ seed: 170736, playerClass: 'hunter', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'survival',
      rows: options.selected === false ? {} : { 20: RAINBREAK_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_401, MOBS.forest_wolf, 20, {
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

describe('Fieldcraft talent: Rainbreak', () => {
  it('keeps the row valid, preserves its siblings, and replaces flat Arrowfall damage', () => {
    const row = ROW_TREES.hunter.find((candidate) => candidate.level === 20);
    const rainbreak = row?.options.find((option) => option.id === RAINBREAK_ID);

    expect(validateTalentTree(TALENTS.hunter)).toEqual([]);
    expect(validateRowTree(ROW_TREES.hunter)).toEqual([]);
    expect(row?.options.map((option) => option.name)).toEqual([
      'Rainbreak',
      'Redline Draw',
      'Wildfang Rally',
    ]);
    expect(rainbreak?.effect.ability).toEqual([{ ability: 'volley', damagePushbackImmune: true }]);
    expect(rainbreak?.effect.proc).toEqual({
      id: 'hun_rainbreak',
      name: 'Rainbreak',
      school: 'physical',
      trigger: { on: 'castNth', n: 1, abilities: ['volley'] },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_ability_damage',
          abilities: ['raptor_strike'],
          duration: 10,
          dmgPct: 0.5,
        },
      ],
    });

    const selected = hunterSim().resolvedAbility('volley');
    const plain = hunterSim({ selected: false }).resolvedAbility('volley');
    expect(selected?.effects).toEqual(plain?.effects);
    expect(selected?.damagePushbackImmune).toBe(true);
    expect(plain?.damagePushbackImmune).not.toBe(true);
  });

  it('starts Arrowfall and banks one ten-second melee payoff without drawing proc RNG', () => {
    const sim = hunterSim();
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);

    sim.castAbility('volley', sim.playerId, { x: sim.player.pos.x, z: sim.player.pos.z + 10 });

    sim.ctx.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(sim.player.channeling).toBe(true);
    expect(sim.player.castingAbility).toBe('volley');
    expect(sim.player.auras.find((aura) => aura.id === 'hun_rainbreak')).toMatchObject({
      name: 'Rainbreak',
      kind: 'next_ability_damage',
      remaining: 10,
      duration: 10,
      value: 0.5,
      empowerAbilities: ['raptor_strike'],
    });
  });

  it('does not bank the payoff for another cast or without the stable row option selected', () => {
    const cases: Array<[Sim, string]> = [
      [hunterSim(), 'multi_shot'],
      [hunterSim({ selected: false }), 'volley'],
    ];
    for (const [sim, abilityId] of cases) {
      onCastCompleted(sim.ctx, sim.player, abilityId);

      expect(sim.player.auras.some((aura) => aura.id === 'hun_rainbreak')).toBe(false);
    }
  });

  it('keeps the shared apex choice useful for both sibling specs', () => {
    for (const spec of ['beast_mastery', 'marksmanship'] as const) {
      const sim = hunterSim({ spec });

      onCastCompleted(sim.ctx, sim.player, 'volley');

      expect(sim.player.auras.find((aura) => aura.id === 'hun_rainbreak')).toMatchObject({
        kind: 'next_ability_damage',
        empowerAbilities: ['raptor_strike'],
      });
    }
  });

  it('spends Rainbreak on one stronger Gutting Strike and clears it when deselected', () => {
    const baseline = hunterSim();
    const baselineDamage = guttingHit(baseline, targetFor(baseline));

    const sim = hunterSim();
    const target = targetFor(sim);
    onCastCompleted(sim.ctx, sim.player, 'volley');
    const empoweredDamage = guttingHit(sim, target);

    expect(empoweredDamage).toBeGreaterThanOrEqual(Math.floor(baselineDamage * 1.5));
    expect(empoweredDamage).toBeLessThanOrEqual(Math.ceil(baselineDamage * 1.5));
    expect(sim.player.auras.some((aura) => aura.id === 'hun_rainbreak')).toBe(false);

    const cleanup = hunterSim();
    onCastCompleted(cleanup.ctx, cleanup.player, 'volley');
    expect(cleanup.applyTalents({ spec: 'survival', rows: {} })).toBe(true);
    expect(cleanup.player.auras.some((aura) => aura.id === 'hun_rainbreak')).toBe(false);
  });

  it('localizes Rainbreak in every non-Latin release locale', () => {
    const expected = {
      zh_CN: '破雨突击',
      zh_TW: '破雨突擊',
      ja_JP: '雨裂き',
      ko_KR: '빗줄기 돌파',
      ru_RU: 'Прорыв сквозь ливень',
    } as const;
    for (const [language, name] of Object.entries(expected)) {
      expect(localizeTalentTitle('Rainbreak', language as keyof typeof expected)).toBe(name);
    }
  });
});
