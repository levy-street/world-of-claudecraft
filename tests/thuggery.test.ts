import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const FINISHERS = ['eviscerate', 'rupture', 'kidney_shot', 'slice_and_dice', 'expose_armor'];

function rogueSim(spec: 'assassination' | 'combat' | 'subtlety' = 'combat'): Sim {
  const sim = new Sim({ seed: 170739, playerClass: 'rogue', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_403, MOBS.forest_wolf, 20, {
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

function autoHit(sim: Sim, target: Entity): number {
  fixedMeleeRolls(sim);
  sim.player.weapon = { ...sim.player.weapon, min: 100, max: 100 };
  const before = target.hp;
  expect(
    sim.ctx.meleeSwing(sim.player, target, 0, 'Attack', {
      abilityId: 'auto_attack',
      cannotBeDodged: true,
    }),
  ).toBe(true);
  return before - target.hp;
}

describe("Thuggery Scrapper's Edge", () => {
  it('authors a valid finisher-to-weapon mastery while preserving its haste rating axis', () => {
    const spec = TALENTS.rogue.specs.find((candidate) => candidate.id === 'combat');

    expect(validateTalentTree(TALENTS.rogue)).toEqual([]);
    expect(spec?.mastery.name).toBe("Scrapper's Edge");
    expect(spec?.mastery.description).toContain('Finishers restore 10 energy');
    expect(spec?.mastery.description).toContain('next landed melee auto-attack');
    expect(spec?.mastery.effect).toEqual({
      global: { meleeHastePct: 0.1, meleeDmgPct: -0.1 },
      proc: {
        id: 'rog_scrappers_edge',
        name: "Scrapper's Edge",
        spec: 'combat',
        requiresKnownAbility: 'blade_flurry',
        school: 'physical',
        trigger: { on: 'castNth', n: 1, abilities: FINISHERS },
        responses: [
          { kind: 'resource', amount: 10 },
          { kind: 'cooldownRefund', ability: 'blade_flurry', seconds: 4 },
          {
            kind: 'empowerNext',
            aura: 'next_ability_damage',
            abilities: ['auto_attack'],
            duration: 8,
            dmgPct: 0.5,
          },
        ],
      },
    });
  });

  it('converts a real combo-point finisher into energy, signature time, and a loaded swing', () => {
    const sim = rogueSim();
    targetFor(sim);
    sim.player.resource = 100;
    sim.player.comboPoints = 5;
    sim.player.cooldowns.set('blade_flurry', 100);

    sim.castAbility('eviscerate');

    expect(sim.player.comboPoints).toBe(0);
    expect(sim.player.resource).toBe(75);
    expect(sim.player.cooldowns.get('blade_flurry')).toBe(96);
    expect(sim.player.auras.find((aura) => aura.id === 'rog_scrappers_edge')).toMatchObject({
      kind: 'next_ability_damage',
      remaining: 8,
      duration: 8,
      value: 0.5,
      empowerAbilities: ['auto_attack'],
    });
  });

  it('responds to every Rogue finisher but not builders or utility casts', () => {
    for (const abilityId of FINISHERS) {
      const sim = rogueSim();
      sim.player.resource = 0;
      onCastCompleted(sim.ctx, sim.player, abilityId, sim.player);
      expect(sim.player.resource, abilityId).toBe(10);
      expect(sim.player.auras.some((aura) => aura.id === 'rog_scrappers_edge')).toBe(true);
    }

    for (const abilityId of ['sinister_strike', 'hemorrhage', 'vanish']) {
      const sim = rogueSim();
      sim.player.resource = 0;
      onCastCompleted(sim.ctx, sim.player, abilityId, sim.player);
      expect(sim.player.resource, abilityId).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === 'rog_scrappers_edge')).toBe(false);
    }
  });

  it('uses a replayable zero-draw cadence and refreshes rather than stacking the swing window', () => {
    const run = () => {
      const sim = rogueSim();
      sim.player.resource = 0;
      sim.player.cooldowns.set('blade_flurry', 20);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      onCastCompleted(sim.ctx, sim.player, 'eviscerate', sim.player);
      onCastCompleted(sim.ctx, sim.player, 'rupture', sim.player);

      sim.ctx.rng.setObserver(null);
      return {
        draws,
        resource: sim.player.resource,
        cooldown: sim.player.cooldowns.get('blade_flurry'),
        windows: sim.player.auras.filter((aura) => aura.id === 'rog_scrappers_edge').length,
      };
    };

    expect(run()).toEqual({ draws: 0, resource: 20, cooldown: 12, windows: 1 });
    expect(run()).toEqual(run());
  });

  it('makes exactly one landed auto-attack 50% stronger and preserves the window on a miss', () => {
    const baseline = rogueSim();
    const baselineDamage = autoHit(baseline, targetFor(baseline));

    const sim = rogueSim();
    const target = targetFor(sim);
    onCastCompleted(sim.ctx, sim.player, 'eviscerate', sim.player);
    const empoweredDamage = autoHit(sim, target);

    expect(empoweredDamage).toBeGreaterThanOrEqual(Math.floor(baselineDamage * 1.5));
    expect(empoweredDamage).toBeLessThanOrEqual(Math.ceil(baselineDamage * 1.5));
    expect(sim.player.auras.some((aura) => aura.id === 'rog_scrappers_edge')).toBe(false);

    const missed = rogueSim();
    const missedTarget = targetFor(missed);
    onCastCompleted(missed.ctx, missed.player, 'eviscerate', missed.player);
    missed.player.auras.push({
      id: 'test_blind',
      name: 'Test Blind',
      kind: 'blind',
      remaining: 5,
      duration: 5,
      value: 1,
      sourceId: missed.player.id,
      school: 'physical',
    });
    expect(
      missed.ctx.meleeSwing(missed.player, missedTarget, 0, 'Attack', {
        abilityId: 'auto_attack',
        cannotBeDodged: true,
      }),
    ).toBe(false);
    expect(missed.player.auras.some((aura) => aura.id === 'rog_scrappers_edge')).toBe(true);
  });

  it('does not build, spend, or draw outside Thuggery or before Mirrored Blades is learned', () => {
    const withoutSignature = rogueSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Thuggery metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'blade_flurry');

    for (const sim of [rogueSim('assassination'), rogueSim('subtlety'), withoutSignature]) {
      sim.player.resource = 0;
      sim.player.cooldowns.set('blade_flurry', 20);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onCastCompleted(sim.ctx, sim.player, 'eviscerate', sim.player);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.resource).toBe(0);
      expect(sim.player.cooldowns.get('blade_flurry')).toBe(20);
      expect(sim.player.auras.some((aura) => aura.id === 'rog_scrappers_edge')).toBe(false);
    }
  });

  it('expires naturally and clears immediately when Thuggery is left', () => {
    const expired = rogueSim();
    onCastCompleted(expired.ctx, expired.player, 'eviscerate', expired.player);
    for (let tick = 0; tick < 161; tick++) expired.tick();
    expect(expired.player.auras.some((aura) => aura.id === 'rog_scrappers_edge')).toBe(false);

    const changedSpec = rogueSim();
    onCastCompleted(changedSpec.ctx, changedSpec.player, 'eviscerate', changedSpec.player);
    expect(changedSpec.applyTalents({ spec: 'subtlety', rows: {} })).toBe(true);
    expect(changedSpec.player.auras.some((aura) => aura.id === 'rog_scrappers_edge')).toBe(false);
  });

  it("localizes Scrapper's Edge in every non-Latin release locale", () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle("Scrapper's Edge", language)).not.toBe("Scrapper's Edge");
    }
  });
});
