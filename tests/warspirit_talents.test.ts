import { describe, expect, it } from 'vitest';
import { onMeleeSwing } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const TEMPEST_REPRISE_ID = 'sha_r20_elemental_fury';

function shamanSim(
  options: {
    seed?: number;
    spec?: 'elemental' | 'enhancement' | 'restoration';
    selectReprise?: boolean;
  } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 170727, playerClass: 'shaman', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'enhancement',
      rows: options.selectReprise === false ? {} : { 20: TEMPEST_REPRISE_ID },
    }),
  ).toBe(true);
  return sim;
}

function resetSequence(seed: number): { draws: number; resets: boolean[] } {
  const sim = shamanSim({ seed });
  let draws = 0;
  sim.ctx.rng.setObserver(() => draws++);
  const resets: boolean[] = [];
  for (let attempt = 0; attempt < 64; attempt++) {
    sim.player.cooldowns.set('stormstrike', 10);
    onMeleeSwing(sim.ctx, sim.player, 'stormstrike');
    resets.push(!sim.player.cooldowns.has('stormstrike'));
  }
  sim.ctx.rng.setObserver(null);
  return { draws, resets };
}

describe('Warspirit row replacement', () => {
  it('keeps the shared row valid and replaces Earthen Fury without changing its stable id', () => {
    const row = ROW_TREES.shaman.find((candidate) => candidate.level === 20);
    const reprise = row?.options.find((option) => option.id === TEMPEST_REPRISE_ID);

    expect(validateTalentTree(TALENTS.shaman)).toEqual([]);
    expect(validateRowTree(ROW_TREES.shaman)).toEqual([]);
    expect(row?.options.map((option) => option.name)).toEqual([
      'Storm Chorus',
      'Tempest Reprise',
      'Undertow Promise',
    ]);
    expect(reprise?.effect.ability).toBeUndefined();
    expect(reprise?.effect.proc).toEqual({
      id: 'sha_tempest_reprise',
      name: 'Tempest Reprise',
      school: 'nature',
      spec: 'enhancement',
      trigger: { on: 'meleeHit', abilities: ['stormstrike'], chance: 0.2 },
      responses: [{ kind: 'cooldownRefund', ability: 'stormstrike', seconds: 'reset' }],
    });
  });

  it('rolls exactly once after each matching landed hit and resets on successful rolls', () => {
    const first = resetSequence(170727);
    const replay = resetSequence(170727);

    expect(first).toEqual(replay);
    expect(first.draws).toBe(64);
    expect(first.resets.some(Boolean)).toBe(true);
    expect(first.resets.every(Boolean)).toBe(false);
  });

  it('uses the authored 20% chance polarity for both a proc and a failure', () => {
    const sim = shamanSim();
    const outcomes = [true, false];
    const probabilities: number[] = [];
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      chance(probability: number): boolean;
    };
    rng.chance = (probability) => {
      probabilities.push(probability);
      return outcomes.shift() ?? false;
    };

    sim.player.cooldowns.set('stormstrike', 10);
    onMeleeSwing(sim.ctx, sim.player, 'stormstrike');
    expect(sim.player.cooldowns.has('stormstrike')).toBe(false);

    sim.player.cooldowns.set('stormstrike', 10);
    onMeleeSwing(sim.ctx, sim.player, 'stormstrike');
    expect(sim.player.cooldowns.get('stormstrike')).toBe(10);
    expect(probabilities).toEqual([0.2, 0.2]);
  });

  it('does not roll or reset from a production-path dodged Ancestral Strike', () => {
    const sim = shamanSim();
    const dodgerId = sim.addPlayer('rogue', 'Reprise Dodger');
    sim.setPlayerLevel(1, dodgerId);
    const target = sim.entities.get(dodgerId);
    if (!target) throw new Error('missing dodge target');
    target.dodgeChance = 1;
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      next(): number;
      chance(probability: number): boolean;
    };
    let procChanceCalls = 0;
    rng.next = () => 0.5;
    rng.chance = (probability) => {
      if (probability === 0.2) procChanceCalls++;
      return false;
    };
    sim.player.cooldowns.set('stormstrike', 10);

    expect(sim.ctx.meleeSwing(sim.player, target, 0, null, { abilityId: 'stormstrike' })).toBe(
      false,
    );

    expect(procChanceCalls).toBe(0);
    expect(sim.player.cooldowns.get('stormstrike')).toBe(10);
    expect(sim.player.auras.some((aura) => aura.id === 'sha_skyrend')).toBe(false);
  });

  it('draws no proc RNG for an auto-attack, an unselected row, or another Shaman spec', () => {
    const cases: Array<[Sim, string]> = [
      [shamanSim(), 'auto_attack'],
      [shamanSim({ selectReprise: false }), 'stormstrike'],
      [shamanSim({ spec: 'elemental' }), 'stormstrike'],
      [shamanSim({ spec: 'restoration' }), 'stormstrike'],
    ];
    for (const [sim, abilityId] of cases) {
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      sim.player.cooldowns.set('stormstrike', 10);
      onMeleeSwing(sim.ctx, sim.player, abilityId);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.cooldowns.get('stormstrike')).toBe(10);
    }
  });

  it('localizes Tempest Reprise in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Tempest Reprise', language)).not.toBe('Tempest Reprise');
    }
  });
});
