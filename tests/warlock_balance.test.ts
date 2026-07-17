import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  rowTreeFor,
  TALENTS,
  type TalentRowOption,
} from '../src/sim/content/talents';
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

function option(id: string): TalentRowOption {
  const talent = rowTreeFor('warlock')
    ?.flatMap((row) => [...row.options])
    .find((entry) => entry.id === id);
  if (!talent) throw new Error(`Missing warlock row option ${id}`);
  return talent;
}

function spec(id: string) {
  const talentSpec = TALENTS.warlock.specs.find((entry) => entry.id === id);
  if (!talentSpec) throw new Error(`Missing warlock spec ${id}`);
  return talentSpec;
}

function abilityEffects(id: string) {
  const effects = option(id).effect.ability;
  if (!effects) throw new Error(`Missing ability effects for warlock row option ${id}`);
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

  it('keeps mastery tuning and the active damage-amplification row canonical', () => {
    // Hexcraft trades half of its former flat DoT scalar for the Consume duration weave;
    // Ruination retains its direct spell critical-damage axis.
    expect(spec('affliction').mastery.effect.global?.dotDmgPct).toBe(0.1);
    expect(spec('affliction').mastery.effect.ability).toEqual([
      {
        ability: 'drain_life',
        addEffects: [
          { type: 'extendDot', dot: 'corruption', seconds: 1, maxBonus: 3 },
          { type: 'extendDot', dot: 'curse_of_agony', seconds: 1, maxBonus: 3 },
          { type: 'extendDot', dot: 'siphon_life', seconds: 1, maxBonus: 3 },
        ],
      },
    ]);
    expect(spec('destruction').mastery.effect.global?.critDmgSpellPct).toBe(0.5);
    expect(spec('destruction').mastery.effect.stats?.crit).toBe(0.02);

    expect(abilityEffects('wlk_r14_amplify_curse')).toEqual([
      {
        ability: 'shadow_bolt',
        addEffects: [
          { type: 'extendDot', dot: 'corruption', seconds: 3, maxBonus: 6 },
          { type: 'extendDot', dot: 'curse_of_agony', seconds: 3, maxBonus: 6 },
        ],
      },
    ]);
    const amplified = computeTalentModifiers(
      'warlock',
      { spec: 'affliction', rows: { 14: 'wlk_r14_amplify_curse' } },
      20,
    );
    expect(amplified.global.dotDmgPct).toBe(0.1);
    expect(amplified.abilities.shadow_bolt?.dmgPctVsDotted).toBe(0);
    expect(amplified.abilities.shadow_bolt?.addEffects).toEqual([
      { type: 'extendDot', dot: 'corruption', seconds: 3, maxBonus: 6 },
      { type: 'extendDot', dot: 'curse_of_agony', seconds: 3, maxBonus: 6 },
    ]);
  });

  it('pins the final Hellglass Ward absorb instead of the obsolete point-tree bonuses', () => {
    expect(option('wlk_r20_grimoire_of_haste').effect.proc).toMatchObject({
      id: 'wlk_grimoire_of_carnage',
      trigger: { on: 'castNth', n: 3 },
      responses: [{ kind: 'absorb', amount: 90, duration: 10, name: 'Hellglass Ward' }],
    });
  });
});
