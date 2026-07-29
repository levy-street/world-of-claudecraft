import { describe, expect, it } from 'vitest';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import {
  buildAttunementPreview,
  buildProfessionIdentityView,
  orderSkillsForCard,
  type ProfessionSkillRow,
  uniformSkillChips,
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
      // requiredAmendsProgress(2) = 5 + 3 * 2, the shared switch-cost-at-rest figure.
      returnCost: 11,
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

  it('display-floors fractional skill and ceils points-to-go on the card rows', () => {
    // Fractional mastery gains never round a card readout over an uncrossed
    // threshold: 74.75 reads 74 with 1 to go (the exact value still drives
    // tierForSkill, so the tier stays 2).
    const zero = Object.fromEntries(Object.keys(baseIdentity.craftSkills).map((id) => [id, 0]));
    const view = buildProfessionIdentityView({
      ...baseIdentity,
      craftSkills: { ...zero, cooking: 74.75 },
    });
    const row = view.skills.find((r) => r.craftId === 'cooking');
    expect(row).toMatchObject({ skill: 74, tier: 2, pointsToNextTier: 1 });
  });

  it('orderSkillsForCard sorts major, hobby, dormant knowledge, rest, ring-stable in groups', () => {
    // The 264px cap shows about five of ten rows; in raw ring order the two
    // Material-pair majors sat at ring indices 8 and 9, below the fold. The
    // sort is stable, so ring order decides within each group: weaponcrafting
    // (ring 8) precedes armorcrafting (ring 9) among the majors, and cooking
    // (ring 2) precedes jewelcrafting (ring 7) among dormant knowledge.
    const view = buildProfessionIdentityView(baseIdentity);
    expect(orderSkillsForCard(view.skills).map((row) => row.craftId)).toEqual([
      'weaponcrafting',
      'armorcrafting',
      'leatherworking',
      'cooking',
      'jewelcrafting',
      'engineering',
      'alchemy',
      'tailoring',
      'inscription',
      'enchanting',
    ]);
    // The MODEL's own skills stay in CRAFT_RING order: the professions
    // window's craft ROW LIST maps identity.skills positionally into
    // model.crafts, so the card's presentation sort must be a copy, never an
    // in-place mutation (the regression the final gate caught: the
    // professions_view crafts pin and the window's craft-icon row order
    // reddened when the sort mutated the shared array).
    expect(view.skills[0].craftId).toBe('engineering');
    expect(view.skills[9].craftId).toBe('armorcrafting');
    // The unattuned card is one role group, so the stable sort leaves it in
    // pure ring order (the collapse caption depends on nothing here).
    const unattuned = buildProfessionIdentityView({
      ...baseIdentity,
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
      attunedPairs: [],
    });
    expect(orderSkillsForCard(unattuned.skills)[0].craftId).toBe('engineering');
    expect(orderSkillsForCard(unattuned.skills)[9].craftId).toBe('armorcrafting');
  });

  it('collapses uniform role/cap chips on the unattuned card and never on the attuned one', () => {
    // Unattuned: every row is role unattuned / ceiling rare by construction,
    // so the card-level caption replaces ten repeated chip pairs.
    const unattuned = buildProfessionIdentityView({
      ...baseIdentity,
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
      attunedPairs: [],
    });
    expect(unattuned.uniform).toEqual({ role: 'unattuned', ceiling: 'rare' });
    // Attuned always mixes (two majors beside hobby/dormant rows): no collapse.
    expect(buildProfessionIdentityView(baseIdentity).uniform).toBeNull();
  });

  it('uniformSkillChips requires BOTH dimensions uniform (per-dimension negatives)', () => {
    const row = (role: ProfessionSkillRow['role'], ceiling: ProfessionSkillRow['ceiling']) => ({
      craftId: 'cooking',
      skill: 0,
      tier: 0,
      pointsToNextTier: 25,
      role,
      ceiling,
      dormantKnowledge: false,
    });
    expect(uniformSkillChips([row('unattuned', 'rare'), row('unattuned', 'rare')])).toEqual({
      role: 'unattuned',
      ceiling: 'rare',
    });
    // Same role, mixed ceiling: no collapse.
    expect(uniformSkillChips([row('dormant', 'common'), row('dormant', 'rare')])).toBeNull();
    // Mixed role, same ceiling: no collapse.
    expect(uniformSkillChips([row('hobby', 'rare'), row('unattuned', 'rare')])).toBeNull();
    // No rows: nothing to state once.
    expect(uniformSkillChips([])).toBeNull();
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
      // switchCount defaults to 0, so the return cost is the base 5.
      returnCost: 5,
    });
  });

  it('a remembered quested hobby wins over the skill default for its pair', () => {
    // The pair-transition restore (professions/hobby_memory.ts) will set the
    // remembered hobby, so the pre-commit preview must promise the same.
    const preview = buildAttunementPreview(
      'weaponcrafting+armorcrafting',
      baseIdentity.craftSkills,
      1,
      { 'weaponcrafting+armorcrafting': 'tailoring' },
    );
    expect(preview?.hobbyCraft).toBe('tailoring');
    // A record for a DIFFERENT pair changes nothing here.
    expect(
      buildAttunementPreview('weaponcrafting+armorcrafting', baseIdentity.craftSkills, 1, {
        'tailoring+leatherworking': 'cooking',
      })?.hobbyCraft,
    ).toBe('leatherworking');
  });

  it('an invalid remembered hobby falls back to the skill default (the restore rule)', () => {
    expect(
      buildAttunementPreview('weaponcrafting+armorcrafting', baseIdentity.craftSkills, 0, {
        'weaponcrafting+armorcrafting': 'weaponcrafting', // a major, never a candidate
      })?.hobbyCraft,
    ).toBe('leatherworking');
  });

  it('escalates the return cost with the switch count (requiredAmendsProgress)', () => {
    // 5 + 3 * switchCount, the shared switch-cost-at-rest formula.
    expect(
      buildAttunementPreview('weaponcrafting+armorcrafting', baseIdentity.craftSkills, 0)
        ?.returnCost,
    ).toBe(5);
    expect(
      buildAttunementPreview('weaponcrafting+armorcrafting', baseIdentity.craftSkills, 1)
        ?.returnCost,
    ).toBe(8);
    expect(
      buildAttunementPreview('weaponcrafting+armorcrafting', baseIdentity.craftSkills, 7)
        ?.returnCost,
    ).toBe(26);
  });

  it('returns null for a malformed or non-adjacent target', () => {
    expect(buildAttunementPreview('armorcrafting+cooking', {})).toBeNull();
    expect(buildAttunementPreview('bad', {})).toBeNull();
  });
});
