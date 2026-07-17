import { describe, expect, it } from 'vitest';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { onShieldConsumed } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function doctrineSim(spec: 'discipline' | 'holy' | 'shadow' = 'discipline', seed = 178_501): Sim {
  const sim = new Sim({ seed, playerClass: 'priest', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  sim.player.spellPower = 0;
  sim.player.hp = Math.max(1, sim.player.maxHp - 500);
  sim.targetEntity(sim.player.id);
  return sim;
}

function aura(sim: Sim, id: string) {
  return sim.player.auras.find((candidate) => candidate.id === id);
}

describe('Doctrine Fixed Purpose', () => {
  it('authors a valid, explicitly gated shield-to-heal relay', () => {
    const discipline = TALENTS.priest.specs.find((spec) => spec.id === 'discipline');

    expect(validateTalentTree(TALENTS.priest)).toEqual([]);
    expect(discipline?.signature).toBe('power_infusion');
    expect(discipline?.mastery.name).toBe('Fixed Purpose');
    expect(discipline?.mastery.description).toContain('Psalm of Warding is fully consumed');
    expect(discipline?.mastery.description).toContain('cost 50% less');
    expect(discipline?.mastery.effect).toEqual({
      global: { absorbPct: 0.3 },
      proc: {
        id: 'pri_fixed_purpose',
        name: 'Fixed Purpose',
        spec: 'discipline',
        requiresKnownAbility: 'power_word_shield',
        school: 'holy',
        trigger: { on: 'shieldConsumed', ability: 'power_word_shield' },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_cheap',
            abilities: ['lesser_heal', 'heal', 'flash_heal'],
            duration: 8,
            costPct: 0.5,
          },
        ],
      },
    });
    expect(doctrineSim().player.resourceType).toBe('mana');
  });

  it('turns a consumed ward into one half-mana direct prayer', () => {
    const sim = doctrineSim();
    onShieldConsumed(sim.ctx, sim.player, 'power_word_shield', sim.player);
    expect(aura(sim, 'pri_fixed_purpose')).toMatchObject({
      name: 'Fixed Purpose',
      kind: 'next_cast_cheap',
      remaining: 8,
      duration: 8,
      value: 0.5,
      empowerAbilities: ['lesser_heal', 'heal', 'flash_heal'],
      sourceId: sim.player.id,
      school: 'holy',
    });

    const prayer = sim.resolvedAbility('heal');
    if (!prayer) throw new Error('missing Doctrine rotation ability');
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing Priest metadata');
    const manaBeforePrayer = sim.player.resource;
    sim.castAbility('heal');

    expect(sim.player.castingAbility).toBe('heal');
    expect(aura(sim, 'pri_fixed_purpose')).toBeDefined();
    sim.player.castRemaining = 0;
    updateCasting(sim.ctx, sim.player, meta);

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBeforePrayer - Math.ceil(prayer.cost * 0.5));
    expect(aura(sim, 'pri_fixed_purpose')).toBeUndefined();
  });

  it('requires Doctrine, a known ward, and the exact shield and prayer hooks', () => {
    for (const sim of [doctrineSim('holy'), doctrineSim('shadow')]) {
      onShieldConsumed(sim.ctx, sim.player, 'power_word_shield', sim.player);
      expect(aura(sim, 'pri_fixed_purpose')).toBeUndefined();
    }

    const withoutWard = doctrineSim();
    const meta = withoutWard.meta(withoutWard.playerId);
    if (!meta) throw new Error('missing Priest metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'power_word_shield');
    onShieldConsumed(withoutWard.ctx, withoutWard.player, 'power_word_shield', withoutWard.player);
    expect(aura(withoutWard, 'pri_fixed_purpose')).toBeUndefined();

    const wrongHooks = doctrineSim();
    onShieldConsumed(wrongHooks.ctx, wrongHooks.player, 'other_shield', wrongHooks.player);
    expect(aura(wrongHooks, 'pri_fixed_purpose')).toBeUndefined();
  });

  it('refreshes one window and clears it when Doctrine is left', () => {
    const sim = doctrineSim();
    onShieldConsumed(sim.ctx, sim.player, 'power_word_shield', sim.player);
    const first = aura(sim, 'pri_fixed_purpose');
    if (!first) throw new Error('missing first Fixed Purpose window');
    first.remaining = 2;
    onShieldConsumed(sim.ctx, sim.player, 'power_word_shield', sim.player);
    expect(sim.player.auras.filter((entry) => entry.id === 'pri_fixed_purpose')).toHaveLength(1);
    expect(aura(sim, 'pri_fixed_purpose')?.remaining).toBe(8);

    expect(sim.applyTalents({ spec: 'holy', rows: {} })).toBe(true);

    expect(aura(sim, 'pri_fixed_purpose')).toBeUndefined();
  });

  it('adds no proc draws and replays the ward relay exactly', () => {
    const run = () => {
      const sim = doctrineSim('discipline', 178_502);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onShieldConsumed(sim.ctx, sim.player, 'power_word_shield', sim.player);
      sim.ctx.rng.setObserver(null);
      const window = aura(sim, 'pri_fixed_purpose');
      return {
        draws,
        window: window ? [window.id, window.kind, window.remaining, window.value] : null,
      };
    };

    expect(run()).toEqual({
      draws: [],
      window: ['pri_fixed_purpose', 'next_cast_cheap', 8, 0.5],
    });
    expect(run()).toEqual(run());
  });

  it('keeps Fixed Purpose filled in every required non-Latin locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Fixed Purpose', language)).not.toBe('Fixed Purpose');
    }
  });
});
