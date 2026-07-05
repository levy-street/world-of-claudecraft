import { describe, expect, it } from 'vitest';
import { ALL_CLASSES } from '../src/sim/types';
import { SKIN_COUNTS } from '../src/sim/content/skins';
import { activeCharacterAppearancePreview, characterAppearanceOptions } from '../src/ui/character_appearance';

describe('character appearance picker', () => {
  it('numbers unlocked mech cosmetics after the class appearances', () => {
    const options = characterAppearanceOptions('shaman', ['amber_crimson']);

    expect(options.map((option) => ({ kind: option.kind, label: option.label }))).toEqual([
      { kind: 'class', label: 1 },
      { kind: 'class', label: 2 },
      { kind: 'class', label: 3 },
      { kind: 'class', label: 4 },
      { kind: 'mech', label: 5 },
    ]);
    expect(options[4]).toMatchObject({
      kind: 'mech',
      skin: 0,
      chromaId: 'amber_crimson',
    });
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
      visualKey: 'player_mech',
    });
    expect(activeCharacterAppearancePreview('paladin', 1, 'class')).toEqual({
      skin: 1,
      visualKey: 'player_paladin',
    });
  });
});
