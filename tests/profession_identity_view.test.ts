import { describe, expect, it } from 'vitest';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import {
  buildAttunementPreview,
  buildProfessionIdentityView,
} from '../src/ui/profession_identity_view';

const baseIdentity = {
  version: 1 as const,
  synced: true,
  craftSkills: {
    armorcrafting: 49,
    weaponcrafting: 25,
    jewelcrafting: 60,
    alchemy: 0,
    engineering: 0,
    cooking: 30,
    inscription: 0,
    enchanting: 0,
    tailoring: 0,
    leatherworking: 0,
  },
  activeArchetype: 'armorcrafting',
  pairedMajor: 'weaponcrafting',
  hobbyCraft: 'leatherworking',
  attunedPairs: ['weaponcrafting+armorcrafting'],
  switchCount: 2,
  amendsProgress: 1,
  amendsRequired: 11,
  knownRecipes: [],
};

describe('buildProfessionIdentityView', () => {
  it('represents the unsynced and unattuned states explicitly', () => {
    expect(buildProfessionIdentityView({ ...baseIdentity, synced: false }).state).toBe('syncing');
    expect(
      buildProfessionIdentityView({
        ...baseIdentity,
        activeArchetype: null,
        pairedMajor: null,
        hobbyCraft: null,
        attunedPairs: [],
      }).state,
    ).toBe('unattuned');
  });

  it('classifies majors, hobby, dormant knowledge, caps, and return history', () => {
    const view = buildProfessionIdentityView(baseIdentity);
    expect(view.state).toBe('attuned');
    expect(view.summary).toMatchObject({
      pairId: 'weaponcrafting+armorcrafting',
      majors: ['armorcrafting', 'weaponcrafting'],
      hobbyCraft: 'leatherworking',
      attunedPairCount: 1,
      returnCount: 2,
    });
    expect(view.skills.find((row) => row.craftId === 'armorcrafting')).toMatchObject({
      role: 'major',
      ceiling: 'unlimited',
      tier: 1,
      pointsToNextTier: 1,
    });
    expect(view.skills.find((row) => row.craftId === 'leatherworking')).toMatchObject({
      role: 'hobby',
      ceiling: 'rare',
    });
    expect(view.skills.find((row) => row.craftId === 'jewelcrafting')).toMatchObject({
      role: 'dormant',
      ceiling: 'common',
      dormantKnowledge: true,
    });
    expect(view.nudges).toContainEqual({
      type: 'nearTier',
      craftId: 'armorcrafting',
      points: 1,
    });
    expect(view.nudges).toContainEqual({ type: 'dormantKnowledge', craftId: 'jewelcrafting' });
  });

  it('shows the first-tier tutorial until any craft reaches tier 1', () => {
    const zero = Object.fromEntries(Object.keys(baseIdentity.craftSkills).map((id) => [id, 0]));
    expect(buildProfessionIdentityView({ ...baseIdentity, craftSkills: zero }).tutorial).toEqual({
      targetSkill: 25,
    });
    expect(buildProfessionIdentityView(baseIdentity).tutorial).toBeNull();
  });

  it('keeps the tutorial hint until the first tier-1 crossing, then never shows it again', () => {
    const zero = Object.fromEntries(Object.keys(baseIdentity.craftSkills).map((id) => [id, 0]));
    const withCooking = (skill: number) =>
      buildProfessionIdentityView({ ...baseIdentity, craftSkills: { ...zero, cooking: skill } });
    // One point short of tier 1 in the best craft: the hint still shows.
    expect(withCooking(24).tutorial).toEqual({ targetSkill: TIER_SKILL_STEP });
    // The first craft to reach skill 25 retires the hint...
    expect(withCooking(25).tutorial).toBeNull();
    // ...and it stays retired as skills keep growing.
    expect(withCooking(80).tutorial).toBeNull();
    expect(withCooking(300).tutorial).toBeNull();
  });
});

describe('buildAttunementPreview', () => {
  it('previews title, majors, deterministic hobby, caps, and retained knowledge', () => {
    expect(
      buildAttunementPreview('weaponcrafting+armorcrafting', baseIdentity.craftSkills),
    ).toEqual({
      target: 'weaponcrafting+armorcrafting',
      majors: ['weaponcrafting', 'armorcrafting'],
      hobbyCraft: 'leatherworking',
      majorCeiling: 'unlimited',
      hobbyCeiling: 'rare',
      otherCeiling: 'common',
      retainsAllSkill: true,
    });
  });

  it('returns null for a malformed or non-adjacent target', () => {
    expect(buildAttunementPreview('armorcrafting+cooking', {})).toBeNull();
    expect(buildAttunementPreview('bad', {})).toBeNull();
  });
});
