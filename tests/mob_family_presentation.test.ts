import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import type { MobFamily } from '../src/sim/types';
import type { TranslationKey } from '../src/ui/i18n';
import { t } from '../src/ui/i18n';
import { hasCrestRecipe } from '../src/ui/icons';
import { crestIdForEntity } from '../src/ui/unit_portrait';

// The mob tooltip label (src/ui/hud.ts showMobHoverTooltip) and crest
// (crestIdForEntity) both key off MobTemplate.family. A family with no
// guide.family.<family>.* i18n entry throws (dev) or shows the raw key
// (release) in the tooltip; one with no CREST_RECIPES entry silently falls
// back to the generic crest. Neither is caught by any test that only checks
// the SFX cue mapping, so this walks every family REAL content actually
// uses (not just the closed MobFamily union, so it fails the moment a new
// family is retagged onto a real mob, exactly the reptile regression).
describe('mob family presentation (tooltip label + crest)', () => {
  const familiesInUse = [...new Set(Object.values(MOBS).map((mob) => mob.family))] as MobFamily[];

  it('has at least the reptile family represented, proving this is not vacuous', () => {
    expect(familiesInUse).toContain('reptile');
  });

  it.each(familiesInUse)('resolves a real tooltip label for family "%s"', (family) => {
    const label =
      family === 'demon'
        ? t('hudChrome.mobTooltip.familyDemon')
        : t(`guide.family.${family}.name` as TranslationKey);
    expect(label.length).toBeGreaterThan(0);
    expect(label.startsWith('guide.family.')).toBe(false);
  });

  // demon is a documented pre-existing exception (see hud_chrome.ts:1540): it has
  // no guide.family.* entry OR crest recipe today and falls back on both, by
  // design, not a regression this suite should chase. Every other family in use
  // must have a real crest.
  it.each(familiesInUse.filter((family) => family !== 'demon'))(
    'has a real crest recipe for family "%s"',
    (family) => {
      expect(hasCrestRecipe(crestIdForEntity('mob', family))).toBe(true);
    },
  );
});
