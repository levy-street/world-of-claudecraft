import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { WARLOCK_TALENTS } from '../src/sim/content/talents_classic';
import { WARLOCK_PET_MOBS } from '../src/sim/content/warlock_pets';

function dotTotal(abilityId: string, level = 20): number {
  const known = abilitiesKnownAt('warlock', level).find((entry) => entry.def.id === abilityId);
  const dot = known?.effects.find((effect) => effect.type === 'dot');
  if (dot?.type !== 'dot') throw new Error(`${abilityId} has no DoT at level ${level}`);
  return dot.total;
}

function rawPetDps(templateId: keyof typeof WARLOCK_PET_MOBS, level = 20): number {
  const pet = WARLOCK_PET_MOBS[templateId];
  return (pet.dmgBase + pet.dmgPerLevel * (level - 1)) / pet.attackSpeed;
}

function node(id: string) {
  const talent = WARLOCK_TALENTS.nodes.find((entry) => entry.id === id);
  if (!talent) throw new Error(`Missing warlock talent ${id}`);
  return talent;
}

function spec(id: string) {
  const talentSpec = WARLOCK_TALENTS.specs.find((entry) => entry.id === id);
  if (!talentSpec) throw new Error(`Missing warlock spec ${id}`);
  return talentSpec;
}

function abilityEffects(id: string) {
  const effects = node(id).effect?.ability;
  if (!effects) throw new Error(`Missing ability effects for warlock talent ${id}`);
  return effects;
}

describe('warlock low-level sustained damage tuning', () => {
  it('keeps Gloomshade clearly below Emberkin damage after the Emberkin tuning pass', () => {
    const impDps = rawPetDps('emberkin');
    const voidwalkerDps = rawPetDps('gloomshade');

    expect(impDps).toBeCloseTo(13, 1);
    expect(voidwalkerDps).toBeCloseTo(9.1, 1);
    expect(voidwalkerDps / impDps).toBeLessThan(0.75);
    expect(voidwalkerDps / impDps).toBeGreaterThan(0.65);
  });

  it('trims the two strongest maintenance DoTs without changing Shadow Bolt base damage', () => {
    expect(dotTotal('corruption')).toBe(85);
    expect(dotTotal('curse_of_agony')).toBe(78);

    const shadowBolt = ABILITIES.shadow_bolt.ranks?.find((rank) => rank.rank === 4);
    expect(shadowBolt?.effects).toEqual([{ type: 'directDamage', min: 68, max: 84 }]);
  });

  it('keeps affliction and destruction talent amplification in line with the other caster masteries', () => {
    // Masteries were made impactful across all specs (spec identity pass): affliction
    // amplifies its damage-over-time effects, destruction doubles spell crit damage.
    expect(spec('affliction').mastery.effect.global?.dotDmgPct).toBe(0.2);
    expect(spec('destruction').mastery.effect.global?.critDmgSpellPct).toBe(0.5);
    expect(spec('destruction').mastery.effect.stats?.crit).toBe(0.02);

    const afflictionPact = node('wlk_dark_pact').choices?.find(
      (choice) => choice.id === 'wlk_pact_affliction',
    );
    expect(afflictionPact?.effect.global?.spellDmgPct).toBe(0.02);

    expect(abilityEffects('aff_imp_agony')).toContainEqual({
      ability: 'curse_of_agony',
      dmgPct: 0.03,
    });
    expect(abilityEffects('aff_imp_corruption')).toContainEqual({
      ability: 'corruption',
      dmgPct: 0.03,
    });
    expect(abilityEffects('dest_bane')).toEqual([
      { ability: 'shadow_bolt', castPct: -0.01 },
      { ability: 'immolate', castPct: -0.01 },
    ]);
  });
});
