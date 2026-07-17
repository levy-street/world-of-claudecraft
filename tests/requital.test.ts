import { describe, expect, it } from 'vitest';
import { onMeleeSwing } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function paladinSim(
  spec: 'holy' | 'protection' | 'retribution' = 'retribution',
  seed = 170728,
): Sim {
  const sim = new Sim({ seed, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.critChance = 0;
  sim.player.spellPower = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_002, MOBS.forest_wolf, 20, {
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

function procSequence(seed: number): { draws: number; procs: boolean[] } {
  const sim = paladinSim('retribution', seed);
  let draws = 0;
  sim.ctx.rng.setObserver(() => draws++);
  const procs: boolean[] = [];
  for (let attempt = 0; attempt < 64; attempt++) {
    sim.player.cooldowns.set('exorcism', 15);
    sim.player.auras = sim.player.auras.filter((aura) => aura.id !== 'pal_blood_debt');
    onMeleeSwing(sim.ctx, sim.player, attempt % 2 === 0 ? 'auto_attack' : 'crusader_strike');
    procs.push(
      !sim.player.cooldowns.has('exorcism') &&
        sim.player.auras.some(
          (aura) =>
            aura.id === 'pal_blood_debt' &&
            aura.kind === 'next_cast_free' &&
            aura.empowerAbilities?.includes('exorcism'),
        ),
    );
  }
  sim.ctx.rng.setObserver(null);
  return { draws, procs };
}

describe('Requital Blood Debt', () => {
  it('authors a valid Requital mastery with a reactive Rite proc', () => {
    const spec = TALENTS.paladin.specs.find((candidate) => candidate.id === 'retribution');

    expect(validateTalentTree(TALENTS.paladin)).toEqual([]);
    expect(spec?.mastery.name).toBe('Blood Debt');
    expect(spec?.mastery.description).toContain('melee auto-attack');
    expect(spec?.mastery.description).toContain('Crusader Strike');
    expect(spec?.mastery.description).toContain('Rite of Expulsion');
    expect(spec?.mastery.effect.proc).toEqual({
      id: 'pal_blood_debt',
      name: 'Blood Debt',
      school: 'holy',
      spec: 'retribution',
      requiresKnownAbility: 'exorcism',
      trigger: {
        on: 'meleeHit',
        abilities: ['auto_attack', 'crusader_strike'],
        chance: 0.2,
        chanceWhenEmpowered: {
          ability: 'crusader_strike',
          auraId: 'pal_oaths_due',
          chance: 0.7,
        },
      },
      responses: [
        { kind: 'cooldownRefund', ability: 'exorcism', seconds: 'reset' },
        {
          kind: 'empowerNext',
          aura: 'next_cast_free',
          abilities: ['exorcism'],
          duration: 8,
        },
      ],
    });
  });

  it('rolls once per matching landed hit and replays the same proc sequence for the same seed', () => {
    const first = procSequence(170728);
    const replay = procSequence(170728);

    expect(first).toEqual(replay);
    expect(first.draws).toBe(64);
    expect(first.procs.some(Boolean)).toBe(true);
    expect(first.procs.every(Boolean)).toBe(false);
  });

  it('uses the authored 20% chance polarity for both a proc and a failure', () => {
    const sim = paladinSim();
    const outcomes = [true, false];
    const probabilities: number[] = [];
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      chance(probability: number): boolean;
    };
    rng.chance = (probability) => {
      probabilities.push(probability);
      return outcomes.shift() ?? false;
    };

    onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(true);

    sim.player.auras = sim.player.auras.filter((aura) => aura.id !== 'pal_blood_debt');
    onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(false);
    expect(probabilities).toEqual([0.2, 0.2]);
  });

  it('does not roll Blood Debt before Rite of Expulsion is learned', () => {
    const sim = new Sim({ seed: 170728, playerClass: 'paladin', autoEquip: false });
    sim.setPlayerLevel(5);
    expect(sim.applyTalents({ spec: 'retribution', rows: {} })).toBe(true);
    const meta = sim.meta(sim.playerId);
    expect(meta?.known.some((ability) => ability.def.id === 'exorcism')).toBe(false);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      chance(probability: number): boolean;
    };
    let procChanceCalls = 0;
    rng.chance = (probability) => {
      if (probability === 0.2) procChanceCalls++;
      return true;
    };

    onMeleeSwing(sim.ctx, sim.player, 'auto_attack');

    expect(procChanceCalls).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(false);
  });

  it('does not roll or arm Blood Debt from production-path misses and dodges', () => {
    const sim = paladinSim();
    const missTarget = targetFor(sim);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      next(): number;
      chance(probability: number): boolean;
    };
    let procChanceCalls = 0;
    rng.chance = (probability) => {
      if (probability === 0.2) procChanceCalls++;
      return true;
    };

    rng.next = () => 0;
    expect(sim.ctx.meleeSwing(sim.player, missTarget, 0, null, { abilityId: 'auto_attack' })).toBe(
      false,
    );

    const dodgerId = sim.addPlayer('rogue', 'Debt Dodger');
    sim.setPlayerLevel(1, dodgerId);
    const dodgeTarget = sim.entities.get(dodgerId);
    if (!dodgeTarget) throw new Error('missing dodge target');
    dodgeTarget.dodgeChance = 1;
    rng.next = () => 0.5;
    expect(sim.ctx.meleeSwing(sim.player, dodgeTarget, 0, null, { abilityId: 'auto_attack' })).toBe(
      false,
    );

    expect(procChanceCalls).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(false);
  });

  it('draws no proc RNG outside Requital or for an unrelated landed ability', () => {
    const cases: Array<[Sim, string]> = [
      [paladinSim('retribution'), 'judgement'],
      [paladinSim('holy'), 'auto_attack'],
      [paladinSim('protection'), 'crusader_strike'],
    ];
    for (const [sim, abilityId] of cases) {
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      sim.player.cooldowns.set('exorcism', 15);
      onMeleeSwing(sim.ctx, sim.player, abilityId);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.cooldowns.get('exorcism')).toBe(15);
      expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(false);
    }
  });

  it('routes Crusader Strike through the landed-hit proc and spends the free Rite exactly once', () => {
    const sim = paladinSim();
    const target = targetFor(sim);
    const meta = sim.meta(sim.playerId);
    const oathStrike = sim.resolvedAbility('crusader_strike');
    if (!meta || !oathStrike) throw new Error('missing Requital combat data');
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      next(): number;
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    rng.next = () => 0.9;
    rng.range = (min) => min;
    rng.chance = (probability) => probability === 0.2;
    sim.player.cooldowns.set('exorcism', 15);

    sim.ctx.runEffects(sim.player, meta, target, oathStrike);

    const proc = sim.player.auras.find((aura) => aura.id === 'pal_blood_debt');
    expect(sim.player.cooldowns.has('exorcism')).toBe(false);
    expect(proc).toMatchObject({
      kind: 'next_cast_free',
      remaining: 8,
      empowerAbilities: ['exorcism'],
    });

    sim.targetEntity(target.id);
    sim.player.facing = Math.atan2(
      target.pos.x - sim.player.pos.x,
      target.pos.z - sim.player.pos.z,
    );
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    rng.chance = () => true;
    const before = target.hp;

    sim.castAbility('exorcism');
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(0);
    expect(sim.player.cooldowns.get('exorcism')).toBe(15);
    expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(false);
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
      advancePendingProjectiles(sim.ctx);
    }

    expect(target.hp).toBeLessThan(before);
  });

  it('clears the spec-owned Rite proc when Requital is left', () => {
    const sim = paladinSim();
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      chance(probability: number): boolean;
    };
    rng.chance = () => true;
    onMeleeSwing(sim.ctx, sim.player, 'auto_attack');
    expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(true);

    expect(sim.applyTalents({ spec: 'holy', rows: {} })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id === 'pal_blood_debt')).toBe(false);
  });

  it('localizes the visible Blood Debt proc in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Blood Debt', language)).not.toBe('Blood Debt');
    }
  });
});
