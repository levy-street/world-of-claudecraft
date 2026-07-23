import { describe, expect, it } from 'vitest';
import { characterSummaryAppearance } from '../src/ui/character_summary_appearance';

describe('characterSummaryAppearance', () => {
  it('carries the complete persisted appearance into the roster preview', () => {
    expect(
      characterSummaryAppearance({
        id: 1,
        name: 'Styled',
        class: 'rogue',
        level: 20,
        skin: 2,
        online: false,
        forceRename: false,
        skinCatalog: 'class',
        mainhandItemId: 'rusty_dagger',
        offhandItemId: 'keen_dirk',
        weaponSkinId: 'frostbite_dagger',
        face: 1,
        hairStyle: 3,
        beard: true,
        hairColor: 0x112233,
        faceColor: 0x445566,
      }),
    ).toEqual({
      cls: 'rogue',
      skin: 2,
      skinCatalog: 'class',
      mainhandItemId: 'rusty_dagger',
      offhandItemId: 'keen_dirk',
      weaponSkinId: 'frostbite_dagger',
      face: 1,
      hairStyle: 3,
      beard: true,
      hairColor: 0x112233,
      faceColor: 0x445566,
    });
  });
});
