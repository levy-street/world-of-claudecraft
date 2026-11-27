// The Maledict Eye's wand shot (Blightcaller, cosmetic) reaches the combat log and
// combat text as the label "Maledict Gaze" with no ability id, like any wand shot.
// The client translates spell labels by their English name, so this pins that the
// label still resolves to each language's Maledict Gaze name.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MALEDICT_GAZE_LABEL } from '../src/sim/combat/affliction';
import { ABILITIES } from '../src/sim/content/classes';
import { abilityDisplayNameFromSource } from '../src/ui/ability_display_name';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

describe('Maledict Gaze wand shot label', () => {
  beforeAll(async () => {
    await Promise.all([ensureLocaleLoaded('de_DE'), ensureLocaleLoaded('zh_CN')]);
  });
  afterEach(() => setLanguage('en'));

  it('is the Maledict Gaze spell name, so the name lookup finds it', () => {
    expect(MALEDICT_GAZE_LABEL).toBe(ABILITIES.maledict_gaze.name);
  });

  it('shows the translated Maledict Gaze name outside English', () => {
    setLanguage('de_DE');
    expect(abilityDisplayNameFromSource(MALEDICT_GAZE_LABEL)).toBe('Fluchblick');
    setLanguage('zh_CN');
    expect(abilityDisplayNameFromSource(MALEDICT_GAZE_LABEL)).toBe('咒眼凝视');
  });
});
