// The PUBLIC (null-viewer) arm of src/ui/hud/professions/recipe_pattern_tooltip_view.ts.
// The player encyclopedia renders pattern cards with no character, so the view
// must state the recipe requirement in the neutral tt-sub colour (there is no
// skill to judge it against) and never claim the recipe is already known. A
// synced viewer below the requirement is the positive control: the same line
// still turns tt-red in game. Real shipped patterns only, so the copy pinned
// here is the catalog's own.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  type RecipePatternViewerInput,
  recipePatternTooltipLines,
} from '../src/ui/hud/professions/recipe_pattern_tooltip_view';

const FORMULA = ITEMS.formula_lastflame_zeal;
const MANUAL = ITEMS.pattern_crucible_str_mail;
const KNOWN_LINE = 'You already know that recipe.';
const ENCHANTING_REQ = 'Requires Enchanting 100';

function viewer(over: Partial<RecipePatternViewerInput> = {}): RecipePatternViewerInput {
  return { synced: true, knownRecipes: [], craftSkills: {}, ...over };
}

describe('recipe pattern tooltip with no viewer', () => {
  it('renders the requirement line in the neutral colour', () => {
    const html = recipePatternTooltipLines(FORMULA, null);
    expect(html).toContain(`<div class="tt-sub">${ENCHANTING_REQ}</div>`);
    expect(html).not.toContain(`<div class="tt-red">${ENCHANTING_REQ}</div>`);
    expect(html).not.toContain('tt-red');
  });

  it('never renders the already-known line', () => {
    // A viewer who knows every taught recipe DOES get the line, so its absence
    // on the public card is the null-viewer arm, not missing content.
    const knownRecipes = ['chest', 'waist', 'feet'].map(
      (slot) => `recipe_crucible_str_mail_${slot}`,
    );
    expect(
      recipePatternTooltipLines(
        MANUAL,
        viewer({ knownRecipes, craftSkills: { armorcrafting: 300 } }),
      ),
    ).toContain(KNOWN_LINE);
    const html = recipePatternTooltipLines(MANUAL, null);
    expect(html).not.toContain(KNOWN_LINE);
    expect(html).not.toContain('tt-red');
  });

  it('still renders the teaches lines and the requirement for a collection manual', () => {
    const html = recipePatternTooltipLines(MANUAL, null);
    expect(html).toContain('Crucible Striker&#39;s Hauberk');
    expect(html).toMatch(/<div class="tt-sub">Requires Armorcrafting \d+<\/div>/);
  });

  it('differs from an unsynced viewer, which stops at the teaches lines', () => {
    expect(recipePatternTooltipLines(FORMULA, viewer({ synced: false }))).not.toContain(
      ENCHANTING_REQ,
    );
  });
});

describe('recipe pattern tooltip with a synced viewer (positive control)', () => {
  it('colours an unmet skill requirement tt-red', () => {
    const html = recipePatternTooltipLines(FORMULA, viewer({ craftSkills: { enchanting: 99 } }));
    expect(html).toContain(`<div class="tt-red">${ENCHANTING_REQ}</div>`);
    expect(html).not.toContain(`<div class="tt-sub">${ENCHANTING_REQ}</div>`);
  });

  it('colours a met skill requirement tt-sub', () => {
    const html = recipePatternTooltipLines(FORMULA, viewer({ craftSkills: { enchanting: 100 } }));
    expect(html).toContain(`<div class="tt-sub">${ENCHANTING_REQ}</div>`);
  });
});
