import { describe, expect, it } from 'vitest';
import { onSpellHit } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const EMBER_RELAY_ID = 'mag_r5_impulse';

function mageSim(
  options: { selected?: boolean; spec?: 'arcane' | 'fire' | 'frost'; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 177_211, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'fire',
      rows: options.selected === false ? {} : { 5: EMBER_RELAY_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_521): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 8,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  sim.targetEntity(target.id);
  sim.player.facing = 0;
  return target;
}

function landedCinderfall(sim: Sim, target: Entity, amount = 15): void {
  const ability = sim.resolvedAbility('fire_blast')?.def;
  if (!ability) throw new Error('missing fire_blast');
  sim.ctx.dealDamage(
    sim.player,
    target,
    amount,
    false,
    'fire',
    ability.name,
    'hit',
    false,
    undefined,
    true,
    false,
    true,
    'fire_blast',
  );
}

function advanceCast(sim: Sim): void {
  for (let tick = 0; tick < 100 && sim.player.castingAbility !== null; tick++) sim.tick();
  expect(sim.player.castingAbility).toBeNull();
}

describe('Pyromancy talent: Ember Relay', () => {
  it('keeps the stable row slot and replaces its flat charge with a valid cast decision', () => {
    const row = ROW_TREES.mage.find((candidate) => candidate.level === 5);
    const option = row?.options.find((candidate) => candidate.id === EMBER_RELAY_ID);

    expect(validateTalentTree(TALENTS.mage)).toEqual([]);
    expect(validateRowTree(ROW_TREES.mage)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['mag_r5_firestarter', 'Cinder Reprise'],
      [EMBER_RELAY_ID, 'Ember Relay'],
      ['mag_r5_mana_attunement', 'Third Current'],
    ]);
    expect(option?.effect).toEqual({
      proc: {
        id: 'mag_ember_relay',
        name: 'Ember Relay',
        requiresKnownAbility: 'fire_blast',
        school: 'fire',
        trigger: { on: 'spellHit', abilities: ['fire_blast'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_cheap',
            abilities: ['fireball', 'scorch'],
            duration: 8,
            costPct: 0.5,
          },
        ],
      },
    });
    expect(option?.effect.ability).toBeUndefined();
  });

  it('turns landed Cinderfall into a visible half-cost Cinderbolt or Scald window', () => {
    const sim = mageSim({ spec: 'arcane' });
    const target = targetFor(sim);
    const cinderbolt = sim.resolvedAbility('fireball');
    if (!cinderbolt) throw new Error('missing fireball');
    landedCinderfall(sim, target);

    expect(sim.player.auras.find((aura) => aura.id === 'mag_ember_relay')).toMatchObject({
      name: 'Ember Relay',
      kind: 'next_cast_cheap',
      remaining: 8,
      duration: 8,
      value: 0.5,
      empowerAbilities: ['fireball', 'scorch'],
    });
    const before = sim.player.resource;

    sim.castAbility('fireball');
    advanceCast(sim);

    expect(before - sim.player.resource).toBe(Math.ceil(cinderbolt.cost * 0.5));
    expect(sim.player.auras.some((aura) => aura.id === 'mag_ember_relay')).toBe(false);
  });

  it('requires both the selected option, its known Cinderfall, and positive landed damage', () => {
    const selected = mageSim();
    const selectedTarget = targetFor(selected, 97_522);
    onSpellHit(selected.ctx, selected.player, 'fireball', selectedTarget, 20);
    expect(selected.player.auras.some((aura) => aura.id === 'mag_ember_relay')).toBe(false);

    selected.ctx.applyAura(selectedTarget, {
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 1_000,
      sourceId: selectedTarget.id,
      school: 'arcane',
    });
    landedCinderfall(selected, selectedTarget);
    expect(selected.player.auras.some((aura) => aura.id === 'mag_ember_relay')).toBe(false);

    const unselected = mageSim({ selected: false });
    onSpellHit(unselected.ctx, unselected.player, 'fire_blast', targetFor(unselected), 15);
    expect(unselected.player.auras.some((aura) => aura.id === 'mag_ember_relay')).toBe(false);

    const withoutKnownAbility = mageSim();
    const meta = withoutKnownAbility.meta(withoutKnownAbility.playerId);
    if (!meta) throw new Error('missing Mage metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'fire_blast');
    onSpellHit(
      withoutKnownAbility.ctx,
      withoutKnownAbility.player,
      'fire_blast',
      targetFor(withoutKnownAbility),
      15,
    );
    expect(withoutKnownAbility.player.auras.some((aura) => aura.id === 'mag_ember_relay')).toBe(
      false,
    );
  });

  it('remains class-wide without adding a second Cinderfall charge', () => {
    for (const spec of ['arcane', 'fire', 'frost'] as const) {
      const sim = mageSim({ spec });
      const target = targetFor(sim, 97_530 + sim.player.id);
      expect(sim.resolvedAbility('fire_blast')).toMatchObject({ bonusCharges: 0 });

      onSpellHit(sim.ctx, sim.player, 'fire_blast', target, 15);

      expect(sim.player.auras.some((aura) => aura.id === 'mag_ember_relay')).toBe(true);
    }
  });

  it('adds no proc draws and replays the discount window exactly', () => {
    const run = () => {
      const sim = mageSim({ seed: 177_212 });
      const target = targetFor(sim);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onSpellHit(sim.ctx, sim.player, 'fire_blast', target, 15);
      sim.ctx.rng.setObserver(null);
      const aura = sim.player.auras.find((candidate) => candidate.id === 'mag_ember_relay');
      return { draws, duration: aura?.remaining ?? 0, discount: aura?.value ?? 0 };
    };

    expect(run()).toEqual({ draws: [], duration: 8, discount: 0.5 });
    expect(run()).toEqual(run());
  });

  it('localizes Ember Relay in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Ember Relay', language)).not.toBe('Ember Relay');
    }
  });
});
