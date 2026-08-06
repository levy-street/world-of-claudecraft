import { describe, expect, it } from 'vitest';
import { accumulateTalentEffect, emptyModifiers } from '../src/sim/content/talents';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { AbilityDef } from '../src/sim/types';

// Minimal ability stub: only the fields resolveTalentHitMult reads.
function def(partial: Partial<AbilityDef>): AbilityDef {
  return {
    id: 'x',
    name: 'X',
    class: 'mage',
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    learnLevel: 1,
    effects: [],
    description: '',
    ...partial,
  };
}

describe('resolveTalentHitMult', () => {
  it('with no talents applied, both multipliers are 1 (a no-op)', () => {
    const mods = emptyModifiers();
    expect(resolveTalentHitMult(def({}), mods)).toEqual({ dmgMult: 1, healMult: 1 });
  });

  it('a global spellDmgPct reaches a spell-school ability dmgMult, not physical', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { global: { spellDmgPct: 0.2 } });
    expect(resolveTalentHitMult(def({ school: 'fire' }), mods).dmgMult).toBeCloseTo(1.2, 10);
    expect(resolveTalentHitMult(def({ school: 'physical' }), mods).dmgMult).toBeCloseTo(1, 10);
  });

  it('a global meleeDmgPct reaches a physical ability, and a ranged attack-spell too', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { global: { meleeDmgPct: 0.3 } });
    expect(resolveTalentHitMult(def({ school: 'physical' }), mods).dmgMult).toBeCloseTo(1.3, 10);
    // Hunter ranged shots (scalesWith: 'ranged') take the melee bucket regardless
    // of magic school, mirroring applyTalentMods (classes.ts).
    expect(
      resolveTalentHitMult(def({ school: 'nature', scalesWith: 'ranged' }), mods).dmgMult,
    ).toBeCloseTo(1.3, 10);
    expect(resolveTalentHitMult(def({ school: 'fire' }), mods).dmgMult).toBeCloseTo(1, 10);
  });

  it('a global healPct reaches healMult regardless of the ability school', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { global: { healPct: 0.15 } });
    expect(resolveTalentHitMult(def({ school: 'holy' }), mods).healMult).toBeCloseTo(1.15, 10);
    expect(resolveTalentHitMult(def({ school: 'physical' }), mods).healMult).toBeCloseTo(1.15, 10);
  });

  it('a per-ability dmgPct stacks additively on top of the global bucket, on both mults', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { global: { spellDmgPct: 0.1 } });
    accumulateTalentEffect(mods, { ability: [{ ability: 'frostbolt', dmgPct: 0.25 }] });
    const scoped = resolveTalentHitMult(def({ id: 'frostbolt', school: 'frost' }), mods);
    expect(scoped.dmgMult).toBeCloseTo(1.35, 10);
    expect(scoped.healMult).toBeCloseTo(1.25, 10);
    // A different ability of the same school only sees the global bucket.
    const unscoped = resolveTalentHitMult(def({ id: 'frost_nova', school: 'frost' }), mods);
    expect(unscoped.dmgMult).toBeCloseTo(1.1, 10);
    expect(unscoped.healMult).toBeCloseTo(1, 10);
  });
});
