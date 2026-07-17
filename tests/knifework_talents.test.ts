import { describe, expect, it } from 'vitest';
import { onMeleeSwing } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const VENOM_DIVIDEND_ID = 'rog_r14_deadly_brew';

function rogueSim(
  options: { selected?: boolean; spec?: 'assassination' | 'combat' | 'subtlety' } = {},
): Sim {
  const sim = new Sim({ seed: 170738, playerClass: 'rogue', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'assassination',
      rows: options.selected === false ? {} : { 14: VENOM_DIVIDEND_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function addWeaponPoison(player: Entity): void {
  player.auras.push({
    id: 'test_poison',
    name: 'Test Poison',
    kind: 'imbue',
    remaining: 30,
    duration: 30,
    value: 0,
    sourceId: player.id,
    school: 'nature',
  });
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_402, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
  return target;
}

describe('Knifework talent: Venom Dividend', () => {
  it('keeps the Rogue tree valid and replaces the stable filler without disturbing its siblings', () => {
    const row = ROW_TREES.rogue.find((candidate) => candidate.level === 14);
    const dividend = row?.options.find((option) => option.id === VENOM_DIVIDEND_ID);

    expect(validateTalentTree(TALENTS.rogue)).toEqual([]);
    expect(validateRowTree(ROW_TREES.rogue)).toEqual([]);
    expect(row?.options.map((option) => [option.id, option.name])).toEqual([
      ['rog_r14_seal_fate', 'Final Notice'],
      ['rog_r14_ghostly_strike', 'Wraith Strike'],
      [VENOM_DIVIDEND_ID, 'Venom Dividend'],
    ]);
    expect(dividend?.effect.proc).toEqual({
      id: 'rog_deadly_brew',
      name: 'Venom Dividend',
      school: 'nature',
      trigger: { on: 'meleeSwingWhile', auraKind: 'imbue', n: 4 },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_cast_free',
          abilities: ['crippling_poison'],
          duration: 8,
        },
      ],
    });
  });

  it('banks free Leaden Venom on every fourth poisoned melee hit with zero RNG draws', () => {
    const run = () => {
      const sim = rogueSim();
      addWeaponPoison(sim.player);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      for (let hit = 0; hit < 7; hit++) onMeleeSwing(sim.ctx, sim.player, 'auto_attack');

      sim.ctx.rng.setObserver(null);
      return {
        draws,
        counter: sim.player.procState?.counters.rog_deadly_brew,
        aura: sim.player.auras.find((candidate) => candidate.id === 'rog_deadly_brew'),
      };
    };

    const result = run();
    expect(result.draws).toBe(0);
    expect(result.counter).toBe(3);
    expect(result.aura).toMatchObject({
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['crippling_poison'],
    });
    expect(run()).toEqual(run());
  });

  it('requires both the selected option and an active weapon poison', () => {
    for (const sim of [rogueSim({ selected: false }), rogueSim()]) {
      for (let hit = 0; hit < 4; hit++) onMeleeSwing(sim.ctx, sim.player, 'auto_attack');

      expect(sim.player.procState?.counters.rog_deadly_brew).toBeUndefined();
      expect(sim.player.auras.some((aura) => aura.id === 'rog_deadly_brew')).toBe(false);
    }
  });

  it('keeps the shared option useful for Combat and Skulduggery', () => {
    for (const spec of ['combat', 'subtlety'] as const) {
      const sim = rogueSim({ spec });
      addWeaponPoison(sim.player);
      for (let hit = 0; hit < 4; hit++) onMeleeSwing(sim.ctx, sim.player, 'hemorrhage');

      expect(sim.player.auras.find((aura) => aura.id === 'rog_deadly_brew')).toMatchObject({
        kind: 'next_cast_free',
        empowerAbilities: ['crippling_poison'],
      });
    }
  });

  it('spends the banked window on one free Leaden Venom and leaves other abilities scoped out', () => {
    const sim = rogueSim();
    targetFor(sim);
    addWeaponPoison(sim.player);
    for (let hit = 0; hit < 4; hit++) onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;

    sim.castAbility('crippling_poison');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.gcdRemaining).toBeGreaterThan(0);
    expect(sim.player.auras.some((aura) => aura.id === 'rog_deadly_brew')).toBe(false);

    const scoped = rogueSim();
    addWeaponPoison(scoped.player);
    for (let hit = 0; hit < 4; hit++) onMeleeSwing(scoped.ctx, scoped.player, 'auto_attack');
    expect(
      scoped.player.auras.find((aura) => aura.id === 'rog_deadly_brew')?.empowerAbilities,
    ).not.toContain('eviscerate');
  });

  it('plays the full poisoned cadence into a free Leaden Venom and free bleed finisher', () => {
    const sim = rogueSim();
    targetFor(sim);
    addWeaponPoison(sim.player);
    for (let hit = 0; hit < 4; hit++) onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    sim.player.resource = 0;
    sim.player.comboPoints = 5;
    sim.player.comboUntil = sim.ctx.time + 30;

    sim.castAbility('crippling_poison');
    for (let tick = 0; tick < 20; tick++) sim.tick();

    expect(sim.player.resource).toBe(0);
    expect(sim.player.comboPoints).toBe(5);
    expect(sim.player.auras.some((aura) => aura.id === 'rog_deadly_brew')).toBe(false);
    expect(sim.player.auras.find((aura) => aura.id === 'rog_redhanded')).toMatchObject({
      kind: 'next_cast_free',
      empowerAbilities: ['eviscerate', 'rupture'],
    });

    sim.player.gcdRemaining = 0;
    sim.castAbility('rupture');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.comboPoints).toBe(0);
    expect(sim.player.auras.filter((aura) => aura.id === 'rog_redhanded')).toEqual([]);
  });

  it('clears a partial cadence and its visible window when deselected', () => {
    const sim = rogueSim();
    addWeaponPoison(sim.player);
    for (let hit = 0; hit < 5; hit++) onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    expect(sim.player.procState?.counters.rog_deadly_brew).toBe(1);
    expect(sim.player.auras.some((aura) => aura.id === 'rog_deadly_brew')).toBe(true);

    expect(sim.applyTalents({ spec: 'assassination', rows: {} })).toBe(true);

    expect(sim.player.procState?.counters.rog_deadly_brew).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.id === 'rog_deadly_brew')).toBe(false);
  });

  it('localizes Venom Dividend in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Venom Dividend', language)).not.toBe('Venom Dividend');
    }
  });
});
