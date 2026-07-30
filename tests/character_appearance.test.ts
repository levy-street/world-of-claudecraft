import { describe, expect, it } from 'vitest';
import { SKIN_COUNTS } from '../src/sim/content/skins';
import { ALL_CLASSES } from '../src/sim/types';
import {
  activeCharacterAppearancePreview,
  armorSetIconUrl,
  characterAppearanceOptions,
  offersArmorSet,
} from '../src/ui/character_appearance';

describe('character appearance picker', () => {
  it('numbers unlocked mech cosmetics after the class appearances', () => {
    const options = characterAppearanceOptions('shaman', ['amber_crimson']);

    expect(options.map((option) => ({ kind: option.kind, label: option.label }))).toEqual([
      { kind: 'class', label: 1 },
      { kind: 'class', label: 2 },
      { kind: 'class', label: 3 },
      { kind: 'class', label: 4 },
      { kind: 'class', label: 5 },
      { kind: 'class', label: 6 },
      { kind: 'mech', label: 7 },
    ]);
    expect(options[6]).toMatchObject({
      kind: 'mech',
      skin: 0,
      chromaId: 'amber_crimson',
    });
    // The level-20 armor set is NOT one of these: it is a toggle worn OVER the
    // selected chroma, so giving it a swatch number would both consume a chroma
    // label and imply it is mutually exclusive with one.
    expect(options.some((option) => (option as { kind: string }).kind === 'armored')).toBe(false);
  });

  it('offers the armor set only at the unlock level, per class', () => {
    for (const cls of ALL_CLASSES) {
      expect(offersArmorSet(cls, 1), cls).toBe(false);
      expect(offersArmorSet(cls, 19), cls).toBe(false);
      expect(offersArmorSet(cls, 20), cls).toBe(true);
      expect(offersArmorSet(cls, 60), cls).toBe(true);
    }
  });

  it('points each class at its own committed armor-set icon', () => {
    for (const cls of ALL_CLASSES) {
      expect(armorSetIconUrl(cls), cls).toBe(`/ui/armor-sets/${cls}.webp`);
    }
    // Distinct art per class, never one shared placeholder.
    const urls = new Set(ALL_CLASSES.map((cls) => armorSetIconUrl(cls)));
    expect(urls.size).toBe(ALL_CLASSES.length);
  });

  it('appends unlocked mech cosmetics after every class appearance set', () => {
    for (const cls of ALL_CLASSES) {
      const options = characterAppearanceOptions(cls, ['amber_crimson']);
      const mech = options.find((option) => option.kind === 'mech');

      expect(mech, cls).toMatchObject({
        kind: 'mech',
        label: SKIN_COUNTS[cls] + 1,
        skin: 0,
        chromaId: 'amber_crimson',
      });
    }
  });

  it('reopens the character preview on the active cosmetic body catalog', () => {
    expect(activeCharacterAppearancePreview('shaman', 0, 'mech')).toEqual({
      skin: 0,
      visualKey: 'player_shaman_mech',
    });
    expect(activeCharacterAppearancePreview('paladin', 1, 'class')).toEqual({
      skin: 1,
      visualKey: 'player_paladin',
    });
    expect(activeCharacterAppearancePreview('shaman', 0, 'armored')).toEqual({
      skin: 0,
      visualKey: 'player_shaman_armored',
    });
  });
});
