import { describe, expect, it } from 'vitest';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const DEEPENED_HEX_ID = 'wlk_r14_amplify_curse';
const HEX_IDS = ['corruption', 'curse_of_agony'] as const;

function warlockSim(
  options: {
    selected?: boolean;
    spec?: 'affliction' | 'demonology' | 'destruction';
    seed?: number;
  } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 170_743, playerClass: 'warlock', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'affliction',
      rows: options.selected === false ? {} : { 14: DEEPENED_HEX_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_404): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 10,
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

function runAbility(sim: Sim, target: Entity, abilityId: string): void {
  const meta = sim.meta(sim.playerId);
  const ability = sim.resolvedAbility(abilityId);
  if (!meta || !ability) throw new Error(`missing ${abilityId}`);
  sim.ctx.runEffects(sim.player, meta, target, ability);
}

function ownedHex(target: Entity, sourceId: number, abilityId: (typeof HEX_IDS)[number]) {
  const aura = target.auras.find(
    (candidate) =>
      candidate.kind === 'dot' && candidate.id === abilityId && candidate.sourceId === sourceId,
  );
  if (!aura) throw new Error(`missing ${abilityId}`);
  return aura;
}

describe('Hexcraft talent: Deepened Hex', () => {
  it('keeps the Warlock trees valid and replaces the stable scalar without changing siblings', () => {
    const row = ROW_TREES.warlock.find((candidate) => candidate.level === 14);
    const option = row?.options.find((candidate) => candidate.id === DEEPENED_HEX_ID);

    expect(validateTalentTree(TALENTS.warlock)).toEqual([]);
    expect(validateRowTree(ROW_TREES.warlock)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      [DEEPENED_HEX_ID, 'Deepened Hex'],
      ['wlk_r14_ruin', 'Ashen Relay'],
      ['wlk_r14_shadow_mastery', 'Shadow Credit'],
    ]);
    expect(option?.effect).toEqual({
      ability: [
        {
          ability: 'shadow_bolt',
          addEffects: [
            { type: 'extendDot', dot: 'corruption', seconds: 3, maxBonus: 6 },
            { type: 'extendDot', dot: 'curse_of_agony', seconds: 3, maxBonus: 6 },
          ],
        },
      ],
    });
  });

  it('turns landed Gloom Bolts into capped upkeep for both owned hexes', () => {
    const sim = warlockSim();
    const target = targetFor(sim);
    for (const hexId of HEX_IDS) runAbility(sim, target, hexId);
    const baseDurations = Object.fromEntries(
      HEX_IDS.map((hexId) => [hexId, ownedHex(target, sim.player.id, hexId).duration]),
    );

    for (let bolt = 0; bolt < 3; bolt++) runAbility(sim, target, 'shadow_bolt');

    for (const hexId of HEX_IDS) {
      const aura = ownedHex(target, sim.player.id, hexId);
      expect(aura.extendedBy).toBe(6);
      expect(aura.duration).toBe(baseDurations[hexId] + 6);
    }
  });

  it('requires the selected option, preserves foreign hexes, and adds no Gloom Bolt draws', () => {
    const run = (selected: boolean) => {
      const sim = warlockSim({ selected, seed: 170_744 });
      const target = targetFor(sim, selected ? 97_405 : 97_406);
      for (const hexId of HEX_IDS) runAbility(sim, target, hexId);
      target.auras.push({
        id: 'corruption',
        name: 'Foreign Blackrot',
        kind: 'dot',
        remaining: 18,
        duration: 18,
        value: 1,
        sourceId: 777,
        school: 'shadow',
      });
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      runAbility(sim, target, 'shadow_bolt');
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        ownExtendedBy: ownedHex(target, sim.player.id, 'corruption').extendedBy ?? 0,
        foreign: target.auras.find((aura) => aura.id === 'corruption' && aura.sourceId === 777),
      };
    };

    const talented = run(true);
    const baseline = run(false);
    expect(talented.draws).toEqual(baseline.draws);
    expect(talented.ownExtendedBy).toBe(3);
    expect(baseline.ownExtendedBy).toBe(0);
    expect(talented.foreign).toMatchObject({ duration: 18, remaining: 18 });
    expect(baseline.foreign).toMatchObject({ duration: 18, remaining: 18 });
  });

  it('keeps the shared upkeep option functional for Pactbound and Ruination', () => {
    for (const spec of ['demonology', 'destruction'] as const) {
      const sim = warlockSim({ spec });
      const target = targetFor(sim, spec === 'demonology' ? 97_407 : 97_408);
      runAbility(sim, target, 'corruption');
      runAbility(sim, target, 'shadow_bolt');

      expect(ownedHex(target, sim.player.id, 'corruption').extendedBy).toBe(3);
    }
  });

  it('localizes Deepened Hex in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Deepened Hex', language)).not.toBe('Deepened Hex');
    }
  });
});
