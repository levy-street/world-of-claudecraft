import { describe, expect, it } from 'vitest';
import { onDamageTaken, tickProcState } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const PAIN_COMMUNION_ID = 'wlk_r17_demonic_resilience';

function warlockSim(
  options: { selected?: boolean; spec?: 'affliction' | 'demonology' | 'destruction' } = {},
): Sim {
  const sim = new Sim({ seed: 170_747, playerClass: 'warlock', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'demonology',
      rows: options.selected === false ? {} : { 17: PAIN_COMMUNION_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.maxHp = 1_000;
  sim.player.hp = sim.player.maxHp;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_417): Entity {
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

describe('Pactbound talent: Pain Communion', () => {
  it('keeps the Warlock trees valid and replaces the fixed heal without changing siblings', () => {
    const row = ROW_TREES.warlock.find((candidate) => candidate.level === 17);
    const option = row?.options.find((candidate) => candidate.id === PAIN_COMMUNION_ID);

    expect(validateTalentTree(TALENTS.warlock)).toEqual([]);
    expect(validateRowTree(ROW_TREES.warlock)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['wlk_r17_death_coil', 'Morrowlash'],
      ['wlk_r17_improved_fear', 'Cruel Awakening'],
      [PAIN_COMMUNION_ID, 'Pain Communion'],
    ]);
    expect(option?.effect.proc).toEqual({
      id: 'wlk_pain_communion',
      name: 'Pain Communion',
      trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_cast_instant',
          abilities: ['immolate'],
          duration: 8,
        },
      ],
    });
  });

  it('arms only at the threshold, enforces its internal cooldown, and draws no RNG', () => {
    const sim = warlockSim();
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);

    onDamageTaken(sim.ctx, sim.player, 149);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_pain_communion')).toBe(false);

    onDamageTaken(sim.ctx, sim.player, 150);
    expect(sim.player.auras.find((aura) => aura.id === 'wlk_pain_communion')).toMatchObject({
      kind: 'next_cast_instant',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['immolate'],
    });
    sim.player.auras = sim.player.auras.filter((aura) => aura.id !== 'wlk_pain_communion');
    onDamageTaken(sim.ctx, sim.player, 500);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_pain_communion')).toBe(false);

    tickProcState(sim.player, 20);
    onDamageTaken(sim.ctx, sim.player, 150);
    sim.ctx.rng.setObserver(null);

    expect(draws).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_pain_communion')).toBe(true);
  });

  it('turns the next Burning Pact instant while preserving its full mana cost', () => {
    const sim = warlockSim();
    targetFor(sim);
    const burningPact = sim.resolvedAbility('immolate');
    if (!burningPact) throw new Error('missing Burning Pact');
    onDamageTaken(sim.ctx, sim.player, 150);
    const manaBefore = sim.player.resource;

    sim.castAbility('immolate');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBefore - burningPact.cost);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_pain_communion')).toBe(false);
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
  });

  it('requires the selected option and stays useful for Hexcraft and Ruination', () => {
    const unselected = warlockSim({ selected: false });
    onDamageTaken(unselected.ctx, unselected.player, 500);
    expect(unselected.player.auras.some((aura) => aura.id === 'wlk_pain_communion')).toBe(false);

    for (const spec of ['affliction', 'destruction'] as const) {
      const sim = warlockSim({ spec });
      onDamageTaken(sim.ctx, sim.player, 150);
      expect(sim.player.auras.find((aura) => aura.id === 'wlk_pain_communion')).toMatchObject({
        kind: 'next_cast_instant',
        empowerAbilities: ['immolate'],
      });
    }
  });

  it('clears both its internal cooldown and visible response when deselected', () => {
    const sim = warlockSim();
    onDamageTaken(sim.ctx, sim.player, 150);
    expect(sim.player.procState?.icds.wlk_pain_communion).toBe(20);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_pain_communion')).toBe(true);

    expect(sim.applyTalents({ spec: 'demonology', rows: {} })).toBe(true);

    expect(sim.player.procState?.icds.wlk_pain_communion).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_pain_communion')).toBe(false);
  });

  it('localizes Pain Communion in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Pain Communion', language)).not.toBe('Pain Communion');
    }
  });
});
