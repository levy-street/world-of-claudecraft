import { describe, expect, it } from 'vitest';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import { buildProfessionTutorialModel } from '../src/ui/profession_tutorial_view';

describe('buildProfessionTutorialModel', () => {
  it('lists the three explainer paragraphs in order behind stable keys', () => {
    const model = buildProfessionTutorialModel();
    expect(model.titleKey).toBe('hudChrome.crafting.tierTutorial.title');
    expect(model.dismissKey).toBe('hudChrome.crafting.tierTutorial.dismiss');
    // Ordered: the tier cap that just bit, the craft-wheel identity concept,
    // then that masters offer attunement quests.
    expect(model.bodyKeys).toEqual([
      'hudChrome.crafting.tierTutorial.tierCap',
      'hudChrome.crafting.tierTutorial.radar',
      'hudChrome.crafting.tierTutorial.masters',
    ]);
  });

  it('draws the first-tier threshold from the sim constant, not a hardcoded 25', () => {
    expect(buildProfessionTutorialModel().targetSkill).toBe(TIER_SKILL_STEP);
  });
});
