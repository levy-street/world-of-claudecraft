import { afterEach, describe, expect, it } from 'vitest';
import { GUIDE_PROF_CRAFTS, GUIDE_PROF_ENCHANTING } from '../src/guide/content.generated';
import { professions } from '../src/guide/pages/professions';
import { ENCHANTS } from '../src/sim/content/enchants';
import { esc } from '../src/ui/esc';
import { getLanguage, setLanguage } from '../src/ui/i18n';

const originalLanguage = getLanguage();
afterEach(() => setLanguage(originalLanguage));
function render(id?: string): string {
  setLanguage('en');
  return professions.render({
    params: id ? [id] : [],
    sub: 'professions',
    titleKey: 'guide.nav.professions',
  });
}

describe('Crucible professions public reference', () => {
  it('distinguishes raid collections from the older daily-gated family', () => {
    const html = render();
    expect(html).toContain('3 Cores of the Last Flame');
    expect(html).toContain('item level 35');
    expect(html).toContain('item level 38');
    expect(html).toContain('chest, waist, and feet');
    expect(html).toContain('one core');
    expect(html).toContain('no cooldown');
    expect(html).not.toContain('The gear patterns are found and never sold');
    const recipes = GUIDE_PROF_CRAFTS.flatMap((craft) => craft.recipes).filter((recipe) =>
      recipe.id.startsWith('recipe_crucible_'),
    );
    expect(recipes).toHaveLength(33);
    expect(recipes.every((recipe) => recipe.acquisition === 'dropAndVendor')).toBe(true);
  });

  it('does not claim that every crafted item remains below the raid floor', () => {
    expect(render('armorcrafting')).not.toContain('it stays below the raid floor');
    expect(render('economy')).not.toContain('Crafted gear is tuned to sit below the raid floor');
    expect(render('economy')).toContain('raid-funded collections');
  });

  it('exports and renders the proc enchant effect and formula acquisition gate', () => {
    const row = GUIDE_PROF_ENCHANTING.enchants.find(
      (entry) => entry.id === 'enchant_weapon_lastflame_zeal',
    );
    expect(row).toMatchObject({ requiresFormula: true, hasDescription: true });
    const html = render('enchanting');
    expect(html).toContain(esc(ENCHANTS.enchant_weapon_lastflame_zeal.description));
    expect(html).toContain('Formula required');
  });
});
