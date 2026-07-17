import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const MENDERS_SIGNAL_ID = 'hun_r11_mend_pet';

function hunterSim(
  options: { selected?: boolean; spec?: 'beast_mastery' | 'marksmanship' | 'survival' } = {},
): Sim {
  const sim = new Sim({ seed: 170732, playerClass: 'hunter', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'beast_mastery',
      rows: options.selected === false ? {} : { 11: MENDERS_SIGNAL_ID },
    }),
  ).toBe(true);
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_111, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 10,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

describe("Packlord talent: Mender's Signal", () => {
  it('keeps the row valid, preserves its siblings, and replaces the flat heal at the stable id', () => {
    const row = ROW_TREES.hunter.find((candidate) => candidate.level === 11);
    const signal = row?.options.find((option) => option.id === MENDERS_SIGNAL_ID);

    expect(validateTalentTree(TALENTS.hunter)).toEqual([]);
    expect(validateRowTree(ROW_TREES.hunter)).toEqual([]);
    expect(row?.options.map((option) => option.name)).toEqual([
      "Mender's Signal",
      'Lean Quiver',
      'Deathless Will',
    ]);
    expect(signal?.effect.ability).toBeUndefined();
    expect(signal?.effect.proc).toEqual({
      id: 'hun_menders_signal',
      name: "Mender's Signal",
      trigger: { on: 'castNth', n: 1, abilities: ['revive_pet'] },
      responses: [
        { kind: 'cooldownRefund', ability: 'bestial_wrath', seconds: 15 },
        {
          kind: 'empowerNext',
          aura: 'next_cast_free',
          abilities: ['arcane_shot'],
          duration: 8,
        },
      ],
    });
  });

  it('opens one eight-second free-shot window after Patch Up without drawing RNG', () => {
    const sim = hunterSim();
    sim.player.cooldowns.set('bestial_wrath', 60);
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);

    onCastCompleted(sim.ctx, sim.player, 'revive_pet');

    sim.ctx.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(sim.player.cooldowns.get('bestial_wrath')).toBe(45);
    expect(sim.player.auras.find((aura) => aura.id === 'hun_menders_signal')).toMatchObject({
      name: "Mender's Signal",
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['arcane_shot'],
    });
  });

  it('does not fire from another cast or when the stable row option is not selected', () => {
    const cases: Array<[Sim, string]> = [
      [hunterSim(), 'tame_beast'],
      [hunterSim({ selected: false }), 'revive_pet'],
    ];
    for (const [sim, abilityId] of cases) {
      sim.player.cooldowns.set('bestial_wrath', 60);
      onCastCompleted(sim.ctx, sim.player, abilityId);

      expect(sim.player.cooldowns.get('bestial_wrath')).toBe(60);
      expect(sim.player.auras.some((aura) => aura.id === 'hun_menders_signal')).toBe(false);
    }
  });

  it('keeps the shared choice useful for sibling specs through its mana-saving shot', () => {
    for (const spec of ['marksmanship', 'survival'] as const) {
      const sim = hunterSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'revive_pet');

      expect(sim.player.auras.find((aura) => aura.id === 'hun_menders_signal')).toMatchObject({
        kind: 'next_cast_free',
        empowerAbilities: ['arcane_shot'],
      });
    }
  });

  it('spends the banked signal on exactly one Fell Shot and clears it when deselected', () => {
    const sim = hunterSim();
    const target = targetFor(sim);
    onCastCompleted(sim.ctx, sim.player, 'revive_pet');
    sim.targetEntity(target.id);
    sim.player.facing = 0;
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;

    sim.castAbility('arcane_shot');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_menders_signal')).toBe(false);
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);

    onCastCompleted(sim.ctx, sim.player, 'revive_pet');
    expect(sim.applyTalents({ spec: 'beast_mastery', rows: {} })).toBe(true);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_menders_signal')).toBe(false);
  });

  it('localizes the option and visible window in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle("Mender's Signal", language)).not.toBe("Mender's Signal");
    }
  });
});
