import { describe, expect, it } from 'vitest';
import { onRangedHit } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function hunterSim(spec: 'beast_mastery' | 'marksmanship' | 'survival' = 'marksmanship'): Sim {
  const sim = new Sim({ seed: 170733, playerClass: 'hunter', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.critChance = 0;
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_201, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 10,
  });
  target.hostile = true;
  target.stats = { ...target.stats, armor: 0 };
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

function faceAndTarget(sim: Sim, target: Entity): void {
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
  sim.player.gcdRemaining = 0;
}

describe('Coldsight Iron Aim', () => {
  it('authors a valid landed-shot setup for an eight-second Long Draw execute', () => {
    const spec = TALENTS.hunter.specs.find((candidate) => candidate.id === 'marksmanship');

    expect(validateTalentTree(TALENTS.hunter)).toEqual([]);
    expect(spec?.mastery.name).toBe('Iron Aim');
    expect(spec?.mastery.description).toContain('landed Rattling Shot');
    expect(spec?.mastery.description).toContain('Long Draw');
    expect(spec?.mastery.effect.global).toBeUndefined();
    expect(spec?.mastery.effect.ability).toEqual(
      ['serpent_sting', 'arcane_shot', 'concussive_shot', 'aimed_shot', 'multi_shot', 'volley'].map(
        (ability) => ({ ability, dmgPct: 0.1 }),
      ),
    );
    expect(spec?.mastery.effect.proc).toEqual({
      id: 'hun_iron_aim',
      name: 'Iron Aim',
      spec: 'marksmanship',
      requiresKnownAbility: 'aimed_shot',
      school: 'physical',
      trigger: { on: 'rangedHit', abilities: ['concussive_shot'] },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_cast_instant',
          abilities: ['aimed_shot'],
          duration: 8,
        },
      ],
    });
  });

  it('arms from one matching landed physical shot without drawing RNG', () => {
    const run = (): { draws: number; window: Partial<Aura> | undefined } => {
      const sim = hunterSim();
      const target = targetFor(sim);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      sim.dealDamage(
        sim.player,
        target,
        10,
        false,
        'physical',
        'Rattling Shot',
        'hit',
        false,
        undefined,
        true,
        false,
        false,
        'concussive_shot',
      );

      sim.ctx.rng.setObserver(null);
      const aura = sim.player.auras.find((candidate) => candidate.id === 'hun_iron_aim');
      return {
        draws,
        window: aura && {
          kind: aura.kind,
          remaining: aura.remaining,
          duration: aura.duration,
          empowerAbilities: aura.empowerAbilities,
        },
      };
    };

    expect(run()).toEqual({
      draws: 0,
      window: {
        kind: 'next_cast_instant',
        remaining: 8,
        duration: 8,
        empowerAbilities: ['aimed_shot'],
      },
    });
    expect(run()).toEqual(run());
  });

  it('arms on Rattling Shot impact, not launch, and fizzles with a dead target', () => {
    const sim = hunterSim();
    const target = targetFor(sim);
    faceAndTarget(sim, target);

    sim.castAbility('concussive_shot');

    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(false);
    for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
      advancePendingProjectiles(sim.ctx);
    }
    expect(sim.ctx.pendingProjectiles).toHaveLength(0);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(true);

    const fizzled = hunterSim();
    const deadTarget = targetFor(fizzled);
    faceAndTarget(fizzled, deadTarget);
    fizzled.castAbility('concussive_shot');
    deadTarget.dead = true;
    advancePendingProjectiles(fizzled.ctx);

    expect(fizzled.ctx.pendingProjectiles).toHaveLength(0);
    expect(fizzled.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(false);
  });

  it('counts a Rattling Shot hit that ends a duel at the one-health guard', () => {
    const sim = hunterSim();
    const rivalId = sim.addPlayer('warrior', 'Rival');
    const rival = sim.entities.get(rivalId);
    if (!rival) throw new Error('missing duel rival');
    const duel = { a: sim.playerId, b: rivalId, state: 'active' as const, timer: 0 };
    sim.ctx.duels.set(sim.playerId, duel);
    sim.ctx.duels.set(rivalId, duel);

    sim.dealDamage(
      sim.player,
      rival,
      rival.hp + 100,
      false,
      'physical',
      'Rattling Shot',
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      'concussive_shot',
    );

    expect(rival.hp).toBe(1);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(true);
  });

  it('does not arm from zero damage, absorbed damage, incidental damage, or another shot', () => {
    const cases: Array<{ amount: number; direct: boolean; abilityId: string; absorb?: number }> = [
      { amount: 0, direct: true, abilityId: 'concussive_shot' },
      { amount: 10, direct: true, abilityId: 'concussive_shot', absorb: 10 },
      { amount: 10, direct: false, abilityId: 'concussive_shot' },
      { amount: 10, direct: true, abilityId: 'aimed_shot' },
    ];
    for (const testCase of cases) {
      const sim = hunterSim();
      const target = targetFor(sim);
      if (testCase.absorb) {
        target.auras.push({
          id: 'test_absorb',
          name: 'Test Absorb',
          kind: 'absorb',
          value: testCase.absorb,
          remaining: 10,
          duration: 10,
          sourceId: target.id,
          school: 'physical',
        });
      }

      sim.dealDamage(
        sim.player,
        target,
        testCase.amount,
        false,
        'physical',
        'Test Shot',
        'hit',
        false,
        undefined,
        testCase.direct,
        false,
        false,
        testCase.abilityId,
      );

      expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(false);
    }
  });

  it('gates the landed hook outside Coldsight and before Long Draw is known', () => {
    const withoutLongDraw = hunterSim();
    const meta = withoutLongDraw.meta(withoutLongDraw.playerId);
    if (!meta) throw new Error('missing Coldsight metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'aimed_shot');
    for (const sim of [hunterSim('beast_mastery'), hunterSim('survival'), withoutLongDraw]) {
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onRangedHit(sim.ctx, sim.player, 'concussive_shot', sim.player);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(false);
    }
  });

  it('turns the next Long Draw into one mobile instant shot and consumes the window', () => {
    const baseline = hunterSim();
    const baselineTarget = targetFor(baseline);
    faceAndTarget(baseline, baselineTarget);
    baseline.castAbility('aimed_shot');
    expect(baseline.player.castingAbility).toBe('aimed_shot');
    expect(baseline.player.castTotal).toBe(3);

    const sim = hunterSim();
    const target = targetFor(sim);
    faceAndTarget(sim, target);
    onRangedHit(sim.ctx, sim.player, 'concussive_shot', target);
    const manaBefore = sim.player.resource;

    sim.castAbility('aimed_shot');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    expect(sim.player.resource).toBe(manaBefore - 50);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(false);
  });

  it('clears the setup window when Coldsight is left', () => {
    const sim = hunterSim();
    onRangedHit(sim.ctx, sim.player, 'concussive_shot', sim.player);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(true);

    expect(sim.applyTalents({ spec: 'survival', rows: {} })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id === 'hun_iron_aim')).toBe(false);
  });

  it('localizes the visible Iron Aim window in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Iron Aim', language)).not.toBe('Iron Aim');
    }
  });
});
