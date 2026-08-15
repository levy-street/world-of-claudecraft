import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { NECROMANCY_MOBS } from '../src/sim/content/necromancy';
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
  it('keeps the temporary undead army near thirty-six raw DPS at level 20', () => {
    const ids = [
      'necromancy_skeletal_warrior',
      'necromancy_bone_mage',
      'necromancy_gravewing',
    ] as const;
    const armyDps = ids.reduce((sum, id) => {
      const undead = NECROMANCY_MOBS[id];
      return sum + (undead.dmgBase + undead.dmgPerLevel * 19) / undead.attackSpeed;
    }, 0);
    const graveguard = NECROMANCY_MOBS.graveguard;
    const graveguardDps =
      (graveguard.dmgBase + graveguard.dmgPerLevel * 19) / graveguard.attackSpeed;

    // The sub-200 re-spread overshot on optimized builds: the 2026-08-07 round
    // walked the warrior (0.65) and bone mage (0.75) per-level rates all the
    // way back and trimmed the gravewing, so the raw temporary-army budget
    // sits near thirty-one now.
    expect(armyDps).toBeGreaterThan(28);
    expect(armyDps).toBeLessThan(34);
    expect(graveguardDps).toBeCloseTo(12.6, 1);
  });

  it('uses the shared Talents V2 row jobs from mobility through capstone utility', () => {
    expect(CHOICE_ROWS.warlock.rows.map((row) => [row.level, row.theme])).toEqual([
      [5, 'mobility'],
      [8, 'control'],
      [11, 'survival'],
      [14, 'resource_behavior'],
      [17, 'major_offense'],
      [20, 'capstone_utility'],
    ]);
  });

  it.each(['affliction', 'demonology', 'destruction'] as const)(
    'keeps every shared row option functional for %s',
    (specId) => {
      const baseline = computeTalentModifiers('warlock', { spec: specId, rows: {} }, 20);
      const known = new Set(
        abilitiesKnownAt('warlock', 20, baseline).map((ability) => ability.def.id),
      );

      for (const row of CHOICE_ROWS.warlock.rows) {
        for (const talent of row.options) {
          const abilityRelevant =
            talent.effect.ability?.some((mod) => known.has(mod.ability)) ?? false;
          const grantRelevant = talent.effect.grant
            ? abilitiesKnownAt(
                'warlock',
                20,
                computeTalentModifiers(
                  'warlock',
                  { spec: specId, rows: { [row.level]: talent.id } },
                  20,
                ),
              ).some((ability) => ability.def.id === talent.effect.grant?.ability)
            : false;
          const trigger =
            talent.effect.proc?.trigger.on === 'castNth' ||
            talent.effect.proc?.trigger.on === 'spellCrit'
              ? talent.effect.proc.trigger.abilities
              : undefined;
          const procRelevant =
            talent.effect.proc !== undefined &&
            (trigger === undefined || trigger.some((ability) => known.has(ability)));
          const universal = talent.effect.stats !== undefined || talent.effect.global !== undefined;

          expect(
            abilityRelevant || grantRelevant || procRelevant || universal,
            `${talent.id} is dead for ${specId}`,
          ).toBe(true);
        }
      }
    },
  );

  it('keeps Gloomshade clearly below Emberkin damage after the Emberkin tuning pass', () => {
    const impDps = rawPetDps('emberkin');
    const voidwalkerDps = rawPetDps('gloomshade');

    expect(impDps).toBeCloseTo(13, 1);
    expect(voidwalkerDps).toBeCloseTo(9.1, 1);
    expect(voidwalkerDps / impDps).toBeLessThan(0.75);
    expect(voidwalkerDps / impDps).toBeGreaterThan(0.65);
  });

  it('pins the maintenance DoTs and the Ruination Gloom Bolt capstone rank', () => {
    expect(dotTotal('corruption')).toBe(85);
    expect(dotTotal('curse_of_agony')).toBe(78);

    const shadowBolt = ABILITIES.shadow_bolt.ranks?.find((rank) => rank.rank === 4);
    expect(shadowBolt?.effects).toEqual([{ type: 'directDamage', min: 126, max: 156 }]);
  });

  it('keeps mastery tuning and the shared generator-resource row canonical', () => {
    // Hexcraft strengthens its generator and payoff while Condemnation owns
    // the rotation. Destruction's identity lives in the Desolation mechanic.
    expect(spec('affliction').mastery.effect.ability).toEqual([
      { ability: 'needle_of_fate', dmgPct: 0.1 },
      { ability: 'sentence', dmgPct: 0.1 },
      // Owner ruling 2026-08-08: Litany joined the mastery so its authored
      // 5/9/14 resolve at the 6/10/15 the viability tests always expected.
      { ability: 'litany_of_guilt', dmgPct: 0.1 },
    ]);
    expect(spec('affliction').mastery.effect.global?.spellDmgPct).toBeUndefined();
    expect(spec('affliction').mastery.effect.global?.dotDmgPct).toBeUndefined();
    expect(spec('destruction').mastery.effect.global?.critDmgSpellPct).toBeUndefined();
    expect(spec('destruction').mastery.effect).toEqual({});
    expect(spec('destruction').mastery.description).toContain('Conflagrate grants Desolation');

    expect(abilityEffects('wlk_r14_amplify_curse')).toEqual([
      { ability: 'needle_of_fate', costPct: -0.25 },
      { ability: 'soul_harvest', costPct: -0.25 },
      { ability: 'shadow_bolt', costPct: -0.25 },
    ]);
    const amplified = computeTalentModifiers(
      'warlock',
      { spec: 'affliction', rows: { 14: 'wlk_r14_amplify_curse' } },
      20,
    );
    expect(amplified.global.dotDmgPct).toBe(0);
    expect(amplified.global.spellDmgPct).toBe(0);
    expect(amplified.abilities.needle_of_fate?.dmgPct).toBeCloseTo(0.18);
    expect(amplified.abilities.sentence?.dmgPct).toBeCloseTo(0.1);
    expect(amplified.abilities.needle_of_fate?.costPct).toBe(-0.33);
    expect(amplified.abilities.soul_harvest?.costPct).toBe(-0.25);
    expect(amplified.abilities.shadow_bolt?.costPct).toBe(-0.25);
  });

  it('keeps both level-17 offensive choices functional for every Warlock spec', () => {
    expect(abilityEffects('wlk_r17_death_coil')).toEqual([
      { ability: 'hex_of_violence', cooldownPct: -0.25 },
      { ability: 'unholy_command', cooldownPct: -0.25 },
      { ability: 'ruinous_brand', cooldownPct: -0.25 },
    ]);
    expect(option('wlk_r17_demonic_resilience').effect.proc).toMatchObject({
      trigger: {
        on: 'castNth',
        n: 3,
        abilities: ['needle_of_fate', 'soul_harvest', 'shadow_bolt'],
        icd: 10,
      },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_cast_instant',
          abilities: ['needle_of_fate', 'soul_harvest', 'shadow_bolt'],
          duration: 8,
        },
      ],
    });
  });

  it('keeps the level-20 capstones utility-focused', () => {
    expect(option('wlk_r20_chaos_bolt').effect.global?.warlockUnbrokenRitual).toBe(0.5);
    expect(option('wlk_r20_curse_mastery').effect.grant).toEqual({
      ability: 'abyssal_rift',
    });
  });

  it('pins Forbidden Reflection instead of the obsolete absorb proc', () => {
    expect(option('wlk_r20_grimoire_of_haste').effect).toMatchObject({
      global: { warlockForbiddenReflection: 60 },
      tuning: { reflectionWindow: 10 },
    });
  });

  it('keeps the warlock choice rows off the mastery axis (no dotDmgPct amplifier)', () => {
    // The point-tree amplifiers lived in the deleted node trees; their
    // successors are the warlock choice rows, which must stay DoT-flavored and
    // bounded (no option may amplify the mastery axis, dotDmgPct).
    for (const row of CHOICE_ROWS.warlock.rows) {
      for (const opt of row.options) {
        expect(opt.effect.global?.dotDmgPct, `${opt.id} stacks the mastery axis`).toBeUndefined();
      }
    }
  });
});
